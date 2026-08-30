(() => {
  'use strict';

  const DEST_KEY = 'streetview:phase3-destination';
  const ROUTE_KEY = 'streetview:journey-route';
  const TEST_KEY = 'streetview:kyoto-test-route';
  const TOKEN_KEY = 'streetview:mapillary-token';
  const CACHE_KEY = 'streetview:kyoto-mapillary-fixed-routes:v2';
  const GRAPH = 'https://graph.mapillary.com';
  const SOURCE = 'kyoto-test-routes';
  const LINE = 'kyoto-test-route-lines';
  const POINTS = 'kyoto-test-route-points';
  const LABELS = 'kyoto-test-route-labels';

  const TARGET_FRAMES = 200;
  const MIN_FRAMES = 170;
  const MAX_FRAMES = 220;
  const INITIAL_FRAMES = 32;
  const META_BATCH = 24;
  const SEARCH_LIMIT = 60;
  const SEARCH_RADII_M = [180, 300, 450];
  const SEARCH_STOPS = [0, 0.25, 0.5, 0.75, 1];
  const META_FIELDS = 'id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';
  const SEARCH_FIELDS = 'id,sequence,computed_geometry';

  const prepared = new Map();
  const resolving = new Map();

  const routes = [
    { id:'road', label:'道路', name:'烏丸通', start:{lat:35.01039,lng:135.75943,name:'烏丸御池'}, end:{lat:35.00367,lng:135.75937,name:'四条烏丸'}, maxEndpointM:850, seedSequenceId:'zq8vy4bui6shkiv29w5fp9' },
    { id:'sidewalk', label:'歩道', name:'鴨川遊歩道', start:{lat:35.00902,lng:135.77168,name:'三条大橋東岸'}, end:{lat:35.00368,lng:135.77155,name:'四条大橋東岸'}, maxEndpointM:850 },
    { id:'mountain', label:'山道', name:'伏見稲荷山', start:{lat:34.96720,lng:135.77322,name:'千本鳥居付近'}, end:{lat:34.97055,lng:135.77920,name:'三ツ辻方面'}, maxEndpointM:1300 },
    { id:'rail', label:'線路', name:'嵯峨野線', start:{lat:34.98758,lng:135.74245,name:'梅小路京都西'}, end:{lat:34.99512,lng:135.74210,name:'丹波口'}, maxEndpointM:1100 }
  ];

  const $ = id => document.getElementById(id);
  const status = text => { const el = $('testRouteStatus'); if (el) el.textContent = text; };
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  }

  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function validFixed(fixed) {
    return !!fixed?.sequenceId && Array.isArray(fixed.imageIds) && fixed.imageIds.length >= MIN_FRAMES && fixed.imageIds.length <= MAX_FRAMES;
  }

  function distanceMeters(a, b) {
    const r = Math.PI / 180;
    const p1 = Number(a.lat) * r, p2 = Number(b.lat) * r;
    const dp = (Number(b.lat) - Number(a.lat)) * r;
    const dl = (Number(b.lng) - Number(a.lng)) * r;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }

  function coords(meta) {
    const c = meta?.computed_geometry?.coordinates;
    return Array.isArray(c) && c.length >= 2 ? { lat:Number(c[1]), lng:Number(c[0]) } : null;
  }

  function sequenceId(meta) {
    return String(meta?.sequence?.id ?? meta?.sequence ?? '').trim();
  }

  function interpolate(route, t) {
    return {
      lat: route.start.lat + (route.end.lat - route.start.lat) * t,
      lng: route.start.lng + (route.end.lng - route.start.lng) * t
    };
  }

  function pointBbox(point, radiusM) {
    const latPad = radiusM / 111320;
    const lngPad = radiusM / Math.max(1, 111320 * Math.cos(Number(point.lat) * Math.PI / 180));
    return `${point.lng - lngPad},${point.lat - latPad},${point.lng + lngPad},${point.lat + latPad}`;
  }

  async function mly(path) {
    const t = token();
    if (!t) throw new Error('Mapillary Access Tokenが未設定です');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`, { cache:'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      const message = data?.error?.message || `Mapillary API ${res.status}`;
      const error = new Error(message);
      error.reduceAmount = /reduce the amount of data/i.test(message);
      throw error;
    }
    return data;
  }

  async function batchMeta(ids, fields = META_FIELDS) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += META_BATCH) {
      const part = ids.slice(i, i + META_BATCH);
      const data = await mly(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(fields)}`);
      for (const row of data?.data || []) out.set(String(row.id), row);
      if (i + META_BATCH < ids.length) await sleep(20);
    }
    return out;
  }

  async function orderedIds(sequence) {
    const data = await mly(`/image_ids?sequence_id=${encodeURIComponent(sequence)}`);
    return (data?.data || []).map(x => String(x?.id ?? x)).filter(Boolean);
  }

  function normalizeFrame(meta, seq, sequenceIndex) {
    const c = coords(meta);
    const source = meta?.thumb_2048_url || meta?.thumb_1024_url || meta?.thumb_256_url;
    if (!c || !source) return null;
    const computed = Number(meta?.computed_compass_angle);
    const exif = Number(meta?.compass_angle);
    const heading = Number.isFinite(computed) ? computed : (Number.isFinite(exif) ? exif : null);
    return {
      id:String(meta.id), sequenceId:String(seq), sequenceIndex,
      lat:c.lat, lng:c.lng,
      heading, headingSource:Number.isFinite(computed) ? 'sfm-computed' : 'exif',
      exifHeading:Number.isFinite(exif) ? exif : null,
      computedHeading:Number.isFinite(computed) ? computed : null,
      projection:meta.is_pano ? 'SPHERE' : 'RECTILINEAR', fieldOfView:meta.is_pano ? 360 : 100,
      sourceUrl:source, raw2048Url:meta?.thumb_2048_url || null, raw1024Url:meta?.thumb_1024_url || null, raw256Url:meta?.thumb_256_url || null,
      url:source, provider:'Mapillary', capturedAt:meta.captured_at || null
    };
  }

  function sampleToTarget(segment, target = TARGET_FRAMES) {
    if (segment.length <= MAX_FRAMES) return segment;
    const sampled = [];
    const step = (segment.length - 1) / (target - 1);
    for (let i = 0; i < target; i++) sampled.push(segment[Math.round(i * step)]);
    return [...new Set(sampled)];
  }

  function targetSegment(ids, startIndex, endIndex) {
    if (!Array.isArray(ids) || ids.length < MIN_FRAMES || startIndex < 0 || endIndex < 0) return null;
    const forward = endIndex >= startIndex;
    let lo = Math.min(startIndex, endIndex);
    let hi = Math.max(startIndex, endIndex);
    const span = hi - lo + 1;

    if (span < MIN_FRAMES) {
      let need = Math.max(0, TARGET_FRAMES - span);
      const left = Math.floor(need / 2), right = need - left;
      lo = Math.max(0, lo - left);
      hi = Math.min(ids.length - 1, hi + right);
      while (hi - lo + 1 < Math.min(TARGET_FRAMES, ids.length) && lo > 0) lo--;
      while (hi - lo + 1 < Math.min(TARGET_FRAMES, ids.length) && hi < ids.length - 1) hi++;
    }

    let segment = ids.slice(lo, hi + 1);
    if (!forward) segment.reverse();
    segment = sampleToTarget(segment);
    return segment.length >= MIN_FRAMES ? segment : null;
  }

  async function imagesNear(point, radiusM) {
    let lastError = null;
    for (const limit of [SEARCH_LIMIT, 30, 15]) {
      try {
        const data = await mly(`/images?bbox=${encodeURIComponent(pointBbox(point, radiusM))}&limit=${limit}&fields=${encodeURIComponent(SEARCH_FIELDS)}`);
        return Array.isArray(data?.data) ? data.data : [];
      } catch (error) {
        lastError = error;
        if (!error?.reduceAmount) throw error;
        await sleep(35);
      }
    }
    throw new Error(`Mapillary取得量上限: ${lastError?.message || '検索範囲をさらに縮小してください'}`);
  }

  async function corridorRows(route, radiusM) {
    const byId = new Map();
    for (const t of SEARCH_STOPS) {
      const rows = await imagesNear(interpolate(route, t), radiusM);
      for (const row of rows) if (row?.id) byId.set(String(row.id), row);
      await sleep(25);
    }
    return [...byId.values()];
  }

  function sequenceCandidates(route, rows) {
    const groups = new Map();
    for (const row of rows) {
      const seq = sequenceId(row), c = coords(row);
      if (!seq || !c) continue;
      let g = groups.get(seq);
      if (!g) groups.set(seq, g = { sequenceId:seq, rows:[], start:null, end:null, startD:Infinity, endD:Infinity });
      g.rows.push(row);
      const ds = distanceMeters(route.start, c), de = distanceMeters(route.end, c);
      if (ds < g.startD) { g.startD = ds; g.start = row; }
      if (de < g.endD) { g.endD = de; g.end = row; }
    }
    return [...groups.values()]
      .filter(g => g.rows.length >= 3 && g.start && g.end)
      .map(g => ({ ...g, score:g.startD + g.endD + Math.max(0, 8 - g.rows.length) * 12 }))
      .sort((a, b) => a.score - b.score);
  }

  async function fixedFromCandidate(route, candidate, source) {
    const ids = await orderedIds(candidate.sequenceId);
    if (ids.length < MIN_FRAMES) return null;
    const si = ids.indexOf(String(candidate.start.id));
    const ei = ids.indexOf(String(candidate.end.id));
    if (si < 0 || ei < 0) return null;
    const imageIds = targetSegment(ids, si, ei);
    if (!imageIds) return null;
    return {
      sequenceId:candidate.sequenceId,
      startImageId:imageIds[0],
      endImageId:imageIds[imageIds.length - 1],
      anchorStartImageId:String(candidate.start.id),
      anchorEndImageId:String(candidate.end.id),
      imageIds,
      startDistanceMeters:candidate.startD,
      endDistanceMeters:candidate.endD,
      source
    };
  }

  async function resolveSeed(route) {
    if (!route.seedSequenceId) return null;
    try {
      const ids = await orderedIds(route.seedSequenceId);
      if (ids.length < MIN_FRAMES) return null;
      const probeCount = Math.min(80, ids.length);
      const probeIds = [];
      for (let i = 0; i < probeCount; i++) probeIds.push(ids[Math.round(i * (ids.length - 1) / Math.max(1, probeCount - 1))]);
      const probeMeta = await batchMeta([...new Set(probeIds)], 'id,computed_geometry');
      let approxStart = -1, approxEnd = -1, startD = Infinity, endD = Infinity;
      ids.forEach((id, index) => {
        const c = coords(probeMeta.get(id));
        if (!c) return;
        const ds = distanceMeters(route.start, c), de = distanceMeters(route.end, c);
        if (ds < startD) { startD = ds; approxStart = index; }
        if (de < endD) { endD = de; approxEnd = index; }
      });
      if (approxStart < 0 || approxEnd < 0) return null;

      const refineIndexes = new Set();
      for (const center of [approxStart, approxEnd]) {
        for (let i = Math.max(0, center - 18); i <= Math.min(ids.length - 1, center + 18); i++) refineIndexes.add(i);
      }
      const refineIds = [...refineIndexes].map(i => ids[i]);
      const refineMeta = await batchMeta(refineIds, 'id,computed_geometry');
      let startIndex = approxStart, endIndex = approxEnd;
      startD = Infinity; endD = Infinity;
      for (const i of refineIndexes) {
        const c = coords(refineMeta.get(ids[i]));
        if (!c) continue;
        const ds = distanceMeters(route.start, c), de = distanceMeters(route.end, c);
        if (ds < startD) { startD = ds; startIndex = i; }
        if (de < endD) { endD = de; endIndex = i; }
      }
      if (Math.max(startD, endD) > route.maxEndpointM * 2) return null;
      const imageIds = targetSegment(ids, startIndex, endIndex);
      if (!imageIds) return null;
      return {
        sequenceId:route.seedSequenceId,
        startImageId:imageIds[0], endImageId:imageIds[imageIds.length - 1],
        anchorStartImageId:ids[startIndex], anchorEndImageId:ids[endIndex], imageIds,
        startDistanceMeters:startD, endDistanceMeters:endD, source:'seed'
      };
    } catch { return null; }
  }

  async function resolveRoute(route) {
    if (resolving.has(route.id)) return resolving.get(route.id);
    const task = (async () => {
      const cache = loadCache();
      const cached = cache[route.id];
      if (validFixed(cached)) return cached;

      let fixed = await resolveSeed(route);
      if (!fixed) {
        let fallback = null;
        for (const radiusM of SEARCH_RADII_M) {
          status(`${route.label}：${radiusM}m単位で小分け探索中…`);
          const rows = await corridorRows(route, radiusM);
          const candidates = sequenceCandidates(route, rows).slice(0, 8);
          for (const candidate of candidates) {
            const candidateFixed = await fixedFromCandidate(route, candidate, `corridor-${radiusM}m`);
            if (!candidateFixed) continue;
            if (!fallback || candidate.score < fallback.score) fallback = { score:candidate.score, fixed:candidateFixed };
            if (Math.max(candidate.startD, candidate.endD) <= route.maxEndpointM) {
              fixed = candidateFixed;
              break;
            }
          }
          if (fixed) break;
        }
        if (!fixed && fallback) fixed = fallback.fixed;
      }

      if (!fixed) throw new Error(`${route.label}で約200枚続くsequenceを見つけられませんでした`);
      fixed = {
        ...fixed,
        routeId:route.id,
        label:route.label,
        targetFrames:TARGET_FRAMES,
        resolvedAt:new Date().toISOString()
      };
      const nextCache = loadCache();
      nextCache[route.id] = fixed;
      saveCache(nextCache);
      return fixed;
    })().finally(() => resolving.delete(route.id));
    resolving.set(route.id, task);
    return task;
  }

  async function buildPayload(route, fixed) {
    const ids = fixed.imageIds;
    const initialIds = ids.slice(0, Math.min(INITIAL_FRAMES, ids.length));
    const meta = await batchMeta(initialIds);
    const frames = initialIds.map((id, i) => normalizeFrame(meta.get(id), fixed.sequenceId, i)).filter(Boolean);
    if (frames.length < 2) throw new Error('固定ルートの初期画像URLを取得できませんでした');

    const loadedIds = new Set(frames.map(f => String(f.id)));
    const initialMissing = initialIds
      .map((id, i) => ({id:String(id), sequenceId:String(fixed.sequenceId), sequenceIndex:i}))
      .filter(ref => !loadedIds.has(ref.id));
    const remaining = ids.slice(initialIds.length).map((id, i) => ({
      id:String(id), sequenceId:String(fixed.sequenceId), sequenceIndex:initialIds.length + i
    }));

    return {
      version:'0.4.12-fixed-200-test',
      source:'Mapillary', provider:'Mapillary', sequenceId:fixed.sequenceId,
      destination:{ ...route.end, testRouteType:route.id, testRouteLabel:route.label },
      selection:{
        strategy:'fixed-test-sequence-200', direction:'forward',
        proximityMeters:fixed.startDistanceMeters, destinationDistanceMeters:fixed.endDistanceMeters,
        searchMode:fixed.source || 'fixed-resolved', candidateCount:1, visualOverride:false,
        startImageId:fixed.startImageId, endImageId:fixed.endImageId, totalImageIds:ids.length
      },
      frames,
      streamPending:[...initialMissing, ...remaining],
      candidateRoutes:[],
      fixedTestRoute:{
        routeId:route.id, label:route.label, name:route.name,
        startImageId:fixed.startImageId, endImageId:fixed.endImageId,
        anchorStartImageId:fixed.anchorStartImageId || null,
        anchorEndImageId:fixed.anchorEndImageId || null,
        frameCount:ids.length, targetFrames:TARGET_FRAMES,
        resolvedAt:fixed.resolvedAt
      }
    };
  }

  async function prepare(route) {
    const fixed = await resolveRoute(route);
    markButton(route.id, 'ready', fixed.imageIds.length);
    return fixed;
  }

  function markButton(id, state, count = null) {
    const b = document.querySelector(`[data-route="${id}"]`);
    if (!b) return;
    b.dataset.fixedState = state;
    const badge = b.querySelector('em');
    if (!badge) return;
    badge.textContent = state === 'ready' ? `約${count || TARGET_FRAMES}枚固定` : state === 'loading' ? '準備中' : state === 'error' ? '再試行' : 'タップで固定';
  }

  function setSessionPreset(route, fixed) {
    const preset = {
      id:route.id, label:route.label, name:route.name,
      start:{...route.start}, end:{...route.end},
      sequenceId:fixed?.sequenceId || null,
      startImageId:fixed?.startImageId || null,
      endImageId:fixed?.endImageId || null,
      frameCount:fixed?.imageIds?.length || null,
      registeredAt:'2026-08-31'
    };
    try {
      sessionStorage.setItem(TEST_KEY, JSON.stringify(preset));
      sessionStorage.setItem(DEST_KEY, JSON.stringify({
        lat:route.end.lat, lng:route.end.lng, name:route.end.name,
        testRouteType:route.id, testRouteLabel:route.label,
        startLat:route.start.lat, startLng:route.start.lng, startName:route.start.name
      }));
    } catch {}
  }

  async function startRoute(route, button) {
    document.querySelectorAll('.test-route-button').forEach(x => x.classList.toggle('is-active', x === button));
    if (!token()) {
      status(`${route.label}：Mapillaryトークンを設定して。約200枚の固定区間を端末内に保存する。`);
      $('mapillarySettings')?.click();
      return;
    }
    markButton(route.id, 'loading');
    try {
      status(`${route.label}：約200枚の固定sequenceを準備中…`);
      const fixed = await prepare(route);
      setSessionPreset(route, fixed);
      if (!prepared.has(route.id)) prepared.set(route.id, buildPayload(route, fixed));
      const payload = await prepared.get(route.id);
      try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(payload)); }
      catch { throw new Error('Journey Engineへ固定ルートを渡せませんでした'); }
      status(`${route.label}：Sequence ${fixed.sequenceId} / ${fixed.imageIds.length}枚固定。先頭${payload.frames.length}枚から再生開始`);
      location.href = '/journey-map.html?autostart=1';
    } catch (e) {
      prepared.delete(route.id);
      markButton(route.id, 'error');
      status(`${route.label}：${e?.message || '固定ルート準備に失敗'}`);
    }
  }

  function geojson() {
    const features = [];
    for (const r of routes) {
      features.push({type:'Feature',properties:{id:r.id,label:r.label,name:r.name,kind:'line'},geometry:{type:'LineString',coordinates:[[r.start.lng,r.start.lat],[r.end.lng,r.end.lat]]}});
      features.push({type:'Feature',properties:{id:r.id,label:`${r.label} 出発`,kind:'point'},geometry:{type:'Point',coordinates:[r.start.lng,r.start.lat]}});
      features.push({type:'Feature',properties:{id:r.id,label:`${r.label} 到着`,kind:'point'},geometry:{type:'Point',coordinates:[r.end.lng,r.end.lat]}});
    }
    return {type:'FeatureCollection',features};
  }

  function installMapOverlay() {
    const map = window.__streetviewCoverageMap;
    if (!map) return setTimeout(installMapOverlay, 120);
    if (!map.loaded()) return map.once('load', installMapOverlay);
    if (!map.getSource(SOURCE)) map.addSource(SOURCE, {type:'geojson',data:geojson()});
    if (!map.getLayer(LINE)) map.addLayer({id:LINE,type:'line',source:SOURCE,filter:['==',['get','kind'],'line'],paint:{'line-color':['match',['get','id'],'road','#ffb45d','sidewalk','#69e8ff','mountain','#9dff70','rail','#ff77d7','#fff'],'line-width':4,'line-opacity':.88,'line-dasharray':[1.4,1.1]}});
    if (!map.getLayer(POINTS)) map.addLayer({id:POINTS,type:'circle',source:SOURCE,filter:['==',['get','kind'],'point'],paint:{'circle-radius':6,'circle-color':'#fff','circle-stroke-width':2.5,'circle-stroke-color':['match',['get','id'],'road','#ffb45d','sidewalk','#69e8ff','mountain','#9dff70','rail','#ff77d7','#07110f']}});
    if (!map.getLayer(LABELS)) map.addLayer({id:LABELS,type:'symbol',source:SOURCE,filter:['==',['get','kind'],'line'],layout:{'symbol-placement':'line','text-field':['get','label'],'text-size':11,'text-allow-overlap':false},paint:{'text-color':'#fff','text-halo-color':'#07110f','text-halo-width':2}});
  }

  function installButtons() {
    const box = $('testRouteButtons');
    if (!box) return;
    box.innerHTML = '';
    const cache = loadCache();
    for (const r of routes) {
      const fixed = cache[r.id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'test-route-button';
      b.dataset.route = r.id;
      b.innerHTML = `<strong>${r.label}</strong><span>${r.start.name} → ${r.end.name}</span><em>${validFixed(fixed) ? `約${fixed.imageIds.length}枚固定` : 'タップで固定'}</em>`;
      b.addEventListener('click', () => startRoute(r, b));
      box.appendChild(b);
    }
  }

  function refreshStatusFromCache() {
    const cache = loadCache();
    const ready = routes.filter(r => validFixed(cache[r.id]));
    if (!token()) {
      status('Mapillaryトークン保存後、各ルートをタップすると約200枚の固定区間を作る。');
      return;
    }
    if (!ready.length) {
      status('道路・歩道・山道・線路をタップすると、小分け探索で約200枚の固定ルートを作る。');
      return;
    }
    const summary = ready.map(r => `${r.label}:${cache[r.id].imageIds.length}枚`).join(' / ');
    status(`${ready.length}/4ルート固定済み。${summary}`);
  }

  function waitForTokenSave() {
    $('saveToken')?.addEventListener('click', () => setTimeout(refreshStatusFromCache, 500));
  }

  installButtons();
  installMapOverlay();
  waitForTokenSave();
  refreshStatusFromCache();

  window.__kyotoJourneyTestRoutes = {
    routes,
    resolve: id => {
      const r = routes.find(x => x.id === id);
      return r ? resolveRoute(r) : null;
    },
    cache: loadCache,
    clear: () => {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      prepared.clear();
      installButtons();
      refreshStatusFromCache();
    }
  };
})();
