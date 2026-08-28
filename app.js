/* Streetview Journey v0.1.4 Smooth Motion
 * 0.5s pseudo-video playback with direction lock, match-cut alignment and micro motion blur.
 */
(() => {
  const VERSION = '0.1.4';
  const FRAME_INTERVAL_MS = 500;
  const CROSSFADE_MS = 80;
  const ALIGN_RELEASE_MS = 135;
  const PRELOAD_AHEAD = 4;
  const BLUR_PX = 1.35;
  const BASE_SCALE = 1.008;
  const FORWARD_SCALE = 1.032;

  const $ = (id) => document.getElementById(id);
  const ui = {
    layerA: $('layerA'), layerB: $('layerB'), motionBlur: document.querySelector('.motion-blur'),
    startPanel: $('startPanel'), errorPanel: $('errorPanel'), startButton: $('startButton'),
    retryButton: $('retryButton'), errorMessage: $('errorMessage'), progressBar: $('progressBar'),
    frameLabel: $('frameLabel'), placeLabel: $('placeLabel'), headingLabel: $('headingLabel'),
    coordLabel: $('coordLabel'), networkLabel: $('networkLabel'), latInput: $('latInput'),
    lngInput: $('lngInput'), useCoordinates: $('useCoordinates')
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

  function isSphereFrame(frame) {
    const fov = Number.isFinite(frame?.fieldOfView) ? frame.fieldOfView : null;
    return String(frame?.projection || '').toUpperCase() === 'SPHERE' || (fov && fov >= 180);
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

    if (isSphereFrame(frame)) return clamp(50 + (delta / 360) * 100, 0, 100);

    const horizontalFov = clamp(fov || 100, 45, 170);
    return clamp(50 + (delta / horizontalFov) * 100, 5, 95);
  }

  function anchorDeltaPercent(fromIndex, toIndex) {
    let delta = viewAnchorX(fromIndex) - viewAnchorX(toIndex);
    if (isSphereFrame(route[fromIndex]) || isSphereFrame(route[toIndex])) {
      if (delta > 50) delta -= 100;
      if (delta < -50) delta += 100;
    }
    return delta;
  }

  function alignmentFor(currentIndex, nextIndex) {
    const current = route[currentIndex];
    const next = route[nextIndex];
    const currentBearing = routeBearingAt(currentIndex);
    const nextBearing = routeBearingAt(nextIndex);
    const turnDelta = shortestAngleDelta(currentBearing, nextBearing);
    const anchorDelta = anchorDeltaPercent(currentIndex, nextIndex);
    const viewportWidth = Math.max(320, window.innerWidth || 390);

    const anchorShift = (anchorDelta / 100) * viewportWidth * 0.22;
    const turnShift = -turnDelta * 0.28;
    const shiftX = clamp(anchorShift + turnShift, -20, 20);

    const distance = distanceMeters(current, next);
    const moved = Number.isFinite(distance) ? clamp(distance, 0, 12) : 2;
    const matchScale = clamp(1 - moved * 0.0017, 0.984, 1.0);

    return { shiftX, matchScale };
  }

  function setFrameView(layer, index, scale = BASE_SCALE, shiftX = 0) {
    layer.style.objectPosition = `${viewAnchorX(index).toFixed(2)}% 50%`;
    layer.style.transform = `scale(${scale}) translate3d(${shiftX.toFixed(2)}px,0,0)`;
  }

  function setBlur(layer, px) {
    layer.style.filter = `brightness(.9) contrast(1.08) saturate(.94) blur(${px}px)`;
  }

  function pulseMotionBlur(on) {
    if (!ui.motionBlur) return;
    ui.motionBlur.classList.toggle('is-active', on);
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
    setBlur(activeLayer, 0);
    await waitForImage(activeLayer, frame.url);
    setFrameView(activeLayer, 0, BASE_SCALE, 0);
    void activeLayer.offsetWidth;
    activeLayer.style.transition = 'opacity 120ms linear, transform 500ms linear';
    activeLayer.style.opacity = '1';
    activeLayer.style.transform = `scale(${FORWARD_SCALE}) translate3d(0,0,0)`;
    await sleep(130);
  }

  async function morphTo(nextFrame, currentIndex, nextIndex) {
    await waitForImage(standbyLayer, nextFrame.url);
    const alignment = alignmentFor(currentIndex, nextIndex);

    standbyLayer.style.transition = 'none';
    standbyLayer.style.opacity = '0';
    setBlur(standbyLayer, BLUR_PX);
    setFrameView(standbyLayer, nextIndex, alignment.matchScale, alignment.shiftX);

    activeLayer.style.transition = 'filter 35ms linear';
    setBlur(activeLayer, BLUR_PX * 0.72);
    pulseMotionBlur(true);
    await sleep(28);

    void standbyLayer.offsetWidth;
    activeLayer.style.transition = `opacity ${CROSSFADE_MS}ms linear, transform ${ALIGN_RELEASE_MS}ms ease-out, filter ${CROSSFADE_MS}ms linear`;
    standbyLayer.style.transition = `opacity ${CROSSFADE_MS}ms linear, transform ${ALIGN_RELEASE_MS}ms cubic-bezier(.22,.72,.26,1), filter ${ALIGN_RELEASE_MS}ms ease-out`;

    updateHud(nextIndex, nextFrame);
    activeLayer.style.opacity = '0';
    activeLayer.style.transform = `scale(${(FORWARD_SCALE + 0.006).toFixed(3)}) translate3d(${(-alignment.shiftX * 0.2).toFixed(2)}px,0,0)`;
    setBlur(activeLayer, BLUR_PX);

    standbyLayer.style.opacity = '1';
    standbyLayer.style.transform = `scale(${BASE_SCALE}) translate3d(0,0,0)`;
    setBlur(standbyLayer, 0);

    await sleep(ALIGN_RELEASE_MS + 8);
    pulseMotionBlur(false);

    const old = activeLayer;
    activeLayer = standbyLayer;
    standbyLayer = old;

    activeLayer.style.transition = `transform ${Math.max(220, FRAME_INTERVAL_MS - ALIGN_RELEASE_MS)}ms linear, filter 45ms linear`;
    activeLayer.style.transform = `scale(${FORWARD_SCALE}) translate3d(0,0,0)`;
    setBlur(activeLayer, 0);
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

      await morphTo(nextFrame, i - 1, i);
      preloadAhead(i);

      nextChangeAt += FRAME_INTERVAL_MS;
      if (nextChangeAt < performance.now()) nextChangeAt = performance.now() + Math.max(80, FRAME_INTERVAL_MS - ALIGN_RELEASE_MS);
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
      ui.networkLabel.textContent = `0.5秒・Smooth Motion・${data.frames.length}枚`;
      ui.startPanel.hidden = true;
      await play(data.frames);
    } catch (error) {
      pulseMotionBlur(false);
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
    pulseMotionBlur(false);
    ui.errorPanel.hidden = true;
    ui.startPanel.hidden = false;
  }

  ui.startButton.addEventListener('click', startJourney);
  ui.retryButton.addEventListener('click', resetToStart);
  document.addEventListener('visibilitychange', refreshWakeLock);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=0.1.4').catch(() => {}));
  }

  console.info(`Streetview Journey v${VERSION}`);
})();
