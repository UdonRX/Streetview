/* Streetview Journey v0.1.6 Stabilized Tile Flow */
(() => {
  const VERSION = '0.1.6';
  const BASE_FILTER = 'brightness(.9) contrast(1.08) saturate(.94)';
  const TILE_COLS = 4;
  const TILE_ROWS = 5;
  const ANALYSIS_W = 80;
  const ANALYSIS_H = 120;
  const ROLL_LIMIT = 3.5;
  const ROLL_EMA = 0.34;
  const ROLL_STEP_LIMIT = 0.72;
  const PRELOAD_AHEAD = 12;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rad = (deg) => deg * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;

  function installUI() {
    const viewer = $('viewer');
    const card = document.querySelector('.start-card');

    if (viewer && !$('flowCanvas')) {
      const canvas = document.createElement('canvas');
      canvas.id = 'flowCanvas';
      canvas.className = 'flow-canvas';
      viewer.querySelector('#layerB')?.insertAdjacentElement('afterend', canvas);
    }

    if (card) {
      card.querySelector('.eyebrow').textContent = 'v0.1.6 STABILIZED TILE FLOW';
      card.querySelector('h1').textContent = '酔いにくいドライブ映像へ。';
      card.querySelector('.lead').textContent = 'Bモードを水平化し、画面を20タイルに分割。近景と遠景を別々の速度でワープさせる実験版。';
      const preset = card.querySelector('.preset-card');
      if (preset) {
        preset.querySelector('.preset-title').textContent = 'Stabilized Tile Flowデモ';
        preset.querySelector('strong').textContent = 'Jakarta / KartaView sample sequence';
        preset.querySelector('small').textContent = '傾き補正 + 4×5 Tile Flow / 0.10・0.12・0.15秒を比較';
      }

      if (!document.querySelector('.speed-lab')) {
        const lab = document.createElement('div');
        lab.className = 'speed-lab';
        lab.innerHTML = `
          <div class="speed-title"><strong>B 自転車・ドライブ風</strong><small>再生速度を比較</small></div>
          <div class="speed-grid">
            <label><input type="radio" name="driveSpeed" value="100"><span>0.10秒<small>最速</small></span></label>
            <label><input type="radio" name="driveSpeed" value="120" checked><span>0.12秒<small>標準</small></span></label>
            <label><input type="radio" name="driveSpeed" value="150"><span>0.15秒<small>安定</small></span></label>
          </div>`;
        preset?.insertAdjacentElement('beforebegin', lab);
      }
    }

    if (!$('stabilizedTileStyles')) {
      const style = document.createElement('style');
      style.id = 'stabilizedTileStyles';
      style.textContent = `
        .flow-canvas{position:absolute;z-index:2;inset:-3%;width:106%;height:106%;opacity:0;pointer-events:none;filter:${BASE_FILTER};will-change:contents}
        .scene-layer{z-index:1}.vignette,.motion-blur{z-index:3}.top-hud,.bottom-hud{z-index:4}
        .motion-blur.drive-stabilized{opacity:1!important;background:transparent;backdrop-filter:blur(.85px);-webkit-backdrop-filter:blur(.85px);mask-image:radial-gradient(ellipse at center,transparent 0 31%,rgba(0,0,0,.18) 49%,#000 92%);-webkit-mask-image:radial-gradient(ellipse at center,transparent 0 31%,rgba(0,0,0,.18) 49%,#000 92%);transition:none}
        .speed-lab{margin:0 0 12px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.04)}
        .speed-title{display:flex;align-items:end;justify-content:space-between;gap:8px;margin-bottom:9px}.speed-title strong{font-size:12px}.speed-title small{font-size:9px;color:rgba(255,255,255,.48)}
        .speed-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.speed-grid label{position:relative}.speed-grid input{position:absolute;opacity:0;pointer-events:none}
        .speed-grid span{display:grid;gap:3px;text-align:center;padding:10px 4px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035);font-size:11px;font-weight:750}
        .speed-grid span small{font-size:8px;font-weight:500;color:rgba(255,255,255,.45)}.speed-grid input:checked+span{background:#fff;color:#080b0f;border-color:#fff}.speed-grid input:checked+span small{color:rgba(8,11,15,.55)}
        .start-panel{overflow-y:auto}
      `;
      document.head.appendChild(style);
    }
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
  let speedMs = 120;
  let ctx = null;
  let currentImage = null;

  const renderCache = new Map();
  const corsCache = new Map();
  const grayCache = new Map();
  const rollRawCache = new Map();
  const rollSmoothCache = new Map();
  const tileCache = new Map();

  function angle(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return ((b - a + 540) % 360) - 180;
  }

  function hasCoords(frame) {
    return Number.isFinite(frame?.lat) && Number.isFinite(frame?.lng);
  }

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
      const d = distanceMeters(current, next);
      if (!Number.isFinite(d) || d < 1) continue;
      const b = bearing(current, next);
      const w = Math.min(d, 14) / Math.sqrt(step);
      x += Math.cos(rad(b)) * w;
      y += Math.sin(rad(b)) * w;
      weight += w;
      if (d >= 18) break;
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
    const d = distanceMeters(route[i], route[i + 1]);
    return {
      x: clamp(anchorDelta / 100 * vw * .18 - turn * .22, -18, 18),
      y: 0,
      distance: Number.isFinite(d) ? d : 2
    };
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
        img.src = `${url}${sep}analysis=v016`;
      }));
    }
    return corsCache.get(url);
  }

  function canvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.05);
    const w = Math.round((window.innerWidth || 390) * 1.06 * dpr);
    const h = Math.round((window.innerHeight || 844) * 1.06 * dpr);
    if (ui.canvas.width !== w || ui.canvas.height !== h) {
      ui.canvas.width = w;
      ui.canvas.height = h;
    }
    ctx = ui.canvas.getContext('2d', { alpha: false });
    return { w, h, dpr };
  }

  function coverRect(canvas, image, anchorPercent) {
    const cw = canvas.width, ch = canvas.height;
    const ratio = Math.max(cw / image.naturalWidth, ch / image.naturalHeight);
    const dw = image.naturalWidth * ratio, dh = image.naturalHeight * ratio;
    return { x: (cw - dw) * anchorPercent / 100, y: (ch - dh) / 2, w: dw, h: dh };
  }

  function drawCorrected(targetCtx, image, i, rollDeg, alpha = 1) {
    const rect = coverRect(targetCtx.canvas, image, anchorX(i));
    targetCtx.save();
    targetCtx.globalAlpha = alpha;
    targetCtx.translate(targetCtx.canvas.width / 2, targetCtx.canvas.height / 2);
    targetCtx.rotate(rad(rollDeg));
    targetCtx.translate(-targetCtx.canvas.width / 2, -targetCtx.canvas.height / 2);
    targetCtx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    targetCtx.restore();
  }

  async function analysisGray(i) {
    if (grayCache.has(i)) return grayCache.get(i);
    const promise = (async () => {
      const img = await loadCors(route[i].url);
      if (!img) return null;
      const canvas = document.createElement('canvas');
      canvas.width = ANALYSIS_W;
      canvas.height = ANALYSIS_H;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const rect = coverRect(canvas, img, anchorX(i));
      g.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      try {
        const p = g.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;
        const out = new Float32Array(ANALYSIS_W * ANALYSIS_H);
        for (let k = 0, j = 0; k < out.length; k += 1, j += 4) {
          out[k] = p[j] * .299 + p[j + 1] * .587 + p[j + 2] * .114;
        }
        return out;
      } catch {
        return null;
      }
    })();
    grayCache.set(i, promise);
    return promise;
  }

  async function rawRoll(i) {
    if (rollRawCache.has(i)) return rollRawCache.get(i);
    const promise = (async () => {
      const gray = await analysisGray(i);
      if (!gray) return 0;
      let sx = 0, sy = 0, sum = 0;
      for (let y = 12; y < ANALYSIS_H - 10; y += 2) {
        for (let x = 7; x < ANALYSIS_W - 7; x += 2) {
          const gx = gray[y * ANALYSIS_W + x + 1] - gray[y * ANALYSIS_W + x - 1];
          const gy = gray[(y + 1) * ANALYSIS_W + x] - gray[(y - 1) * ANALYSIS_W + x];
          const mag = Math.hypot(gx, gy);
          if (mag < 18) continue;
          const theta = Math.atan2(gy, gx);
          const weight = Math.min(mag, 160);
          sx += Math.cos(4 * theta) * weight;
          sy += Math.sin(4 * theta) * weight;
          sum += weight;
        }
      }
      if (!sum) return 0;
      const confidence = Math.hypot(sx, sy) / sum;
      if (confidence < .075) return 0;
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
      if (i === 0) return clamp(raw * .6, -ROLL_LIMIT, ROLL_LIMIT);
      const prev = await smoothRoll(i - 1);
      const target = prev * (1 - ROLL_EMA) + raw * ROLL_EMA;
      return clamp(prev + clamp(target - prev, -ROLL_STEP_LIMIT, ROLL_STEP_LIMIT), -ROLL_LIMIT, ROLL_LIMIT);
    })();
    rollSmoothCache.set(i, promise);
    return promise;
  }

  async function correctedAnalysis(i) {
    const img = await loadCors(route[i].url);
    if (!img) return null;
    const roll = await smoothRoll(i);
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_W;
    canvas.height = ANALYSIS_H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#111';
    g.fillRect(0, 0, ANALYSIS_W, ANALYSIS_H);
    drawCorrected(g, img, i, roll);
    try {
      const data = g.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;
      const gray = new Float32Array(ANALYSIS_W * ANALYSIS_H);
      for (let k = 0, j = 0; k < gray.length; k += 1, j += 4) {
        gray[k] = data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114;
      }
      return gray;
    } catch {
      return null;
    }
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

  async function tileVectors(i) {
    if (tileCache.has(i)) return tileCache.get(i);
    const promise = (async () => {
      const geo = geoAlignment(i);
      const globalX = geo.x / Math.max(320, window.innerWidth || 390) * ANALYSIS_W;
      const globalY = geo.y / Math.max(600, window.innerHeight || 844) * ANALYSIS_H;
      const [a, b] = await Promise.all([correctedAnalysis(i), correctedAnalysis(i + 1)]);
      const vectors = [];
      for (let row = 0; row < TILE_ROWS; row += 1) {
        for (let col = 0; col < TILE_COLS; col += 1) {
          const depth = tileDepth(col, row);
          let vx = globalX * depth, vy = globalY * depth, confidence = 0;
          if (a && b) {
            const x0 = Math.floor(col * ANALYSIS_W / TILE_COLS);
            const x1 = Math.floor((col + 1) * ANALYSIS_W / TILE_COLS);
            const y0 = Math.floor(row * ANALYSIS_H / TILE_ROWS);
            const y1 = Math.floor((row + 1) * ANALYSIS_H / TILE_ROWS);
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
      return vectors;
    })();
    tileCache.set(i, promise);
    return promise;
  }

  function createCorrectedFrame(image, i, rollDeg) {
    const { w, h } = canvasSize();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { alpha: false });
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, h);
    drawCorrected(g, image, i, rollDeg);
    return c;
  }

  function drawTileFlow(frameA, frameB, vectors, t) {
    const w = ui.canvas.width, h = ui.canvas.height;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);
    const scaleX = w / ANALYSIS_W;
    const scaleY = h / ANALYSIS_H;

    ctx.globalAlpha = 1 - t;
    for (const v of vectors) {
      const sx = Math.floor(v.col * w / TILE_COLS);
      const sy = Math.floor(v.row * h / TILE_ROWS);
      const ex = Math.ceil((v.col + 1) * w / TILE_COLS);
      const ey = Math.ceil((v.row + 1) * h / TILE_ROWS);
      const sw = ex - sx, sh = ey - sy;
      const ox = v.vx * scaleX * t;
      const oy = v.vy * scaleY * t;
      ctx.drawImage(frameA, sx, sy, sw, sh, sx + ox - 1, sy + oy - 1, sw + 2, sh + 2);
    }

    ctx.globalAlpha = t;
    for (const v of vectors) {
      const sx = Math.floor(v.col * w / TILE_COLS);
      const sy = Math.floor(v.row * h / TILE_ROWS);
      const ex = Math.ceil((v.col + 1) * w / TILE_COLS);
      const ey = Math.ceil((v.row + 1) * h / TILE_ROWS);
      const sw = ex - sx, sh = ey - sy;
      const ox = -v.vx * scaleX * (1 - t);
      const oy = -v.vy * scaleY * (1 - t);
      ctx.drawImage(frameB, sx, sy, sw, sh, sx + ox - 1, sy + oy - 1, sw + 2, sh + 2);
    }
    ctx.globalAlpha = 1;
  }

  async function warmAhead(i) {
    const end = Math.min(route.length, i + PRELOAD_AHEAD + 1);
    for (let k = i + 1; k < end; k += 1) loadRender(route[k].url).catch(() => {});
    for (let k = i; k < Math.min(route.length, i + 7); k += 1) smoothRoll(k).catch(() => {});
    for (let k = i; k < Math.min(route.length - 1, i + 4); k += 1) tileVectors(k).catch(() => {});
  }

  function updateHud(i, rollValue = 0) {
    const frame = route[i];
    ui.num.textContent = `${i + 1} / ${route.length}`;
    ui.bar.style.width = `${(i + 1) / route.length * 100}%`;
    const b = travelBearing(i);
    ui.heading.textContent = Number.isFinite(b) ? `${Math.round(b)}°` : '—°';
    ui.coord.textContent = hasCoords(frame) ? `${frame.lat.toFixed(5)}, ${frame.lng.toFixed(5)}` : '—';
    ui.net.textContent = `B・${(speedMs / 1000).toFixed(2)}秒・Tile Flow・水平 ${rollValue >= 0 ? '+' : ''}${rollValue.toFixed(1)}°`;
  }

  async function showFirst() {
    const image = await loadRender(route[0].url);
    const roll = await smoothRoll(0);
    const frame = createCorrectedFrame(image, 0, roll);
    canvasSize();
    ctx.drawImage(frame, 0, 0);
    ui.canvas.style.opacity = '1';
    ui.a.style.opacity = '0';
    ui.b.style.opacity = '0';
    ui.edgeBlur?.classList.add('drive-stabilized');
    currentImage = image;
    updateHud(0, roll);
  }

  async function animatePair(i) {
    const nextImage = await loadRender(route[i + 1].url);
    const [rollA, rollB, vectors] = await Promise.all([
      smoothRoll(i), smoothRoll(i + 1), tileVectors(i)
    ]);
    const frameA = createCorrectedFrame(currentImage, i, rollA);
    const frameB = createCorrectedFrame(nextImage, i + 1, rollB);
    const duration = Math.max(72, Math.round(speedMs * .82));
    const start = performance.now();

    await new Promise((resolve) => {
      function tick(now) {
        const t = clamp((now - start) / duration, 0, 1);
        const smooth = t * t * (3 - 2 * t);
        drawTileFlow(frameA, frameB, vectors, smooth);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });

    ctx.globalAlpha = 1;
    ctx.drawImage(frameB, 0, 0);
    currentImage = nextImage;
    updateHud(i + 1, rollB);
  }

  async function play(frames) {
    const playToken = ++token;
    route = frames;
    renderCache.clear();
    corsCache.clear();
    grayCache.clear();
    rollRawCache.clear();
    rollSmoothCache.clear();
    tileCache.clear();
    if (!route.length) throw new Error('再生できる画像がありません');

    ui.place.textContent = route[0].sequenceId ? `Sequence #${route[0].sequenceId}` : 'KartaView route';
    await warmAhead(0);
    await Promise.race([Promise.all([smoothRoll(0), smoothRoll(1), tileVectors(0)]), sleep(650)]);
    await showFirst();

    let nextAt = performance.now() + speedMs;
    for (let i = 0; i < route.length - 1 && playToken === token; i += 1) {
      warmAhead(i + 1);
      const remaining = nextAt - performance.now();
      if (remaining > 0) await sleep(remaining);
      if (playToken !== token) return;
      await animatePair(i);
      nextAt += speedMs;
      if (nextAt < performance.now()) nextAt = performance.now() + Math.max(12, speedMs * .12);
    }

    if (playToken === token) {
      ui.net.textContent = `B・${(speedMs / 1000).toFixed(2)}秒・再スタート`;
      await sleep(500);
      if (playToken === token) play(frames);
    }
  }

  async function fetchRoute() {
    const p = new URLSearchParams({ source: 'karta' });
    if (ui.coords.checked) {
      const lat = Number(ui.lat.value), lng = Number(ui.lng.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('緯度・経度を確認してください');
      p.set('lat', String(lat));
      p.set('lng', String(lng));
      p.set('radius', '1200');
    } else {
      p.set('sequence', '6187609');
      p.set('index', '650');
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
    ui.startBtn.textContent = 'ルートを準備中…';
    ui.error.hidden = true;
    speedMs = Number(document.querySelector('input[name="driveSpeed"]:checked')?.value || 120);
    try {
      await requestWakeLock();
      const data = await fetchRoute();
      ui.start.hidden = true;
      await play(data.frames);
    } catch (error) {
      ui.edgeBlur?.classList.remove('drive-stabilized');
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
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=0.1.6').catch(() => {}));
  }

  console.info(`Streetview Journey v${VERSION}`);
})();
