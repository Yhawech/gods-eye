// ADS_B_FALLBACK_GRID (2026-11-11): global multi-point civil-flight fallback.
// OpenSky is TCP-unreachable from AWS and a single 250nm circle shows only a
// handful of aircraft; query a fixed global receiver grid + the view anchor in
// parallel (each point cached + coalesced), merge and dedupe by ICAO24.
const ADS_B_FALLBACK_GRID = [
  [40.0, -75.0], [36.0, -98.0], [34.0, -118.0], [25.0, -90.0],
  [-23.0, -46.0], [53.0, -1.0], [50.0, 8.0], [41.0, 12.0],
  [39.0, 32.0], [25.0, 55.0], [28.0, 77.0], [13.0, 77.0],
  [1.3, 103.8], [35.0, 139.0], [-31.0, 151.0], [-29.0, 28.0],
];
async function fetchAdsbLolGridFallback(req) {
  const anchor = adsbLolFallbackAnchor(req);
  const wanted = [];
  if (anchor) wanted.push([anchor.latitude, anchor.longitude]);
  for (const point of ADS_B_FALLBACK_GRID) wanted.push(point);
  const fetchOne = async (lat, lon) => {
    const roundedLat = Math.round(lat * 4) / 4;
    const roundedLon = Math.round(lon * 4) / 4;
    const cacheKey = 'g:' + roundedLat.toFixed(2) + ',' + roundedLon.toFixed(2);
    const now = Date.now();
    const cached = _adsbLolPointCache.get(cacheKey);
    if (cached && now - cached.cachedAt < ADSBLOL_POINT_CACHE_MS) return cached.normalized;
    const existing = _adsbLolPointInFlight.get(cacheKey);
    if (existing) return existing.promise;
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const url = 'https://api.adsb.lol/v2/lat/' + roundedLat + '/lon/' + roundedLon + '/dist/' + ADSBLOL_POINT_RADIUS_NM;
        const upstream = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'gods-eye-view-adsblol-regional-fallback/1.0' },
          signal: controller.signal,
        });
        if (!upstream.ok) throw new Error('upstream HTTP ' + upstream.status);
        const payload = await readResponseJsonCapped(upstream, ADSBLOL_POINT_MAX_RESPONSE_BYTES);
        const normalized = normalizeAdsbLolPointResponse(payload);
        _adsbLolPointCache.set(cacheKey, { normalized: normalized, cachedAt: Date.now() });
        return normalized;
      } finally { clearTimeout(timer); }
    })();
    _adsbLolPointInFlight.set(cacheKey, { promise: promise });
    promise.finally(() => {
      if (_adsbLolPointInFlight.get(cacheKey) && _adsbLolPointInFlight.get(cacheKey).promise === promise) _adsbLolPointInFlight.delete(cacheKey);
    }).catch(() => {});
    return promise;
  };
  const results = await Promise.allSettled(wanted.map(function (pair) { return fetchOne(pair[0], pair[1]); }));
  const seen = new Set();
  const states = [];
  let newest = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const normalized = result.value;
    if (Number(normalized.time) > newest) newest = Number(normalized.time);
    for (const row of normalized.states || []) {
      const id = row && row[0];
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      states.push(row);
    }
  }
  if (!states.length) return null;
  return {
    body: JSON.stringify({ time: newest || Math.floor(Date.now() / 1000), states: states }),
    count: states.length,
    cacheStatus: 'GRID',
  };
}
