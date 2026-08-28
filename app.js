/* Streetview Journey v0.1.0
 * iPhone Safari/PWA prototype: no interaction is required after playback starts.
 */
(() => {
  const VERSION = '0.1.0';
  const FRAME_HOLD_MS = 2500;
  const TRANSITION_MS = 1350;

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

  function shortestAngleDelta(from = 0, to = 0) {
    return ((to - from + 540) % 360) - 180;
  }

  function motionX(fromHeading, toHeading) {
    const delta = shortestAngleDelta(fromHeading, toHeading);
    return clamp(delta * 0.55, -34, 34);
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
    ui.headingLabel.textContent = Number.isFinite(frame.heading) ? `${Math.round(frame.heading)}°` : '—°';
    ui.coordLabel.textContent = Number.isFinite(frame.lat) && Number.isFinite(frame.lng)
      ? `${frame.lat.toFixed(5)}, ${frame.lng.toFixed(5)}` : '—';
  }

  async function showFirstFrame(frame) {
    activeLayer.style.transition = 'none';
    activeLayer.style.opacity = '0';
    await waitForImage(activeLayer, frame.url);
    activeLayer.style.transform = 'scale(1.01) translate3d(0,0,0)';
    requestAnimationFrame(() => {
      activeLayer.style.transition = 'opacity 650ms ease';
      activeLayer.style.opacity = '1';
    });
    await sleep(700);
  }

  async function morphTo(nextFrame, currentFrame) {
    const pan = motionX(currentFrame?.heading, nextFrame.heading);
    standbyLayer.style.transition = 'none';
    standbyLayer.style.opacity = '0';
    standbyLayer.style.transform = `scale(.94) translate3d(${pan * -0.45}px,0,0)`;
    await waitForImage(standbyLayer, nextFrame.url);

    void standbyLayer.offsetWidth;
    activeLayer.style.transition = `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms cubic-bezier(.2,.72,.25,1)`;
    standbyLayer.style.transition = `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms cubic-bezier(.2,.72,.25,1)`;

    activeLayer.style.opacity = '0';
    activeLayer.style.transform = `scale(1.11) translate3d(${pan}px,0,0)`;
    standbyLayer.style.opacity = '1';
    standbyLayer.style.transform = 'scale(1.01) translate3d(0,0,0)';

    await sleep(TRANSITION_MS + 40);
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
    await showFirstFrame(route[0]);
    preload(route[1]);

    for (let i = 1; i < route.length && token === playbackToken; i += 1) {
      await sleep(FRAME_HOLD_MS);
      if (token !== playbackToken) return;
      await morphTo(route[i], route[i - 1]);
      updateHud(i, route[i]);
      preload(route[i + 1]);
    }

    if (token === playbackToken && route.length > 2) {
      await sleep(1800);
      const reversed = [...route].reverse();
      await play(reversed);
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
      ui.networkLabel.textContent = `節約モード・${data.frames.length}枚`;
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
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  console.info(`Streetview Journey v${VERSION}`);
})();
