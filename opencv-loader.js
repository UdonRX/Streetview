/* Streetview Journey v0.1.20 Lazy OpenCV Loader */
(() => {
  const LOADER_VERSION = '0.1.20';
  const SOURCES = [
    {
      label: 'jsDelivr @techstark/opencv-js 4.10.0',
      url: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'
    },
    {
      label: 'unpkg @techstark/opencv-js 4.10.0',
      url: 'https://unpkg.com/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'
    }
  ];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const state = window.__opencvLoaderState = {
    version: LOADER_VERSION,
    source: null,
    sourceLabel: null,
    attempt: 0,
    requested: false,
    loading: false,
    script: false,
    runtime: false,
    promise: true,
    mat: false,
    lk: false,
    ready: false,
    error: null,
    startedAt: 0
  };

  window.cv = readyPromise;

  const isApiReady = (cv) =>
    Boolean(cv?.Mat && cv?.matFromArray && cv?.goodFeaturesToTrack && cv?.calcOpticalFlowPyrLK);

  function updateApiState(cv) {
    state.mat = Boolean(cv?.Mat && cv?.matFromArray);
    state.lk = Boolean(cv?.goodFeaturesToTrack && cv?.calcOpticalFlowPyrLK);
    if (!isApiReady(cv)) return false;

    state.runtime = true;
    state.ready = true;
    state.loading = false;
    state.error = null;
    window.cv = cv;
    resolveReady(cv);
    window.dispatchEvent(new CustomEvent('journey-opencv-ready', {
      detail: {
        version: LOADER_VERSION,
        source: state.source,
        sourceLabel: state.sourceLabel
      }
    }));
    return true;
  }

  function attachRuntimeHook(target) {
    if (!target || typeof target !== 'object' || typeof target.then === 'function') return;
    if (target.__journeyRuntimeHooked) return;
    try {
      const previous = target.onRuntimeInitialized;
      target.onRuntimeInitialized = function () {
        state.runtime = true;
        try { previous?.apply(this, arguments); } catch {}
        Promise.resolve().then(async () => {
          const cv = await unwrapRuntimeCandidate(1800);
          if (cv) updateApiState(cv);
        });
      };
      target.__journeyRuntimeHooked = true;
    } catch {}
  }

  async function unwrapRuntimeCandidate(timeoutMs = 1000) {
    const candidate = window.cv;
    if (!candidate || candidate === readyPromise) return null;
    if (typeof candidate.then === 'function') {
      state.promise = true;
      try {
        const resolved = await Promise.race([
          candidate,
          sleep(timeoutMs).then(() => null)
        ]);
        if (resolved) {
          window.cv = resolved;
          attachRuntimeHook(resolved);
          return resolved;
        }
      } catch (error) {
        state.error = `cv Promise: ${error?.message || error}`;
      }
      return null;
    }
    attachRuntimeHook(candidate);
    return candidate;
  }

  function installRuntimeModule() {
    const oldModule = window.Module && typeof window.Module === 'object' ? window.Module : {};
    const previousRuntime = oldModule.onRuntimeInitialized;
    window.Module = {
      ...oldModule,
      onRuntimeInitialized() {
        state.runtime = true;
        try { previousRuntime?.(); } catch {}
        Promise.resolve().then(async () => {
          const cv = await unwrapRuntimeCandidate(1800);
          if (cv) updateApiState(cv);
        });
      }
    };
  }

  function renderLoaderState() {
    const eyebrow = document.querySelector('.start-card .eyebrow');
    if (eyebrow && eyebrow.textContent !== 'v0.1.20 PHASE 1.2.3 LAZY OPENCV FIX') {
      eyebrow.textContent = 'v0.1.20 PHASE 1.2.3 LAZY OPENCV FIX';
    }
    const diag = document.getElementById('journeyDiag');
    if (!diag) return;
    let line = document.getElementById('jdLoader');
    if (!line) {
      line = document.createElement('div');
      line.id = 'jdLoader';
      line.style.color = 'rgba(171,224,255,.95)';
      line.style.marginBottom = '2px';
      const head = diag.querySelector('.jd-head');
      head?.insertAdjacentElement('afterend', line);
    }
    const flag = (ok) => ok ? '✓' : '—';
    const phase = !state.requested ? '待機' : (state.ready ? 'Ready' : state.loading ? 'Loading' : 'Fallback');
    line.textContent =
      `Loader ${phase} Script${flag(state.script)} Runtime${flag(state.runtime)} Mat${flag(state.mat)} LK${flag(state.lk)}`;
    if (state.sourceLabel) line.textContent += ` / ${state.sourceLabel}`;
    if (state.error && !state.ready) line.textContent += ` / ${state.error}`;
  }

  async function waitUntilReady(maxMs) {
    const started = performance.now();
    while (performance.now() - started < maxMs) {
      const cv = await unwrapRuntimeCandidate(1200);
      if (cv && updateApiState(cv)) return cv;
      await sleep(80);
    }
    return null;
  }

  async function loadSource(source, attempt) {
    state.source = source.url;
    state.sourceLabel = source.label;
    state.attempt = attempt + 1;
    state.script = false;
    state.runtime = false;
    state.mat = false;
    state.lk = false;
    state.error = null;

    installRuntimeModule();

    const stale = document.querySelector('script[data-journey-opencv-runtime]');
    if (stale) stale.remove();

    try { delete window.cv; } catch { window.cv = undefined; }

    const script = document.createElement('script');
    script.async = true;
    script.src = source.url;
    script.dataset.journeyOpencvRuntime = '1';
    script.dataset.loaderVersion = LOADER_VERSION;
    script.referrerPolicy = 'no-referrer';

    const loaded = new Promise((resolve, reject) => {
      script.addEventListener('load', async () => {
        state.script = true;
        const cv = await unwrapRuntimeCandidate(1800);
        if (cv) updateApiState(cv);
        resolve(true);
      }, { once: true });
      script.addEventListener('error', () => {
        state.error = `script load failed (${attempt + 1})`;
        reject(new Error(state.error));
      }, { once: true });
    });

    document.head.appendChild(script);
    await loaded;
    return waitUntilReady(20000);
  }

  let bootPromise = null;
  async function start() {
    if (state.ready) return window.cv;
    if (bootPromise) return bootPromise;

    state.requested = true;
    state.loading = true;
    state.startedAt = performance.now();

    bootPromise = (async () => {
      for (let i = 0; i < SOURCES.length; i += 1) {
        try {
          const cv = await loadSource(SOURCES[i], i);
          if (cv) return cv;
          state.error = `runtime timeout (${i + 1})`;
        } catch (error) {
          state.error = error?.message || String(error);
        }
      }
      state.loading = false;
      state.ready = false;
      const error = new Error(state.error || 'OpenCV load failed');
      rejectReady(error);
      window.dispatchEvent(new CustomEvent('journey-opencv-failed', { detail: { ...state } }));
      return null;
    })();

    return bootPromise;
  }

  const startButton = document.getElementById('startButton');
  startButton?.addEventListener('click', () => {
    requestAnimationFrame(() => setTimeout(() => start().catch(() => {}), 0));
  });

  window.__journeyOpenCVLoader = {
    version: LOADER_VERSION,
    state,
    ready: readyPromise,
    start
  };

  setInterval(renderLoaderState, 250);
  console.info(`Streetview Journey Lazy OpenCV Loader v${LOADER_VERSION}`);
})();
