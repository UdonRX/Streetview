(() => {
  'use strict';

  const VERSION = '0.4.10-fast-prewarm';
  const TOKEN_KEY = 'streetview:mapillary-token';
  const DEST_KEY = 'streetview:phase3-destination';
  const ROUTE_KEY = 'streetview:journey-route';
  const GRAPH = 'https://graph.mapillary.com';
  const MLY_SOURCE = 'mapillary-coverage';
  const ROUTE_SOURCE = 'selected-journey-route';
  const ROUTE_GLOW = 'selected-journey-route-glow';
  const ROUTE_LINE = 'selected-journey-route-line';

  const START_SNAP_STEPS = [180, 350, 700, 1200];
  const DEST_SNAP_STEPS = [180, 400, 800, 1500, 3000];
  const CONNECTION_PROFILE = { name: 'adaptive-fast', same: 420, cross: 560 };
  const SAME_SEQUENCE_LIMIT = 650;
  const MAX_MAPILLARY_PARTS = 180;
  const MAX_KARTA = 18;
  const ETA_SPEED_KMH = 30;
  const META_BATCH = 48;
  const META_CONCURRENCY = 6;
  const PREFETCH_TARGET = 64;
  const PREFETCH_REQUIRED = 32;
  const PREFETCH_CONCURRENCY = 6;
  const PREFETCH_TIMEOUT_MS = 2200;

  let map = null;
  let busy = false;
  let startMarker = null;
  let endMarker = null;
  let metaActive = 0;
  const metaWaiters = [];

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nowMs = () => performance.now();

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }
  function destination() {
    try {
      const value = JSON.parse(sessionStorage.getItem(DEST_KEY) || 'null');
      return value && Number.isFinite(+value.lat) && Number.isFinite(+value.lng)
        ? { ...value, lat: +value.lat, lng: +value.lng }
        : null;
    } catch { return null; }
  }
  function libs() { return window.__journeyGraphLibs || null; }
  async function waitLibs() {
    for (let i = 0; i < 80; i++) {
      const l = libs();
      if (l?.turf && l?.RBush && l?.createGraph && l?.ngraphPath?.aStar) return l;
      if (window.__journeyGraphLibsError) throw new Error('Journey Graphライブラリを読み込めませんでした');
      await sleep(35);
    }
    throw new Error('Journey Graphライブラリを読み込めませんでした');
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function fmtDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }
  function fmtDuration(min) {
    const m = Math.max(1, Math.round(min));
    return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
  }
  function timeText(date) {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function coordsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return geometry.coordinates || [];
    if (geometry.type === 'MultiLineString') return (geometry.coordinates || []).flat();
    return [];
  }
  function fid(feature) {
    return String(feature?.properties?.id ?? feature?.properties?.sequence_id ?? feature?.id ?? '').trim();
  }
  function lineFeature(coords, properties = {}) {
    return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } };
  }
  function nodeKey(provider, id, part = 0) {
    return `${provider}:${id}#${part}`;
  }
  function pointFromCoord(c) { return { lng: +c[0], lat: +c[1] }; }
  function approxDistance(a, b) {
    const lat = ((+a.lat || 0) + (+b.lat || 0)) * 0.5 * Math.PI / 180;
    const dy = (+a.lat - +b.lat) * 111320;
    const dx = (+a.lng - +b.lng) * 111320 * Math.max(.2, Math.cos(lat));
    return Math.hypot(dx, dy);
  }
  function bboxOf(coords) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of coords) {
      if (!Array.isArray(c) || c.length < 2) continue;
      minX = Math.min(minX, +c[0]); maxX = Math.max(maxX, +c[0]);
      minY = Math.min(minY, +c[1]); maxY = Math.max(maxY, +c[1]);
    }
    return { minX, minY, maxX, maxY };
  }
  function featureSignature(id, coords) {
    if (!id || coords.length < 2) return '';
    const a = coords[0], b = coords[coords.length - 1];
    return `${id}:${coords.length}:${(+a[0]).toFixed(6)},${(+a[1]).toFixed(6)}:${(+b[0]).toFixed(6)},${(+b[1]).toFixed(6)}`;
  }
  function nearestCoordIndex(coords, p) {
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const d = approxDistance({ lat: +c[1], lng: +c[0] }, p);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    return best;
  }
  function clipCoords(coords, entry, exit) {
    if (!Array.isArray(coords) || coords.length < 2) return coords || [];
    const a = nearestCoordIndex(coords, entry), b = nearestCoordIndex(coords, exit);
    const sliced = a <= b ? coords.slice(a, b + 1) : coords.slice(b, a + 1).reverse();
    return sliced.length > 1 ? sliced : coords;
  }
  function polylineMeters(coords) {
    let meters = 0;
    for (let i = 1; i < coords.length; i++) {
      meters += approxDistance(pointFromCoord(coords[i - 1]), pointFromCoord(coords[i]));
    }
    return meters;
  }
  function nearestOnLine(turf, node, p) {
    const snap = turf.nearestPointOnLine(
      lineFeature(node.coords),
      turf.point([p.lng, p.lat]),
      { units: 'meters' }
    );
    return {
      lng: +snap.geometry.coordinates[0],
      lat: +snap.geometry.coordinates[1],
      distance: +snap.properties.dist,
      index: +snap.properties.index || 0,
      location: +snap.properties.location || 0
    };
  }

  async function withMetaSlot(fn) {
    if (metaActive >= META_CONCURRENCY) await new Promise(resolve => metaWaiters.push(resolve));
    metaActive++;
    try { return await fn(); }
    finally {
      metaActive--;
      metaWaiters.shift()?.();
    }
  }
  async function mlyApi(path) {
    const t = token();
    if (!t) throw new Error('Mapillary Access Tokenが未設定です');
    const response = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `OAuth ${t}` }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new Error(data?.error?.message || `Mapillary API ${response.status}`);
    return data;
  }
  async function imageIds(sequenceId) {
    const data = await mlyApi(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);
    return (data?.data || []).map(x => String(x?.id ?? x)).filter(Boolean);
  }
  async function imageMetas(refs) {
    const out = new Array(refs.length).fill(null);
    const jobs = [];
    for (let start = 0; start < refs.length; start += META_BATCH) {
      const part = refs.slice(start, start + META_BATCH);
      jobs.push(withMetaSlot(async () => {
        const ids = part.map(r => r.id).join(',');
        const fields = 'id,sequence,captured_at,computed_geometry,compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';
        const data = await mlyApi(`/images?image_ids=${encodeURIComponent(ids)}&fields=${encodeURIComponent(fields)}`).catch(() => ({ data: [] }));
        const byId = new Map((data?.data || []).map(x => [String(x.id), x]));
        part.forEach((r, i) => { out[start + i] = byId.get(String(r.id)) || null; });
      }));
    }
    await Promise.all(jobs);
    return out;
  }
  function mlyFrame(meta, sequenceId, index) {
    const c = meta?.computed_geometry?.coordinates;
    const sourceUrl = meta?.thumb_2048_url || meta?.thumb_1024_url || meta?.thumb_256_url;
    if (!Array.isArray(c) || c.length < 2 || !sourceUrl) return null;
    return {
      id: String(meta.id), sequenceId: String(sequenceId), sequenceIndex: index,
      lat: +c[1], lng: +c[0],
      heading: Number.isFinite(+meta.compass_angle) ? +meta.compass_angle : null,
      projection: meta.is_pano ? 'SPHERE' : 'RECTILINEAR',
      fieldOfView: meta.is_pano ? 360 : 100,
      url: sourceUrl,
      sourceUrl,
      raw256Url: meta.thumb_256_url || null,
      raw1024Url: meta.thumb_1024_url || null,
      provider: 'Mapillary', capturedAt: meta.captured_at || null
    };
  }
  async function mapillaryFrames(sequenceId) {
    const ids = await imageIds(sequenceId);
    const refs = ids.map((id, i) => ({ id, sequenceId, sequenceIndex: i }));
    const meta = await imageMetas(refs);
    const out = [];
    for (let i = 0; i < meta.length; i++) {
      const frame = meta[i] ? mlyFrame(meta[i], sequenceId, i) : null;
      if (frame) out.push(frame);
    }
    return out;
  }
  async function kartaFrames(sequenceId) {
    const response = await fetch(`/api/imagery?source=karta&sequence=${encodeURIComponent(sequenceId)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'KartaView sequence取得失敗');
    return Array.isArray(data.frames) ? data.frames : [];
  }
  function nearestFrameIndex(frames, p) {
    let bestIndex = 0, bestDistance = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!Number.isFinite(+f.lat) || !Number.isFinite(+f.lng)) continue;
      const d = approxDistance({ lat: +f.lat, lng: +f.lng }, p);
      if (d < bestDistance) { bestDistance = d; bestIndex = i; }
    }
    return bestIndex;
  }
  function sliceFrames(frames, entry, exit) {
    if (frames.length < 2) return frames;
    const a = nearestFrameIndex(frames, entry), b = nearestFrameIndex(frames, exit);
    return a <= b ? frames.slice(a, b + 1) : frames.slice(b, a + 1).reverse();
  }

  async function waitMapillaryFeatures() {
    if (!map?.getSource?.(MLY_SOURCE)) return [];
    const collected = new Map();
    let lastSize = -1, stable = 0;
    const started = nowMs();
    for (let i = 0; i < 18; i++) {
      let features = [];
      try { features = map.querySourceFeatures(MLY_SOURCE, { sourceLayer: 'sequence' }) || []; } catch {}
      for (const f of features) {
        const id = fid(f), coords = coordsOf(f.geometry);
        const sig = featureSignature(id, coords);
        if (sig) collected.set(sig, f);
      }
      const size = collected.size;
      stable = size === lastSize ? stable + 1 : 0;
      lastSize = size;
      let loaded = false;
      try { loaded = !!map.isSourceLoaded(MLY_SOURCE); } catch {}
      if (loaded && stable >= 1 && nowMs() - started >= 160) break;
      await sleep(60);
    }
    return [...collected.values()];
  }
  function corridorPoints(turf, start, dest) {
    const line = turf.lineString([[start.lng, start.lat], [dest.lng, dest.lat]]);
    const km = turf.length(line, { units: 'kilometers' });
    const count = Math.max(4, Math.min(8, Math.ceil(km / 1.5) + 2));
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = turf.along(line, km * (i / (count - 1)), { units: 'kilometers' }).geometry.coordinates;
      out.push({ lat: +p[1], lng: +p[0] });
    }
    return out;
  }
  function partPriority(node, corridor) {
    const box = bboxOf(node.coords);
    const center = { lng: (box.minX + box.maxX) / 2, lat: (box.minY + box.maxY) / 2 };
    let best = Infinity;
    for (const p of corridor) best = Math.min(best, approxDistance(center, p));
    return best;
  }
  function buildMapillaryNodes(features, corridor) {
    const groups = new Map();
    for (const feature of features) {
      const id = fid(feature), coords = coordsOf(feature.geometry);
      if (!id || coords.length < 2) continue;
      const signature = featureSignature(id, coords);
      if (!groups.has(id)) groups.set(id, new Map());
      groups.get(id).set(signature, coords);
    }
    const nodes = [];
    for (const [id, parts] of groups) {
      let part = 0;
      for (const coords of parts.values()) nodes.push({ key: nodeKey('Mapillary', id, part++), id, provider: 'Mapillary', coords });
    }
    nodes.sort((a, b) => partPriority(a, corridor) - partPriority(b, corridor));
    return nodes.slice(0, MAX_MAPILLARY_PARTS);
  }
  async function fetchKartaNodes(points) {
    const query = new URLSearchParams({
      source: 'karta', mode: 'graph-nearby',
      points: points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';'),
      limit: String(MAX_KARTA)
    });
    const response = await fetch(`/api/imagery?${query}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    return (data.sequences || []).map((s, i) => ({
      key: nodeKey('KartaView', String(s.sequenceId), i),
      id: String(s.sequenceId), provider: 'KartaView', coords: s.coords || []
    })).filter(n => n.coords.length > 1);
  }

  function makeSpatialIndex(RBush, nodes) {
    const tree = new RBush();
    tree.load(nodes.map(n => ({ ...bboxOf(n.coords), key: n.key, node: n })).filter(x => Number.isFinite(x.minX)));
    return tree;
  }
  function aroundBox(p, meters) {
    const dy = meters / 111320;
    const dx = dy / Math.max(.2, Math.cos(p.lat * Math.PI / 180));
    return { minX: p.lng - dx, minY: p.lat - dy, maxX: p.lng + dx, maxY: p.lat + dy };
  }
  function findSnapCandidates(turf, tree, point, steps, maxCount = 8) {
    let best = [], usedRadius = steps[steps.length - 1];
    for (const radius of steps) {
      const candidates = tree.search(aroundBox(point, radius)).map(x => x.node);
      const seen = new Set(), rows = [];
      for (const node of candidates) {
        if (!node || seen.has(node.key)) continue;
        seen.add(node.key);
        const snap = nearestOnLine(turf, node, point);
        if (Number.isFinite(snap.distance) && snap.distance <= radius) rows.push({ node, snap });
      }
      rows.sort((a, b) => a.snap.distance - b.snap.distance);
      if (rows.length) { best = rows.slice(0, maxCount); usedRadius = radius; break; }
    }
    return { rows: best, radius: usedRadius, nearest: best[0]?.snap?.distance ?? Infinity };
  }
  function sampledCoords(coords, max = 24) {
    if (coords.length <= max) return coords;
    const out = [], stride = (coords.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(coords[Math.min(coords.length - 1, Math.round(i * stride))]);
    return out;
  }
  function minPairDistance(a, b) {
    let best = { distance: Infinity, a: null, b: null };
    const aa = sampledCoords(a.coords), bb = sampledCoords(b.coords);
    for (const ca of aa) {
      const pa = pointFromCoord(ca);
      for (const cb of bb) {
        const pb = pointFromCoord(cb), distance = approxDistance(pa, pb);
        if (distance < best.distance) best = { distance, a: pa, b: pb };
      }
    }
    return best;
  }
  function buildEdges(RBush, createGraph, nodes) {
    const tree = makeSpatialIndex(RBush, nodes);
    const graph = createGraph();
    nodes.forEach(node => graph.addNode(node.key, node));
    const linkMeta = new Map();
    const maxLimit = Math.max(CONNECTION_PROFILE.same, CONNECTION_PROFILE.cross, SAME_SEQUENCE_LIMIT);
    for (const node of nodes) {
      const b = bboxOf(node.coords), lat = (b.minY + b.maxY) / 2;
      const dy = maxLimit / 111320, dx = dy / Math.max(.2, Math.cos(lat * Math.PI / 180));
      const candidates = tree.search({ minX: b.minX - dx, minY: b.minY - dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
      for (const hit of candidates) {
        const other = hit.node;
        if (!other || other.key === node.key || node.key > other.key) continue;
        const sameSequence = node.provider === other.provider && node.id === other.id;
        const limit = sameSequence ? SAME_SEQUENCE_LIMIT : (node.provider === other.provider ? CONNECTION_PROFILE.same : CONNECTION_PROFILE.cross);
        const pair = minPairDistance(node, other);
        if (!Number.isFinite(pair.distance) || pair.distance > limit) continue;
        const switchPenalty = node.provider === other.provider ? 0 : 90;
        const bridgePenalty = sameSequence ? 0 : pair.distance * (node.provider === other.provider ? 2.2 : 3.2);
        const weight = Math.max(.1, pair.distance + bridgePenalty + switchPenalty);
        graph.addLink(node.key, other.key, { weight, pair, sameSequence });
        graph.addLink(other.key, node.key, { weight, pair: { distance: pair.distance, a: pair.b, b: pair.a }, sameSequence });
        linkMeta.set(`${node.key}>${other.key}`, pair);
        linkMeta.set(`${other.key}>${node.key}`, { distance: pair.distance, a: pair.b, b: pair.a });
      }
    }
    return { graph, tree, linkMeta };
  }
  function graphPath(l, start, dest, nodes) {
    const { turf, RBush, createGraph, ngraphPath } = l;
    const tree = makeSpatialIndex(RBush, nodes);
    const startSnapSet = findSnapCandidates(turf, tree, start, START_SNAP_STEPS);
    const destSnapSet = findSnapCandidates(turf, tree, dest, DEST_SNAP_STEPS);
    window.__journeyGraphDiagnostics = {
      ...(window.__journeyGraphDiagnostics || {}), version: VERSION, stage: 'snap', nodeCount: nodes.length,
      startSnapRadius: startSnapSet.radius,
      startNearestMeters: Number.isFinite(startSnapSet.nearest) ? Math.round(startSnapSet.nearest) : null,
      destinationSnapRadius: destSnapSet.radius,
      destinationNearestMeters: Number.isFinite(destSnapSet.nearest) ? Math.round(destSnapSet.nearest) : null
    };
    if (!startSnapSet.rows.length) throw new Error(`出発地点から${fmtDistance(START_SNAP_STEPS.at(-1))}以内に撮影済みルートを取得できませんでした`);
    if (!destSnapSet.rows.length) throw new Error(`到着地点から${fmtDistance(DEST_SNAP_STEPS.at(-1))}以内に撮影済みルートを取得できませんでした`);

    const { graph, linkMeta } = buildEdges(RBush, createGraph, nodes);
    graph.addNode('__start', { virtual: true });
    graph.addNode('__dest', { virtual: true });
    for (const item of startSnapSet.rows) graph.addLink('__start', item.node.key, { weight: item.snap.distance, snap: item.snap });
    for (const item of destSnapSet.rows) graph.addLink(item.node.key, '__dest', { weight: item.snap.distance, snap: item.snap });
    const finder = ngraphPath.aStar(graph, {
      distance: (from, to, link) => Math.max(.01, +link.data?.weight || 1),
      heuristic: () => 0,
      oriented: true
    });
    let path = finder.find('__start', '__dest') || [];
    if (path.length && path[0]?.id !== '__start') path = [...path].reverse();
    const keys = path.map(x => String(x.id)).filter(x => x !== '__start' && x !== '__dest');
    if (!keys.length) throw new Error('撮影済みsequence同士を接続する経路が見つかりませんでした');
    const nodesByKey = new Map(nodes.map(n => [n.key, n]));
    const startNode = nodesByKey.get(keys[0]), endNode = nodesByKey.get(keys[keys.length - 1]);
    if (!startNode || !endNode) throw new Error('Journey Graphの経路ノードを復元できませんでした');
    const startSnap = nearestOnLine(turf, startNode, start), destSnap = nearestOnLine(turf, endNode, dest);
    const connectors = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const pair = linkMeta.get(`${keys[i]}>${keys[i + 1]}`);
      if (pair) connectors.push({ from: keys[i], to: keys[i + 1], ...pair });
    }
    return {
      keys, startSnap, destSnap, connectors, nodesByKey,
      connectionProfile: CONNECTION_PROFILE.name,
      snap: { startRadius: startSnapSet.radius, destinationRadius: destSnapSet.radius }
    };
  }

  function skeletonSegments(route) {
    const segments = [];
    for (let i = 0; i < route.keys.length; i++) {
      const key = route.keys[i], node = route.nodesByKey.get(key);
      if (!node) continue;
      const prev = route.connectors[i - 1], next = route.connectors[i];
      const entry = i === 0 ? route.startSnap : (prev?.b || pointFromCoord(node.coords[0]));
      const exit = i === route.keys.length - 1 ? route.destSnap : (next?.a || pointFromCoord(node.coords[node.coords.length - 1]));
      segments.push({ key, node, provider: node.provider, entry, exit, coords: clipCoords(node.coords, entry, exit) });
    }
    return segments;
  }
  function fastDistance(segments, connectors, start, dest, startSnap, destSnap) {
    let meters = 0;
    for (const segment of segments) meters += polylineMeters(segment.coords);
    for (const c of connectors) meters += c.distance || 0;
    meters += approxDistance(start, startSnap) + approxDistance(dest, destSnap);
    return Math.max(1, meters);
  }

  function removeMarker(marker) { try { marker?.remove(); } catch {} return null; }
  function pin(label, kind, p) {
    const el = document.createElement('div');
    el.className = `phase4-route-pin ${kind}`;
    el.textContent = label;
    return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
  }
  function showRoute(plan, startOriginal, destOriginal) {
    const features = [];
    plan.segments.forEach((segment, i) => features.push(lineFeature(segment.coords, { provider: segment.provider, kind: 'route', order: i })));
    plan.connectors.forEach((c, i) => features.push(lineFeature([[c.a.lng, c.a.lat], [c.b.lng, c.b.lat]], { provider: 'Cross', kind: 'connector', order: i })));
    features.push(lineFeature([[startOriginal.lng, startOriginal.lat], [plan.startSnap.lng, plan.startSnap.lat]], { provider: 'Snap', kind: 'connector' }));
    features.push(lineFeature([[plan.destSnap.lng, plan.destSnap.lat], [destOriginal.lng, destOriginal.lat]], { provider: 'Snap', kind: 'connector' }));
    const data = { type: 'FeatureCollection', features };
    const source = map.getSource(ROUTE_SOURCE);
    if (source?.setData) source.setData(data);
    else {
      try {
        if (map.getLayer(ROUTE_LINE)) map.removeLayer(ROUTE_LINE);
        if (map.getLayer(ROUTE_GLOW)) map.removeLayer(ROUTE_GLOW);
        if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
      } catch {}
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data });
      const color = ['match', ['get', 'provider'], 'Mapillary', '#58ff93', 'KartaView', '#69dfff', 'Cross', '#ffffff', '#b9c2cb'];
      map.addLayer({ id: ROUTE_GLOW, type: 'line', source: ROUTE_SOURCE, paint: { 'line-color': color, 'line-width': ['case', ['==', ['get', 'kind'], 'connector'], 7, 13], 'line-opacity': .25, 'line-blur': 4 } });
      map.addLayer({ id: ROUTE_LINE, type: 'line', source: ROUTE_SOURCE, paint: { 'line-color': color, 'line-width': ['case', ['==', ['get', 'kind'], 'connector'], 2.5, 5], 'line-opacity': 1, 'line-dasharray': ['case', ['==', ['get', 'kind'], 'connector'], ['literal', [2, 2]], ['literal', [1, 0]]] } });
    }
    for (const id of ['kartaview-coverage-layer', 'mapillary-sequence-glow', 'mapillary-sequence-line', 'mapillary-image-points']) {
      try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); } catch {}
    }
    startMarker = removeMarker(startMarker); endMarker = removeMarker(endMarker);
    startMarker = pin('出', 'start', plan.startSnap); endMarker = pin('着', 'end', plan.destSnap);
    const bounds = new maplibregl.LngLatBounds();
    features.forEach(f => (f.geometry.coordinates || []).forEach(c => bounds.extend(c)));
    map.fitBounds(bounds, { padding: { top: 120, right: 40, bottom: 360, left: 40 }, maxZoom: 15, duration: 260 });
  }

  function openLoading() {
    const card = $('journeyCandidate');
    if (!card) return;
    card.classList.add('is-open', 'is-loading');
    card.classList.remove('phase4-summary');
    document.querySelector('.provider-panel')?.classList.add('has-candidate');
    $('candidateKicker').textContent = 'PHASE 4 JOURNEY GRAPH';
    $('candidateKicker').classList.add('mapillary');
    $('candidateTitle').textContent = 'Journey Graphを構築中';
    $('candidateText').classList.remove('jc-error');
    $('candidateText').textContent = '経路探索を先に完了し、実画像の先読みは並列で開始する。';
    $('candidateStats').hidden = true;
    $('candidateActions').hidden = true;
  }
  function renderError(message) {
    const card = $('journeyCandidate');
    if (!card) return;
    card.classList.remove('is-loading', 'phase4-summary');
    $('candidateTitle').textContent = '経路を作れなかった';
    $('candidateText').classList.add('jc-error');
    $('candidateText').textContent = message;
    $('candidateStats').hidden = true;
    $('candidateActions').hidden = true;
  }
  function setupBottomSheet(payload, plan) {
    const card = $('journeyCandidate');
    card.classList.remove('is-loading');
    card.classList.add('phase4-summary');
    const providers = payload.selection.providerPath;
    const mins = payload.selection.durationMinutes;
    $('candidateKicker').textContent = providers.length > 1 ? 'MAPILLARY × KARTAVIEW' : 'JOURNEY ROUTE';
    $('candidateTitle').textContent = providers.length > 1 ? 'Provider横断ルート' : `${providers[0]}ルート`;
    $('candidateText').classList.remove('jc-error');
    $('candidateText').textContent = `${payload.selection.sequencePath.length} sequenceを接続。実画像を先読み中…`;
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('candidateStats').hidden = false;
    $('candidateStats').innerHTML = `<div class="jc-stat"><small>距離</small><b>${esc(fmtDistance(payload.selection.distanceMeters))}</b></div><div class="jc-stat"><small>所要時間</small><b>${esc(fmtDuration(mins))}</b></div><label class="jc-stat jc-time"><small>出発時間</small><input id="phase4DepartTime" type="time" value="${defaultTime}"></label><div class="jc-stat"><small>到着予定</small><b id="phase4Arrival">—</b></div>`;
    $('candidateStats').style.gridTemplateColumns = 'repeat(2,1fr)';
    $('candidateActions').hidden = false;
    const oldButton = $('candidateStart'), button = oldButton.cloneNode(true);
    oldButton.replaceWith(button);
    button.disabled = true;
    button.textContent = '実画像を準備中…';
    const updateEta = () => {
      const value = $('phase4DepartTime')?.value || defaultTime;
      const [h, m] = value.split(':').map(Number), depart = new Date();
      depart.setHours(h, m, 0, 0);
      const arrival = new Date(depart.getTime() + mins * 60000);
      $('phase4Arrival').textContent = timeText(arrival);
      payload.selection.departureTime = value;
      payload.selection.arrivalTime = timeText(arrival);
    };
    updateEta();
    $('phase4DepartTime')?.addEventListener('input', updateEta);
    button.addEventListener('click', () => {
      if (!payload.selection.playbackReady) return;
      updateEta();
      try {
        sessionStorage.setItem(ROUTE_KEY, JSON.stringify(payload));
        location.href = '/journey-map.html?autostart=1';
      } catch { renderError('Journey Engineへルートを渡せませんでした'); }
    });
    return { button, updateEta };
  }
  function setPrewarmProgress(payload, ui, prefix, target) {
    payload.selection.prewarmReady = prefix;
    const need = Math.min(PREFETCH_REQUIRED, target);
    const ready = prefix >= need;
    payload.selection.playbackReady = ready;
    $('candidateText').textContent = ready
      ? `${payload.selection.sequencePath.length} sequenceを接続。実画像${prefix}枚を先読み済み。`
      : `${payload.selection.sequencePath.length} sequenceを接続。実画像を先読み中 ${prefix}/${need}`;
    ui.button.disabled = !ready;
    ui.button.textContent = ready ? 'このルートでJourney開始' : `実画像を準備中 ${prefix}/${need}`;
  }

  async function materializePlan(route, segments) {
    const unique = new Map();
    for (const segment of segments) unique.set(`${segment.provider}:${segment.node.id}`, segment);
    const cache = new Map();
    await Promise.all([...unique.entries()].map(async ([key, segment]) => {
      const frames = segment.provider === 'Mapillary'
        ? await mapillaryFrames(segment.node.id)
        : await kartaFrames(segment.node.id);
      cache.set(key, frames);
    }));
    const loaded = [];
    for (const segment of segments) {
      const frames = cache.get(`${segment.provider}:${segment.node.id}`) || [];
      const sliced = sliceFrames(frames, segment.entry, segment.exit);
      if (!sliced.length) continue;
      const coords = sliced.filter(f => Number.isFinite(+f.lng) && Number.isFinite(+f.lat)).map(f => [+f.lng, +f.lat]);
      loaded.push({ ...segment, frames: sliced, coords: coords.length > 1 ? coords : segment.coords });
    }
    return loaded;
  }
  function assembleFrames(segments) {
    const frames = [];
    for (const segment of segments) {
      for (const frame of segment.frames) {
        const prev = frames[frames.length - 1];
        if (prev && String(prev.id) === String(frame.id) && prev.provider === frame.provider) continue;
        frames.push(frame);
      }
    }
    return frames;
  }
  function prewarmOne(frame) {
    const urls = [frame.raw256Url, frame.raw1024Url, frame.sourceUrl, frame.url].filter(Boolean);
    let pos = 0;
    return new Promise(resolve => {
      const tryNext = () => {
        const url = urls[pos++];
        if (!url) { resolve(false); return; }
        const im = new Image();
        im.decoding = 'async';
        im.referrerPolicy = 'no-referrer';
        let done = false;
        const finish = ok => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (ok) {
            frame.prewarmed = true;
            frame.prewarmedVariant = url === frame.raw256Url ? '256' : (url === frame.raw1024Url ? '1024' : 'source');
            resolve(true);
          } else tryNext();
        };
        const timer = setTimeout(() => finish(false), PREFETCH_TIMEOUT_MS);
        im.onload = () => finish(true);
        im.onerror = () => finish(false);
        im.src = url;
      };
      tryNext();
    });
  }
  function prewarmFrames(frames, onProgress) {
    const target = Math.min(PREFETCH_TARGET, frames.length);
    let next = 0, active = 0, finished = 0, prefix = 0;
    let readyResolve, allResolve;
    const readyPromise = new Promise(resolve => { readyResolve = resolve; });
    const allPromise = new Promise(resolve => { allResolve = resolve; });
    const updatePrefix = () => {
      while (prefix < target && frames[prefix]?.prewarmed) prefix++;
      onProgress(prefix, target);
      if (prefix >= Math.min(PREFETCH_REQUIRED, target)) readyResolve(prefix);
      if (finished >= target) {
        if (prefix < Math.min(PREFETCH_REQUIRED, target)) readyResolve(prefix);
        allResolve({ prefix, target });
      }
    };
    const pump = () => {
      while (active < PREFETCH_CONCURRENCY && next < target) {
        const index = next++;
        active++;
        prewarmOne(frames[index]).catch(() => false).finally(() => {
          active--; finished++; updatePrefix(); pump();
        });
      }
      updatePrefix();
    };
    pump();
    return { readyPromise, allPromise, target };
  }

  async function handleStart(start) {
    if (busy) return;
    const dest = destination();
    if (!dest) return;
    busy = true;
    openLoading();
    const started = nowMs();
    const diagnostics = {
      version: VERSION, stage: 'start', startedAt: new Date().toISOString(), start,
      destination: { lat: dest.lat, lng: dest.lng, name: dest.name || dest.title || null }
    };
    window.__journeyGraphDiagnostics = diagnostics;
    try {
      const l = await waitLibs();
      const bounds = new maplibregl.LngLatBounds([start.lng, start.lat], [start.lng, start.lat]);
      bounds.extend([dest.lng, dest.lat]);
      map.fitBounds(bounds, { padding: 70, maxZoom: 13, duration: 0 });
      const corridor = corridorPoints(l.turf, start, dest);
      const kartaPromise = fetchKartaNodes(corridor);
      const [mapillaryFeatures, kartaNodes] = await Promise.all([waitMapillaryFeatures(), kartaPromise]);
      const mapillaryNodes = buildMapillaryNodes(mapillaryFeatures, corridor);
      const nodes = [...mapillaryNodes, ...kartaNodes];
      Object.assign(diagnostics, {
        stage: 'nodes-ready', mapillaryFeatureFragments: mapillaryFeatures.length,
        mapillaryNodes: mapillaryNodes.length, kartaNodes: kartaNodes.length, totalNodes: nodes.length
      });
      if (!nodes.length) throw new Error('周辺の撮影済みsequenceを取得できませんでした');

      const route = graphPath(l, start, dest, nodes);
      const segments = skeletonSegments(route);
      if (!segments.length) throw new Error('経路セグメントを構築できませんでした');
      const distanceMeters = fastDistance(segments, route.connectors, start, dest, route.startSnap, route.destSnap);
      const durationMinutes = Math.max(1, Math.ceil(distanceMeters / 500));
      const providers = [...new Set(segments.map(s => s.provider))];
      const sequenceIds = segments.map(s => s.node.id).filter((id, i, arr) => i === 0 || id !== arr[i - 1]);
      const plan = { ...route, segments };
      showRoute(plan, start, dest);
      const payload = {
        version: VERSION,
        source: providers.length > 1 ? 'Mixed' : providers[0],
        provider: providers.length > 1 ? 'Mixed' : providers[0],
        sequenceId: sequenceIds.join('→'), sequenceIds, frames: [], destination: dest,
        streamOpen: false, streamPending: [],
        selection: {
          strategy: 'phase4-fast-single-graph-prewarm', graphVersion: VERSION,
          distanceMeters, durationMinutes,
          startSnap: route.startSnap, destinationSnap: route.destSnap,
          startSnapMeters: route.startSnap.distance, destinationSnapMeters: route.destSnap.distance,
          startSnapRadiusMeters: route.snap.startRadius, destinationSnapRadiusMeters: route.snap.destinationRadius,
          connectionProfile: route.connectionProfile, providerPath: providers, sequencePath: sequenceIds,
          totalImageIds: 0, candidateCount: nodes.length,
          mapillaryFeatureFragments: mapillaryFeatures.length, mapillaryNodeCount: mapillaryNodes.length,
          kartaNodeCount: kartaNodes.length, crossProvider: providers.length > 1,
          etaSpeedKmh: ETA_SPEED_KMH, etaFormula: 'ceil(distanceMeters/500)',
          graphReady: true, playbackReady: false, prewarmRequired: PREFETCH_REQUIRED
        }
      };
      diagnostics.stage = 'graph-ready';
      diagnostics.graphReadyMs = Math.round(nowMs() - started);
      diagnostics.sequencePath = sequenceIds;
      diagnostics.distanceMeters = Math.round(distanceMeters);
      window.__journeyGraphDiagnostics = { ...diagnostics };
      const sheet = setupBottomSheet(payload, plan);

      const loadedSegments = await materializePlan(route, segments);
      const byKey = new Map(loadedSegments.map(s => [s.key, s]));
      const ordered = route.keys.map(key => byKey.get(key)).filter(Boolean);
      const frames = assembleFrames(ordered);
      if (frames.length < 2) throw new Error('再生可能な画像が不足しています');
      payload.frames = frames;
      payload.selection.totalImageIds = frames.length;
      diagnostics.stage = 'frames-ready';
      diagnostics.frameMetadataReadyMs = Math.round(nowMs() - started);
      diagnostics.frameCount = frames.length;
      window.__journeyGraphDiagnostics = { ...diagnostics };

      const prewarm = prewarmFrames(frames, (prefix, target) => setPrewarmProgress(payload, sheet, prefix, target));
      const prefix = await prewarm.readyPromise;
      if (prefix < Math.min(PREFETCH_REQUIRED, prewarm.target)) throw new Error('Journey開始用の実画像を十分に先読みできませんでした');
      payload.selection.playbackReady = true;
      payload.selection.prewarmReady = prefix;
      diagnostics.stage = 'playback-ready';
      diagnostics.playbackReadyMs = Math.round(nowMs() - started);
      diagnostics.prewarmPrefix = prefix;
      window.__journeyGraphDiagnostics = { ...diagnostics };
      setPrewarmProgress(payload, sheet, prefix, prewarm.target);
      prewarm.allPromise.then(result => {
        window.__journeyGraphDiagnostics = {
          ...(window.__journeyGraphDiagnostics || {}), prewarmFinished: result.prefix,
          prewarmTarget: result.target, prewarmAllMs: Math.round(nowMs() - started)
        };
      });
    } catch (error) {
      window.__journeyGraphDiagnostics = {
        ...(window.__journeyGraphDiagnostics || diagnostics), stage: 'error', error: String(error?.message || error)
      };
      console.error('[JourneyGraph]', error, window.__journeyGraphDiagnostics);
      renderError(error?.message || 'Journey Graphの構築に失敗しました');
    } finally { busy = false; }
  }

  function captureClick(event) {
    if (!destination() || busy) return;
    const target = event.target;
    if (target?.closest?.('.journey-candidate,.provider-panel,.map-header,.maplibregl-ctrl')) return;
    const rect = map.getCanvas().getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const ll = map.unproject(point);
    event.preventDefault(); event.stopImmediatePropagation();
    handleStart({ lat: +ll.lat, lng: +ll.lng });
  }
  function attach(m) {
    if (map === m) return;
    map = m;
    const style = document.createElement('style');
    style.textContent = `
      .phase4-route-pin{width:38px;height:38px;border-radius:999px;display:grid;place-items:center;border:3px solid #fff;box-shadow:0 5px 20px rgba(0,0,0,.38);font-size:12px;font-weight:900;color:#fff;z-index:30}
      .phase4-route-pin.start{background:#111827}.phase4-route-pin.end{background:#ef4444}
      .phase4-summary .jc-time input{width:100%;border:0;background:transparent;color:#fff;font:inherit;font-weight:800;padding:0}
      .phase4-summary .jc-time input::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.75}
      #candidateActions[hidden],#candidateStats[hidden]{display:none!important}
    `;
    document.head.appendChild(style);
    map.getCanvas().addEventListener('click', captureClick, true);
  }
  const timer = setInterval(() => {
    if (window.__streetviewCoverageMap) { clearInterval(timer); attach(window.__streetviewCoverageMap); }
  }, 60);
  setTimeout(() => clearInterval(timer), 15000);
})();
