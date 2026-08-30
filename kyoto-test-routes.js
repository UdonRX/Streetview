(() => {
  'use strict';

  const DEST_KEY = 'streetview:phase3-destination';
  const ROUTE_KEY = 'streetview:journey-route';
  const TEST_KEY = 'streetview:kyoto-test-route';
  const TOKEN_KEY = 'streetview:mapillary-token';
  const CACHE_KEY = 'streetview:kyoto-mapillary-fixed-routes:v1';
  const GRAPH = 'https://graph.mapillary.com';
  const SOURCE = 'kyoto-test-routes';
  const LINE = 'kyoto-test-route-lines';
  const POINTS = 'kyoto-test-route-points';
  const LABELS = 'kyoto-test-route-labels';
  const META_FIELDS = 'id,sequence,captured_at,computed_geometry,compass_angle,thumb_2048_url,is_pano';
  const MAX_SEGMENT_FRAMES = 120;
  const prepared = new Map();
  const resolving = new Map();

  const routes = [
    { id:'road', label:'道路', name:'烏丸通', start:{lat:35.01039,lng:135.75943,name:'烏丸御池'}, end:{lat:35.00367,lng:135.75937,name:'四条烏丸'}, padLat:.010, padLng:.012, maxEndpointM:850, seedSequenceId:'zq8vy4bui6shkiv29w5fp9' },
    { id:'sidewalk', label:'歩道', name:'鴨川遊歩道', start:{lat:35.00902,lng:135.77168,name:'三条大橋東岸'}, end:{lat:35.00368,lng:135.77155,name:'四条大橋東岸'}, padLat:.010, padLng:.012, maxEndpointM:850 },
    { id:'mountain', label:'山道', name:'伏見稲荷山', start:{lat:34.96720,lng:135.77322,name:'千本鳥居付近'}, end:{lat:34.97055,lng:135.77920,name:'三ツ辻方面'}, padLat:.018, padLng:.020, maxEndpointM:1300 },
    { id:'rail', label:'線路', name:'嵯峨野線', start:{lat:34.98758,lng:135.74245,name:'梅小路京都西'}, end:{lat:34.99512,lng:135.74210,name:'丹波口'}, padLat:.014, padLng:.016, maxEndpointM:1100 }
  ];

  const $ = id => document.getElementById(id);
  const status = text => { const el = $('testRouteStatus'); if (el) el.textContent = text; };
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  }
  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }
  function distanceMeters(a, b) {
    const r = Math.PI / 180, p1 = Number(a.lat) * r, p2 = Number(b.lat) * r;
    const dp = (Number(b.lat) - Number(a.lat)) * r, dl = (Number(b.lng) - Number(a.lng)) * r;
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
  async function mly(path) {
    const t = token();
    if (!t) throw new Error('Mapillary Access Tokenが未設定です');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`, { cache:'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error?.message || `Mapillary API ${res.status}`);
    return data;
  }
  async function batchMeta(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      const data = await mly(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(META_FIELDS)}`);
      for (const row of data?.data || []) out.set(String(row.id), row);
    }
    return out;
  }
  async function orderedIds(sequence) {
    const data = await mly(`/image_ids?sequence_id=${encodeURIComponent(sequence)}`);
    return (data?.data || []).map(x => String(x?.id ?? x)).filter(Boolean);
  }
  function normalizeFrame(meta, seq, sequenceIndex) {
    const c = coords(meta);
    if (!c || !meta?.thumb_2048_url) return null;
    return {
      id:String(meta.id), sequenceId:String(seq), sequenceIndex,
      lat:c.lat, lng:c.lng,
      heading:Number.isFinite(Number(meta.compass_angle)) ? Number(meta.compass_angle) : null,
      projection:meta.is_pano ? 'SPHERE' : 'RECTILINEAR', fieldOfView:meta.is_pano ? 360 : 100,
      sourceUrl:meta.thumb_2048_url, url:meta.thumb_2048_url, provider:'Mapillary', capturedAt:meta.captured_at || null
    };
  }
  function sampleSegment(ids, startIndex, endIndex) {
    let segment = endIndex >= startIndex ? ids.slice(startIndex, endIndex + 1) : ids.slice(endIndex, startIndex + 1).reverse();
    if (segment.length <= MAX_SEGMENT_FRAMES) return segment;
    const step = (segment.length - 1) / (MAX_SEGMENT_FRAMES - 1), sampled = [];
    for (let i = 0; i < MAX_SEGMENT_FRAMES; i++) sampled.push(segment[Math.round(i * step)]);
    return [...new Set(sampled)];
  }
  function bboxFor(route, scale = 1) {
    const minLat = Math.min(route.start.lat, route.end.lat) - route.padLat * scale;
    const maxLat = Math.max(route.start.lat, route.end.lat) + route.padLat * scale;
    const minLng = Math.min(route.start.lng, route.end.lng) - route.padLng * scale;
    const maxLng = Math.max(route.start.lng, route.end.lng) + route.padLng * scale;
    return `${minLng},${minLat},${maxLng},${maxLat}`;
  }
  async function imagesInBox(route, scale) {
    const fields = 'id,sequence,captured_at,computed_geometry,compass_angle';
    const data = await mly(`/images?bbox=${encodeURIComponent(bboxFor(route, scale))}&limit=1000&fields=${encodeURIComponent(fields)}`);
    return Array.isArray(data?.data) ? data.data : [];
  }
  function bestSequence(route, rows) {
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
    const candidates = [...groups.values()].filter(g => g.rows.length >= 4 && g.start && g.end)
      .map(g => ({ ...g, score:g.startD + g.endD + Math.max(0, 12 - g.rows.length) * 20 }))
      .sort((a,b) => a.score - b.score);
    return candidates[0] || null;
  }
  async function resolveSeed(route) {
    if (!route.seedSequenceId) return null;
    try {
      const ids = await orderedIds(route.seedSequenceId);
      if (ids.length < 2) return null;
      const meta = await batchMeta(ids);
      let startIndex = -1, endIndex = -1, startD = Infinity, endD = Infinity;
      ids.forEach((id, i) => {
        const c = coords(meta.get(id)); if (!c) return;
        const ds = distanceMeters(route.start, c), de = distanceMeters(route.end, c);
        if (ds < startD) { startD = ds; startIndex = i; }
        if (de < endD) { endD = de; endIndex = i; }
      });
      if (startIndex < 0 || endIndex < 0 || Math.max(startD, endD) > route.maxEndpointM * 2) return null;
      const segmentIds = sampleSegment(ids, startIndex, endIndex);
      return { sequenceId:route.seedSequenceId, startImageId:ids[startIndex], endImageId:ids[endIndex], imageIds:segmentIds, startDistanceMeters:startD, endDistanceMeters:endD, source:'seed' };
    } catch { return null; }
  }
  async function resolveRoute(route) {
    if (resolving.has(route.id)) return resolving.get(route.id);
    const task = (async () => {
      const cached = loadCache()[route.id];
      if (cached?.sequenceId && Array.isArray(cached.imageIds) && cached.imageIds.length >= 2) return cached;
      let fixed = await resolveSeed(route);
      if (!fixed) {
        let best = null;
        for (const scale of [1, 1.6, 2.3]) {
          const rows = await imagesInBox(route, scale);
          best = bestSequence(route, rows);
          if (best && Math.max(best.startD, best.endD) <= route.maxEndpointM) break;
        }
        if (!best) throw new Error(`${route.label}の固定sequence候補が見つかりません`);
        const ids = await orderedIds(best.sequenceId);
        const si = ids.indexOf(String(best.start.id)), ei = ids.indexOf(String(best.end.id));
        if (si < 0 || ei < 0) throw new Error(`${route.label}の開始・終了imageをsequence内で特定できません`);
        fixed = { sequenceId:best.sequenceId, startImageId:ids[si], endImageId:ids[ei], imageIds:sampleSegment(ids, si, ei), startDistanceMeters:best.startD, endDistanceMeters:best.endD, source:'bbox' };
      }
      fixed = { ...fixed, routeId:route.id, label:route.label, resolvedAt:new Date().toISOString() };
      const cache = loadCache(); cache[route.id] = fixed; saveCache(cache);
      return fixed;
    })().finally(() => resolving.delete(route.id));
    resolving.set(route.id, task);
    return task;
  }
  async function buildPayload(route, fixed) {
    const ids = fixed.imageIds;
    const meta = await batchMeta(ids);
    const frames = ids.map((id, i) => normalizeFrame(meta.get(id), fixed.sequenceId, i)).filter(Boolean);
    if (frames.length < 2) throw new Error('固定ルート画像URLを取得できませんでした');
    return {
      version:'0.4.11-fixed-mapillary-test', source:'Mapillary', provider:'Mapillary', sequenceId:fixed.sequenceId,
      destination:{ ...route.end, testRouteType:route.id, testRouteLabel:route.label },
      selection:{ strategy:'fixed-test-sequence-segment', direction:'forward', proximityMeters:fixed.startDistanceMeters, destinationDistanceMeters:fixed.endDistanceMeters, searchMode:'fixed-pre-resolved', candidateCount:1, visualOverride:false, startImageId:fixed.startImageId, endImageId:fixed.endImageId, totalImageIds:frames.length },
      frames, candidateRoutes:[], fixedTestRoute:{ routeId:route.id, label:route.label, name:route.name, startImageId:fixed.startImageId, endImageId:fixed.endImageId, resolvedAt:fixed.resolvedAt }
    };
  }
  async function prepare(route) {
    const fixed = await resolveRoute(route);
    if (!prepared.has(route.id)) prepared.set(route.id, buildPayload(route, fixed));
    await prepared.get(route.id);
    markButton(route.id, 'ready');
    return fixed;
  }
  function markButton(id, state) {
    const b = document.querySelector(`[data-route="${id}"]`); if (!b) return;
    b.dataset.fixedState = state;
    const badge = b.querySelector('em');
    if (badge) badge.textContent = state === 'ready' ? '固定済' : state === 'loading' ? '準備中' : '要確認';
  }
  function setSessionPreset(route, fixed) {
    const preset = { id:route.id, label:route.label, name:route.name, start:{...route.start}, end:{...route.end}, sequenceId:fixed?.sequenceId || null, startImageId:fixed?.startImageId || null, endImageId:fixed?.endImageId || null, registeredAt:'2026-08-30' };
    try {
      sessionStorage.setItem(TEST_KEY, JSON.stringify(preset));
      sessionStorage.setItem(DEST_KEY, JSON.stringify({ lat:route.end.lat, lng:route.end.lng, name:route.end.name, testRouteType:route.id, testRouteLabel:route.label, startLat:route.start.lat, startLng:route.start.lng, startName:route.start.name }));
    } catch {}
  }
  async function startRoute(route, button) {
    document.querySelectorAll('.test-route-button').forEach(x => x.classList.toggle('is-active', x === button));
    if (!token()) { status(`${route.label}：Mapillaryトークンを設定して。固定IDは端末内に保存する。`); $('mapillarySettings')?.click(); return; }
    markButton(route.id, 'loading');
    try {
      status(`${route.label}：固定sequenceを開いている…`);
      const fixed = await resolveRoute(route);
      setSessionPreset(route, fixed);
      if (!prepared.has(route.id)) prepared.set(route.id, buildPayload(route, fixed));
      const payload = await prepared.get(route.id);
      try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(payload)); } catch { throw new Error('Journey Engineへ固定ルートを渡せませんでした'); }
      status(`${route.label}：Sequence ${fixed.sequenceId} / ${fixed.imageIds.length}枚を固定再生`);
      location.href = '/journey-map.html?autostart=1';
    } catch (e) {
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
    const box = $('testRouteButtons'); if (!box) return;
    box.innerHTML = '';
    const cache = loadCache();
    for (const r of routes) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'test-route-button'; b.dataset.route = r.id;
      b.innerHTML = `<strong>${r.label}</strong><span>${r.start.name} → ${r.end.name}</span><em>${cache[r.id]?.sequenceId ? '固定済' : '準備中'}</em>`;
      b.addEventListener('click', () => startRoute(r, b)); box.appendChild(b);
    }
  }
  async function prewarm() {
    if (!token()) { status('Mapillaryトークン保存後、4ルートをバックグラウンドで固定する。'); return; }
    status('京都4ルートのMapillary sequence / 開始・終了imageを事前準備中…');
    let ok = 0;
    for (let i = 0; i < routes.length; i += 2) {
      const pair = routes.slice(i, i + 2);
      await Promise.all(pair.map(async r => {
        markButton(r.id, 'loading');
        try { await prepare(r); ok++; } catch { markButton(r.id, 'error'); }
      }));
      await sleep(40);
    }
    const cache = loadCache();
    const summary = routes.filter(r => cache[r.id]?.sequenceId).map(r => `${r.label}:${cache[r.id].sequenceId}`).join(' / ');
    status(ok === routes.length ? `4ルート固定済み。${summary}` : `${ok}/4ルート固定済み。未固定はタップ時に再試行する。`);
  }
  function waitForTokenSave() {
    $('saveToken')?.addEventListener('click', () => setTimeout(prewarm, 500));
  }

  installButtons();
  installMapOverlay();
  waitForTokenSave();
  window.__kyotoJourneyTestRoutes = { routes, resolve: id => { const r = routes.find(x => x.id === id); return r ? resolveRoute(r) : null; }, cache: loadCache, clear: () => { try { localStorage.removeItem(CACHE_KEY); } catch {} } };
  setTimeout(prewarm, 700);
})();
