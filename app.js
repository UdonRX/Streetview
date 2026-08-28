/* Streetview Journey v0.1.3
 * 0.5s pseudo-video playback with route-direction view locking for 360 imagery.
 */
(() => {
  const VERSION = '0.1.3';
  const FRAME_INTERVAL_MS = 500;
  const TRANSITION_MS = 160;
  const PRELOAD_AHEAD = 4;

  const $ = (id) => document.getElementById(id);
  const ui = {
    layerA: $('layerA'), layerB: $('layerB'), startPanel: $('startPanel'), errorPanel: $('errorPanel'),
    startButton: $('startButton'), retryButton: $('retryButton'), errorMessage: $('errorMessage'),
    progressBar: $('progressBar'), frameLabel: $('frameLabel'), placeLabel: $('placeLabel'),
    headingLabel: $('headingLabel'), coordLabel: $('coordLabel'), networkLabel: $('networkLabel'),
    latInput: $('latInput'), lngInput: $('lngInput'), useCoordinates: $('useCoordinates')
  };

  let route = [];
  let activeLayer = ui.layerA;
  let standbyLayer = ui.layerB;
  let wakeLock = null;
  let playbackToken = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const toRad = (deg) => deg * Math.PI / 180;
  const toDeg = (rad) => rad * 180 / Math.PI;

  function shortestAngleDelta(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return ((to - from + 540) % 360) - 180;
  }

  function hasCoords(frame) {
    return Number.isFinite(frame?.lat) && Number.isFinite(frame?.lng);
  }

  function distanceMeters(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return Infinity;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLat = lat2 - lat1;
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }

  function bearingBetween(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return null;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
    return Number.isFinite(bearing) ? bearing : null;
  }

  function routeBearingAt(index) {
    const current = route[index];
    if (!current) return null;

    for (let step = 1; step <= 8 && index + step < route.length; step += 1) {
      const next = route[index + step];
      if (distanceMeters(current, next) >= 1.2) return bearingBetween(current, next);
    }

    for (let step = 1; step <= 8 && index - step >= 0; step += 1) {
      const prev = route[index - step];
      if (distanceMeters(prev, current) >= 1.2) return bearingBetween(prev, current);
    }

    return Number.isFinite(current.heading) ? current.heading : null;
  }

  function viewAnchorX(index) {
    const frame = route[index];
    if (!frame) return 50;
    const travelBearing = routeBearingAt(index);
    const imageHeading = Number.isFinite(frame.heading)
      ? frame.heading
      : (Number.isFinite(frame.projectionYaw) ? frame.projectionYaw : null);
    if (!Number.isFinite(travelBearing) || !Number.isFinite(imageHeading)) return 50;

    const delta = shortestAngleDelta(imageHeading, travelBearing);
    const fov = Number.isFinite(frame.fieldOfView) ? frame.fieldOfView : null;
    const isSphere = String(frame.projection || '').toUpperCase() === 'SPHERE' || (fov && fov >= 180);

    if (isSphere) return clamp(50 + (delta / 360) * 100, 0, 100);

    const horizontalFov = clamp(fov || 100, 45, 170);
    return clamp(50 + (delta / horizontalFov) * 100, 5, 95);
  }

  function setFrameView(layer, index, scale = 1.006) {
    layer.style.objectPosition = `${viewAnchorX(index).toFixed(2)}% 50%`;
    layer.style.transform = `scale(${scale}) translate3d(0,0,0)`;
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { }
  }

  async function refreshWakeLock() {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) await requestWakeLock();
  }

  function preload(frame) {
    if (!frame?.url) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = frame.url;
  }

  function preloadAhead(index) {
    for (let offset = 1; offset <= PRELOAD_AHEAD; offset += 1) preload(route[index + offset]);
  }

  function waitForImage(img, src) {
    return new Promise((resolve, reject) => {
      if (img.src === src && img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = src;
    });
  }

  function updateHud(index, frame) {
    const total = route.length;
    ui.frameLabel.textContent = `${index + 1} / ${total}`;
    ui.progressBar.style.width = `${((index + 1) / total) * 100}%`;
    const travelBearing = routeBearingAt(index);
    ui.headingLabel.textContent = Number.isFinite(travelBearing) ? `${Math.round(travelBearing)}°` : '—°';
    ui.coordLabel.textContent = hasCoords(frame) ? `${frame.lat.toFixed(5)}, ${frame.lng.toFixed(5)}` : '—';
  }

  async function showFirstFrame(frame) {
    activeLayer.style.transition = 'none';
    activeLayer.style.opacity = '0';
    await waitForImage(activeLayer, frame.url);
    setFrameView(activeLayer, 0, 1.006);
    void activeLayer.offsetWidth;
    activeLayer.style.transition = 'opacity 180ms linear, transform 500ms linear';
    activeLayer.style.opacity = '1';
    activeLayer.style.transform = 'scale(1.025) translate3d(0,0,0)';
    await sleep(190);
  }

  async function morphTo(nextFrame, nextIndex) {
    standbyLayer.style.transition = 'none';
    standbyLayer.style.opacity = '0';
    await waitForImage(standbyLayer, nextFrame.url);
    setFrameView(standbyLayer, nextIndex, 1.006);

    void standbyLayer.offsetWidth;
    activeLayer.style.transition = `opacity ${TRANSITION_MS}ms linear, transform ${FRAME_INTERVAL_MS}ms linear`;
    standbyLayer.style.transition = `opacity ${TRANSITION_MS}ms linear, transform ${FRAME_INTERVAL_MS}ms linear`;

    updateHud(nextIndex, nextFrame);
    activeLayer.style.opacity = '0';
    activeLayer.style.transform = 'scale(1.035) translate3d(0,0,0)';
    standbyLayer.style.opacity = '1';
    standbyLayer.style.transform = 'scale(1.025) translate3d(0,0,0)';

    await sleep(TRANSITION_MS + 8);
    const old = activeLayer;
    activeLayer = standbyLayer;
    standbyLayer = old;
  }

  async function play(frames) {
    const token = ++playbackToken;
    route = frames;
    if (!route.length) throw new Error('再生できる画像がありません');

    ui.placeLabel.textContent = route[0].sequenceId ? `Sequence #${route[0].sequenceId}` : 'KartaView route';
    updateHud(0, route[0]);
    preloadAhead(0);
    await showFirstFrame(route[0]);

    let nextChangeAt = performance.now() + FRAME_INTERVAL_MS;

    for (let i = 1; i < route.length && token === playbackToken; i += 1) {
      const nextFrame = route[i];
      await waitForImage(standbyLayer, nextFrame.url);
      if (token !== playbackToken) return;

      const remaining = nextChangeAt - performance.now();
      if (remaining > 0) await sleep(remaining);
      if (token !== playbackToken) return;

      await morphTo(nextFrame, i);
      preloadAhead(i);

      nextChangeAt += FRAME_INTERVAL_MS;
      if (nextChangeAt < performance.now()) nextChangeAt = performance.now() + Math.max(60, FRAME_INTERVAL_MS - TRANSITION_MS);
    }

    if (token === playbackToken && route.length > 2) {
      ui.networkLabel.textContent = 'ルート完了・再スタート';
      await sleep(1200);
      if (token === playbackToken) await play(frames);
    }
  }

  async function fetchRoute() {
    const useCoordinates = ui.useCoordinates.checked;
    const params = new URLSearchParams({ source: 'karta' });
    if (useCoordinates) {
      const lat = Number(ui.latInput.value);
      const lng = Number(ui.lngInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('緯度・経度を確認してください');
      params.set('lat', String(lat));
      params.set('lng', String(lng));
      params.set('radius', '1200');
    } else {
      params.set('sequence', '6187609');
      params.set('index', '650');
    }

    const response = await fetch(`/api/imagery?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `API error ${response.status}`);
    if (!Array.isArray(data.frames) || data.frames.length < 2) throw new Error('連続して再生できる写真が見つかりませんでした');
    return data;
  }

  async function startJourney() {
    ui.startButton.disabled = true;
    ui.startButton.textContent = 'ルートを準備中…';
    ui.errorPanel.hidden = true;
    try {
      await requestWakeLock();
      const data = await fetchRoute();
      ui.networkLabel.textContent = `0.5秒・進行方向固定・${data.frames.length}枚`;
      ui.startPanel.hidden = true;
      await play(data.frames);
    } catch (error) {
      ui.errorMessage.textContent = error?.message || '不明なエラーが発生しました';
      ui.errorPanel.hidden = false;
      ui.startPanel.hidden = true;
    } finally {
      ui.startButton.disabled = false;
      ui.startButton.textContent = '旅をはじめる';
    }
  }

  function resetToStart() {
    playbackToken += 1;
    ui.errorPanel.hidden = true;
    ui.startPanel.hidden = false;
  }

  ui.startButton.addEventListener('click', startJourney);
  ui.retryButton.addEventListener('click', resetToStart);
  document.addEventListener('visibilitychange', refreshWakeLock);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=0.1.3').catch(() => {}));
  }

  console.info(`Streetview Journey v${VERSION}`);
})();
