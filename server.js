import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const preferredPort = Number(process.env.PORT || 4173);
const cache = new Map();
const CACHE_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 14_000;

const rangeProfiles = {
  "24h": { days: 1, usgsFeed: "all_day", gdeltTimespan: "24h" },
  "7d": { days: 7, usgsFeed: "2.5_week", gdeltTimespan: "7d" },
  "30d": { days: 30, usgsFeed: "4.5_month", gdeltTimespan: "30d" },
  "90d": { days: 90, usgsFeed: "4.5_month", gdeltTimespan: "3months" }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const gdeltFeeds = [
  {
    key: "osint-news",
    source: "GDELT OSINT News",
    category: "news",
    query: "(military OR missile OR sanctions OR protest OR earthquake OR wildfire OR flood OR volcano)",
    maxrecords: 80
  }
];

const googleNewsFeeds = [
  {
    key: "google-military",
    source: "Google News Military OSINT",
    category: "military",
    query: "military OR missile OR drone OR troops OR defense OR navy OR air force",
    maxrecords: 70
  },
  {
    key: "google-geopolitical",
    source: "Google News Geopolitical OSINT",
    category: "geopolitical",
    query: "sanctions OR diplomacy OR protest OR border OR ceasefire OR election OR summit",
    maxrecords: 70
  }
];

const rssFeeds = [
  {
    key: "gdacs",
    source: "GDACS Disaster Alerts",
    category: "disaster",
    sourceType: "official",
    url: "https://www.gdacs.org/xml/rss.xml",
    maxrecords: 80
  },
  {
    key: "defense",
    source: "Defense.gov News",
    category: "military",
    sourceType: "official",
    url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=50",
    maxrecords: 50
  }
];

const countryCentroids = {
  AF: [33.9391, 67.71],
  AL: [41.1533, 20.1683],
  DZ: [28.0339, 1.6596],
  AR: [-38.4161, -63.6167],
  AM: [40.0691, 45.0382],
  AU: [-25.2744, 133.7751],
  AT: [47.5162, 14.5501],
  AZ: [40.1431, 47.5769],
  BD: [23.685, 90.3563],
  BY: [53.7098, 27.9534],
  BE: [50.5039, 4.4699],
  BO: [-16.2902, -63.5887],
  BA: [43.9159, 17.6791],
  BR: [-14.235, -51.9253],
  BG: [42.7339, 25.4858],
  BF: [12.2383, -1.5616],
  KH: [12.5657, 104.991],
  CM: [7.3697, 12.3547],
  CA: [56.1304, -106.3468],
  CL: [-35.6751, -71.543],
  CN: [35.8617, 104.1954],
  CO: [4.5709, -74.2973],
  CD: [-4.0383, 21.7587],
  CG: [-0.228, 15.8277],
  CR: [9.7489, -83.7534],
  HR: [45.1, 15.2],
  CU: [21.5218, -77.7812],
  CY: [35.1264, 33.4299],
  CZ: [49.8175, 15.473],
  DK: [56.2639, 9.5018],
  DO: [18.7357, -70.1627],
  EC: [-1.8312, -78.1834],
  EG: [26.8206, 30.8025],
  SV: [13.7942, -88.8965],
  EE: [58.5953, 25.0136],
  ET: [9.145, 40.4897],
  FI: [61.9241, 25.7482],
  FR: [46.2276, 2.2137],
  GE: [42.3154, 43.3569],
  DE: [51.1657, 10.4515],
  GH: [7.9465, -1.0232],
  GR: [39.0742, 21.8243],
  GT: [15.7835, -90.2308],
  HT: [18.9712, -72.2852],
  HN: [15.2, -86.2419],
  HK: [22.3193, 114.1694],
  HU: [47.1625, 19.5033],
  IS: [64.9631, -19.0208],
  IN: [20.5937, 78.9629],
  ID: [-0.7893, 113.9213],
  IR: [32.4279, 53.688],
  IQ: [33.2232, 43.6793],
  IE: [53.1424, -7.6921],
  IL: [31.0461, 34.8516],
  IT: [41.8719, 12.5674],
  JM: [18.1096, -77.2975],
  JP: [36.2048, 138.2529],
  JO: [30.5852, 36.2384],
  KZ: [48.0196, 66.9237],
  KE: [-0.0236, 37.9062],
  KR: [35.9078, 127.7669],
  KW: [29.3117, 47.4818],
  KG: [41.2044, 74.7661],
  LA: [19.8563, 102.4955],
  LV: [56.8796, 24.6032],
  LB: [33.8547, 35.8623],
  LY: [26.3351, 17.2283],
  LT: [55.1694, 23.8813],
  LU: [49.8153, 6.1296],
  MG: [-18.7669, 46.8691],
  MY: [4.2105, 101.9758],
  ML: [17.5707, -3.9962],
  MX: [23.6345, -102.5528],
  MD: [47.4116, 28.3699],
  MN: [46.8625, 103.8467],
  MA: [31.7917, -7.0926],
  MZ: [-18.6657, 35.5296],
  MM: [21.9162, 95.956],
  NP: [28.3949, 84.124],
  NL: [52.1326, 5.2913],
  NZ: [-40.9006, 174.886],
  NI: [12.8654, -85.2072],
  NE: [17.6078, 8.0817],
  NG: [9.082, 8.6753],
  KP: [40.3399, 127.5101],
  NO: [60.472, 8.4689],
  OM: [21.4735, 55.9754],
  PK: [30.3753, 69.3451],
  PS: [31.9522, 35.2332],
  PA: [8.538, -80.7821],
  PG: [-6.315, 143.9555],
  PY: [-23.4425, -58.4438],
  PE: [-9.19, -75.0152],
  PH: [12.8797, 121.774],
  PL: [51.9194, 19.1451],
  PT: [39.3999, -8.2245],
  QA: [25.3548, 51.1839],
  RO: [45.9432, 24.9668],
  RU: [61.524, 105.3188],
  RW: [-1.9403, 29.8739],
  SA: [23.8859, 45.0792],
  SN: [14.4974, -14.4524],
  RS: [44.0165, 21.0059],
  SG: [1.3521, 103.8198],
  SK: [48.669, 19.699],
  SI: [46.1512, 14.9955],
  SO: [5.1521, 46.1996],
  ZA: [-30.5595, 22.9375],
  ES: [40.4637, -3.7492],
  LK: [7.8731, 80.7718],
  SD: [12.8628, 30.2176],
  SE: [60.1282, 18.6435],
  CH: [46.8182, 8.2275],
  SY: [34.8021, 38.9968],
  TW: [23.6978, 120.9605],
  TJ: [38.861, 71.2761],
  TZ: [-6.369, 34.8888],
  TH: [15.87, 100.9925],
  TN: [33.8869, 9.5375],
  TR: [38.9637, 35.2433],
  TM: [38.9697, 59.5563],
  UG: [1.3733, 32.2903],
  UA: [48.3794, 31.1656],
  AE: [23.4241, 53.8478],
  GB: [55.3781, -3.436],
  US: [37.0902, -95.7129],
  UY: [-32.5228, -55.7658],
  UZ: [41.3775, 64.5853],
  VE: [6.4238, -66.5897],
  VN: [14.0583, 108.2772],
  YE: [15.5527, 48.5164],
  ZM: [-13.1339, 27.8493],
  ZW: [-19.0154, 29.1549]
};

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryNameLookup = buildCountryNameLookup();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/events") {
      await handleEventsApi(requestUrl, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/traffic/")) {
      await handleTrafficApi(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      sendJson(res, {
        ok: true,
        serverTime: new Date().toISOString(),
        cacheKeys: [...cache.keys()]
      });
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: "Unexpected server error", detail: error.message }, 500);
  }
});

