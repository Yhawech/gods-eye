
import fs from 'node:fs';
import path from 'node:path';

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function write(filePath, text) {
  fs.writeFileSync(filePath, text, 'utf8');
}

export function patchNativeDataLayers(target) {
  const militaryPath = path.join(target, 'src/data/militaryInstallations.js');
  let military = read(militaryPath);

  if (!military.includes('GODS_EYE_BUNDLED_INSTALLATIONS')) {
    const catalog = [
      '// GODS_EYE_BUNDLED_INSTALLATIONS keeps the layer useful at globe scale and',
      '// when an upstream map query is temporarily unavailable. These are public map',
      '// references only; live OSM results replace them whenever a bounded view loads.',
      'const GODS_EYE_BUNDLED_INSTALLATIONS = Object.freeze([',
      "  ['Pentagon', 'Defense HQ', 38.8719, -77.0563, 'United States'],",
      "  ['Ramstein Air Base', 'Air base', 49.4369, 7.6003, 'Germany'],",
      "  ['Diego Garcia', 'Joint support facility', -7.3133, 72.4111, 'BIOT'],",
      "  ['Naval Station Norfolk', 'Naval base', 36.9467, -76.3289, 'United States'],",
      "  ['Pearl Harbor-Hickam', 'Naval / air base', 21.3499, -157.9430, 'United States'],",
      "  ['Incirlik Air Base', 'Air base', 37.0021, 35.4259, 'Turkey'],",
      "  ['Naval Station Rota', 'Naval base', 36.6459, -6.3495, 'Spain'],",
      "  ['Fleet Activities Yokosuka', 'Naval base', 35.2920, 139.6718, 'Japan'],",
      "  ['Kadena Air Base', 'Air base', 26.3556, 127.7676, 'Japan'],",
      "  ['Osan Air Base', 'Air base', 37.0906, 127.0296, 'South Korea'],",
      "  ['Andersen Air Force Base', 'Air base', 13.5840, 144.9290, 'Guam'],",
      "  ['HMNB Clyde Faslane', 'Naval base', 56.0669, -4.8220, 'United Kingdom'],",
      "  ['HMNB Portsmouth', 'Naval base', 50.8019, -1.1097, 'United Kingdom'],",
      "  ['Souda Bay Naval Base', 'Naval base', 35.4908, 24.1500, 'Greece'],",
      "  ['NAS Sigonella', 'Air base', 37.4017, 14.9224, 'Italy'],",
      "  ['Camp Lemonnier', 'Expeditionary base', 11.5463, 43.1481, 'Djibouti'],",
      "  ['Pituffik Space Base', 'Space / air base', 76.5312, -68.7032, 'Greenland'],",
      "  ['Fort Liberty', 'Army installation', 35.1390, -79.0060, 'United States'],",
      "  ['Nellis Air Force Base', 'Air base', 36.2362, -115.0343, 'United States'],",
      "].map(([name, type, latitude, longitude, country], index) => ({",
      "  id: 'catalog:installation-' + index,",
      "  kind: 'installation',",
      "  class: 'military_land',",
      "  name, type, latitude, longitude, country,",
      "  footprint: null,",
      "  sources: [{ name: 'Bundled public map reference' }],",
      "  validation: 'reference-catalog',",
      "  retrievedAt: null,",
      '})));',
    ].join('\n');
    military = military.replace(
      'const EARTH_MEAN_RADIUS_M = 6371008.8;',
      catalog + '\nconst EARTH_MEAN_RADIUS_M = 6371008.8;',
    );
  }

  if (!military.includes('function showBundledInstallations')) {
    const helpers = [
      'function bundledInstallationRecords(box = null) {',
      '  return GODS_EYE_BUNDLED_INSTALLATIONS.filter((record) => !box || installationWithinViewport(record, box));',
      '}',
      '',
      'function showBundledInstallations(reason, box = null) {',
      '  const records = bundledInstallationRecords(box);',
      '  state.records = records;',
      '  state.recordById = new Map(records.map((record) => [record.id, record]));',
      '  state.lastUpdate = Date.now();',
      '  state.stale = true;',
      '  state.saturated = false;',
      '  clearUnavailableRetry();',
      "  setInstallationStatus('fallback', reason);",
      '  renderRecords();',
      '  warmInstallationFloors(records);',
      '}',
      '',
    ].join('\n');
    military = military.replace(
      'function clearRendered() {',
      helpers + 'function clearRendered() {',
    );
  }

  military = military.replace(
    "  if (!box) {\n    state.abort?.abort();\n    state.abort = null;\n    state.loading = false;\n    clearUnavailableRetry();\n    setInstallationStatus('zoom-in', 'Zoom in to load mapped installation context');\n    return;\n  }",
    "  if (!box) {\n    state.abort?.abort();\n    state.abort = null;\n    state.loading = false;\n    showBundledInstallations(\n      'Showing public reference installations; zoom in for live mapped OSM data.',\n    );\n    return;\n  }",
  );
  military = military.replace(
    "    const records = normalized.records.filter((record) => installationWithinViewport(record, box));",
    "    let records = normalized.records.filter((record) => installationWithinViewport(record, box));",
  );
  military = military.replace(
    "    }\n    await resolveGroundFloorCellsBounded(records.map((record) => ({",
    "    }\n    if (!records.length) {\n      records = bundledInstallationRecords(box);\n    }\n    await resolveGroundFloorCellsBounded(records.map((record) => ({",
  );
  military = military.replace(
    "    setInstallationStatus(\n      state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty',",
    "    const usingBundled = records.some((record) => record.validation === 'reference-catalog');\n    setInstallationStatus(\n      usingBundled ? 'fallback' : (state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty'),",
  );
  military = military.replace(
    "    setInstallationStatus('unavailable', error?.message || 'Installation context unavailable');\n    scheduleUnavailableRetry();",
    "    const fallback = bundledInstallationRecords(box);\n    if (fallback.length) {\n      showBundledInstallations(\n        'Live map source unavailable; showing public reference installations.',\n        box,\n      );\n    } else {\n      setInstallationStatus('unavailable', error?.message || 'Installation context unavailable');\n      scheduleUnavailableRetry();\n    }",
  );
  write(militaryPath, military);

  // GODS_EYE_MILITARY_OSINT_LAYERS: public-source fleet, defense-test, and geopolitical layers.
  const osintLayerDir = path.join(target, 'src/data');
  const osintLayerSource = "import * as Cesium from 'cesium';\nimport {\n  clearSelectedEntityContextForLayer,\n  registerEntityContext,\n  removeEntityContextsForLayer,\n  selectEntityContext,\n} from './contextStore.js';\n\nconst DEFAULT_REFRESH_MS = 300000;\nconst MAX_ITEMS = 100;\nconst OSINT_ENABLED = String(import.meta.env.VITE_GLOBE_OSINT_ENABLED || 'true').toLowerCase() === 'true';\n\nfunction finiteCoordinate(value) {\n  const number = Number(value);\n  return Number.isFinite(number) ? number : null;\n}\n\nfunction safeText(value, fallback = '') {\n  const text = String(value ?? '').replace(/\\s+/g, ' ').trim();\n  return text || fallback;\n}\n\nexport function createMilitaryOsintLayer({ id, name, icon, scope, color }) {\n  const state = {\n    viewer: null,\n    dataSource: null,\n    clickHandler: null,\n    enabled: false,\n    rows: [],\n    entitiesById: new Map(),\n    lastUpdate: null,\n    error: null,\n    request: null,\n  };\n  const refreshMs = Math.max(60000, Number(import.meta.env.VITE_GLOBE_OSINT_REFRESH_MS) || DEFAULT_REFRESH_MS);\n  const limit = Math.max(10, Math.min(MAX_ITEMS, Number(import.meta.env.VITE_GLOBE_OSINT_MAX_ITEMS) || 80));\n\n  function clearEntities() {\n    state.dataSource?.entities?.removeAll?.();\n    state.entitiesById.clear();\n  }\n\n  function publishMarkerSelection(entity, row) {\n    const detail = {\n      ...row,\n      layerId: id,\n      layerName: name,\n      title: safeText(row.title, 'Untitled public report'),\n      category: safeText(row.category, scope === 'fleet' ? 'defense watch' : 'geopolitical watch'),\n      region: safeText(row.region, 'regional attribution'),\n      source: safeText(row.source, 'GDELT public-source index'),\n      domain: safeText(row.domain),\n      url: safeText(row.url),\n      publishedAt: safeText(row.publishedAt),\n      confidence: safeText(row.confidence, 'source-reported'),\n    };\n    selectEntityContext(entity);\n    window.dispatchEvent(new CustomEvent('gods-eye-osint-marker-selected', { detail }));\n  }\n\n  function installInteraction(viewer) {\n    if (state.clickHandler || !viewer?.scene?.canvas) return;\n    state.clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);\n    state.clickHandler.setInputAction((click) => {\n      if (!state.enabled) return;\n      const picked = viewer.scene.pick(click.position);\n      const entity = picked?.id;\n      const entityId = typeof entity?.id === 'string' ? entity.id : null;\n      const row = entityId ? state.entitiesById.get(entityId) : null;\n      if (row && entity) publishMarkerSelection(entity, row);\n    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);\n  }\n\n  function renderRows() {\n    removeEntityContextsForLayer(id);\n    clearEntities();\n    if (!state.dataSource) return;\n    for (const row of state.rows) {\n      const latitude = finiteCoordinate(row.latitude);\n      const longitude = finiteCoordinate(row.longitude);\n      if (latitude === null || longitude === null) continue;\n      const category = safeText(row.category, scope === 'fleet' ? 'defense watch' : 'geopolitical watch');\n      const title = safeText(row.title, 'Untitled public report');\n      const markerColor = category.includes('test') ? '#ffb000' : color;\n      const entityId = `${id}:${safeText(row.id, Math.random().toString(36).slice(2))}`;\n      const entity = state.dataSource.entities.add({\n        id: entityId,\n        position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 1200),\n        point: {\n          pixelSize: category.includes('test') ? 9 : 8,\n          color: Cesium.Color.fromCssColorString(markerColor).withAlpha(0.9),\n          outlineColor: Cesium.Color.WHITE.withAlpha(0.9),\n          outlineWidth: 1,\n          disableDepthTestDistance: Number.POSITIVE_INFINITY,\n        },\n        properties: {\n          title,\n          category,\n          region: safeText(row.region, 'regional attribution'),\n          source: safeText(row.source, 'GDELT public-source index'),\n          domain: safeText(row.domain),\n          url: safeText(row.url),\n          publishedAt: safeText(row.publishedAt),\n          confidence: safeText(row.confidence, 'source-reported'),\n        },\n      });\n      state.entitiesById.set(entityId, row);\n      entity.gevDisplayPosition = () => Cesium.Cartesian3.fromDegrees(longitude, latitude, 1200);\n      registerEntityContext(entity, {\n        id: entityId,\n        layerId: id,\n        layerName: name,\n        source: safeText(row.source, 'GDELT public-source index'),\n        label: title,\n        latitude,\n        longitude,\n        properties: {\n          category,\n          region: safeText(row.region, 'regional attribution'),\n          domain: safeText(row.domain),\n          url: safeText(row.url),\n          publishedAt: safeText(row.publishedAt),\n          confidence: safeText(row.confidence, 'source-reported'),\n        },\n      });\n    }\n    state.dataSource.show = state.enabled;\n  }\n\n  async function refresh() {\n    if (!OSINT_ENABLED || !state.enabled) return;\n    if (state.request) return state.request;\n    state.request = (async () => {\n      try {\n        const response = await fetch(`/api/military-osint?scope=${encodeURIComponent(scope)}&limit=${limit}`, { cache: 'no-store' });\n        if (!response.ok) throw new Error(`OSINT feed unavailable (${response.status})`);\n        const payload = await response.json();\n        state.rows = Array.isArray(payload.items) ? payload.items.slice(0, limit) : [];\n        state.lastUpdate = payload.retrievedAt || new Date().toISOString();\n        state.error = null;\n        renderRows();\n      } catch (error) {\n        state.error = safeText(error?.message, 'OSINT feed unavailable');\n      } finally {\n        state.request = null;\n      }\n    })();\n    return state.request;\n  }\n\n  return {\n    id,\n    name,\n    icon,\n    source: 'GDELT / Google News RSS public-source index; regional attribution only',\n    updateInterval: 0,\n    refreshInterval: refreshMs,\n    init(viewer) {\n      state.viewer = viewer;\n      state.dataSource = new Cesium.CustomDataSource(id);\n      viewer.dataSources.add(state.dataSource);\n      installInteraction(viewer);\n    },\n    enable() {\n      state.enabled = OSINT_ENABLED;\n      if (state.dataSource) state.dataSource.show = state.enabled;\n      return refresh();\n    },\n    disable() {\n      state.enabled = false;\n      state.rows = [];\n      state.error = null;\n      clearSelectedEntityContextForLayer(id);\n      removeEntityContextsForLayer(id);\n      clearEntities();\n      if (state.dataSource) state.dataSource.show = false;\n    },\n    update() {\n      return refresh();\n    },\n    destroy(viewer) {\n      this.disable();\n      state.clickHandler?.destroy?.();\n      state.clickHandler = null;\n      if (state.dataSource && viewer) viewer.dataSources.remove(state.dataSource, true);\n      state.dataSource = null;\n      state.viewer = null;\n    },\n    getStats() {\n      return {\n        enabled: OSINT_ENABLED,\n        count: state.rows.length,\n        loading: Boolean(state.request),\n        lastUpdate: state.lastUpdate,\n        error: state.error,\n        source: 'GDELT / Google News RSS public-source index',\n      };\n    },\n    getItems() {\n      return state.rows.slice();\n    },\n  };\n}";
  const fleetLayerSource = "import { createMilitaryOsintLayer } from './militaryOsintLayer.js';\n\nexport default createMilitaryOsintLayer({\n  id: 'fleet-deployments',\n  name: 'Fleet & Defense Watch',\n  icon: '⚓',\n  scope: 'fleet',\n  color: '#ff5c7a',\n});";
  const geopoliticalLayerSource = "import { createMilitaryOsintLayer } from './militaryOsintLayer.js';\n\nexport default createMilitaryOsintLayer({\n  id: 'geopolitical-watch',\n  name: 'Geopolitical & Test Watch',\n  icon: '◈',\n  scope: 'geopolitical',\n  color: '#00d4ff',\n});";
  write(path.join(osintLayerDir, 'militaryOsintLayer.js'), osintLayerSource);
  write(path.join(osintLayerDir, 'fleetDeployments.js'), fleetLayerSource);
  write(path.join(osintLayerDir, 'geopoliticalWatch.js'), geopoliticalLayerSource);
  const globeMainPath = path.join(target, 'src/main.js');
  let globeMain = read(globeMainPath);
  if (!globeMain.includes("from './data/fleetDeployments.js'")) {
    globeMain = globeMain.replace(
      "import militaryAwarenessLayer from './data/militaryAwareness.js';",
      "import militaryAwarenessLayer from './data/militaryAwareness.js';\nimport fleetDeploymentsLayer from './data/fleetDeployments.js';\nimport geopoliticalWatchLayer from './data/geopoliticalWatch.js';",
    );
  }
  if (!globeMain.includes('dataManager.register(fleetDeploymentsLayer);')) {
    globeMain = globeMain.replace(
      '    dataManager.register(militaryAwarenessLayer);',
      '    dataManager.register(militaryAwarenessLayer);\n    dataManager.register(fleetDeploymentsLayer);\n    dataManager.register(geopoliticalWatchLayer);',
    );
  }
  write(globeMainPath, globeMain);

  const layerStatePath = path.join(target, 'src/data/layerState.js');
  let layerState = read(layerStatePath);
  // Street Traffic is intentionally absent from the production globe registry.
  layerState = layerState.replace(/^\s*Object\.freeze\(\{ id: 'traffic'.*\r?\n/gm, '');
  if (!layerState.includes("id: 'fleet-deployments'")) {
    layerState = layerState.replace(
      "  Object.freeze({ id: 'military-awareness', token: 'g', disposition: 'enabled-only' }),",
      "  Object.freeze({ id: 'military-awareness', token: 'g', disposition: 'enabled-only' }),\n  Object.freeze({ id: 'fleet-deployments', token: 'y', disposition: 'enabled-only' }),\n  Object.freeze({ id: 'geopolitical-watch', token: 'z', disposition: 'enabled-only' }),",
    );
  }
  write(layerStatePath, layerState);
  const bikePath = path.join(target, 'src/data/bikeshare.js');
  let bike = read(bikePath);
  if (!bike.includes('showInTogglePanel: false')) {
    bike = bike.replace(
      "  source: 'GBFS',\n  updateInterval: STATUS_POLL_MS,",
      "  source: 'GBFS',\n  // Kept available to shared engine code, but not shown in the user data-layer panel.\n  showInTogglePanel: false,\n  updateInterval: STATUS_POLL_MS,",
    );
  }
  write(bikePath, bike);

  const viteConfigPath = path.join(target, 'vite.config.js');
  if (fs.existsSync(viteConfigPath)) {
    let vite = read(viteConfigPath);
    // GODS_EYE_MILITARY_OSINT_PROXY: keyless GDELT recent-report proxy for globe layers.
    if (!vite.includes('function militaryOsintProxy()')) {
      const militaryOsintProxySource = "function militaryOsintProxy() {\n  const cacheMs = Math.max(60000, Number(process.env.GLOBE_OSINT_REFRESH_MS) || 300000);\n  const staleMs = Math.max(cacheMs, 6 * 60 * 60 * 1000);\n  const maxLimit = Math.max(20, Math.min(100, Number(process.env.GLOBE_OSINT_MAX_ITEMS) || 80));\n  const cache = new Map();\n  const inflight = new Map();\n  const queries = {\n    fleet: '(navy OR fleet OR warship OR carrier OR destroyer OR frigate OR submarine OR \"naval deployment\" OR troop deployment OR military exercise OR \"missile test\" OR \"missile launch\")',\n    geopolitical: '(geopolitical OR sanctions OR ceasefire OR conflict OR \"security council\" OR diplomacy OR \"military operation\" OR \"defense test\" OR \"missile test\" OR \"missile launch\" OR \"military exercise\")',\n  };\n  const anchors = [\n    ['taiwan strait|taiwan', 'Taiwan Strait', 24.0, 120.7],\n    ['south china sea|philippines', 'South China Sea', 12.5, 115.0],\n    ['red sea|yemen|houthi', 'Red Sea', 16.0, 42.0],\n    ['ukraine|crimea|donbas', 'Ukraine / Black Sea', 49.0, 32.0],\n    ['gaza|israel|lebanon', 'Eastern Mediterranean', 34.5, 31.0],\n    ['persian gulf|iran|hormuz', 'Persian Gulf', 26.5, 52.0],\n    ['korean peninsula|north korea|south korea', 'Korean Peninsula', 38.3, 127.6],\n    ['japan|okinawa', 'Japan / Western Pacific', 32.0, 135.0],\n    ['baltic|poland|finland', 'Baltic / Northern Europe', 56.5, 20.0],\n    ['black sea|romania|bulgaria', 'Black Sea', 43.5, 34.0],\n    ['sahel|niger|mali|burkina faso', 'Sahel', 15.0, 4.0],\n    ['syria|iraq', 'Levant / Iraq', 34.5, 40.5],\n    ['india|pakistan|kashmir', 'South Asia', 28.5, 78.0],\n  ];\n  const countryAnchors = {\n    'united states': ['United States', 39.0, -98.0],\n    russia: ['Russia', 61.0, 100.0],\n    china: ['China', 35.0, 105.0],\n    'united kingdom': ['United Kingdom', 54.0, -2.0],\n    france: ['France', 46.2, 2.2],\n    germany: ['Germany', 51.2, 10.4],\n    india: ['India', 22.5, 79.0],\n    iran: ['Iran', 32.0, 53.0],\n  };\n  const clean = (value, max = 220) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);\n  const safeUrl = (value) => { try { const parsed = new URL(String(value || '')); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };\n  const dateOf = (value) => {\n    const raw = clean(value, 32);\n    const compact = /^(\\d{8})T(\\d{6})Z$/.exec(raw);\n    if (compact) return compact[1].slice(0, 4) + '-' + compact[1].slice(4, 6) + '-' + compact[1].slice(6, 8) + 'T' + compact[2].slice(0, 2) + ':' + compact[2].slice(2, 4) + ':' + compact[2].slice(4, 6) + 'Z';\n    const parsed = Date.parse(raw);\n    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();\n  };\n  const hash = (value) => { let result = 0; for (const char of String(value || '')) result = ((result * 31) + char.charCodeAt(0)) >>> 0; return result.toString(36); };\n  const categoryOf = (title, scope) => {\n    const text = String(title || '').toLowerCase();\n    if (/missile|ballistic|defense test|defence test|military exercise|rocket launch|weapons test|scheduled test/.test(text)) return 'missile / defense test';\n    if (scope === 'fleet' && /carrier|navy|fleet|warship|destroyer|frigate|submarine|naval|maritime/.test(text)) return 'fleet / maritime';\n    if (scope === 'fleet' && /troop|deployment|military|exercise/.test(text)) return 'troop / exercise';\n    return 'geopolitical event';\n  };\n  const locationOf = (text, sourceCountry) => {\n    const match = anchors.find(([terms]) => terms.split('|').some((term) => text.includes(term)));\n    if (match) return { region: match[1], latitude: match[2], longitude: match[3], basis: 'keyword-region' };\n    const country = countryAnchors[String(sourceCountry || '').toLowerCase()];\n    if (country) return { region: country[0], latitude: country[1], longitude: country[2], basis: 'source-country-region' };\n    return { region: 'Global / location unconfirmed', latitude: null, longitude: null, basis: 'not geocoded' };\n  };\n  async function refresh(scope, limit) {\n    try { return await refreshGdelt(scope, limit); }\n    catch { return refreshFromRss(scope, limit); }\n  }\n  async function refreshGdelt(scope, limit) {\n    if (!queries[scope]) throw new Error('Unsupported OSINT scope');\n    const endpoint = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(queries[scope]) + '&mode=artlist&format=json&maxrecords=' + limit + '&timespan=24h&sort=HybridRel';\n    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });\n    if (!response.ok) throw new Error('GDELT returned HTTP ' + response.status);\n    const payload = await response.json();\n    const seen = new Set();\n    const items = [];\n    for (const row of Array.isArray(payload?.articles) ? payload.articles : []) {\n      const url = safeUrl(row?.url || row?.url_mobile);\n      const title = clean(row?.title);\n      if (!url || !title) continue;\n      const domain = clean(row?.domain || new URL(url).hostname.replace(/^www\\./, ''), 100);\n      const signature = title.toLowerCase() + '|' + domain.toLowerCase();\n      if (seen.has(signature)) continue;\n      seen.add(signature);\n      const sourceCountry = clean(row?.sourcecountry, 80) || null;\n      const location = locationOf((title + ' ' + sourceCountry).toLowerCase(), sourceCountry);\n      items.push({ id: 'gdelt-' + hash(scope + '|' + signature), title, url, domain, publishedAt: dateOf(row?.seendate), sourceCountry, category: categoryOf(title, scope), region: location.region, latitude: location.latitude, longitude: location.longitude, locationBasis: location.basis, confidence: 'source-reported', source: 'GDELT DOC 2.0 public news index' });\n      if (items.length >= limit) break;\n    }\n    return { status: 'ready', scope, retrievedAt: new Date().toISOString(), items, sourceHealth: [{ source: 'GDELT DOC 2.0', ok: true, count: items.length }], note: 'Recent public-source reporting. Regional markers are attribution aids, not confirmed operational coordinates.' };\n  }\n  async function refreshFromRss(scope, limit) {\n    const query = scope === 'fleet'\n      ? 'navy OR fleet OR warship OR carrier OR deployment OR missile test OR military exercise'\n      : 'geopolitics OR sanctions OR ceasefire OR conflict OR diplomacy OR missile test OR defense exercise';\n    const params = new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' });\n    const xml = await fetchRegionalText('https://news.google.com/rss/search?' + params, { headers: { 'User-Agent': 'GodsEyeView/0.1' }, timeoutMs: 15000 });\n    const rows = normalizeRssArticles(xml, limit);\n    const items = rows.map((row) => {\n      const sourceCountry = null;\n      const location = locationOf(String(row.title || '').toLowerCase(), sourceCountry);\n      return { id: 'google-news-' + hash(scope + '|' + row.title + '|' + row.url), title: clean(row.title), url: safeUrl(row.url), domain: clean(row.domain, 100), publishedAt: row.publishedAt, sourceCountry, category: categoryOf(row.title, scope), region: location.region, latitude: location.latitude, longitude: location.longitude, locationBasis: location.basis, confidence: 'source-reported', source: 'Google News RSS public index' };\n    }).filter((row) => row.url && row.title);\n    return { status: 'ready', scope, retrievedAt: new Date().toISOString(), items, sourceHealth: [{ source: 'Google News RSS', ok: true, count: items.length }], note: 'Recent public-source reporting. Regional markers are attribution aids, not confirmed operational coordinates.', fallback: 'gdelt-rate-limited-or-unavailable' };\n  }  function install(middlewares) {\n    middlewares.use('/api/military-osint', async (req, res) => {\n      if (req.method !== 'GET') { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Method Not Allowed' })); return; }\n      const url = new URL(req.url || '', 'http://localhost');\n      const scope = url.searchParams.get('scope') || 'fleet';\n      const rawLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);\n      const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(maxLimit, rawLimit)) : maxLimit;\n      const key = scope + ':' + limit;\n      const now = Date.now();\n      const cached = cache.get(key);\n      const send = (status, body, header) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-OSINT': header }); res.end(JSON.stringify(body)); };\n      if (cached && now - cached.cachedAt <= cacheMs) { send(200, { ...cached.payload, status: 'cached' }, 'HIT'); return; }\n      let request = inflight.get(key);\n      let shared = true;\n      if (!request) { shared = false; const promise = refresh(scope, limit); request = { promise }; inflight.set(key, request); promise.finally(() => { if (inflight.get(key) === request) inflight.delete(key); }).catch(() => {}); }\n      try { const payload = await request.promise; cache.set(key, { payload, cachedAt: Date.now() }); send(200, payload, shared ? 'INFLIGHT' : 'MISS'); }\n      catch { if (cached && now - cached.cachedAt <= staleMs) { send(200, { ...cached.payload, status: 'stale' }, 'STALE'); return; } send(503, { error: 'Public OSINT feed is temporarily unavailable', scope }, 'ERROR'); }\n    });\n  }\n  return { name: 'military-osint-proxy', configureServer(server) { install(server.middlewares); }, configurePreviewServer(server) { install(server.middlewares); } };\n}";
      vite = vite.replace('function weatherEffectsProxy() {', militaryOsintProxySource + '\nfunction weatherEffectsProxy() {');
    }
    if (!vite.includes('militaryOsintProxy(),')) {
      vite = vite.replace('      regionalBriefProxy(),', '      regionalBriefProxy(),\n      militaryOsintProxy(),');
    }
    // OVERPASS mirror for AWS (2026-11-11): overpass-api.de + lz4 return nginx 406
    // for every request from AWS IPs; kumi.systems + private.coffee are TCP-
    // unreachable from EC2. The mail.ru mirror serves full-planet data from AWS
    // (verified: military-installations query 200, 258 KB). Put it first.
    if (!vite.includes('maps.mail.ru')) {
      vite = vite.replace(
        'const OVERPASS_UPSTREAMS = [',
        "const OVERPASS_UPSTREAMS = [\n  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', // AWS-reachable mirror — de mirrors 406-ban AWS IPs; kumi/private.coffee unreachable",
      );
    }
    // The mail.ru mirror needs 14-60s for snapped boxes; the stock 22s abort
    // mid-flight (aborted Overpass requests also occupy server-side slots).
    if (vite.includes('const OVERPASS_TIMEOUT_MS = 22000;')) {
      vite = vite.replace('const OVERPASS_TIMEOUT_MS = 22000;', 'const OVERPASS_TIMEOUT_MS = 60000;');
    }
    // ADS_B_FALLBACK_GRID (2026-11-11): OpenSky is TCP-unreachable from AWS and
    // the single 250nm view-anchor circle showed only a handful of aircraft.
    // A 16-point global receiver grid + the view anchor (parallel, per-point
    // cached, merged + deduped by ICAO24) serves ~2,200+ real live aircraft.
    if (!vite.includes('ADS_B_FALLBACK_GRID')) {
      const gridSource = fs.readFileSync(new URL('./globe_flight_grid.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trimEnd();
      vite = vite.replace(
        'async function fetchAdsbLolPointFallback(req) {',
        gridSource + '\nasync function fetchAdsbLolPointFallback(req) {',
      );
      vite = vite.replace(
        'const fallback = await fetchAdsbLolPointFallback(req);',
        'const fallback = await fetchAdsbLolGridFallback(req);',
      );
    }
    write(viteConfigPath, vite);
  }
}
