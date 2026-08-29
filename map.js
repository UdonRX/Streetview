(() => {
  'use strict';

  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const TOKEN_KEY = 'streetview:mapillary-token';
  const ROUTE_KEY = 'streetview:journey-route';
  const GRAPH = 'https://graph.mapillary.com';
  const MAX_FRAMES = 72;

  const KARTA_SOURCE = 'kartaview-coverage';
  const KARTA_LAYER = 'kartaview-coverage-layer';
  const MLY_SOURCE = 'mapillary-coverage';
  const MLY_GLOW = 'mapillary-sequence-glow';
  const MLY_LINE = 'mapillary-sequence-line';
  const MLY_IMAGE = 'mapillary-image-points';

  const $ = id => document.getElementById(id);
  let map = null;
  let loaded = false;
  let mapillaryReady = false;
  let candidateAbort = null;
  let currentCandidate = null;

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }
  function setToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }
  function setStatus(text) {
    if ($('mapStatus')) $('mapStatus').textContent = text;
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function distanceMeters(a, b) {
    const r = Math.PI / 180;
    const p1 = a.lat * r, p2 = b.lat * r;
    const dp = (b.lat - a.lat) * r, dl = (b.lng - a.lng) * r;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }
  function setLayerVisible(id, visible) {
    if (map && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }

  function installCandidateUI() {
    if ($('journeyCandidate')) return;
    const style = document.createElement('style');
    style.textContent = `.coverage-map{cursor:crosshair}.journey-candidate{position:fixed;z-index:12;left:14px;right:14px;bottom:calc(var(--safe-bottom) + 14px);transform:translateY(125%);opacity:0;pointer-events:none;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s;padding:14px;border:1px solid rgba(255,255,255,.15);border-radius:20px;background:rgba(7,15,14,.94);box-shadow:0 16px 46px rgba(0,0,0,.34);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.journey-candidate.is-open{transform:translateY(0);opacity:1;pointer-events:auto}.journey-candidate.is-loading .jc-main{opacity:.55}.provider-panel.has-candidate{transform:translateY(125%);opacity:0;pointer-events:none}.provider-panel{transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s}.jc-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.jc-kicker{font-size:8px;font-weight:850;letter-spacing:.16em;color:#65e8ff}.jc-kicker.mapillary{color:#73ffa1}.jc-close{width:32px;height:32px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.06);color:#fff;font-size:18px}.jc-main{display:grid;gap:5px;margin-top:8px}.jc-main strong{font-size:18px}.jc-main p{margin:0;font-size:10px;line-height:1.5;color:rgba(255,255,255,.58)}.jc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:11px}.jc-stat{display:grid;gap:3px;padding:9px 10px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.035)}.jc-stat small{font-size:8px;color:rgba(255,255,255,.42)}.jc-stat b{font-size:11px;overflow:hidden;text-overflow:ellipsis}.jc-actions{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}.jc-actions button{display:grid;place-items:center;min-height:44px;border:1px solid rgba(255,255,255,.12);border-radius:13px;font-size:11px;font-weight:800}.jc-actions .primary{background:#fff;color:#07110f}.jc-actions .secondary{padding:0 15px;background:rgba(255,255,255,.06);color:#fff}.jc-error{color:#ffcf9b!important}@media(orientation:landscape){.journey-candidate{left:14px;right:auto;width:min(390px,42vw)}}`;
    document.head.appendChild(style);

    const card = document.createElement('section');
    card.id = 'journeyCandidate';
    card.className = 'journey-candidate';
    card.innerHTML = `<div class="jc-head"><span id="candidateKicker" class="jc-kicker">JOURNEY CANDIDATE</span><button id="candidateClose" class="jc-close" type="button">×</button></div><div class="jc-main"><strong id="candidateTitle">撮影済みルートを確認中</strong><p id="candidateText">sequenceを直接確認している。</p></div><div id="candidateStats" class="jc-stats" hidden></div><div id="candidateActions" class="jc-actions" hidden><button id="candidateStart" class="primary" type="button">このルートでJourney開始</button><button id="candidateDismiss" class="secondary" type="button">戻る</button></div>`;
    document.body.appendChild(card);
    $('candidateClose').addEventListener('click', closeCandidate);
    $('candidateDismiss').addEventListener('click', closeCandidate);
    $('candidateStart').addEventListener('click', startCandidateJourney);
  }

  function closeCandidate() {
    if (candidateAbort) candidateAbort.abort();
    candidateAbort = null;
    currentCandidate = null;
    $('journeyCandidate')?.classList.remove('is-open', 'is-loading');
    document.querySelector('.provider-panel')?.classList.remove('has-candidate');
  }
  function openLoading(provider, text) {
    installCandidateUI();
    currentCandidate = null;
    const card = $('journeyCandidate');
    card.classList.add('is-open', 'is-loading');
    document.querySelector('.provider-panel')?.classList.add('has-candidate');
    $('candidateKicker').textContent = `${provider.toUpperCase()} JOURNEY CANDIDATE`;
    $('candidateKicker').classList.toggle('mapillary', provider === 'Mapillary');
    $('candidateTitle').textContent = '撮影済みsequenceを読み込み中';
    $('candidateText').classList.remove('jc-error');
    $('candidateText').textContent = text;
    $('candidateStats').hidden = true;
    $('candidateActions').hidden = true;
  }
  function renderError(provider, message) {
    $('journeyCandidate').classList.remove('is-loading');
    $('candidateKicker').textContent = `${provider.toUpperCase()} JOURNEY CANDIDATE`;
    $('candidateKicker').classList.toggle('mapillary', provider === 'Mapillary');
    $('candidateTitle').textContent = 'この場所では候補を作れなかった';
    $('candidateText').classList.add('jc-error');
    $('candidateText').textContent = message;
    $('candidateStats').hidden = true;
    $('candidateActions').hidden = true;
  }
  function formatDistance(d) {
    if (!Number.isFinite(d)) return '直接選択';
    return d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
  }
  function renderRouteCandidate(payload, extra = {}) {
    currentCandidate = payload;
    const provider = payload.provider || payload.source || 'Coverage';
    const frames = Array.isArray(payload.frames) ? payload.frames : [];
    const selection = payload.selection || {};
    $('journeyCandidate').classList.remove('is-loading');
    $('candidateKicker').textContent = `${provider.toUpperCase()} JOURNEY CANDIDATE`;
    $('candidateKicker').classList.toggle('mapillary', provider === 'Mapillary');
    $('candidateTitle').textContent = `Sequence ${payload.sequenceId || '—'}`;
    $('candidateText').classList.remove('jc-error');
    $('candidateText').textContent = `${provider}の撮影済みsequenceを直接選択した。`;
    const stats = $('candidateStats');
    stats.hidden = false;
    stats.innerHTML = `<div class="jc-stat"><small>Provider</small><b>${esc(provider)}</b></div><div class="jc-stat"><small>連続画像</small><b>${frames.length}枚</b></div><div class="jc-stat"><small>${esc(extra.thirdLabel || 'タップ地点から')}</small><b>${esc(extra.thirdValue || formatDistance(Number(selection.proximityMeters)))}</b></div>`;
    $('candidateActions').hidden = false;
  }
  function startCandidateJourney() {
    if (!currentCandidate?.frames?.length) return;
    try {
      sessionStorage.setItem(ROUTE_KEY, JSON.stringify(currentCandidate));
      location.href = '/journey-map.html?autostart=1';
    } catch {
      renderError(currentCandidate.provider || 'Coverage', '選択ルートをJourney Engineへ渡せませんでした。');
    }
  }

  async function findKartaDirect(ll) {
    if (!$('kartaToggle')?.checked) return;
    openLoading('KartaView', `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} の紫ルートを確認中…`);
    if (candidateAbort) candidateAbort.abort();
    candidateAbort = new AbortController();
    try {
      const q = new URLSearchParams({ source: 'karta', mode: 'nearest', lat: String(ll.lat), lng: String(ll.lng) });
      const response = await fetch(`/api/imagery?${q}`, { signal: candidateAbort.signal, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'KartaView sequenceを特定できませんでした');
      renderRouteCandidate(data);
    } catch (error) {
      if (error?.name !== 'AbortError') renderError('KartaView', error?.message || 'KartaView候補を作れませんでした');
    } finally {
      candidateAbort = null;
    }
  }

  async function mlyFetch(path) {
    const token = getToken();
    if (!token) throw new Error('Mapillary Access Tokenが未設定です');
    const response = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `OAuth ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new Error(data?.error?.message || `Mapillary API ${response.status}`);
    return data;
  }
  async function imageMeta(id) {
    const fields = 'id,sequence,captured_at,computed_geometry,compass_angle,thumb_2048_url,is_pano';
    return mlyFetch(`/${encodeURIComponent(id)}?fields=${fields}`);
  }
  function featureId(feature) {
    return String(feature?.properties?.id ?? feature?.properties?.image_id ?? feature?.properties?.sequence_id ?? feature?.id ?? '').trim();
  }
  async function parallelMap(items, limit, fn) {
    const output = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try { output[i] = await fn(items[i], i); } catch { output[i] = null; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return output;
  }
  function normalizeMlyFrame(meta, sequenceId, index) {
    const c = meta?.computed_geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !meta?.thumb_2048_url) return null;
    return {
      id: String(meta.id), sequenceId: String(sequenceId), sequenceIndex: index,
      lat: Number(c[1]), lng: Number(c[0]),
      heading: Number.isFinite(Number(meta.compass_angle)) ? Number(meta.compass_angle) : null,
      projection: meta.is_pano ? 'SPHERE' : 'RECTILINEAR',
      fieldOfView: meta.is_pano ? 360 : 100,
      url: meta.thumb_2048_url, provider: 'Mapillary', capturedAt: meta.captured_at || null
    };
  }
  async function mapillarySequencePayload(sequenceId, anchorImageId, ll) {
    const idsData = await mlyFetch(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);
    const ids = (idsData?.data || []).map(x => String(x?.id ?? x)).filter(Boolean);
    if (ids.length < 2) throw new Error('このMapillary sequenceには連続画像がありません');
    let anchor = anchorImageId ? ids.indexOf(String(anchorImageId)) : -1;
    if (anchor < 0) anchor = Math.floor(ids.length / 2);
    let start = Math.max(0, anchor - Math.floor(MAX_FRAMES * 0.35));
    if (start + MAX_FRAMES > ids.length) start = Math.max(0, ids.length - MAX_FRAMES);
    const windowIds = ids.slice(start, start + MAX_FRAMES);
    const metadata = await parallelMap(windowIds, 8, id => imageMeta(id));
    const frames = metadata.map((m, i) => normalizeMlyFrame(m, sequenceId, start + i)).filter(Boolean);
    if (frames.length < 2) throw new Error('Mapillary画像URLを取得できませんでした');
    let nearest = null;
    if (ll) for (const frame of frames) {
      const d = distanceMeters(ll, frame);
      if (nearest === null || d < nearest) nearest = d;
    }
    return {
      version: '0.2.2', source: 'Mapillary', provider: 'Mapillary', sequenceId: String(sequenceId), anchorIndex: anchor,
      selection: { strategy: 'direct-vector-feature', direction: 'forward', alignmentErrorDeg: null, proximityMeters: nearest, searchMode: anchorImageId ? 'mapillary-image-feature' : 'mapillary-sequence-feature', candidateCount: 1, visualOverride: false },
      frames, candidateRoutes: []
    };
  }
  async function findMapillaryDirect(feature, ll) {
    if (!getToken()) { openSheet(); return; }
    const layer = feature?.layer?.id || '';
    const id = featureId(feature);
    if (!id) return;
    openLoading('Mapillary', 'Mapillaryの撮影済みsequenceを直接読み込み中…');
    try {
      let sequenceId = null, anchorImageId = null;
      if (layer === MLY_IMAGE) {
        anchorImageId = id;
        const meta = await imageMeta(id);
        sequenceId = String(meta?.sequence?.id ?? meta?.sequence ?? '');
      } else {
        sequenceId = id;
      }
      if (!sequenceId) throw new Error('Mapillary sequence IDを取得できませんでした');
      const payload = await mapillarySequencePayload(sequenceId, anchorImageId, ll);
      renderRouteCandidate(payload, { thirdLabel: 'Mapillary', thirdValue: anchorImageId ? '画像点を直接選択' : 'sequence線を直接選択' });
    } catch (error) {
      renderError('Mapillary', error?.message || 'Mapillary候補を作れませんでした');
    }
  }

  function installKartaView() {
    if (!map || map.getSource(KARTA_SOURCE)) return;
    map.addSource(KARTA_SOURCE, { type: 'raster', tiles: ['https://api.openstreetcam.org/2.0/sequence/tiles/{x}/{y}/{z}.png'], tileSize: 256, minzoom: 0, maxzoom: 20, attribution: '© KartaView' });
    map.addLayer({ id: KARTA_LAYER, type: 'raster', source: KARTA_SOURCE, paint: { 'raster-opacity': 0.88, 'raster-contrast': 0.16, 'raster-saturation': 0.35, 'raster-brightness-max': 1 } });
    $('kartaStatus').textContent = '実データ表示中';
  }
  function removeMapillary() {
    if (!map) return;
    for (const id of [MLY_IMAGE, MLY_LINE, MLY_GLOW]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(MLY_SOURCE)) map.removeSource(MLY_SOURCE);
    mapillaryReady = false;
  }
  function installMapillary(token) {
    if (!map || !loaded || !token) return;
    removeMapillary();
    const tileUrl = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`;
    map.addSource(MLY_SOURCE, { type: 'vector', tiles: [tileUrl], minzoom: 6, maxzoom: 14, attribution: '© Mapillary' });
    map.addLayer({ id: MLY_GLOW, type: 'line', source: MLY_SOURCE, 'source-layer': 'sequence', minzoom: 6, paint: { 'line-color': '#58ff93', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 11, 5, 14, 10], 'line-opacity': 0.25, 'line-blur': 3 } });
    map.addLayer({ id: MLY_LINE, type: 'line', source: MLY_SOURCE, 'source-layer': 'sequence', minzoom: 6, paint: { 'line-color': '#73ffa1', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 1.7, 14, 3.1], 'line-opacity': 0.92 } });
    map.addLayer({ id: MLY_IMAGE, type: 'circle', source: MLY_SOURCE, 'source-layer': 'image', minzoom: 14, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 4.2], 'circle-color': '#dcffe6', 'circle-opacity': 0.86, 'circle-stroke-width': 1, 'circle-stroke-color': '#43ff86' } });
    mapillaryReady = true;
    $('mapillaryToggle').checked = true;
    $('mapillaryStatus').textContent = '接続中';
  }
  function updateMapillaryState() {
    const token = getToken();
    if (!token) {
      removeMapillary();
      $('mapillaryToggle').checked = false;
      $('mapillaryStatus').textContent = 'トークン未設定';
      return;
    }
    if (loaded && !mapillaryReady) installMapillary(token);
  }
  function mapillaryFeatureAt(point) {
    if (!mapillaryReady || !$('mapillaryToggle')?.checked) return null;
    const layers = [MLY_IMAGE, MLY_LINE].filter(id => map.getLayer(id));
    if (!layers.length) return null;
    const radius = 12;
    const box = [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]];
    const features = map.queryRenderedFeatures(box, { layers });
    return features.find(f => f.layer?.id === MLY_IMAGE) || features[0] || null;
  }

  function openSheet() {
    const sheet = $('tokenSheet');
    if (!sheet) return;
    $('mapillaryToken').value = getToken();
    sheet.hidden = false;
    requestAnimationFrame(() => $('mapillaryToken').focus());
  }
  function closeSheet() { $('tokenSheet').hidden = true; }

  function init() {
    installCandidateUI();
    if (!window.maplibregl) {
      setStatus('MapLibreを読み込めませんでした');
      return;
    }
    setStatus('地図を読み込み中');
    try {
      map = new maplibregl.Map({ container: 'coverageMap', style: STYLE_URL, center: [135.7681, 35.0116], zoom: 11.3, pitch: 0, bearing: 0, attributionControl: false, maxPitch: 55 });
    } catch (error) {
      console.error(error);
      setStatus('地図の初期化に失敗');
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: true, fitBoundsOptions: { maxZoom: 15 } }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      loaded = true;
      installKartaView();
      updateMapillaryState();
      setStatus('実データ表示中');
    });
    map.on('click', event => {
      const feature = mapillaryFeatureAt(event.point);
      if (feature) {
        findMapillaryDirect(feature, { lat: event.lngLat.lat, lng: event.lngLat.lng });
      } else {
        findKartaDirect(event.lngLat);
      }
    });
    map.on('sourcedata', event => {
      if (event.sourceId === MLY_SOURCE && event.isSourceLoaded) {
        $('mapillaryStatus').textContent = '実データ表示中';
        setStatus('Mapillary + KartaView');
      }
    });
    map.on('error', event => {
      const message = String(event?.error?.message || '');
      if (message.includes('mapillary') || message.includes('401') || message.includes('403')) $('mapillaryStatus').textContent = 'トークンを確認';
    });

    $('kartaToggle').addEventListener('change', event => { setLayerVisible(KARTA_LAYER, event.target.checked); closeCandidate(); });
    $('mapillaryToggle').addEventListener('change', event => {
      if (!getToken()) { event.target.checked = false; openSheet(); return; }
      for (const id of [MLY_GLOW, MLY_LINE, MLY_IMAGE]) setLayerVisible(id, event.target.checked);
      closeCandidate();
    });
    $('mapillarySettings').addEventListener('click', openSheet);
    $('tokenBackdrop').addEventListener('click', closeSheet);
    $('closeTokenSheet').addEventListener('click', closeSheet);
    $('saveToken').addEventListener('click', () => {
      const token = $('mapillaryToken').value.trim();
      if (!token) return;
      setToken(token);
      removeMapillary();
      installMapillary(token);
      closeSheet();
    });
    $('removeToken').addEventListener('click', () => {
      setToken('');
      $('mapillaryToken').value = '';
      updateMapillaryState();
      closeSheet();
    });
  }

  window.addEventListener('error', event => {
    if (!loaded) setStatus(`JSエラー: ${event.message || '初期化失敗'}`);
  });
  init();
})();