startServer(preferredPort);

function startServer(port, attempt = 0) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && attempt < 10) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying http://localhost:${nextPort}`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error(error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`GOD EYES OSINT Dashboard running at http://localhost:${port}`);
  });
}

async function handleEventsApi(requestUrl, res) {
  const requestedRange = requestUrl.searchParams.get("range") || "7d";
  const range = rangeProfiles[requestedRange] ? requestedRange : "7d";
  const cacheKey = `events:${range}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    sendJson(res, { ...cached.payload, cached: true });
    return;
  }

  const payload = await buildEventsPayload(range);
  cache.set(cacheKey, { createdAt: Date.now(), payload });
  sendJson(res, payload);
}

const trafficRegions = {
  global: {
    label: "Global",
    flightBox: null
  },
  "north-america": {
    label: "North America",
    flightBox: [24, -130, 55, -60]
  },
  europe: {
    label: "Europe",
    flightBox: [35, -12, 62, 35]
  },
  "middle-east": {
    label: "Middle East",
    flightBox: [12, 34, 36, 62]
  },
  india: {
    label: "India",
    flightBox: [5, 65, 32, 92]
  },
  "indo-pacific": {
    label: "Indo-Pacific",
    flightBox: [-12, 95, 38, 150]
  }
};

async function handleTrafficApi(requestUrl, res) {
  const endpoint = requestUrl.pathname.replace("/api/traffic/", "");
  const regionKey = trafficRegions[requestUrl.searchParams.get("region")] ? requestUrl.searchParams.get("region") : "global";

  if (endpoint === "flights") {
    const payload = await cachedTrafficPayload(`traffic:flights:${regionKey}`, 15 * 60_000, () => getOpenSkyTraffic(regionKey));
    sendJson(res, payload);
    return;
  }

  if (endpoint === "military") {
    const payload = await cachedTrafficPayload(`traffic:military:${regionKey}`, 2 * 60_000, () => getMilitaryTraffic(regionKey));
    sendJson(res, payload);
    return;
  }

  sendJson(res, { ok: false, error: "Unknown traffic endpoint" }, 404);
}

async function cachedTrafficPayload(cacheKey, ttlMs, buildPayload) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ttlMs) {
    return { ...cached.payload, cached: true };
  }

  const payload = await buildPayload();
  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

async function getOpenSkyTraffic(regionKey) {
  const region = trafficRegions[regionKey] || trafficRegions.global;
  const params = new URLSearchParams({ extended: "1" });
  if (region.flightBox) {
    const [lamin, lomin, lamax, lomax] = region.flightBox;
    params.set("lamin", String(lamin));
    params.set("lomin", String(lomin));
    params.set("lamax", String(lamax));
    params.set("lomax", String(lomax));
  }

  const source = "OpenSky Network";
  const url = `https://opensky-network.org/api/states/all?${params.toString()}`;
  const fetched = await fetchJson(source, url, { timeoutMs: 16_000 });
  if (!fetched.ok) {
    return trafficErrorPayload("flights", source, region, fetched);
  }

  const aircraft = (fetched.data.states || [])
    .map(openSkyStateToAircraft)
    .filter((aircraft) => hasTrafficCoordinates(aircraft))
    .slice(0, 1600);

  return {
    ok: true,
    kind: "flights",
    source,
    region: regionKey,
    regionLabel: region.label,
    refreshedAt: new Date().toISOString(),
    generatedInMs: fetched.ms,
    cached: false,
    count: aircraft.length,
    aircraft
  };
}

