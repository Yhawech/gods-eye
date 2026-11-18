import * as Cesium from 'cesium';

const INSTALLATIONS = Object.freeze([
  ['Pentagon', 'Defense HQ', 38.8719, -77.0563, 4200, 'United States'],
  ['Ramstein Air Base', 'Air base', 49.4369, 7.6003, 6500, 'Germany'],
  ['Diego Garcia', 'Joint support facility', -7.3133, 72.4111, 11500, 'BIOT'],
  ['Naval Station Norfolk', 'Naval base', 36.9467, -76.3289, 6500, 'United States'],
  ['Pearl Harbor-Hickam', 'Naval / air base', 21.3499, -157.9430, 8000, 'United States'],
  ['Incirlik Air Base', 'Air base', 37.0021, 35.4259, 6500, 'Turkey'],
  ['Naval Station Rota', 'Naval base', 36.6459, -6.3495, 6500, 'Spain'],
  ['Fleet Activities Yokosuka', 'Naval base', 35.2920, 139.6718, 6200, 'Japan'],
  ['Kadena Air Base', 'Air base', 26.3556, 127.7676, 6500, 'Japan'],
  ['Osan Air Base', 'Air base', 37.0906, 127.0296, 6500, 'South Korea'],
  ['Andersen Air Force Base', 'Air base', 13.5840, 144.9290, 7600, 'Guam'],
  ['HMNB Clyde Faslane', 'Naval base', 56.0669, -4.8220, 6200, 'United Kingdom'],
  ['HMNB Portsmouth', 'Naval base', 50.8019, -1.1097, 5800, 'United Kingdom'],
  ['Souda Bay Naval Base', 'Naval base', 35.4908, 24.1500, 6500, 'Greece'],
  ['NAS Sigonella', 'Air base', 37.4017, 14.9224, 6500, 'Italy'],
  ['Camp Lemonnier', 'Expeditionary base', 11.5463, 43.1481, 6500, 'Djibouti'],
  ['Pituffik Space Base', 'Space / air base', 76.5312, -68.7032, 10000, 'Greenland'],
  ['Fort Liberty', 'Army installation', 35.1390, -79.0060, 8500, 'United States'],
  ['Nellis Air Force Base', 'Air base', 36.2362, -115.0343, 6500, 'United States'],
]).map(([name, type, latitude, longitude, height, country], index) => ({
  id: `installation-${index}`,
  name, type, latitude, longitude, height, country,
  group: 'installation',
}));

const EVENT_AREAS = Object.freeze([
  ['Ukraine conflict watch', 'Military / geopolitical', 49.0, 32.0, 1200000],
  ['Red Sea maritime security', 'Maritime / trade route', 16.0, 42.0, 1400000],
  ['Taiwan Strait watch', 'Military / maritime', 24.0, 120.7, 650000],
  ['Korean Peninsula watch', 'Military / missile activity', 38.3, 127.6, 850000],
  ['Persian Gulf energy corridor', 'Energy / maritime security', 26.5, 52.0, 850000],
  ['South China Sea watch', 'Maritime / geopolitical', 12.5, 115.0, 1450000],
  ['Sahel security belt', 'Security / humanitarian', 15.0, 4.0, 1700000],
  ['Eastern Mediterranean watch', 'Maritime / geopolitical', 34.5, 31.0, 850000],
]).map(([name, type, latitude, longitude, height], index) => ({
  id: `event-${index}`,
  name, type, latitude, longitude, height,
  country: 'regional watch area',
  group: 'event',
}));

const CAMERA_DIRECTORIES = Object.freeze([
  ['Austin Mobility Cameras', 'Austin, United States', 'https://cctv.austinmobility.io/'],
  ['Caltrans QuickMap Cameras', 'California, United States', 'https://quickmap.dot.ca.gov/'],
  ['NYC DOT Traffic Cameras', 'New York City, United States', 'https://www.nyc.gov/html/dot/html/motorist/traffic-cameras.shtml'],
  ['Transport for London Traffic', 'London, United Kingdom', 'https://tfl.gov.uk/traffic/status/'],
  ['WSDOT Traffic Cameras', 'Washington, United States', 'https://wsdot.com/travel/real-time/cameras/'],
  ['Minnesota 511 Cameras', 'Minnesota, United States', 'https://511mn.org/'],
  ['Virginia 511 Cameras', 'Virginia, United States', 'https://www.511virginia.org/'],
  ['EarthCam Public Webcams', 'Global public webcams', 'https://www.earthcam.com/'],
  ['SkylineWebcams', 'Global public webcams', 'https://www.skylinewebcams.com/'],
]).map(([name, area, url]) => ({ name, area, url }));


