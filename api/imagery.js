/* Streetview Journey v0.1.0 - single Vercel Hobby Function */
const KARTA_API = 'https://api.openstreetcam.org/2.0';
const MAX_FRAMES = 72;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractData(json) {
  const data = json?.result?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.photos)) return data.photos;
  return [];
}

function sequenceIdOf(photo) {
  return String(photo?.sequenceId ?? photo?.sequence?.id ?? '').trim();
}

function imageUrlOf(photo) {
  return photo?.fileurlLTh || photo?.fileurlTh || photo?.fileurlProc || photo?.fileurl || null;
}

function normalizePhoto(photo) {
  const url = imageUrlOf(photo);
  if (!url) return null;
  return {
    id: String(photo.id ?? photo.photoId ?? ''),
    sequenceId: sequenceIdOf(photo),
    sequenceIndex: numberOrNull(photo.sequenceIndex),
    lat: numberOrNull(photo.lat ?? photo.matchLat),
    lng: numberOrNull(photo.lng ?? photo.matchLng),
    heading: numberOrNull(photo.heading ?? photo.projectionYaw),
    url
  };
}

function pickWindow(photos, anchorIndex) {
  const normalized = photos.map(normalizePhoto).filter(Boolean);
  normalized.sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  if (normalized.length <= MAX_FRAMES) return normalized;

  let anchor = 0;
  if (Number.isFinite(anchorIndex)) {
    const found = normalized.findIndex((p) => p.sequenceIndex >= anchorIndex);
    if (found >= 0) anchor = found;
  }

  let selected = normalized.slice(anchor, anchor + MAX_FRAMES * 2);
  if (selected.length < MAX_FRAMES) selected = normalized.slice(Math.max(0, normalized.length - MAX_FRAMES * 2));
  const stride = Math.max(1, Math.ceil(selected.length / MAX_FRAMES));
  return selected.filter((_, i) => i % stride === 0).slice(0, MAX_FRAMES);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`KartaView upstream ${response.status}`);
  return response.json();
}

async function findNearby(lat, lng, radius) {
  const params = new URLSearchParams({
    lat: String(lat), lng: String(lng), radius: String(radius),
    join: 'sequence', orderBy: 'id', orderDirection: 'desc'
  });
  const json = await fetchJson(`${KARTA_API}/photo/?${params}`);
  const photos = extractData(json);
  const candidate = photos.find((p) => sequenceIdOf(p));
  if (!candidate) return null;
  return {
    sequenceId: sequenceIdOf(candidate),
    sequenceIndex: numberOrNull(candidate.sequenceIndex)
  };
}

async function sequencePage(sequenceId, sequenceIndex) {
  const page = Number.isFinite(sequenceIndex) ? Math.floor(Math.max(0, sequenceIndex) / 150) + 1 : 1;
  const params = new URLSearchParams({ sequenceId, page: String(page), itemsPerPage: '150' });
  const json = await fetchJson(`${KARTA_API}/photo/?${params}`);
  return extractData(json);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if ((req.query.source || 'karta') !== 'karta') {
      return res.status(400).json({ error: 'v0.1ではKartaViewのみ有効です' });
    }

    let sequenceId = String(req.query.sequence || '').trim();
    let anchorIndex = null;

    if (!sequenceId) {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Math.min(5000, Math.max(100, Number(req.query.radius) || 1200));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ error: '有効な緯度・経度が必要です' });
      }
      const nearby = await findNearby(lat, lng, radius);
      if (!nearby) return res.status(404).json({ error: 'この周辺ではKartaViewの連続写真が見つかりませんでした' });
      sequenceId = nearby.sequenceId;
      anchorIndex = nearby.sequenceIndex;
    }

    const photos = await sequencePage(sequenceId, anchorIndex);
    let frames = pickWindow(photos, anchorIndex);

    if (frames.length < 12 && photos.length >= 12) {
      frames = pickWindow([...photos].reverse(), anchorIndex).reverse();
    }

    if (frames.length < 2) return res.status(404).json({ error: '再生可能な画像が不足しています' });
    return res.status(200).json({ version: '0.1.0', source: 'KartaView', sequenceId, frames });
  } catch (error) {
    console.error('imagery route error', error);
    return res.status(502).json({ error: 'KartaViewからルートを取得できませんでした' });
  }
};