async function getMilitaryTraffic(regionKey) {
  const region = trafficRegions[regionKey] || trafficRegions.global;
  const source = "Airplanes.live Military";
  const url = "https://api.airplanes.live/v2/mil";
  const fetched = await fetchJson(source, url, { timeoutMs: 16_000 });
  if (!fetched.ok) {
    return trafficErrorPayload("military", source, region, fetched);
  }

  const aircraft = (fetched.data.ac || [])
    .map(airplanesLiveToAircraft)
    .filter((aircraft) => hasTrafficCoordinates(aircraft))
    .filter((aircraft) => trafficInFlightRegion(aircraft, region))
    .slice(0, 1000);

  return {
    ok: true,
    kind: "military",
    source,
    region: regionKey,
    regionLabel: region.label,
    refreshedAt: new Date().toISOString(),
    generatedInMs: fetched.ms,
    cached: false,
    count: aircraft.length,
    aircraft
  };
}

function openSkyStateToAircraft(row) {
  const lastContact = row[4] ? new Date(row[4] * 1000).toISOString() : null;
  const speedKnots = numberOrNull(row[9]) === null ? null : Math.round(Number(row[9]) * 1.94384);
  const altitudeFeet = numberOrNull(row[7]) === null ? null : Math.round(Number(row[7]) * 3.28084);

  return cleanTrafficAsset({
    id: `opensky:${row[0]}`,
    hex: row[0],
    callsign: cleanString(row[1]) || row[0],
    label: cleanString(row[1]) || row[0],
    type: "civil",
    category: openSkyAircraftCategory(row[17]),
    country: row[2] || "Unknown",
    lat: row[6],
    lon: row[5],
    altitudeFeet,
    speedKnots,
    track: row[10],
    verticalRate: row[11],
    squawk: row[14],
    source: "OpenSky Network",
    lastSeen: lastContact
  });
}

function airplanesLiveToAircraft(aircraft) {
  return cleanTrafficAsset({
    id: `airplanes:${aircraft.hex || aircraft.flight || `${aircraft.lat}:${aircraft.lon}`}`,
    hex: aircraft.hex,
    callsign: cleanString(aircraft.flight) || aircraft.hex || "MIL",
    label: cleanString(aircraft.flight) || aircraft.r || aircraft.hex || "MIL",
    type: "military",
    category: aircraft.t || aircraft.type || "Military",
    registration: aircraft.r,
    description: aircraft.desc,
    country: aircraft.ownOp || aircraft.operator || "Unknown",
    lat: aircraft.lat,
    lon: aircraft.lon,
    altitudeFeet: aircraft.alt_baro === "ground" ? 0 : numberOrNull(aircraft.alt_baro),
    speedKnots: numberOrNull(aircraft.gs),
    track: aircraft.track,
    squawk: aircraft.squawk,
    source: "Airplanes.live",
    lastSeen: new Date().toISOString()
  });
}

function trafficErrorPayload(kind, source, region, fetched) {
  return {
    ok: false,
    kind,
    source,
    regionLabel: region.label,
    refreshedAt: new Date().toISOString(),
    generatedInMs: fetched.ms || 0,
    cached: false,
    count: 0,
    aircraft: [],
    error: fetched.error || "Traffic source failed"
  };
}

function cleanTrafficAsset(asset) {
  return Object.fromEntries(
    Object.entries(asset).map(([key, value]) => [key, typeof value === "string" ? cleanString(value) : value])
  );
}

