/* Streetview Journey v0.1.14 Phase 1 Multi-frame Camera Path */
(() => {
  const VERSION = '0.1.14';
  const OPENCV_URL = 'https://docs.opencv.org/4.x/opencv.js';
  const BASE_FILTER = 'brightness(.9) contrast(1.08) saturate(.94)';
  const TILE_COLS = 4;
  const TILE_ROWS = 5;
  const ANALYSIS_W = 80;
  const ANALYSIS_H = 120;
  const ROLL_LIMIT = 3.2;
  const ROLL_EMA = 0.22;
  const ROLL_STEP_LIMIT = 0.36;
  const PRELOAD_AHEAD = 12;
  const VECTOR_SMOOTH = 0.62;
  const VECTOR_PASSES = 3;
  const MAX_NEIGHBOR_DX = 1.65;
  const MAX_NEIGHBOR_DY = 1.25;
  const TILE_OVERLAP_CSS_PX = 12;
  const ACCUM_SCALE = 0.16;
  const NORMALIZE_FPS = 36;
  const FAST_80_FPS = 60;
  const NORMALIZE_SCALE = 0.40;
  const MIN_WEIGHT_BYTE = 3;
  const BRIDGE_RADIAL_GAIN = 0.014;
  const BRIDGE_BLUR_BOOST = 1.20;
  const BRIDGE_MIN_STRENGTH = 0.18;
  const FAR_X0 = 10;
  const FAR_X1 = 70;
  const FAR_Y0 = 20;
  const FAR_Y1 = 78;
  const FAR_SEARCH_X = 5;
  const FAR_SEARCH_Y = 4;
  const FAR_MIN_CONFIDENCE = 0.018;
  const CAMERA_WINDOW_RADIUS = 2;
  const CAMERA_MIN_TRACKS = 8;
  const CAMERA_TARGET_TRACKS = 24;
  const CAMERA_MAX_STEP_X = 4.0;
  const CAMERA_MAX_STEP_Y = 3.0;
  const CAMERA_MAX_STEP_ROLL = 1.0;
  const CAMERA_MAX_STEP_LOG_SCALE = 0.018;
  const CAMERA_MAX_CORR_X = 5.8;
  const CAMERA_MAX_CORR_Y = 4.0;
  const CAMERA_MAX_CORR_ROLL = 1.7;
  const CAMERA_MIN_SCALE = 0.985;
  const CAMERA_MAX_SCALE = 1.015;
  const CAMERA_CV_MIN_CONFIDENCE = 0.10;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rad = (value) => value * Math.PI / 180;
  const deg = (value) => value * 180 / Math.PI;
  const cosineRamp = (t) => .5 - .5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  function installUI() {
    const viewer = $('viewer');
    const card = document.querySelector('.start-card');
    if (viewer && !$('flowCanvas')) {
      const canvas = document.createElement('canvas');
      canvas.id = 'flowCanvas';
      canvas.className = 'flow-canvas';
      viewer.querySelector('#layerB')?.insertAdjacentElement('afterend', canvas);
    }
    $('seamCanvas')?.remove();

    if (card) {
      card.querySelector('.eyebrow').textContent = 'v0.1.14 PHASE 1 CAMERA PATH';
      card.querySelector('h1').textContent = '0.08秒のまま、カメラの軌道を滑らかに。';
      card.querySelector('.lead').textContent = 'OpenCV.jsで複数フレームの背景特徴を追跡し、X/Y・傾き・微小ズームを仮想カメラ軌道として平滑化。既存のFar-field / Tile Flowはフォールバックとして残すPhase 1。';
      const preset = card.querySelector('.preset-card');
      if (preset) {
        preset.querySelector('.preset-title').textContent = 'Phase 1 Multi-frame Camera Path';
        preset.querySelector('strong').textContent = 'Jakarta / KartaView sample sequence';
        preset.querySelector('small').textContent = 'OpenCV feature tracking + Scene-axis + 4×5 Tile Flow / 0.08秒を標準';
      }
      document.querySelector('.speed-lab')?.remove();
      const lab = document.createElement('div');
      lab.className = 'speed-lab';
      lab.innerHTML = `
        <div class="speed-title"><strong>Journey Engine</strong><small>0.08秒を基準に改善</small></div>
        <div class="speed-grid">
          <label><input type="radio" name="driveSpeed" value="80" checked><span>0.08秒<small>標準</small></span></label>
          <label><input type="radio" name="driveSpeed" value="100"><span>0.10秒<small>比較</small></span></label>
          <label><input type="radio" name="driveSpeed" value="120"><span>0.12秒<small>比較</small></span></label>
        </div>`;
      preset?.insertAdjacentElement('beforebegin', lab);
    }

    if (!$('stabilizedTileStyles')) {
      const style = document.createElement('style');
      style.id = 'stabilizedTileStyles';
      document.head.appendChild(style);
    }
    $('stabilizedTileStyles').textContent = `
      .flow-canvas{position:absolute;z-index:2;inset:-3%;width:106%;height:106%;opacity:0;pointer-events:none;filter:${BASE_FILTER};will-change:contents}
      .scene-layer{z-index:1}.vignette,.motion-blur{z-index:3}.top-hud,.bottom-hud{z-index:4}
      .motion-blur.drive-stabilized{opacity:1!important;background:transparent;backdrop-filter:blur(var(--drive-blur,.85px));-webkit-backdrop-filter:blur(var(--drive-blur,.85px));mask-image:radial-gradient(ellipse at center,transparent 0 31%,rgba(0,0,0,.18) 49%,#000 92%);-webkit-mask-image:radial-gradient(ellipse at center,transparent 0 31%,rgba(0,0,0,.18) 49%,#000 92%);transition:none}
      .speed-lab{margin:0 0 12px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.04)}
      .speed-title{display:flex;align-items:end;justify-content:space-between;gap:8px;margin-bottom:9px}.speed-title strong{font-size:12px}.speed-title small{font-size:9px;color:rgba(255,255,255,.48)}
      .speed-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.speed-grid label{position:relative}.speed-grid input{position:absolute;opacity:0;pointer-events:none}
      .speed-grid span{display:grid;gap:3px;text-align:center;padding:10px 4px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035);font-size:11px;font-weight:750}
      .speed-grid span small{font-size:8px;font-weight:500;color:rgba(255,255,255,.45)}.speed-grid input:checked+span{background:#fff;color:#080b0f;border-color:#fff}.speed-grid input:checked+span small{color:rgba(8,11,15,.55)}
      .start-panel{overflow-y:auto}
    `;
  }

  installUI();

  const ui = {
    viewer: $('viewer'), a: $('layerA'), b: $('layerB'), canvas: $('flowCanvas'),
    edgeBlur: document.querySelector('.motion-blur'), start: $('startPanel'), error: $('errorPanel'),
    startBtn: $('startButton'), retry: $('retryButton'), err: $('errorMessage'), bar: $('progressBar'),
    num: $('frameLabel'), place: $('placeLabel'), heading: $('headingLabel'), coord: $('coordLabel'),
    net: $('networkLabel'), lat: $('latInput'), lng: $('lngInput'), coords: $('useCoordinates')
  };

  let route = [];
  let token = 0;
  let wake = null;
  let speedMs = 80;
  let ctx = null;
  let canvasDpr = 1;
  let canvasSignature = '';
  let currentImage = null;
  let colorCanvas = null, colorCtx = null;
  let weightCanvas = null, weightCtx = null;
  let fallbackCanvas = null, fallbackCtx = null;
  let outputImage = null;
  let cvReady = false;
  let cvLoadPromise = null;

  const renderCache = new Map();
  const corsCache = new Map();
  const grayCache = new Map();
  const rollRawCache = new Map();
  const rollSmoothCache = new Map();
  const correctedGrayCache = new Map();
  const farPairCache = new Map();
  const cvPairCache = new Map();
  const motionPairCache = new Map();
  const rawTrajectoryCache = new Map();
  const cameraPoseCache = new Map();
  const stabilizedGrayCache = new Map();
  const tileCache = new Map();
  const blendAssetCache = new Map();

  window.__journeyDiagnostics = {
    version: VERSION,
    opencv: 'loading',
    lastPose: null,
    lastPairMs: 0,
    cameraSamples: 0,
    averageConfidence: 0,
    pairSamples: 0,
    averagePairMs: 0
  };

  function ensureOpenCV() {
    if (window.cv?.Mat && window.cv?.goodFeaturesToTrack && window.cv?.calcOpticalFlowPyrLK) {
      cvReady = true;
      window.__journeyDiagnostics.opencv = 'ready';
      return Promise.resolve(window.cv);
    }
    if (cvLoadPromise) return cvLoadPromise;
    cvLoadPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cvReady = Boolean(value?.Mat && value?.goodFeaturesToTrack && value?.calcOpticalFlowPyrLK);
        window.__journeyDiagnostics.opencv = cvReady ? 'ready' : 'fallback';
        resolve(cvReady ? value : null);
      };
      const detect = () => {
        const candidate = window.cv;
        if (candidate?.Mat && candidate?.goodFeaturesToTrack && candidate?.calcOpticalFlowPyrLK) {
          finish(candidate);
          return true;
        }
        if (candidate?.then) {
          candidate.then((value) => {
            window.cv = value;
            finish(value);
          }).catch(() => finish(null));
          return true;
        }
        return false;
      };
      if (detect()) return;
      let script = document.querySelector('script[data-journey-opencv]');
      if (!script) {
        script = document.createElement('script');
        script.src = OPENCV_URL;
        script.async = true;
        script.dataset.journeyOpencv = '1';
        document.head.appendChild(script);
      }
      const started = performance.now();
      const poll = () => {
        if (settled || detect()) return;
        if (performance.now() - started > 15000) return finish(null);
        setTimeout(poll, 60);
      };
      script.addEventListener('error', () => finish(null), { once: true });
      poll();
    });
    return cvLoadPromise;
  }
  const opencvWithin = (ms) => Promise.race([ensureOpenCV(), sleep(ms).then(() => null)]);
  ensureOpenCV().catch(() => {});

  function angle(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return ((b - a + 540) % 360) - 180;
  }
  function hasCoords(frame) { return Number.isFinite(frame?.lat) && Number.isFinite(frame?.lng); }
  function distanceMeters(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return Infinity;
    const p1 = rad(a.lat), p2 = rad(b.lat), dp = p2 - p1, dl = rad(b.lng - a.lng);
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }
  function bearing(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return null;
    const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lng - a.lng);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function travelBearing(i) {
    const current = route[i];
    if (!current) return null;
    let x = 0, y = 0, weight = 0;
    for (let step = 1; step <= 10 && i + step < route.length; step += 1) {
      const next = route[i + step];
      const distance = distanceMeters(current, next);
      if (!Number.isFinite(distance) || distance < 1) continue;
      const direction = bearing(current, next);
      const w = Math.min(distance, 14) / Math.sqrt(step);
      x += Math.cos(rad(direction)) * w;
      y += Math.sin(rad(direction)) * w;
      weight += w;
      if (distance >= 18) break;
    }
    if (weight) return (deg(Math.atan2(y, x)) + 360) % 360;
    return Number.isFinite(current.heading) ? current.heading : null;
  }
  function isSphere(frame) {
    return String(frame?.projection || '').toUpperCase() === 'SPHERE' ||
      (Number.isFinite(frame?.fieldOfView) && frame.fieldOfView >= 180);
  }
  function anchorX(i) {
    const frame = route[i];
    if (!frame) return 50;
    const travel = travelBearing(i);
    const imageHeading = Number.isFinite(frame.heading) ? frame.heading : frame.projectionYaw;
    if (!Number.isFinite(travel) || !Number.isFinite(imageHeading)) return 50;
    const delta = angle(imageHeading, travel);
    if (isSphere(frame)) return clamp(50 + delta / 3.6, 0, 100);
    return clamp(50 + delta / clamp(frame.fieldOfView || 100, 45, 170) * 100, 5, 95);
  }
  function geoAlignment(i) {
    let anchorDelta = anchorX(i) - anchorX(i + 1);
    if (isSphere(route[i]) || isSphere(route[i + 1])) {
      if (anchorDelta > 50) anchorDelta -= 100;
      if (anchorDelta < -50) anchorDelta += 100;
    }
    const vw = window.innerWidth || 390;
    const turn = angle(travelBearing(i), travelBearing(i + 1));
    const distance = distanceMeters(route[i], route[i + 1]);
    return {
      x: clamp(anchorDelta / 100 * vw * .18 - turn * .22, -18, 18),
      y: 0,
      distance: Number.isFinite(distance) ? distance : 2
    };
  }

  function perceptualBridgeStrength(i) {
    const distance = distanceMeters(route[i], route[i + 1]);
    const turn = Math.abs(angle(travelBearing(i), travelBearing(i + 1)));
    const distancePart = Number.isFinite(distance) ? clamp((distance - 1.2) / 7.0, 0, 1) : .35;
    const turnPart = clamp(turn / 32, 0, 1);
    return clamp(BRIDGE_MIN_STRENGTH + distancePart * .62 + turnPart * .20, BRIDGE_MIN_STRENGTH, 1);
  }
  function setPerceptualBridgeVisual(progress, strength) {
    if (!ui.edgeBlur) return;
    const pulse = Math.sin(Math.PI * clamp(progress, 0, 1));
    const blur = .85 + BRIDGE_BLUR_BOOST * strength * pulse;
    ui.edgeBlur.style.setProperty('--drive-blur', `${blur.toFixed(2)}px`);
  }
  function resetPerceptualBridgeVisual() {
    ui.edgeBlur?.style.setProperty('--drive-blur', '.85px');
  }

  function loadRender(url) {
    if (!renderCache.has(url)) {
      renderCache.set(url, new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('画像を読み込めませんでした'));
        img.src = url;
      }));
    }
    return renderCache.get(url);
  }
  function loadCors(url) {
    if (!corsCache.has(url)) {
      corsCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}analysis=v0114`;
      }));
    }
    return corsCache.get(url);
  }

  function makeCanvas(w, h, alpha) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d', { alpha, willReadFrequently: true }) };
  }
  function canvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
    const w = Math.round((window.innerWidth || 390) * 1.06 * dpr);
    const h = Math.round((window.innerHeight || 844) * 1.06 * dpr);
    if (ui.canvas.width !== w || ui.canvas.height !== h) {
      ui.canvas.width = w; ui.canvas.height = h;
    }
    ctx = ui.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    canvasDpr = dpr;
    const signature = `${w}x${h}@${dpr}`;
    if (signature !== canvasSignature) {
      canvasSignature = signature;
      blendAssetCache.clear();
      const nw = Math.max(160, Math.round(w * NORMALIZE_SCALE));
      const nh = Math.max(260, Math.round(h * NORMALIZE_SCALE));
      ({ canvas: colorCanvas, ctx: colorCtx } = makeCanvas(nw, nh, false));
      ({ canvas: weightCanvas, ctx: weightCtx } = makeCanvas(nw, nh, false));
      ({ canvas: fallbackCanvas, ctx: fallbackCtx } = makeCanvas(nw, nh, false));
      outputImage = colorCtx.createImageData(nw, nh);
    }
    return { w, h, dpr };
  }
  function coverRect(canvas, image, anchorPercent) {
    const cw = canvas.width, ch = canvas.height;
    const ratio = Math.max(cw / image.naturalWidth, ch / image.naturalHeight);
    const dw = image.naturalWidth * ratio, dh = image.naturalHeight * ratio;
    return { x: (cw - dw) * anchorPercent / 100, y: (ch - dh) / 2, w: dw, h: dh };
  }
  function drawBase(targetCtx, image, i, rollDeg, pose = null, alpha = 1) {
    const rect = coverRect(targetCtx.canvas, image, anchorX(i));
    const px = pose ? pose.x * targetCtx.canvas.width / ANALYSIS_W : 0;
    const py = pose ? pose.y * targetCtx.canvas.height / ANALYSIS_H : 0;
    const scale = pose?.scale || 1;
    const cx = targetCtx.canvas.width / 2;
    const cy = targetCtx.canvas.height / 2;
    targetCtx.save();
    targetCtx.globalAlpha = alpha;
    targetCtx.translate(px, py);
    targetCtx.translate(cx, cy);
    targetCtx.rotate(rad(rollDeg + (pose?.roll || 0)));
    targetCtx.scale(scale, scale);
    targetCtx.translate(-cx, -cy);
    targetCtx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    targetCtx.restore();
  }

  async function analysisGray(i) {
    if (grayCache.has(i)) return grayCache.get(i);
    const promise = (async () => {
      const img = await loadCors(route[i].url);
      if (!img) return null;
      const canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_W; canvas.height = ANALYSIS_H;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const rect = coverRect(canvas, img, anchorX(i));
      g.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      try {
        const p = g.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;
        const out = new Float32Array(ANALYSIS_W * ANALYSIS_H);
        for (let k = 0, j = 0; k < out.length; k += 1, j += 4) out[k] = p[j] * .299 + p[j + 1] * .587 + p[j + 2] * .114;
        return out;
      } catch { return null; }
    })();
    grayCache.set(i, promise);
    return promise;
  }

  function edgeMap(gray) {
    const out = new Float32Array(ANALYSIS_W * ANALYSIS_H);
    if (!gray) return out;
    for (let y = 1; y < ANALYSIS_H - 1; y += 1) {
      for (let x = 1; x < ANALYSIS_W - 1; x += 1) {
        const gx = gray[y * ANALYSIS_W + x + 1] - gray[y * ANALYSIS_W + x - 1];
        const gy = gray[(y + 1) * ANALYSIS_W + x] - gray[(y - 1) * ANALYSIS_W + x];
        out[y * ANALYSIS_W + x] = Math.min(255, Math.abs(gx) + Math.abs(gy));
      }
    }
    return out;
  }

  async function rawRoll(i) {
    if (rollRawCache.has(i)) return rollRawCache.get(i);
    const promise = (async () => {
      const gray = await analysisGray(i);
      if (!gray) return 0;
      let sx = 0, sy = 0, sum = 0;
      for (let y = FAR_Y0; y < FAR_Y1; y += 2) {
        const yw = 0.65 + 0.35 * ((y - FAR_Y0) / Math.max(1, FAR_Y1 - FAR_Y0));
        for (let x = FAR_X0; x < FAR_X1; x += 2) {
          const gx = gray[y * ANALYSIS_W + x + 1] - gray[y * ANALYSIS_W + x - 1];
          const gy = gray[(y + 1) * ANALYSIS_W + x] - gray[(y - 1) * ANALYSIS_W + x];
          const mag = Math.hypot(gx, gy);
          if (mag < 20) continue;
          const theta = Math.atan2(gy, gx);
          const axisDistance = Math.min(Math.abs(Math.sin(theta)), Math.abs(Math.cos(theta)));
          if (axisDistance > .42) continue;
          const centerW = 1 - Math.min(0.45, Math.abs(x - ANALYSIS_W / 2) / ANALYSIS_W);
          const weight = Math.min(mag, 170) * yw * centerW;
          sx += Math.cos(4 * theta) * weight;
          sy += Math.sin(4 * theta) * weight;
          sum += weight;
        }
      }
      if (!sum || Math.hypot(sx, sy) / sum < .08) return 0;
      let correction = -deg(Math.atan2(sy, sx)) / 4;
      while (correction > 22.5) correction -= 45;
      while (correction < -22.5) correction += 45;
      return clamp(correction, -ROLL_LIMIT, ROLL_LIMIT);
    })();
    rollRawCache.set(i, promise);
    return promise;
  }

  function smoothRoll(i) {
    if (rollSmoothCache.has(i)) return rollSmoothCache.get(i);
    const promise = (async () => {
      const raw = await rawRoll(i);
      if (i === 0) return clamp(raw * .65, -ROLL_LIMIT, ROLL_LIMIT);
      const prev = await smoothRoll(i - 1);
      const target = prev * (1 - ROLL_EMA) + raw * ROLL_EMA;
      return clamp(prev + clamp(target - prev, -ROLL_STEP_LIMIT, ROLL_STEP_LIMIT), -ROLL_LIMIT, ROLL_LIMIT);
    })();
    rollSmoothCache.set(i, promise);
    return promise;
  }

  async function correctedGray(i) {
    if (correctedGrayCache.has(i)) return correctedGrayCache.get(i);
    const promise = (async () => {
      const img = await loadCors(route[i].url);
      if (!img) return null;
      const roll = await smoothRoll(i);
      const canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_W; canvas.height = ANALYSIS_H;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#111'; g.fillRect(0, 0, ANALYSIS_W, ANALYSIS_H);
      drawBase(g, img, i, roll, null);
      try {
        const data = g.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;
        const gray = new Float32Array(ANALYSIS_W * ANALYSIS_H);
        for (let k = 0, j = 0; k < gray.length; k += 1, j += 4) gray[k] = data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114;
        return gray;
      } catch { return null; }
    })();
    correctedGrayCache.set(i, promise);
    return promise;
  }

  function farScore(a, b, dx, dy) {
    let score = 0, weightSum = 0;
    for (let y = FAR_Y0 + 2; y < FAR_Y1 - 2; y += 2) {
      const by = y + dy;
      if (by < 1 || by >= ANALYSIS_H - 1) continue;
      for (let x = FAR_X0 + 2; x < FAR_X1 - 2; x += 2) {
        const bx = x + dx;
        if (bx < 1 || bx >= ANALYSIS_W - 1) continue;
        const av = a[y * ANALYSIS_W + x];
        const bv = b[by * ANALYSIS_W + bx];
        const localW = 0.45 + Math.min(1.6, (av + bv) / 120);
        score += Math.abs(av - bv) * localW;
        weightSum += localW;
      }
    }
    return weightSum ? score / weightSum : 1e9;
  }

  async function farPair(i) {
    if (farPairCache.has(i)) return farPairCache.get(i);
    const promise = (async () => {
      const [ga, gb] = await Promise.all([correctedGray(i), correctedGray(i + 1)]);
      if (!ga || !gb) return { dx: 0, dy: 0, confidence: 0 };
      const a = edgeMap(ga), b = edgeMap(gb);
      const base = farScore(a, b, 0, 0);
      let best = { dx: 0, dy: 0, score: base };
      for (let dy = -FAR_SEARCH_Y; dy <= FAR_SEARCH_Y; dy += 1) {
        for (let dx = -FAR_SEARCH_X; dx <= FAR_SEARCH_X; dx += 1) {
          const score = farScore(a, b, dx, dy);
          if (score < best.score) best = { dx, dy, score };
        }
      }
      const confidence = clamp((base - best.score) / Math.max(base, 1), 0, 1);
      if (confidence < FAR_MIN_CONFIDENCE) return { dx: 0, dy: 0, confidence };
      return { dx: best.dx, dy: best.dy, confidence };
    })();
    farPairCache.set(i, promise);
    return promise;
  }

  function grayToCvMat(cv, gray) {
    const bytes = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) bytes[i] = clamp(Math.round(gray[i]), 0, 255);
    return cv.matFromArray(ANALYSIS_H, ANALYSIS_W, cv.CV_8UC1, bytes);
  }

  async function cvFeaturePair(i) {
    if (cvPairCache.has(i)) return cvPairCache.get(i);
    const promise = (async () => {
      const cv = await opencvWithin(350);
      const [ga, gb] = await Promise.all([correctedGray(i), correctedGray(i + 1)]);
      if (!cv || !ga || !gb) return { dx: 0, dy: 0, roll: 0, logScale: 0, confidence: 0, tracks: 0, source: 'fallback' };
      let a, b, p0, p1, st, err, mask;
      try {
        a = grayToCvMat(cv, ga);
        b = grayToCvMat(cv, gb);
        p0 = new cv.Mat(); p1 = new cv.Mat(); st = new cv.Mat(); err = new cv.Mat();
        mask = cv.Mat.zeros(ANALYSIS_H, ANALYSIS_W, cv.CV_8UC1);
        const roi = mask.roi(new cv.Rect(4, 7, ANALYSIS_W - 8, ANALYSIS_H - 34));
        roi.setTo(new cv.Scalar(255)); roi.delete();
        cv.goodFeaturesToTrack(a, p0, 90, 0.015, 4, mask, 5, false, 0.04);
        if (!p0.rows || p0.rows < CAMERA_MIN_TRACKS) return { dx: 0, dy: 0, roll: 0, logScale: 0, confidence: 0, tracks: p0.rows || 0, source: 'fallback' };
        const winSize = new cv.Size(15, 15);
        const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 12, 0.03);
        cv.calcOpticalFlowPyrLK(a, b, p0, p1, st, err, winSize, 2, criteria);
        const tracked = [];
        for (let n = 0; n < p0.rows; n += 1) {
          if (!st.data[n]) continue;
          const x0 = p0.data32F[n * 2], y0 = p0.data32F[n * 2 + 1];
          const x1 = p1.data32F[n * 2], y1 = p1.data32F[n * 2 + 1];
          const e = Number.isFinite(err.data32F?.[n]) ? err.data32F[n] : 0;
          if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
          if (x1 < 1 || x1 >= ANALYSIS_W - 1 || y1 < 1 || y1 >= ANALYSIS_H - 1) continue;
          if (e > 55) continue;
          tracked.push({ x0, y0, x1, y1, dx: x1 - x0, dy: y1 - y0, e });
        }
        if (tracked.length < CAMERA_MIN_TRACKS) return { dx: 0, dy: 0, roll: 0, logScale: 0, confidence: 0, tracks: tracked.length, source: 'fallback' };
        const mdx = median(tracked.map((p) => p.dx));
        const mdy = median(tracked.map((p) => p.dy));
        const deviations = tracked.map((p) => Math.hypot(p.dx - mdx, p.dy - mdy));
        const mad = Math.max(0.65, median(deviations));
        const inliers = tracked.filter((p, idx) => deviations[idx] <= Math.max(1.6, mad * 2.6));
        if (inliers.length < CAMERA_MIN_TRACKS) return { dx: mdx, dy: mdy, roll: 0, logScale: 0, confidence: 0.05, tracks: inliers.length, source: 'cv-low' };
        const ax = median(inliers.map((p) => p.x0));
        const ay = median(inliers.map((p) => p.y0));
        const bx = median(inliers.map((p) => p.x1));
        const by = median(inliers.map((p) => p.y1));
        const angles = [], scales = [];
        for (const p of inliers) {
          const ux = p.x0 - ax, uy = p.y0 - ay;
          const vx = p.x1 - bx, vy = p.y1 - by;
          const r0 = Math.hypot(ux, uy), r1 = Math.hypot(vx, vy);
          if (r0 < 7 || r1 < 5) continue;
          angles.push(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
          scales.push(Math.log(clamp(r1 / r0, 0.96, 1.04)));
        }
        const roll = angles.length ? deg(median(angles)) : 0;
        const logScale = scales.length ? median(scales) : 0;
        const inlierRatio = inliers.length / Math.max(1, tracked.length);
        const countScore = clamp(inliers.length / CAMERA_TARGET_TRACKS, 0, 1);
        const medianError = median(inliers.map((p) => p.e));
        const errorScore = clamp(1 - medianError / 45, 0.25, 1);
        const confidence = clamp(inlierRatio * countScore * errorScore, 0, 1);
        return {
          dx: clamp(median(inliers.map((p) => p.dx)), -CAMERA_MAX_STEP_X, CAMERA_MAX_STEP_X),
          dy: clamp(median(inliers.map((p) => p.dy)), -CAMERA_MAX_STEP_Y, CAMERA_MAX_STEP_Y),
          roll: clamp(roll, -CAMERA_MAX_STEP_ROLL, CAMERA_MAX_STEP_ROLL),
          logScale: clamp(logScale, -CAMERA_MAX_STEP_LOG_SCALE, CAMERA_MAX_STEP_LOG_SCALE),
          confidence,
          tracks: inliers.length,
          source: 'cv'
        };
      } catch (error) {
        console.warn('OpenCV tracking fallback', error);
        return { dx: 0, dy: 0, roll: 0, logScale: 0, confidence: 0, tracks: 0, source: 'fallback' };
      } finally {
        [a, b, p0, p1, st, err, mask].forEach((m) => { try { m?.delete?.(); } catch {} });
      }
    })();
    cvPairCache.set(i, promise);
    return promise;
  }

  async function motionPair(i) {
    if (motionPairCache.has(i)) return motionPairCache.get(i);
    const promise = (async () => {
      const cvPair = await cvFeaturePair(i);
      if (cvPair.confidence >= CAMERA_CV_MIN_CONFIDENCE) return cvPair;
      const far = await farPair(i);
      return {
        dx: clamp(far.dx, -CAMERA_MAX_STEP_X, CAMERA_MAX_STEP_X),
        dy: clamp(far.dy, -CAMERA_MAX_STEP_Y, CAMERA_MAX_STEP_Y),
        roll: 0,
        logScale: 0,
        confidence: clamp(far.confidence * 0.55, 0, 0.35),
        tracks: cvPair.tracks || 0,
        source: 'far'
      };
    })();
    motionPairCache.set(i, promise);
    return promise;
  }

  function rawTrajectory(i) {
    if (rawTrajectoryCache.has(i)) return rawTrajectoryCache.get(i);
    const promise = (async () => {
      if (i <= 0) return { x: 0, y: 0, roll: 0, logScale: 0, confidence: 1 };
      const [prev, pair] = await Promise.all([rawTrajectory(i - 1), motionPair(i - 1)]);
      return {
        x: prev.x + pair.dx,
        y: prev.y + pair.dy,
        roll: prev.roll + pair.roll,
        logScale: prev.logScale + pair.logScale,
        confidence: pair.confidence
      };
    })();
    rawTrajectoryCache.set(i, promise);
    return promise;
  }

  function cameraPose(i) {
    if (cameraPoseCache.has(i)) return cameraPoseCache.get(i);
    const promise = (async () => {
      const start = Math.max(0, i - CAMERA_WINDOW_RADIUS);
      const end = Math.min(route.length - 1, i + CAMERA_WINDOW_RADIUS);
      const indices = [];
      for (let k = start; k <= end; k += 1) indices.push(k);
      const rawList = await Promise.all(indices.map(rawTrajectory));
      const raw = await rawTrajectory(i);
      let sx = 0, sy = 0, sr = 0, ss = 0, sw = 0;
      for (let n = 0; n < rawList.length; n += 1) {
        const d = Math.abs(indices[n] - i);
        const w = d === 0 ? 3 : d === 1 ? 2 : 1;
        sx += rawList[n].x * w; sy += rawList[n].y * w; sr += rawList[n].roll * w; ss += rawList[n].logScale * w; sw += w;
      }
      const smooth = { x: sx / sw, y: sy / sw, roll: sr / sw, logScale: ss / sw };
      const localPairs = [];
      for (let k = Math.max(0, i - 2); k < Math.min(route.length - 1, i + 2); k += 1) localPairs.push(motionPair(k));
      const pairs = await Promise.all(localPairs);
      const confidence = pairs.length ? pairs.reduce((s, p) => s + p.confidence, 0) / pairs.length : 0;
      const pose = {
        x: clamp(smooth.x - raw.x, -CAMERA_MAX_CORR_X, CAMERA_MAX_CORR_X),
        y: clamp(smooth.y - raw.y, -CAMERA_MAX_CORR_Y, CAMERA_MAX_CORR_Y),
        roll: clamp(smooth.roll - raw.roll, -CAMERA_MAX_CORR_ROLL, CAMERA_MAX_CORR_ROLL),
        scale: clamp(Math.exp(smooth.logScale - raw.logScale), CAMERA_MIN_SCALE, CAMERA_MAX_SCALE),
        confidence,
        source: cvReady && confidence >= CAMERA_CV_MIN_CONFIDENCE ? 'cv' : 'mixed'
      };
      const diag = window.__journeyDiagnostics;
      diag.lastPose = { ...pose, frame: i };
      diag.cameraSamples += 1;
      diag.averageConfidence += (confidence - diag.averageConfidence) / diag.cameraSamples;
      return pose;
    })();
    cameraPoseCache.set(i, promise);
    return promise;
  }

  async function stabilizedGray(i) {
    if (stabilizedGrayCache.has(i)) return stabilizedGrayCache.get(i);
    const promise = (async () => {
      const img = await loadCors(route[i].url);
      if (!img) return null;
      const [roll, pose] = await Promise.all([smoothRoll(i), cameraPose(i)]);
      const canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_W; canvas.height = ANALYSIS_H;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#111'; g.fillRect(0, 0, ANALYSIS_W, ANALYSIS_H);
      drawBase(g, img, i, roll, pose);
      try {
        const data = g.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;
        const gray = new Float32Array(ANALYSIS_W * ANALYSIS_H);
        for (let k = 0, j = 0; k < gray.length; k += 1, j += 4) gray[k] = data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114;
        return gray;
      } catch { return null; }
    })();
    stabilizedGrayCache.set(i, promise);
    return promise;
  }

  function blockScore(a, b, x0, y0, x1, y1, dx, dy) {
    let score = 0, count = 0;
    for (let y = y0 + 3; y < y1 - 3; y += 2) {
      const by = y + dy;
      if (by < 1 || by >= ANALYSIS_H - 1) continue;
      for (let x = x0 + 3; x < x1 - 3; x += 2) {
        const bx = x + dx;
        if (bx < 1 || bx >= ANALYSIS_W - 1) continue;
        score += Math.abs(a[y * ANALYSIS_W + x] - b[by * ANALYSIS_W + bx]);
        count += 1;
      }
    }
    return count ? score / count : 1e9;
  }
  function tileDepth(col, row) {
    const nx = Math.abs((col + .5) / TILE_COLS - .5) * 2;
    const ny = (row + .5) / TILE_ROWS;
    return clamp(.50 + .55 * ny + .22 * nx, .55, 1.28);
  }
  function smoothVectorField(vectors) {
    let field = vectors.map((v) => ({ ...v }));
    for (let pass = 0; pass < VECTOR_PASSES; pass += 1) {
      const prev = field;
      field = prev.map((v) => {
        let sumX = v.vx * 2.7, sumY = v.vy * 2.7, sumW = 2.7;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const col = v.col + dx, row = v.row + dy;
            if (col < 0 || col >= TILE_COLS || row < 0 || row >= TILE_ROWS) continue;
            const n = prev[row * TILE_COLS + col];
            const weight = dx && dy ? .52 : .94;
            sumX += n.vx * weight; sumY += n.vy * weight; sumW += weight;
          }
        }
        const avgX = sumX / sumW, avgY = sumY / sumW;
        return { ...v, vx: clamp(v.vx * (1 - VECTOR_SMOOTH) + avgX * VECTOR_SMOOTH, -4.8, 4.8), vy: clamp(v.vy * (1 - VECTOR_SMOOTH) + avgY * VECTOR_SMOOTH, -3.6, 3.6) };
      });
    }
    for (let pass = 0; pass < 2; pass += 1) {
      const next = field.map((v) => ({ ...v }));
      for (const v of field) {
        const neighbors = [];
        if (v.col > 0) neighbors.push(field[v.row * TILE_COLS + v.col - 1]);
        if (v.col < TILE_COLS - 1) neighbors.push(field[v.row * TILE_COLS + v.col + 1]);
        if (v.row > 0) neighbors.push(field[(v.row - 1) * TILE_COLS + v.col]);
        if (v.row < TILE_ROWS - 1) neighbors.push(field[(v.row + 1) * TILE_COLS + v.col]);
        if (!neighbors.length) continue;
        const avgX = neighbors.reduce((s, n) => s + n.vx, 0) / neighbors.length;
        const avgY = neighbors.reduce((s, n) => s + n.vy, 0) / neighbors.length;
        const item = next[v.row * TILE_COLS + v.col];
        item.vx = clamp(item.vx, avgX - MAX_NEIGHBOR_DX, avgX + MAX_NEIGHBOR_DX);
        item.vy = clamp(item.vy, avgY - MAX_NEIGHBOR_DY, avgY + MAX_NEIGHBOR_DY);
      }
      field = next;
    }
    return field;
  }

  async function tileVectors(i) {
    if (tileCache.has(i)) return tileCache.get(i);
    const promise = (async () => {
      const geo = geoAlignment(i);
      const globalX = geo.x / Math.max(320, window.innerWidth || 390) * ANALYSIS_W;
      const globalY = geo.y / Math.max(600, window.innerHeight || 844) * ANALYSIS_H;
      const [a, b] = await Promise.all([stabilizedGray(i), stabilizedGray(i + 1)]);
      const vectors = [];
      for (let row = 0; row < TILE_ROWS; row += 1) {
        for (let col = 0; col < TILE_COLS; col += 1) {
          const depth = tileDepth(col, row);
          let vx = globalX * depth, vy = globalY * depth, confidence = 0;
          if (a && b) {
            const x0 = Math.floor(col * ANALYSIS_W / TILE_COLS), x1 = Math.floor((col + 1) * ANALYSIS_W / TILE_COLS);
            const y0 = Math.floor(row * ANALYSIS_H / TILE_ROWS), y1 = Math.floor((row + 1) * ANALYSIS_H / TILE_ROWS);
            const base = blockScore(a, b, x0, y0, x1, y1, 0, 0);
            let best = { dx: 0, dy: 0, score: base };
            for (let dy = -3; dy <= 3; dy += 1) {
              for (let dx = -3; dx <= 3; dx += 1) {
                const score = blockScore(a, b, x0, y0, x1, y1, dx, dy);
                if (score < best.score) best = { dx, dy, score };
              }
            }
            confidence = clamp((base - best.score) / Math.max(base, 1), 0, 1);
            if (confidence >= .018) {
              vx = (best.dx * .78 + globalX * .22) * depth;
              vy = (best.dy * .78 + globalY * .22) * depth;
            }
          }
          vectors.push({ col, row, vx: clamp(vx, -4.8, 4.8), vy: clamp(vy, -3.6, 3.6), confidence, depth });
        }
      }
      return smoothVectorField(vectors);
    })();
    tileCache.set(i, promise);
    return promise;
  }

  async function createStabilizedFrame(image, i) {
    const { w, h } = canvasSize();
    const [roll, pose] = await Promise.all([smoothRoll(i), cameraPose(i)]);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { alpha: false });
    g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
    drawBase(g, image, i, roll, pose);
    return { canvas, roll: roll + pose.roll, pose };
  }

  function blendAsset(col, row) {
    const w = colorCanvas.width, h = colorCanvas.height;
    const overlap = Math.max(3, Math.round(TILE_OVERLAP_CSS_PX * canvasDpr * NORMALIZE_SCALE));
    const x0 = Math.floor(col * w / TILE_COLS), y0 = Math.floor(row * h / TILE_ROWS);
    const x1 = Math.ceil((col + 1) * w / TILE_COLS), y1 = Math.ceil((row + 1) * h / TILE_ROWS);
    const left = col > 0 ? overlap : 0, right = col < TILE_COLS - 1 ? overlap : 0;
    const top = row > 0 ? overlap : 0, bottom = row < TILE_ROWS - 1 ? overlap : 0;
    const sx = Math.max(0, x0 - left), sy = Math.max(0, y0 - top);
    const ex = Math.min(w, x1 + right), ey = Math.min(h, y1 + bottom);
    const sw = ex - sx, sh = ey - sy;
    const key = `${canvasSignature}:${col}:${row}:${overlap}:${sw}x${sh}`;
    if (blendAssetCache.has(key)) return blendAssetCache.get(key);
    const mask = document.createElement('canvas');
    mask.width = sw; mask.height = sh;
    const maskCtx = mask.getContext('2d', { alpha: true });
    const image = maskCtx.createImageData(sw, sh);
    const data = image.data;
    const featherW = Math.max(1, overlap * 2), featherH = Math.max(1, overlap * 2);
    for (let y = 0; y < sh; y += 1) {
      let wy = 1;
      if (row > 0 && y < featherH) wy *= cosineRamp(y / featherH);
      if (row < TILE_ROWS - 1 && y >= sh - featherH) wy *= cosineRamp((sh - 1 - y) / featherH);
      for (let x = 0; x < sw; x += 1) {
        let wx = 1;
        if (col > 0 && x < featherW) wx *= cosineRamp(x / featherW);
        if (col < TILE_COLS - 1 && x >= sw - featherW) wx *= cosineRamp((sw - 1 - x) / featherW);
        const alpha = Math.round(clamp(wx * wy, 0, 1) * 255);
        const k = (y * sw + x) * 4;
        data[k] = 255; data[k + 1] = 255; data[k + 2] = 255; data[k + 3] = alpha;
      }
    }
    maskCtx.putImageData(image, 0, 0);
    const asset = { sx, sy, sw, sh, mask };
    blendAssetCache.set(key, asset);
    return asset;
  }

  function prepareTileLayers(frame) {
    const layers = [];
    const scaleX = frame.width / colorCanvas.width;
    const scaleY = frame.height / colorCanvas.height;
    for (let row = 0; row < TILE_ROWS; row += 1) {
      for (let col = 0; col < TILE_COLS; col += 1) {
        const asset = blendAsset(col, row);
        const c = document.createElement('canvas');
        c.width = asset.sw; c.height = asset.sh;
        const g = c.getContext('2d', { alpha: true });
        g.drawImage(frame, asset.sx * scaleX, asset.sy * scaleY, asset.sw * scaleX, asset.sh * scaleY, 0, 0, asset.sw, asset.sh);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(asset.mask, 0, 0);
        g.globalCompositeOperation = 'source-over';
        layers.push({ asset, color: c });
      }
    }
    return layers;
  }

  function clearAccumulator(targetCtx, w, h) {
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = 1;
    targetCtx.fillStyle = '#000';
    targetCtx.fillRect(0, 0, w, h);
    targetCtx.globalCompositeOperation = 'lighter';
  }

  function accumulateLayer(layer, vector, progress, incoming, temporalAlpha, bridgeStrength) {
    const scaleX = colorCanvas.width / ANALYSIS_W;
    const scaleY = colorCanvas.height / ANALYSIS_H;
    const factor = incoming ? -(1 - progress) : progress;
    const tileCx = layer.asset.sx + layer.asset.sw * .5;
    const tileCy = layer.asset.sy + layer.asset.sh * .5;
    const vanishX = colorCanvas.width * .5;
    const vanishY = colorCanvas.height * .46;
    const radialPhase = incoming ? -(1 - progress) : progress;
    const radial = BRIDGE_RADIAL_GAIN * bridgeStrength * radialPhase;
    const dx = layer.asset.sx + vector.vx * scaleX * factor + (tileCx - vanishX) * radial;
    const dy = layer.asset.sy + vector.vy * scaleY * factor + (tileCy - vanishY) * radial;
    const alpha = temporalAlpha * ACCUM_SCALE;
    colorCtx.globalAlpha = alpha; colorCtx.drawImage(layer.color, dx, dy);
    weightCtx.globalAlpha = alpha; weightCtx.drawImage(layer.asset.mask, dx, dy);
  }

  function drawFallback(frameA, frameB, progress) {
    const w = fallbackCanvas.width, h = fallbackCanvas.height;
    fallbackCtx.globalCompositeOperation = 'source-over';
    fallbackCtx.globalAlpha = 1; fallbackCtx.drawImage(frameA, 0, 0, w, h);
    fallbackCtx.globalAlpha = progress; fallbackCtx.drawImage(frameB, 0, 0, w, h);
    fallbackCtx.globalAlpha = 1;
  }

  function normalizeAccumulation(frameA, frameB, layersA, layersB, vectors, progress, bridgeStrength) {
    const w = colorCanvas.width, h = colorCanvas.height;
    clearAccumulator(colorCtx, w, h);
    clearAccumulator(weightCtx, w, h);
    const outAlpha = 1 - progress, inAlpha = progress;
    for (let n = 0; n < vectors.length; n += 1) accumulateLayer(layersA[n], vectors[n], progress, false, outAlpha, bridgeStrength);
    for (let n = 0; n < vectors.length; n += 1) accumulateLayer(layersB[n], vectors[n], progress, true, inAlpha, bridgeStrength);
    colorCtx.globalCompositeOperation = 'source-over';
    weightCtx.globalCompositeOperation = 'source-over';
    colorCtx.globalAlpha = 1; weightCtx.globalAlpha = 1;
    drawFallback(frameA, frameB, progress);
    const color = colorCtx.getImageData(0, 0, w, h).data;
    const weight = weightCtx.getImageData(0, 0, w, h).data;
    const fallback = fallbackCtx.getImageData(0, 0, w, h).data;
    const out = outputImage.data;
    for (let k = 0; k < out.length; k += 4) {
      const wb = weight[k];
      if (wb > MIN_WEIGHT_BYTE) {
        const scale = 255 / wb;
        out[k] = clamp(Math.round(color[k] * scale), 0, 255);
        out[k + 1] = clamp(Math.round(color[k + 1] * scale), 0, 255);
        out[k + 2] = clamp(Math.round(color[k + 2] * scale), 0, 255);
      } else {
        out[k] = fallback[k]; out[k + 1] = fallback[k + 1]; out[k + 2] = fallback[k + 2];
      }
      out[k + 3] = 255;
    }
    colorCtx.globalCompositeOperation = 'copy';
    colorCtx.putImageData(outputImage, 0, 0);
    colorCtx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(colorCanvas, 0, 0, w, h, 0, 0, ui.canvas.width, ui.canvas.height);
  }

  async function warmAhead(i) {
    const end = Math.min(route.length, i + PRELOAD_AHEAD + 1);
    for (let k = i + 1; k < end; k += 1) loadRender(route[k].url).catch(() => {});
    for (let k = i; k < Math.min(route.length, i + 8); k += 1) smoothRoll(k).catch(() => {});
    for (let k = i; k < Math.min(route.length, i + 7); k += 1) cameraPose(k).catch(() => {});
    for (let k = i; k < Math.min(route.length - 1, i + 4); k += 1) tileVectors(k).catch(() => {});
  }

  function updateHud(i, rollValue = 0, pose = null) {
    const frame = route[i];
    ui.num.textContent = `${i + 1} / ${route.length}`;
    ui.bar.style.width = `${(i + 1) / route.length * 100}%`;
    const direction = travelBearing(i);
    ui.heading.textContent = Number.isFinite(direction) ? `${Math.round(direction)}°` : '—°';
    ui.coord.textContent = hasCoords(frame) ? `${frame.lat.toFixed(5)}, ${frame.lng.toFixed(5)}` : '—';
    const conf = pose && Number.isFinite(pose.confidence) ? Math.round(pose.confidence * 100) : 0;
    const source = pose?.source === 'cv' ? 'CV' : 'Mix';
    ui.net.textContent = `${(speedMs / 1000).toFixed(2)}秒・${source} ${conf}%・水平 ${rollValue >= 0 ? '+' : ''}${rollValue.toFixed(1)}°`;
  }

  async function showFirst() {
    const image = await loadRender(route[0].url);
    const first = await createStabilizedFrame(image, 0);
    canvasSize();
    ctx.drawImage(first.canvas, 0, 0);
    ui.canvas.style.opacity = '1';
    ui.a.style.opacity = '0'; ui.b.style.opacity = '0';
    ui.edgeBlur?.classList.add('drive-stabilized');
    resetPerceptualBridgeVisual();
    currentImage = image;
    updateHud(0, first.roll, first.pose);
  }

  async function animatePair(i) {
    const pairStarted = performance.now();
    const nextImage = await loadRender(route[i + 1].url);
    const [aInfo, bInfo, vectors] = await Promise.all([
      createStabilizedFrame(currentImage, i),
      createStabilizedFrame(nextImage, i + 1),
      tileVectors(i)
    ]);
    const frameA = aInfo.canvas, frameB = bInfo.canvas;
    const layersA = prepareTileLayers(frameA), layersB = prepareTileLayers(frameB);
    const bridgeStrength = perceptualBridgeStrength(i);
    const fast80 = speedMs === 80;
    const duration = fast80 ? 80 : Math.max(88, Math.round(speedMs * .92));
    const minFrameMs = 1000 / (fast80 ? FAST_80_FPS : NORMALIZE_FPS);
    const start = performance.now();
    let lastDraw = -Infinity, finalRendered = false;
    await new Promise((resolve) => {
      function tick(now) {
        const t = clamp((now - start) / duration, 0, 1);
        if (t >= 1 || now - lastDraw >= minFrameMs) {
          setPerceptualBridgeVisual(t, bridgeStrength);
          try {
            normalizeAccumulation(frameA, frameB, layersA, layersB, vectors, t, bridgeStrength);
          } catch (error) {
            console.warn('Phase 1 flow fallback', error);
            ctx.globalAlpha = 1; ctx.drawImage(frameA, 0, 0);
            ctx.globalAlpha = t; ctx.drawImage(frameB, 0, 0);
            ctx.globalAlpha = 1;
          }
          lastDraw = now;
          if (t >= 1) finalRendered = true;
        }
        if (t < 1) requestAnimationFrame(tick); else resolve();
      }
      requestAnimationFrame(tick);
    });
    if (!finalRendered) {
      try { normalizeAccumulation(frameA, frameB, layersA, layersB, vectors, 1, bridgeStrength); } catch {}
    }
    resetPerceptualBridgeVisual();
    ctx.globalAlpha = 1; ctx.drawImage(frameB, 0, 0);
    currentImage = nextImage;
    const elapsed = performance.now() - pairStarted;
    const diag = window.__journeyDiagnostics;
    diag.lastPairMs = elapsed;
    diag.pairSamples += 1;
    diag.averagePairMs += (elapsed - diag.averagePairMs) / diag.pairSamples;
    updateHud(i + 1, bInfo.roll, bInfo.pose);
  }

  async function play(frames) {
    const playToken = ++token;
    route = frames;
    [renderCache, corsCache, grayCache, rollRawCache, rollSmoothCache, correctedGrayCache, farPairCache, cvPairCache, motionPairCache, rawTrajectoryCache, cameraPoseCache, stabilizedGrayCache, tileCache, blendAssetCache].forEach((cache) => cache.clear());
    window.__journeyDiagnostics.cameraSamples = 0;
    window.__journeyDiagnostics.averageConfidence = 0;
    window.__journeyDiagnostics.pairSamples = 0;
    window.__journeyDiagnostics.averagePairMs = 0;
    if (!route.length) throw new Error('再生できる画像がありません');
    ui.place.textContent = route[0].sequenceId ? `Sequence #${route[0].sequenceId}` : 'KartaView route';
    await Promise.race([ensureOpenCV(), sleep(6000)]);
    await warmAhead(0);
    await Promise.race([Promise.all([smoothRoll(0), smoothRoll(1), cameraPose(0), cameraPose(1), tileVectors(0)]), sleep(1100)]);
    await showFirst();
    let nextAt = performance.now() + speedMs;
    for (let i = 0; i < route.length - 1 && playToken === token; i += 1) {
      warmAhead(i + 1);
      const remaining = nextAt - performance.now();
      if (remaining > 0) await sleep(remaining);
      if (playToken !== token) return;
      await animatePair(i);
      nextAt += speedMs;
      if (nextAt < performance.now()) nextAt = performance.now() + Math.max(8, speedMs * .10);
    }
    if (playToken === token) {
      ui.net.textContent = `${(speedMs / 1000).toFixed(2)}秒・再スタート`;
      await sleep(500);
      if (playToken === token) play(frames);
    }
  }

  async function fetchRoute() {
    const p = new URLSearchParams({ source: 'karta' });
    if (ui.coords.checked) {
      const lat = Number(ui.lat.value), lng = Number(ui.lng.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('緯度・経度を確認してください');
      p.set('lat', String(lat)); p.set('lng', String(lng)); p.set('radius', '1200');
    } else {
      p.set('sequence', '6187609'); p.set('index', '650');
    }
    const response = await fetch(`/api/imagery?${p.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `API error ${response.status}`);
    if (!Array.isArray(data.frames) || data.frames.length < 2) throw new Error('連続して再生できる写真が見つかりませんでした');
    return data;
  }
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wake = await navigator.wakeLock.request('screen'); } catch {}
  }
  async function start() {
    ui.startBtn.disabled = true;
    ui.startBtn.textContent = 'カメラ軌道を解析中…';
    ui.error.hidden = true;
    speedMs = Number(document.querySelector('input[name="driveSpeed"]:checked')?.value || 80);
    try {
      await requestWakeLock();
      const data = await fetchRoute();
      ui.start.hidden = true;
      await play(data.frames);
    } catch (error) {
      ui.edgeBlur?.classList.remove('drive-stabilized');
      resetPerceptualBridgeVisual();
      ui.canvas.style.opacity = '0';
      ui.err.textContent = error?.message || '不明なエラーが発生しました';
      ui.error.hidden = false;
      ui.start.hidden = true;
    } finally {
      ui.startBtn.disabled = false;
      ui.startBtn.textContent = '旅をはじめる';
    }
  }
  function reset() {
    token += 1;
    ui.edgeBlur?.classList.remove('drive-stabilized');
    resetPerceptualBridgeVisual();
    ui.canvas.style.opacity = '0';
    ui.error.hidden = true;
    ui.start.hidden = false;
  }

  ui.startBtn.addEventListener('click', start);
  ui.retry.addEventListener('click', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wake || wake.released)) requestWakeLock();
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=0.1.14').catch(() => {}));
  }
  console.info(`Streetview Journey v${VERSION}`);
})();