const markerState = { visible: false, entities: [] };

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openExternal(url) {
  return window.open(url, '_blank', 'noopener,noreferrer');
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function getViewPoint(viewer) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || !camera) return null;
  const canvas = scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let world = camera.pickEllipsoid(center, Cesium.Ellipsoid.WGS84);
  if (!world) world = camera.positionWC || camera.position;
  if (!world) return null;
  const carto = Cesium.Cartographic.fromCartesian(world);
  const latitude = Cesium.Math.toDegrees(carto.latitude);
  const longitude = Cesium.Math.toDegrees(carto.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, heading: Cesium.Math.toDegrees(camera.heading || 0) };
}

function streetViewUrl(point) {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`,
    heading: String(Math.round(point.heading || 0)),
    pitch: '0',
    fov: '80',
  });
  return `https://www.google.com/maps/@?${params}`;
}

function addStreetTools(parent, viewer, statusNode) {
  const row = el('div', 'gods-eye-osint-wide-actions');
  const actions = [
    ['Open Street View', (point) => streetViewUrl(point), 'Opened Google Street View near the current globe center.'],
    ['Open Mapillary', (point) => mapillaryUrl(point), 'Opened Mapillary street-level imagery near the current globe center.'],
  ];
  for (const [label, makeUrl, message] of actions) {
    const button = el('button', '', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const point = getViewPoint(viewer);
      if (!point) {
        statusNode.textContent = 'Could not read the globe center yet — wait for the globe to finish loading, then try again.';
        return;
      }
      const opened = openExternal(makeUrl(point));
      statusNode.textContent = opened
        ? message
        : 'Popup blocked by the browser — allow popups for this site, then click again. (Street-level coverage is limited in remote and ocean regions.)';
    });
    row.append(button);
  }
  parent.append(row);
}

function addLocationList(parent, title, rows, viewer, statusNode) {
  const details = el('details', 'gods-eye-osint-section');
  details.open = title === 'Military And Event Map';
  details.append(el('summary', '', title));
  const list = el('div', 'gods-eye-osint-list');
  for (const row of rows) {
    const button = el('button', 'gods-eye-osint-row');
    button.type = 'button';
    button.innerHTML = `<strong>${row.name}</strong><span>${row.type} | ${row.country}</span>`;
    button.addEventListener('click', () => {
      flyTo(viewer, row);
      statusNode.textContent = `Focused ${row.name}. This is public map context, not an operational claim.`;
    });
    list.append(button);
  }
  details.append(list);
  parent.append(details);
}

function addCameraDirectory(parent, statusNode) {
  const details = el('details', 'gods-eye-osint-section');
  details.append(el('summary', '', 'Public Live Camera Directories'));
  const list = el('div', 'gods-eye-osint-list');
  for (const row of CAMERA_DIRECTORIES) {
    const button = el('button', 'gods-eye-osint-row');
    button.type = 'button';
    button.innerHTML = `<strong>${row.name}</strong><span>${row.area}</span>`;
    button.addEventListener('click', () => {
      openExternal(row.url);
      statusNode.textContent = 'Opened the public camera source in a new tab. Official sites often block embedded playback, so live viewing opens at the source.';
    });
    list.append(button);
  }
  details.append(list);
  parent.append(details);
}

// GODS_EYE_PUBLIC_OSINT_FEED_PANEL: recent, source-linked public reporting for the globe companion.
const MILITARY_FEED_CONFIG = Object.freeze([
  { key: 'fleet', title: 'Fleet & Deployment Watch', subtitle: 'Recent public reporting on naval, troop, and defense activity.' },
  { key: 'tests', title: 'Missile & Defense Test Watch', subtitle: 'Recent reports or scheduled notices; not a live firing authority.' },
  { key: 'geopolitical', title: 'Geopolitical Watch', subtitle: 'Recent public reporting on major security and geopolitical developments.' },
]);