function hasTrafficCoordinates(asset) {
  const lat = Number(asset.lat);
  const lon = Number(asset.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function trafficInFlightRegion(asset, region) {
  if (!region.flightBox) return true;
  const [minLat, minLon, maxLat, maxLon] = region.flightBox;
  const lat = Number(asset.lat);
  const lon = Number(asset.lon);
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

function openSkyAircraftCategory(value) {
  const categories = {
    0: "Unknown",
    1: "Unknown",
    2: "Light",
    3: "Small",
    4: "Large",
    5: "High vortex",
    6: "Heavy",
    7: "High performance",
    8: "Rotorcraft",
    9: "Glider",
    10: "Lighter-than-air",
    11: "Parachutist",
    12: "Ultralight",
    14: "UAV",
    15: "Space vehicle",
    16: "Emergency vehicle",
    17: "Service vehicle"
  };
  return categories[Number(value)] || "Aircraft";
}

async function buildEventsPayload(range) {
  const profile = rangeProfiles[range];
  const startedAt = Date.now();

  const sourceJobs = [
    getUsgsEarthquakes(profile),
    getNasaEonet(profile),
    getNwsAlerts(),
    ...rssFeeds.map((feed) => getRssEvents(feed, profile)),
    ...googleNewsFeeds.map((feed) => getGoogleNewsEvents(feed, profile)),
    ...gdeltFeeds.map((feed) => getGdeltArticles(feed, profile))
  ];

  const settled = await Promise.allSettled(sourceJobs);
  const events = [];
  const sourceHealth = [];

  for (const result of settled) {
    const item =
      result.status === "fulfilled"
        ? result.value
        : {
            source: "Unknown source",
            ok: false,
            count: 0,
            ms: 0,
            error: result.reason?.message || "Unknown source failure"
          };

    sourceHealth.push({
      source: item.source,
      ok: item.ok,
      count: item.count || 0,
      ms: item.ms || 0,
      error: item.error || null,
      url: item.url || null
    });

    if (item.ok && Array.isArray(item.events)) {
      events.push(...item.events);
    }
  }

  const deduped = dedupeEvents(events)
    .sort((a, b) => {
      const severityDelta = b.severityScore - a.severityScore;
      if (Math.abs(severityDelta) > 18) return severityDelta;
      return new Date(b.time || 0) - new Date(a.time || 0);
    })
    .slice(0, 1200);

  return {
    refreshedAt: new Date().toISOString(),
    range,
    generatedInMs: Date.now() - startedAt,
    cached: false,
    ttlSeconds: CACHE_TTL_MS / 1000,
    sourceHealth,
    report: buildReport(deduped, sourceHealth),
    events: deduped
  };
}

async function getUsgsEarthquakes(profile) {
  const source = "USGS Earthquakes";
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${profile.usgsFeed}.geojson`;
  const fetched = await fetchJson(source, url);

  if (!fetched.ok) return fetched;

  const events = (fetched.data.features || []).map((feature) => {
    const props = feature.properties || {};
    const [lon, lat, depth] = feature.geometry?.coordinates || [];
    const mag = numberOrNull(props.mag);
    const score = earthquakeScore(mag, props.alert, props.tsunami);
    const place = props.place || "Unknown location";

    return cleanEvent({
      id: `usgs:${props.code || props.ids || props.url || `${lat}:${lon}:${props.time}`}`,
      title: mag ? `M${mag.toFixed(1)} earthquake - ${place}` : `Earthquake - ${place}`,
      summary: [
        mag ? `Magnitude ${mag.toFixed(1)} earthquake reported by USGS.` : "Earthquake reported by USGS.",
        depth !== undefined ? `Depth is about ${Number(depth).toFixed(1)} km.` : "",
        props.tsunami ? "USGS tsunami flag is active for this event." : "",
        props.alert ? `PAGER alert level: ${String(props.alert).toUpperCase()}.` : ""
      ]
        .filter(Boolean)
        .join(" "),
      category: "earthquake",
      source,
      sourceType: "official",
      severity: scoreToSeverity(score),
      severityScore: score,
      confidence: 0.95,
      time: toIso(props.time),
      updated: toIso(props.updated),
      lat,
      lon,
      area: place,
      url: props.url,
      tags: ["earthquake", mag ? `M${mag.toFixed(1)}` : null, props.alert, props.tsunami ? "tsunami-flag" : null]
    });
  });

  return { ...fetched, count: events.length, events };
}

async function getNasaEonet(profile) {
  const source = "NASA EONET";
  const params = new URLSearchParams({
    status: "open",
    days: String(Math.max(profile.days, 7)),
    limit: "300"
  });
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events/geojson?${params.toString()}`;
  const fetched = await fetchJson(source, url);

  if (!fetched.ok) return fetched;

  const events = (fetched.data.features || []).map((feature) => {
    const props = feature.properties || {};
    const categories = props.categories || [];
    const firstCategory = categories[0] || {};
    const categoryId = normalizeEonetCategory(firstCategory.id || firstCategory.title || props.title);
    const [lat, lon] = centroid(feature.geometry);
    const score = naturalHazardScore(categoryId, props);
    const sourceLinks = Array.isArray(props.sources) ? props.sources : [];
    const primaryLink = sourceLinks[0]?.url || props.link;

    return cleanEvent({
      id: `eonet:${props.id || props.link || props.title}`,
      title: props.title || "NASA EONET active event",
      summary: [
        `NASA EONET lists this as an open ${labelForCategory(categoryId)} event.`,
        sourceLinks.length ? `Primary source: ${sourceLinks[0].id || sourceLinks[0].title || "linked agency"}.` : "",
        props.closed ? "The event has a closure timestamp, but it was returned in the current event feed." : ""
      ]
        .filter(Boolean)
        .join(" "),
      category: categoryId,
      source,
      sourceType: "official",
      severity: scoreToSeverity(score),
      severityScore: score,
      confidence: 0.82,
      time: props.date || latestGeometryDate(feature.geometry) || new Date().toISOString(),
      updated: latestGeometryDate(feature.geometry) || props.date,
      lat,
      lon,
      area: props.title || labelForCategory(categoryId),
      url: primaryLink,
      tags: [categoryId, ...categories.map((category) => category.title || category.id).filter(Boolean)]
    });
  });

  return { ...fetched, count: events.length, events };
}

async function getNwsAlerts() {
  const source = "NOAA/NWS Alerts";
  const url = "https://api.weather.gov/alerts/active?status=actual&message_type=alert";
  const fetched = await fetchJson(source, url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "GOD-EYES-OSINT-Dashboard/1.0 local-osint-monitor"
    },
    timeoutMs: 18_000
  });

  if (!fetched.ok) return fetched;

  const events = (fetched.data.features || []).slice(0, 550).map((feature) => {
    const props = feature.properties || {};
    const [lat, lon] = centroid(feature.geometry);
    const category = nwsCategory(props.event || props.headline || "");
    const score = nwsSeverityScore(props.severity, props.urgency, props.certainty, props.event);
    const area = props.areaDesc || props.geocode?.UGC?.slice(0, 5).join(", ") || "United States";

    return cleanEvent({
      id: `nws:${props.id || props["@id"] || props.event + props.sent}`,
      title: props.headline || `${props.event || "Weather alert"} - ${area}`,
      summary: shortenText(
        props.description || props.instruction || `${props.event || "Weather alert"} for ${area}.`,
        420
      ),
      category,
      source,
      sourceType: "official",
      severity: scoreToSeverity(score),
      severityScore: score,
      confidence: 0.9,
      time: props.effective || props.sent,
      updated: props.sent,
      expires: props.expires,
      lat,
      lon,
      area,
      url: props["@id"],
      tags: [props.event, props.severity, props.urgency, props.certainty].filter(Boolean)
    });
  });

  return { ...fetched, count: events.length, events };
}

async function getRssEvents(feed, profile) {
  const fetched = await fetchText(feed.source, feed.url, { timeoutMs: 18_000 });

  if (!fetched.ok) return fetched;

  const cutoff = Date.now() - profile.days * 24 * 60 * 60 * 1000;
  const rssItems = parseRssItems(fetched.text).slice(0, feed.maxrecords || 50);
  const events = rssItems
    .map((item) => rssItemToEvent(item, feed))
    .filter((event) => new Date(event.time || 0).getTime() >= cutoff);

  return { ...fetched, count: events.length, events };
}

async function getGoogleNewsEvents(feed, profile) {
  const params = new URLSearchParams({
    q: `${feed.query} when:${profile.days}d`,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  const url = `https://news.google.com/rss/search?${params.toString()}`;
  const fetched = await fetchText(feed.source, url, { timeoutMs: 18_000 });

  if (!fetched.ok) return fetched;

  const rssItems = parseRssItems(fetched.text).slice(0, feed.maxrecords || 60);
  const events = rssItems.map((item) => rssItemToEvent(item, feed));

  return { ...fetched, count: events.length, events };
}

function rssItemToEvent(item, feed) {
  const rawTitle = item.title || `${feed.source} update`;
  const sourceName = item.source || item.creator || extractTrailingPublisher(rawTitle) || feed.source;
  const title = removeTrailingPublisher(rawTitle);
  const description = stripHtml(item.description || item.summary || "");
  const textForLocation = `${title} ${description}`;
  const inferred = inferLocationFromText(textForLocation);
  const gdacsLat = numberOrNull(item["geo:lat"]);
  const gdacsLon = numberOrNull(item["geo:long"]);
  const category = feed.key === "gdacs" ? gdacsCategory(item, title) : classifyGdeltCategory(title, feed.category);
  const severityScore = feed.key === "gdacs" ? gdacsSeverityScore(title, item) : gdeltSeverityScore(category, title);

  return cleanEvent({
    id: `rss:${feed.key}:${item.guid || item.link || title}`,
    title,
    summary: shortenText(description || `${sourceName}: ${title}`, 420),
    category,
    source: feed.source,
    sourceType: feed.sourceType || "news",
    severity: scoreToSeverity(severityScore),
    severityScore,
    confidence: feed.sourceType === "official" ? 0.86 : 0.62,
    time: parseDateOrNow(item.pubDate || item.updated || item["dc:date"]),
    updated: parseDateOrNow(item["gdacs:datemodified"] || item.pubDate || item.updated),
    lat: Number.isFinite(gdacsLat) ? gdacsLat : inferred?.lat,
    lon: Number.isFinite(gdacsLon) ? gdacsLon : inferred?.lon,
    area: inferred?.area || gdacsArea(title) || sourceName || "Global",
    url: item.link,
    image: item.enclosureUrl,
    tags: [category, sourceName, item["dc:subject"], item["gdacs:alertlevel"], item["gdacs:eventtype"]].filter(Boolean)
  });
}

async function getGdeltArticles(feed, profile) {
  const params = new URLSearchParams({
    query: feed.query,
    mode: "ArtList",
    format: "json",
    sort: "HybridRel",
    maxrecords: String(feed.maxrecords),
    timespan: profile.gdeltTimespan
  });
  const url = `http://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const fetched = await fetchJson(feed.source, url, { timeoutMs: 18_000 });

  if (!fetched.ok) return fetched;

  const articles = fetched.data.articles || [];
  const events = articles.map((article) => {
    const countryCode = cleanCountryCode(article.sourceCountry);
    const inferred = inferLocationFromText(`${article.title || ""} ${article.domain || ""}`);
    const coords = countryCode ? countryCentroids[countryCode] : inferred ? [inferred.lat, inferred.lon] : null;
    const category = classifyGdeltCategory(article.title || "", feed.category);
    const score = gdeltSeverityScore(category, article.title || "");
    const countryName = countryCode ? countryNames.of(countryCode) || countryCode : null;
    const sourceName = article.sourceCommonName || article.domain || "GDELT source";

    return cleanEvent({
      id: `gdelt:${feed.key}:${article.url || article.title}`,
      title: article.title || `${labelForCategory(feed.category)} report`,
      summary: shortenText(
        `${sourceName}${countryName ? ` from ${countryName}` : ""}: ${article.title || "Open-source report"}`,
        360
      ),
      category,
      source: feed.source,
      sourceType: "news",
      severity: scoreToSeverity(score),
      severityScore: score,
      confidence: 0.58,
      time: parseGdeltDate(article.seendate),
      updated: parseGdeltDate(article.seendate),
      lat: coords?.[0],
      lon: coords?.[1],
      area: countryName || inferred?.area || article.sourceCountry || article.domain || "Global",
      url: article.url,
      image: article.socialimage,
      tags: [
        category,
        sourceName,
        countryName,
        article.language,
        ...extractPriorityKeywords(article.title || "")
      ].filter(Boolean)
    });
  });

  return { ...fetched, count: events.length, events };
}

async function fetchJson(source, url, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(shortenText(text || `Expected JSON from ${source}`, 180));
    }
    return {
      source,
      ok: true,
      url,
      data,
      ms: Date.now() - started
    };
  } catch (error) {
    return {
      source,
      ok: false,
      url,
      count: 0,
      events: [],
      error: error.name === "AbortError" ? "Timed out while fetching source" : error.message,
      ms: Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(source, url, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, text/plain",
        "User-Agent": "GOD-EYES-OSINT-Dashboard/1.0 local-osint-monitor",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return {
      source,
      ok: true,
      url,
      text,
      ms: Date.now() - started
    };
  } catch (error) {
    return {
      source,
      ok: false,
      url,
      count: 0,
      events: [],
      error: error.name === "AbortError" ? "Timed out while fetching source" : error.message,
      ms: Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItems(xml) {
  return [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    const item = {
      title: tagValue(block, "title"),
      link: tagValue(block, "link"),
      description: tagValue(block, "description"),
      pubDate: tagValue(block, "pubDate"),
      guid: tagValue(block, "guid"),
      source: tagValue(block, "source"),
      creator: tagValue(block, "dc:creator"),
      "dc:date": tagValue(block, "dc:date"),
      "dc:subject": tagValue(block, "dc:subject"),
      "geo:lat": tagValue(block, "geo:lat"),
      "geo:long": tagValue(block, "geo:long"),
      "gdacs:alertlevel": tagValue(block, "gdacs:alertlevel"),
      "gdacs:eventtype": tagValue(block, "gdacs:eventtype"),
      "gdacs:datemodified": tagValue(block, "gdacs:datemodified")
    };

    const enclosure = block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*>/i);
    if (enclosure) item.enclosureUrl = decodeXml(enclosure[1]);

    return item;
  });
}

function tagValue(block, tagName) {
  const escaped = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .trim();
}

function stripHtml(value) {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReport(events, sourceHealth) {
  const categoryCounts = countBy(events, (event) => event.category);
  const sourceCounts = countBy(events, (event) => event.source);
  const highPriority = events.filter((event) => event.severityScore >= 68);
  const critical = events.filter((event) => event.severity === "critical");
  const mapped = events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon)).length;
  const failedSources = sourceHealth.filter((source) => !source.ok);
  const hotspots = buildHotspots(events);
  const topCategory = topEntry(categoryCounts);
  const highest = events[0] || null;
  const latest = [...events].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))[0] || null;

  return {
    total: events.length,
    mapped,
    highPriority: highPriority.length,
    critical: critical.length,
    failedSources: failedSources.length,
    categoryCounts,
    sourceCounts,
    hotspots,
    watchlist: highPriority.slice(0, 10),
    overview: [
      events.length
        ? `${events.length} open-source items are active in this view, with ${highPriority.length} high-priority or critical items.`
        : "No live items were returned for this view.",
      topCategory
        ? `${labelForCategory(topCategory[0])} is the busiest category right now with ${topCategory[1]} items.`
        : "No category concentration is visible yet.",
      hotspots[0]
        ? `${hotspots[0].name} is the leading hotspot by event density and severity.`
        : "No geographic hotspot is available yet.",
      highest ? `Highest current priority: ${highest.title}.` : "",
      latest ? `Latest item: ${latest.title}.` : "",
      failedSources.length
        ? `${failedSources.length} source${failedSources.length > 1 ? "s" : ""} failed this refresh; live data will retry automatically.`
        : "All configured live sources responded during this refresh."
    ].filter(Boolean)
  };
}

function cleanEvent(event) {
  const lat = numberOrNull(event.lat);
  const lon = numberOrNull(event.lon);
  const severityScore = clamp(Math.round(numberOrNull(event.severityScore) || 20), 1, 100);

  return {
    id: String(event.id || `${event.source}:${event.title}:${event.time}`),
    title: cleanString(event.title || "Untitled event"),
    summary: cleanString(event.summary || "No summary available from source."),
    category: event.category || "news",
    source: event.source || "Unknown source",
    sourceType: event.sourceType || "open-source",
    severity: event.severity || scoreToSeverity(severityScore),
    severityScore,
    confidence: clamp(Number(event.confidence || 0.5), 0, 1),
    time: event.time || new Date().toISOString(),
    updated: event.updated || event.time || null,
    expires: event.expires || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    area: cleanString(event.area || "Global"),
    url: event.url || null,
    image: event.image || null,
    tags: [...new Set((event.tags || []).map(cleanString).filter(Boolean))].slice(0, 10)
  };
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = event.url ? `${event.source}:${event.url}` : event.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildHotspots(events) {
  const buckets = new Map();

  for (const event of events) {
    const name = normalizeArea(event.area);
    if (!name) continue;
    const existing = buckets.get(name) || {
      name,
      count: 0,
      maxSeverity: 0,
      categories: new Set(),
      latest: null,
      lat: null,
      lon: null
    };

    existing.count += 1;
    existing.maxSeverity = Math.max(existing.maxSeverity, event.severityScore);
    existing.categories.add(event.category);

    if (!existing.latest || new Date(event.time || 0) > new Date(existing.latest || 0)) {
      existing.latest = event.time;
    }

    if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) {
      existing.lat = event.lat;
      existing.lon = event.lon;
    }

    buckets.set(name, existing);
  }

  return [...buckets.values()]
    .map((hotspot) => ({
      ...hotspot,
      categories: [...hotspot.categories],
      score: hotspot.count * 8 + hotspot.maxSeverity
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function earthquakeScore(mag, alert, tsunami) {
  let score = 18;
  if (mag >= 7) score = 96;
  else if (mag >= 6) score = 84;
  else if (mag >= 5) score = 70;
  else if (mag >= 4) score = 52;
  else if (mag >= 2.5) score = 36;

  if (alert === "red") score += 8;
  if (alert === "orange") score += 5;
  if (tsunami) score += 8;
  return clamp(score, 1, 100);
}

function naturalHazardScore(category) {
  const scores = {
    wildfire: 68,
    storm: 64,
    volcano: 66,
    flood: 70,
    landslide: 62,
    drought: 50,
    dust: 38,
    snow: 42,
    ice: 36,
    manmade: 58,
    disaster: 56
  };
  return scores[category] || 52;
}

function nwsSeverityScore(severity, urgency, certainty, eventName = "") {
  const severityBase = {
    Extreme: 94,
    Severe: 82,
    Moderate: 61,
    Minor: 39,
    Unknown: 32
  };
  let score = severityBase[severity] || 45;
  if (urgency === "Immediate") score += 8;
  if (urgency === "Expected") score += 4;
  if (certainty === "Observed") score += 5;
  if (/tornado|hurricane|flash flood|wildfire|evacuation/i.test(eventName)) score += 7;
  return clamp(score, 1, 100);
}

function gdeltSeverityScore(category, title) {
  const base = category === "military" ? 64 : category === "geopolitical" ? 54 : 48;
  const keywords = extractPriorityKeywords(title);
  const escalators = keywords.length * 5;
  const major =
    /\b(nuclear|missile|invasion|air strike|drone strike|coup|evacuation|ceasefire|sanction|earthquake|wildfire|flood|killed|dead)\b/i.test(
      title
    )
      ? 12
      : 0;
  return clamp(base + escalators + major, 1, 92);
}

function gdacsCategory(item, title) {
  const type = String(item["gdacs:eventtype"] || item["dc:subject"] || title).toUpperCase();
  if (type.includes("EQ") || /earthquake/i.test(title)) return "earthquake";
  if (type.includes("WF") || /wildfire|fire/i.test(title)) return "wildfire";
  if (type.includes("FL") || /flood/i.test(title)) return "flood";
  if (type.includes("TC") || /cyclone|hurricane|typhoon|storm/i.test(title)) return "storm";
  if (type.includes("VO") || /volcano/i.test(title)) return "volcano";
  if (type.includes("DR") || /drought/i.test(title)) return "drought";
  return "disaster";
}

function gdacsSeverityScore(title, item) {
  const alert = String(item["gdacs:alertlevel"] || title).toLowerCase();
  if (alert.includes("red")) return 94;
  if (alert.includes("orange")) return 78;
  if (alert.includes("green")) return 48;
  if (/magnitude\s*[7-9]|7\.\dM|8\.\dM|9\.\dM/i.test(title)) return 90;
  if (/magnitude\s*6|6\.\dM/i.test(title)) return 76;
  return naturalHazardScore(gdacsCategory(item, title));
}

function gdacsArea(title) {
  const inMatch = String(title || "").match(/\bin\s+([^,]+?)(?:\s+\d{2}\/|\s+\d{4}|\s+\(|,|$)/i);
  return cleanString(inMatch?.[1] || "");
}

function classifyGdeltCategory(title, fallback = "news") {
  if (/\b(military|missile|drone|troops|air strike|naval|artillery|rocket|defense ministry|army|navy|air force)\b/i.test(title)) {
    return "military";
  }
  if (/\b(geopolitical|sanction|diplomacy|election|protest|border dispute|ceasefire|trade war|summit|embassy)\b/i.test(title)) {
    return "geopolitical";
  }
  if (/\b(earthquake|wildfire|fire|flood|cyclone|volcano|landslide|humanitarian|evacuation|disaster)\b/i.test(title)) {
    return "news";
  }
  return fallback;
}

function buildCountryNameLookup() {
  const aliases = [
    ["US", "united states"],
    ["US", "u.s."],
    ["US", "usa"],
    ["US", "america"],
    ["GB", "united kingdom"],
    ["GB", "uk"],
    ["GB", "britain"],
    ["RU", "russia"],
    ["IR", "iran"],
    ["KR", "south korea"],
    ["KP", "north korea"],
    ["PS", "gaza"],
    ["PS", "west bank"],
    ["PS", "palestine"],
    ["SY", "syria"],
    ["MM", "myanmar"],
    ["CD", "dr congo"],
    ["CD", "democratic republic of congo"],
    ["AE", "uae"],
    ["VN", "vietnam"],
    ["LA", "laos"],
    ["CZ", "czech republic"],
    ["TR", "turkey"]
  ];

  const entries = Object.keys(countryCentroids)
    .map((code) => [code, countryNames.of(code)])
    .filter(([, name]) => name)
    .map(([code, name]) => [code, String(name).toLowerCase()]);

  return [...entries, ...aliases].sort((a, b) => b[1].length - a[1].length);
}

function inferLocationFromText(text) {
  const haystack = ` ${String(text || "").toLowerCase()} `;
  for (const [code, name] of countryNameLookup) {
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i");
    if (pattern.test(haystack)) {
      const coords = countryCentroids[code];
      return {
        lat: coords[0],
        lon: coords[1],
        area: countryNames.of(code) || code
      };
    }
  }

  return null;
}

function extractTrailingPublisher(title) {
  const parts = String(title || "").split(" - ");
  return parts.length > 1 ? cleanString(parts.at(-1)) : "";
}

function removeTrailingPublisher(title) {
  const parts = String(title || "").split(" - ");
  if (parts.length <= 1) return cleanString(title);
  return cleanString(parts.slice(0, -1).join(" - "));
}

function extractPriorityKeywords(text) {
  const keywords = [
    "missile",
    "drone",
    "air strike",
    "troops",
    "naval",
    "border",
    "sanction",
    "ceasefire",
    "evacuation",
    "earthquake",
    "wildfire",
    "flood",
    "volcano",
    "coup",
    "nuclear",
    "killed"
  ];
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

function nwsCategory(name) {
  if (/fire|red flag/i.test(name)) return "wildfire";
  if (/flood|flash flood/i.test(name)) return "flood";
  if (/tornado|hurricane|cyclone|storm|thunderstorm|marine/i.test(name)) return "storm";
  if (/winter|snow|ice|blizzard/i.test(name)) return "snow";
  if (/heat|cold|freeze|wind|fog|dust/i.test(name)) return "weather";
  return "weather";
}

function normalizeEonetCategory(input = "") {
  const value = String(input).toLowerCase();
  if (value.includes("wildfire")) return "wildfire";
  if (value.includes("severe") || value.includes("storm")) return "storm";
  if (value.includes("volcano")) return "volcano";
  if (value.includes("flood")) return "flood";
  if (value.includes("landslide")) return "landslide";
  if (value.includes("drought")) return "drought";
  if (value.includes("dust") || value.includes("haze")) return "dust";
  if (value.includes("snow")) return "snow";
  if (value.includes("ice")) return "ice";
  if (value.includes("manmade")) return "manmade";
  return "disaster";
}

function labelForCategory(category = "") {
  const labels = {
    earthquake: "Earthquake",
    wildfire: "Fire",
    storm: "Storm",
    volcano: "Volcano",
    flood: "Flood",
    landslide: "Landslide",
    drought: "Drought",
    dust: "Dust/Haze",
    snow: "Snow/Ice",
    ice: "Sea/Lake Ice",
    manmade: "Manmade Hazard",
    weather: "Weather",
    geopolitical: "Geopolitical",
    military: "Military",
    news: "News",
    disaster: "Natural Disaster"
  };
  return labels[category] || category.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scoreToSeverity(score) {
  if (score >= 86) return "critical";
  if (score >= 68) return "high";
  if (score >= 45) return "moderate";
  return "low";
}

function centroid(geometry) {
  if (!geometry) return [null, null];

  const coords = [];
  collectCoordinatePairs(geometry.coordinates, coords);

  if (!coords.length) return [null, null];

  const totals = coords.reduce(
    (acc, pair) => {
      acc.lon += pair[0];
      acc.lat += pair[1];
      return acc;
    },
    { lat: 0, lon: 0 }
  );

  return [totals.lat / coords.length, totals.lon / coords.length];
}

function collectCoordinatePairs(value, output) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push(value);
    return;
  }

  for (const child of value) collectCoordinatePairs(child, output);
}

function latestGeometryDate(geometry) {
  if (!geometry) return null;
  const dates = [];
  collectDates(geometry, dates);
  return dates.sort().at(-1) || null;
}

function collectDates(value, output) {
  if (!value || typeof value !== "object") return;
  if (typeof value.date === "string") output.push(value.date);
  for (const child of Object.values(value)) {
    if (typeof child === "object") collectDates(child, output);
  }
}

function parseGdeltDate(value) {
  if (!value) return new Date().toISOString();
  const text = String(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return new Date(text).toISOString();
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)).toISOString();
}

function parseDateOrNow(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toIso(value) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeArea(area = "") {
  const text = cleanString(area)
    .replace(/\b\d+\s*(km|mi|miles|kilometers)\b/gi, "")
    .replace(/\b(N|S|E|W|NE|NW|SE|SW)\b/g, "")
    .replace(/\s+of\s+/i, " of ")
    .trim();

  const afterOf = text.split(/\sof\s/i).at(-1);
  return (afterOf || text).split(",").slice(-2).join(",").trim() || "Global";
}

function topEntry(object) {
  return Object.entries(object).sort((a, b) => b[1] - a[1])[0] || null;
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function shortenText(text, maxLength) {
  const clean = cleanString(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function cleanString(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
}

function cleanCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function serveStatic(pathname, res) {
  const requestedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const normalized = path.normalize(requestedPath).replace(/^([/\\])+/, "");
  const filePath = path.join(publicDir, normalized);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(res, "Forbidden", 403, "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=300"
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, "Not found", 404, "text/plain; charset=utf-8");
      return;
    }
    throw error;
  }
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

function sendText(res, body, status, contentType) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}