function relativeAge(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return 'time unavailable';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function appendFeedRow(list, row, viewer, statusNode) {
  const button = el('button', 'gods-eye-osint-feed-row');
  button.type = 'button';
  const title = el('strong', '', row.title || 'Untitled public report');
  const meta = [row.category, row.region, row.domain, relativeAge(row.publishedAt)].filter(Boolean).join(' | ');
  button.append(title, el('span', '', meta || 'public-source report'));
  button.addEventListener('click', () => {
    if (Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
      flyTo(viewer, { ...row, height: 180000 });
    }
    if (row.url) openExternal(row.url);
    statusNode.textContent = `${row.category || 'Public report'} opened from ${row.domain || 'the source link'}. Marker location is regional attribution only.`;
  });
  list.append(button);
}

function createFeedSection(parent, config) {
  const details = el('details', 'gods-eye-osint-feed-section');
  details.append(el('summary', '', config.title));
  details.append(el('div', 'gods-eye-osint-feed-subtitle', config.subtitle));
  const list = el('div', 'gods-eye-osint-feed-list');
  list.append(el('div', 'gods-eye-osint-empty', 'Feed not loaded yet.'));
  details.append(list);
  parent.append(details);
  return { details, list };
}

function fillFeedSection(section, rows, viewer, statusNode, emptyText) {
  section.list.replaceChildren();
  if (!rows.length) {
    section.list.append(el('div', 'gods-eye-osint-empty', emptyText));
    return;
  }
  for (const row of rows.slice(0, 12)) appendFeedRow(section.list, row, viewer, statusNode);
}

function addMilitaryFeedSections(parent, viewer, statusNode) {
  const sections = Object.fromEntries(MILITARY_FEED_CONFIG.map((config) => [config.key, createFeedSection(parent, config)]));
  async function refresh() {
    statusNode.textContent = 'Refreshing public fleet, defense-test, and geopolitical feeds...';
    try {
      const [fleetResponse, geopoliticalResponse] = await Promise.all([
        fetch('/api/military-osint?scope=fleet&limit=80', { cache: 'no-store' }),
        fetch('/api/military-osint?scope=geopolitical&limit=80', { cache: 'no-store' }),
      ]);
      if (!fleetResponse.ok || !geopoliticalResponse.ok) throw new Error('Public OSINT proxy unavailable');
      const fleetPayload = await fleetResponse.json();
      const geopoliticalPayload = await geopoliticalResponse.json();
      const fleetItems = Array.isArray(fleetPayload.items) ? fleetPayload.items : [];
      const geopoliticalItems = Array.isArray(geopoliticalPayload.items) ? geopoliticalPayload.items : [];
      fillFeedSection(sections.fleet, fleetItems.filter((row) => !String(row.category || '').includes('test')), viewer, statusNode, 'No fleet or deployment report returned in the recent window.');
      fillFeedSection(sections.tests, fleetItems.filter((row) => String(row.category || '').includes('test')).concat(
        geopoliticalItems.filter((row) => String(row.category || '').includes('test')),
      ), viewer, statusNode, 'No recent missile or defense-test report returned.');
      fillFeedSection(sections.geopolitical, geopoliticalItems, viewer, statusNode, 'No geopolitical report returned in the recent window.');
      statusNode.textContent = `Feeds refreshed: ${fleetItems.length + geopoliticalItems.length} source-linked reports. Regional markers are approximate.`;
    } catch (error) {
      statusNode.textContent = error?.message || 'Public OSINT feeds are temporarily unavailable.';
      for (const section of Object.values(sections)) fillFeedSection(section, [], viewer, statusNode, 'Feed temporarily unavailable. Try refresh again.');
    }
  }
  return { sections, refresh };
}
function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function addOsintMarkerDetails(parent, statusNode) {
  const section = el('section', 'gods-eye-osint-marker-details');
  section.id = 'gods-eye-osint-marker-details';
  const title = el('div', 'gods-eye-osint-marker-details-title', 'SELECTED PUBLIC REPORT');
  const content = el('div', 'gods-eye-osint-marker-details-content');
  content.append(el('div', 'gods-eye-osint-empty', 'Select a Fleet & Defense or Geopolitical Watch dot on the globe to inspect its source-linked details.'));
  section.append(title, content);

  const render = (row = {}) => {
    content.replaceChildren();
    content.append(el('strong', 'gods-eye-osint-marker-title', row.title || 'Untitled public report'));
    const meta = [row.category, row.region, row.domain || row.source, row.publishedAt ? relativeAge(row.publishedAt) : null].filter(Boolean).join(' | ');
    content.append(el('span', 'gods-eye-osint-marker-meta', meta || 'public-source report'));
    const facts = [
      ['Source', row.domain || row.source || 'GDELT public-source index'],
      ['Confidence', row.confidence || 'source-reported'],
      ['Marker', 'regional attribution only'],
    ];
    if (row.summary || row.description) facts.splice(1, 0, ['Summary', row.summary || row.description]);
    const factGrid = el('div', 'gods-eye-osint-marker-facts');
    for (const [label, value] of facts) {
      const fact = el('div', 'gods-eye-osint-marker-fact');
      fact.append(el('span', '', label), el('strong', '', String(value)));
      factGrid.append(fact);
    }
    content.append(factGrid);
    if (isHttpUrl(row.url)) {
      const sourceButton = el('button', 'gods-eye-osint-marker-source', 'Open source' + (row.domain ? ': ' + row.domain : ''));
      sourceButton.type = 'button';
      sourceButton.addEventListener('click', () => {
        openExternal(row.url);
        statusNode.textContent = 'Opened ' + (row.domain || 'the source link') + ' for the selected public report.';
      });
      content.append(sourceButton);
    }
    section.classList.add('has-selection');
    statusNode.textContent = (row.layerName || 'OSINT') + ' selected: ' + (row.title || 'public report') + '. Marker location is regional attribution only.';
  };

  window.addEventListener('gods-eye-osint-marker-selected', (event) => render(event.detail || {}));
  window.addEventListener('gods-eye-osint-marker-cleared', () => {
    section.classList.remove('has-selection');
    content.replaceChildren(el('div', 'gods-eye-osint-empty', 'Select a Fleet & Defense or Geopolitical Watch dot on the globe to inspect its source-linked details.'));
  });
  return section;
}
function addSourceNotes(parent) {
  const notes = el('div', 'gods-eye-osint-notes');
  notes.innerHTML = `
    <div><strong>FIRMS</strong><span>Free NASA FIRMS_MAP_KEY required.</span></div>
    <div><strong>AIS</strong><span>Free AISSTREAM_API_KEY required for live vessels.</span></div>
    <div><strong>OSINT</strong><span>GDELT / Google News public-source index; click globe dots for source-linked details.</span></div>
    <div><strong>CCTV</strong><span>Only public/official camera sources are opened.</span></div>
    <div><strong>Street View</strong><span>Uses Google Maps URLs, not a separate Street View API call.</span></div>
  `;
  parent.append(notes);
}

export function initGodsEyeOsintEnhancements(context = {}) {
  if (document.getElementById('gods-eye-osint-panel')) return;
  const viewer = context.viewer;
  const panel = el('aside', 'gods-eye-osint-panel');
  panel.id = 'gods-eye-osint-panel';
  panel.innerHTML = `
    <div class="gods-eye-osint-head">
      <div><strong>GOD EYE OSINT</strong><span>public data tools</span></div>
      <button type="button" id="gods-eye-osint-collapse" aria-label="Collapse OSINT tools">-</button>
    </div>
  `;
  const body = el('div', 'gods-eye-osint-body');
  const statusNode = el('div', 'gods-eye-osint-status', 'Ready. Use legal public feeds only.');
  const briefList = el('div', 'gods-eye-osint-brief-list');

  addStreetTools(body, viewer, statusNode);
  body.append(addOsintMarkerDetails(body, statusNode));

  const markerBtn = el('button', 'gods-eye-osint-primary', 'Toggle Public Site Markers');
  markerBtn.type = 'button';
  markerBtn.addEventListener('click', () => toggleMarkers(viewer, statusNode));
  body.append(markerBtn);

  const briefBtn = el('button', 'gods-eye-osint-primary', 'Refresh Nearby Intel');
  briefBtn.type = 'button';
  briefBtn.addEventListener('click', () => refreshNearbyIntel(viewer, briefList, statusNode));
  body.append(briefBtn, briefList);

  const feedState = addMilitaryFeedSections(body, viewer, statusNode);
  const feedRefresh = el('button', 'gods-eye-osint-primary', 'Refresh Fleet / Defense / Geopolitical Feeds');
  feedRefresh.type = 'button';
  feedRefresh.addEventListener('click', () => { void feedState.refresh(); });
  body.append(feedRefresh);
  void feedState.refresh();

  addLocationList(body, 'Military And Event Map', [...INSTALLATIONS, ...EVENT_AREAS], viewer, statusNode);
  addCameraDirectory(body, statusNode);
  addSourceNotes(body);
  body.append(statusNode);
  panel.append(body);
  document.body.append(panel);

  document.getElementById('gods-eye-osint-collapse')?.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });
}
