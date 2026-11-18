const categories = [
  "earthquake",
  "wildfire",
  "storm",
  "volcano",
  "flood",
  "landslide",
  "drought",
  "dust",
  "snow",
  "ice",
  "weather",
  "geopolitical",
  "military",
  "news",
  "disaster",
  "manmade"
];

const categoryLabels = {
  earthquake: "Earthquake",
  wildfire: "Fire",
  storm: "Storm",
  volcano: "Volcano",
  flood: "Flood",
  landslide: "Landslide",
  drought: "Drought",
  dust: "Dust/Haze",
  snow: "Snow",
  ice: "Ice",
  weather: "Weather",
  geopolitical: "Geo",
  military: "Military",
  news: "News",
  disaster: "Disaster",
  manmade: "Manmade"
};

const categoryColors = {
  earthquake: "#ff4d5e",
  wildfire: "#ff8a3d",
  storm: "#2ec7ff",
  volcano: "#ff5f30",
  flood: "#4aa8ff",
  landslide: "#b88a55",
  drought: "#e7c353",
  dust: "#d1a463",
  snow: "#cde9ff",
  ice: "#8bd9ff",
  weather: "#61d394",
  geopolitical: "#c8e35d",
  military: "#d66bff",
  news: "#ffd166",
  disaster: "#f2b84b",
  manmade: "#f59e0b"
};

const severityColors = {
  low: "#8fb4a9",
  moderate: "#f4cf5d",
  high: "#ff8a3d",
  critical: "#ff4d5e"
};

const severityRank = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4
};

const mapTileStyles = [
  {
    name: "Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    filter: "brightness(0.58) saturate(0.28) contrast(1.12)"
  },
  {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    filter: "brightness(0.42) saturate(0.58) contrast(1.12)"
  },
  {
    name: "Smooth",
    url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
    filter: "brightness(0.82) saturate(0.5) contrast(1.04)"
  }
];

const LEAFLET_MARKER_LIMIT = 650;

const state = {
  range: "24h",
  events: [],
  filtered: [],
  sourceHealth: [],
  selectedId: null,
  selectedCategories: new Set(categories),
  severity: "all",
  sort: "priority",
  search: "",
  mappedOnly: false,
  autoRefresh: true,
  loading: false,
  nextRefreshAt: null,
  refreshTimer: null,
  countdownTimer: null,
  searchDebounce: null,
  map: null,
  mapCanvas: null,
  mapContext: null,
  mapTooltip: null,
  mapEmpty: null,
  leafletMap: null,
  leafletLayer: null,
  leafletTileLayer: null,
  leafletRenderer: null,
  leafletMarkers: new Map(),
  mapStyleIndex: 0,
  mapMoveTimer: null,
  mapView: {
    zoom: 1,
    panX: 0,
    panY: 0
  },
  mapPointer: null,
  mapDragging: null,
  mapResizeObserver: null,
  mapResizeTimer: null,
  mapRenderPending: false,
  hasFittedMap: false,
  markers: new Map(),
  lastPayload: null
};

const landMasses = [
  {
    name: "North America",
    points: [
      [-168, 71],
      [-150, 73],
      [-130, 70],
      [-113, 66],
      [-96, 72],
      [-72, 67],
      [-55, 55],
      [-61, 45],
      [-78, 36],
      [-81, 26],
      [-97, 25],
      [-105, 31],
      [-113, 31],
      [-119, 38],
      [-124, 49],
      [-139, 59],
      [-154, 58],
      [-166, 62]
    ]
  },
  {
    name: "Central America",
    points: [
      [-104, 23],
      [-92, 18],
      [-88, 15],
      [-84, 10],
      [-79, 9],
      [-76, 8],
      [-82, 5],
      [-91, 9],
      [-98, 16]
    ]
  },
  {
    name: "South America",
    points: [
      [-81, 12],
      [-70, 12],
      [-58, 7],
      [-49, -4],
      [-38, -13],
      [-35, -26],
      [-43, -36],
      [-54, -48],
      [-67, -55],
      [-73, -44],
      [-76, -30],
      [-81, -14],
      [-79, 0]
    ]
  },
  {
    name: "Greenland",
    points: [
      [-53, 83],
      [-30, 78],
      [-23, 70],
      [-40, 60],
      [-58, 60],
      [-73, 70],
      [-68, 79]
    ]
  },
  {
    name: "Europe",
    points: [
      [-11, 36],
      [-6, 50],
      [8, 60],
      [26, 69],
      [42, 60],
      [38, 48],
      [28, 41],
      [16, 36],
      [2, 36]
    ]
  },
  {
    name: "Africa",
    points: [
      [-17, 35],
      [5, 37],
      [28, 31],
      [43, 12],
      [51, -2],
      [40, -18],
      [32, -35],
      [18, -35],
      [6, -23],
      [-8, -7],
      [-17, 12]
    ]
  },
  {
    name: "Asia",
    points: [
      [30, 38],
      [44, 55],
      [70, 60],
      [96, 72],
      [130, 62],
      [156, 57],
      [169, 48],
      [148, 36],
      [121, 22],
      [105, 8],
      [91, 21],
      [78, 9],
      [62, 23],
      [47, 28]
    ]
  },
  {
    name: "Southeast Asia",
    points: [
      [96, 22],
      [111, 17],
      [122, 9],
      [132, -5],
      [119, -8],
      [107, -5],
      [100, 4],
      [94, 13]
    ]
  },
  {
    name: "Australia",
    points: [
      [113, -11],
      [132, -10],
      [153, -24],
      [146, -39],
      [125, -38],
      [112, -27]
    ]
  },
  {
    name: "New Zealand",
    points: [
      [166, -35],
      [178, -39],
      [174, -47],
      [164, -45]
    ]
  },
  {
    name: "Antarctica",
    points: [
      [-180, -69],
      [-120, -72],
      [-60, -68],
      [0, -72],
      [70, -69],
      [140, -73],
      [180, -70],
      [180, -85],
      [-180, -85]
    ]
  }
];

const mapLabels = [
  { text: "North America", lat: 47, lon: -106 },
  { text: "South America", lat: -21, lon: -62 },
  { text: "Europe", lat: 52, lon: 15 },
  { text: "Africa", lat: 5, lon: 20 },
  { text: "Asia", lat: 43, lon: 87 },
  { text: "Australia", lat: -26, lon: 134 },
  { text: "Arctic", lat: 78, lon: 10 },
  { text: "Pacific", lat: 3, lon: -150 },
  { text: "Atlantic", lat: 1, lon: -30 },
  { text: "Indian Ocean", lat: -18, lon: 76 }
];

const mapIconLabels = {
  earthquake: "EQ",
  wildfire: "FI",
  storm: "ST",
  volcano: "VO",
  flood: "FL",
  landslide: "LS",
  drought: "DR",
  dust: "DU",
  snow: "SN",
  ice: "IC",
  weather: "WX",
  geopolitical: "GO",
  military: "MI",
  news: "NW",
  disaster: "DS",
  manmade: "MH"
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  renderCategoryToggles();
  renderLegend();
  initMap();
  bindEvents();
  initHudExtras();
  refreshData();
  startCountdown();
  renderIcons();
});

function bindElements() {
  [
    "liveStatus",
    "totalCount",
    "priorityCount",
    "sourceCount",
    "refreshBtn",
    "resetBtn",
    "searchInput",
    "severitySelect",
    "sortSelect",
    "mappedOnly",
    "autoRefresh",
    "nextRefresh",
    "categoryToggles",
    "mapTitle",
    "mapLegend",
    "fitMapBtn",
    "locateHighBtn",
    "filteredCount",
    "eventList",
    "updatedTime",
    "overviewText",
    "watchlist",
    "hotspots",
    "selectedEvent",
    "sourceHealth",
    "exportBtn",
    "copyBriefBtn",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", () => refreshData({ force: true }));
  els.resetBtn.addEventListener("click", resetFilters);
  els.searchInput.addEventListener("input", (event) => {
    const value = event.target.value.trim().toLowerCase();
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => {
      state.search = value;
      applyFilters();
    }, 140);
  });
  els.severitySelect.addEventListener("change", (event) => {
    state.severity = event.target.value;
    applyFilters();
  });
  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    applyFilters();
  });
  els.mappedOnly.addEventListener("change", (event) => {
    state.mappedOnly = event.target.checked;
    applyFilters();
  });
  els.autoRefresh.addEventListener("change", (event) => {
    state.autoRefresh = event.target.checked;
    scheduleNextRefresh();
    showToast(state.autoRefresh ? "Auto refresh enabled." : "Auto refresh paused.");
  });
  els.fitMapBtn.addEventListener("click", fitVisibleEvents);
  els.locateHighBtn.addEventListener("click", focusHighestPriority);
  els.exportBtn.addEventListener("click", exportCsv);
  els.copyBriefBtn.addEventListener("click", copyBrief);

  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.range === button.dataset.range) return;
      state.range = button.dataset.range;
      document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
      refreshData({ force: true });
    });
  });
}

function initHudExtras() {
  startHudClock();

  const sidebarToggle = document.getElementById("sidebarToggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
      sidebarToggle.textContent = document.body.classList.contains("sidebar-collapsed") ? ">" : "<";
    });
  }

  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const resetMapBtn = document.getElementById("resetMapBtn");
  const styleMapBtn = document.getElementById("styleMapBtn");

  zoomInBtn?.addEventListener("click", () => {
    if (state.leafletMap) state.leafletMap.zoomIn(0.5);
    else zoomMapFromCenter(1.22);
  });
  zoomOutBtn?.addEventListener("click", () => {
    if (state.leafletMap) state.leafletMap.zoomOut(0.5);
    else zoomMapFromCenter(0.82);
  });
  resetMapBtn?.addEventListener("click", () => fitVisibleEvents());
  styleMapBtn?.addEventListener("click", cycleMapStyle);
}

function startHudClock() {
  updateHudClock();
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(updateHudClock, 1000);
}

function updateHudClock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  setText("clk-time", `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`);
  setText(
    "clk-date",
    `${now.toLocaleDateString("en", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).toUpperCase()} UTC`
  );
}

async function refreshData(options = {}) {
  if (state.loading) return;
  state.loading = true;
  document.body.classList.add("loading");
  setLiveStatus("connecting", "Refreshing");

  try {
    const response = await fetch(`/api/events?range=${encodeURIComponent(state.range)}&t=${Date.now()}`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const payload = await response.json();
    state.lastPayload = payload;
    state.events = payload.events || [];
    state.sourceHealth = payload.sourceHealth || [];
    state.selectedId = state.events.some((event) => event.id === state.selectedId) ? state.selectedId : null;
    state.hasFittedMap = false;
    applyFilters();
    setLiveStatus(...liveStatusForSources());
    showToast(options.force ? "Live feeds refreshed." : "Live dashboard loaded.");
  } catch (error) {
    setLiveStatus("error", "Offline");
    showToast(`Could not refresh live feeds: ${error.message}`);
  } finally {
    state.loading = false;
    document.body.classList.remove("loading");
    document.body.classList.add("ready");
    scheduleNextRefresh();
    renderIcons();
  }
}

function applyFilters() {
  const minSeverity = state.severity === "all" ? 0 : severityRank[state.severity] || 0;
  const query = state.search;

  state.filtered = state.events.filter((event) => {
    if (!state.selectedCategories.has(event.category)) return false;
    if (minSeverity && severityRank[event.severity] < minSeverity) return false;
    if (state.mappedOnly && !hasCoordinates(event)) return false;
    if (!query) return true;

    const haystack = [
      event.title,
      event.summary,
      event.area,
      event.source,
      event.category,
      event.severity,
      ...(event.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  sortFiltered();
  if (state.selectedId && !state.filtered.some((event) => event.id === state.selectedId)) {
    state.selectedId = null;
  }
  render();
}

function sortFiltered() {
  const sorters = {
    priority: (a, b) => b.severityScore - a.severityScore || newestFirst(a, b),
    newest: newestFirst,
    source: (a, b) => a.source.localeCompare(b.source) || newestFirst(a, b),
    category: (a, b) => a.category.localeCompare(b.category) || b.severityScore - a.severityScore
  };
  state.filtered.sort(sorters[state.sort] || sorters.priority);
}

function newestFirst(a, b) {
  return new Date(b.time || 0) - new Date(a.time || 0);
}

function render() {
  renderCounters();
  renderMap();
  renderEventList();
  renderBrief();
  renderSelectedEvent();
  renderSourceHealth();
  renderIcons();
}

function renderCounters() {
  const highPriority = state.filtered.filter((event) => event.severityScore >= 68).length;
  const liveSources = state.sourceHealth.filter((source) => source.ok).length;
  const mappedCount = state.filtered.filter(hasCoordinates).length;
  const topScore = state.filtered.reduce((score, event) => Math.max(score, event.severityScore || 0), 0);
  const threatIndex = calculateThreatIndex(state.filtered);
  els.totalCount.textContent = formatNumber(state.filtered.length);
  els.priorityCount.textContent = formatNumber(highPriority);
  els.sourceCount.textContent = `${liveSources}/${state.sourceHealth.length || 0}`;
  els.filteredCount.textContent = `${formatNumber(state.filtered.length)} shown`;
  els.updatedTime.textContent = state.lastPayload?.refreshedAt
    ? `Updated ${formatRelativeTime(state.lastPayload.refreshedAt)}`
    : "Not refreshed";
  els.mapTitle.textContent =
    state.leafletMap && mappedCount > LEAFLET_MARKER_LIMIT
      ? `${formatNumber(LEAFLET_MARKER_LIMIT)} priority markers shown of ${formatNumber(mappedCount)} mapped events`
      : `${formatNumber(mappedCount)} mapped of ${formatNumber(state.filtered.length)} events`;

  setText("mappedStat", formatNumber(mappedCount));
  setText("highestStat", String(Math.round(topScore)));
  setText("rangeStat", state.range.toUpperCase());
  setText("threatPct", `${threatIndex}%`);
  setWidth("threatFill", `${threatIndex}%`);
  setText("live-ago", state.lastPayload?.refreshedAt ? `synced ${formatRelativeTime(state.lastPayload.refreshedAt)}` : "syncing");
}

function renderEventList() {
  const visible = state.filtered.slice(0, 80);
  els.eventList.innerHTML = visible.length
    ? visible.map((event) => eventCardHtml(event)).join("")
    : `<div class="empty-state">No events match the current filters.</div>`;

  els.eventList.querySelectorAll("[data-event-id]").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.eventId, { pan: true }));
  });
}

function eventCardHtml(event) {
  return `
    <button class="event-card ${event.id === state.selectedId ? "selected" : ""}"
      data-event-id="${escapeAttr(event.id)}"
      style="${styleVars(event)}"
      type="button">
      <div class="badge-row">
        ${severityBadge(event)}
        ${categoryBadge(event)}
        <span class="source-badge">${escapeHtml(event.source)}</span>
      </div>
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.summary)}</p>
      <div class="event-meta">
        <span>${escapeHtml(event.area || "Global")}</span>
        <span>${formatRelativeTime(event.time)}</span>
        <span>${Math.round(event.confidence * 100)}% confidence</span>
      </div>
    </button>
  `;
}

function renderBrief() {
  const brief = buildBrief(state.filtered);
  els.overviewText.innerHTML = brief.overview.map((line) => `<div class="overview-line">${escapeHtml(line)}</div>`).join("");
  els.watchlist.innerHTML = brief.watchlist.length
    ? brief.watchlist
        .map(
          (event) => `
            <div class="watch-item" style="${styleVars(event)}">
              <button type="button" data-watch-id="${escapeAttr(event.id)}">${escapeHtml(event.title)}</button>
              <small>${escapeHtml(event.area)} - ${event.severity.toUpperCase()} - ${formatRelativeTime(event.time)}</small>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">No high-priority items in this filter view.</div>`;

  els.hotspots.innerHTML = brief.hotspots.length
    ? brief.hotspots
        .map(
          (hotspot) => `
            <div class="hotspot-item">
              <strong>${escapeHtml(hotspot.name)}</strong>
              <small>${hotspot.count} item${hotspot.count === 1 ? "" : "s"} - max score ${hotspot.maxSeverity}</small>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">No hotspot concentration yet.</div>`;

  els.watchlist.querySelectorAll("[data-watch-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.watchId, { pan: true }));
  });
}

function buildBrief(events) {
  const highPriority = events.filter((event) => event.severityScore >= 68);
  const critical = events.filter((event) => event.severity === "critical");
  const categoriesByCount = entriesByCount(countBy(events, (event) => event.category));
  const sourcesByCount = entriesByCount(countBy(events, (event) => event.source));
  const hotspots = buildHotspots(events).slice(0, 6);
  const latest = [...events].sort(newestFirst)[0];
  const busiestCategory = categoriesByCount[0];
  const busiestSource = sourcesByCount[0];

  const overview = [
    events.length
      ? `${formatNumber(events.length)} filtered items are active, including ${formatNumber(
          highPriority.length
        )} high-priority items and ${formatNumber(critical.length)} critical items.`
      : "No live items match the current filters.",
    busiestCategory
      ? `${labelForCategory(busiestCategory[0])} is currently the busiest lane with ${busiestCategory[1]} item${
          busiestCategory[1] === 1 ? "" : "s"
        }.`
      : "No category concentration is visible in this view.",
    hotspots[0]
      ? `${hotspots[0].name} is the strongest hotspot by density and severity.`
      : "The current view has no strong geographic hotspot.",
    latest ? `Newest item: ${latest.title}.` : "",
    busiestSource
      ? `${busiestSource[0]} is contributing the largest share of visible data.`
      : "No source is dominant in the filtered view.",
    hasSourceFailures()
      ? "Some sources failed this refresh, so the dashboard will retry on the next cycle."
      : "All configured source checks are currently healthy."
  ].filter(Boolean);

  return {
    overview,
    watchlist: highPriority.slice(0, 7),
    hotspots
  };
}

function renderSelectedEvent() {
  const event = state.events.find((item) => item.id === state.selectedId);
  if (!event) {
    els.selectedEvent.classList.add("empty-state");
    els.selectedEvent.innerHTML = "Select an item on the map or feed.";
    return;
  }

  els.selectedEvent.classList.remove("empty-state");
  els.selectedEvent.style.cssText = styleVars(event);
  els.selectedEvent.innerHTML = `
    <div class="badge-row">
      ${severityBadge(event)}
      ${categoryBadge(event)}
      <span class="source-badge">${escapeHtml(event.source)}</span>
    </div>
    <h4>${escapeHtml(event.title)}</h4>
    <p>${escapeHtml(event.summary)}</p>
    <p><strong>Area:</strong> ${escapeHtml(event.area || "Global")}</p>
    <p><strong>Observed:</strong> ${formatAbsoluteTime(event.time)}</p>
    ${
      hasCoordinates(event)
        ? `<p><strong>Coordinates:</strong> ${Number(event.lat).toFixed(3)}, ${Number(event.lon).toFixed(3)}</p>`
        : `<p><strong>Coordinates:</strong> Not provided by source</p>`
    }
    ${
      event.tags?.length
        ? `<p><strong>Tags:</strong> ${event.tags.map(escapeHtml).join(", ")}</p>`
        : ""
    }
    ${event.url ? `<a href="${escapeAttr(event.url)}" target="_blank" rel="noreferrer">Open source report</a>` : ""}
  `;
}

function renderSourceHealth() {
  els.sourceHealth.innerHTML = state.sourceHealth.length
    ? state.sourceHealth
        .map(
          (source) => `
            <div class="source-item">
              <div>
                <strong>${escapeHtml(source.source)}</strong>
                <small>${source.ok ? `${source.count} items - ${source.ms} ms` : escapeHtml(source.error || "Failed")}</small>
              </div>
              <span class="source-light ${source.ok ? "ok" : ""}"></span>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Waiting for source status.</div>`;

  updateStatusDots();
}

function calculateThreatIndex(events) {
  if (!events.length) return 0;
  const topEvents = [...events].sort((a, b) => b.severityScore - a.severityScore).slice(0, 24);
  const averageTopScore = topEvents.reduce((sum, event) => sum + (event.severityScore || 0), 0) / topEvents.length;
  const criticalBoost = Math.min(16, events.filter((event) => event.severity === "critical").length * 4);
  const densityBoost = Math.min(18, Math.round(events.length / 10));
  return Math.max(0, Math.min(100, Math.round(averageTopScore * 0.66 + criticalBoost + densityBoost)));
}

function updateStatusDots() {
  const sourceGroups = {
    "sd-official": (source) => /USGS|NASA|GDACS|Defense/i.test(source.source),
    "sd-news": (source) => /GDELT|Google|News/i.test(source.source),
    "sd-weather": (source) => /NOAA|NWS|Weather/i.test(source.source)
  };

  for (const [id, matches] of Object.entries(sourceGroups)) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.classList.toggle("ok", state.sourceHealth.some((source) => source.ok && matches(source)));
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setWidth(id, value) {
  const element = document.getElementById(id);
  if (element) element.style.width = value;
}

function initMap() {
  state.map = document.getElementById("map");
  if (!state.map) return;

  if (window.L) {
    initLeafletMap();
    return;
  }

  state.map.innerHTML = `
    <canvas class="ops-map-canvas" aria-label="World event map"></canvas>
    <div class="ops-map-tooltip" id="mapTooltip" hidden></div>
    <div class="map-empty" id="mapEmpty" hidden>No mapped events in this filter view.</div>
  `;
  state.mapCanvas = state.map.querySelector(".ops-map-canvas");
  state.mapContext = state.mapCanvas.getContext("2d", { alpha: false });
  state.mapTooltip = state.map.querySelector("#mapTooltip");
  state.mapEmpty = state.map.querySelector("#mapEmpty");
  bindCanvasMapEvents();
  state.mapResizeObserver = new ResizeObserver(queueMapResize);
  state.mapResizeObserver.observe(state.map);
  window.addEventListener("resize", queueMapResize);
  queueMapResize();
}

function initLeafletMap() {
  state.map.classList.add("leaflet-map");
  state.map.innerHTML = "";
  state.leafletRenderer = L.canvas({ padding: 0.35, tolerance: 8 });
  state.leafletMap = L.map(state.map, {
    center: [20, 10],
    zoom: 3,
    minZoom: 2,
    maxZoom: 14,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    renderer: state.leafletRenderer,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    fadeAnimation: false,
    zoomAnimation: true,
    markerZoomAnimation: false
  });

  applyLeafletStyle(0);
  state.leafletLayer = L.layerGroup().addTo(state.leafletMap);
  state.leafletMarkers = new Map();

  state.mapEmpty = document.createElement("div");
  state.mapEmpty.className = "map-empty";
  state.mapEmpty.id = "mapEmpty";
  state.mapEmpty.hidden = true;
  state.mapEmpty.textContent = "No mapped events in this filter view.";
  state.map.appendChild(state.mapEmpty);

  state.leafletMap.on("mousemove", (event) => {
    const lat = event.latlng.lat;
    const lon = event.latlng.lng;
    const latSuffix = lat >= 0 ? "N" : "S";
    const lonSuffix = lon >= 0 ? "E" : "W";
    setText("coord-bar", `${Math.abs(lat).toFixed(3)} ${latSuffix} / ${Math.abs(lon).toFixed(3)} ${lonSuffix}`);
  });
  state.leafletMap.on("mouseout", () => setText("coord-bar", "Hover the map for coordinates"));
  state.leafletMap.on("click", () => state.leafletMap.closePopup());
  state.leafletMap.on("movestart zoomstart", () => {
    clearTimeout(state.mapMoveTimer);
    document.body.classList.add("map-moving");
  });
  state.leafletMap.on("moveend zoomend", () => {
    clearTimeout(state.mapMoveTimer);
    state.mapMoveTimer = setTimeout(() => document.body.classList.remove("map-moving"), 120);
  });

  window.addEventListener("resize", () => state.leafletMap.invalidateSize());
  setTimeout(() => state.leafletMap.invalidateSize(), 120);
}

function applyLeafletStyle(index) {
  if (!state.leafletMap || !window.L) return;
  const style = mapTileStyles[index] || mapTileStyles[0];
  if (state.leafletTileLayer) state.leafletMap.removeLayer(state.leafletTileLayer);
  state.leafletTileLayer = L.tileLayer(style.url, {
    maxZoom: 19,
    subdomains: "abc",
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    detectRetina: false
  }).addTo(state.leafletMap);
  state.leafletTileLayer.bringToBack();

  let filterStyle = document.getElementById("leafletTileFilter");
  if (!filterStyle) {
    filterStyle = document.createElement("style");
    filterStyle.id = "leafletTileFilter";
    document.head.appendChild(filterStyle);
  }
  filterStyle.textContent = `.leaflet-tile{filter:${style.filter}!important}body.map-moving .leaflet-tile{filter:none!important}`;
}

function cycleMapStyle() {
  if (!state.leafletMap) {
    showToast("Map styles are available when Leaflet is loaded.");
    return;
  }
  state.mapStyleIndex = (state.mapStyleIndex + 1) % mapTileStyles.length;
  applyLeafletStyle(state.mapStyleIndex);
  showToast(`Map style: ${mapTileStyles[state.mapStyleIndex].name}.`);
}

function renderMap() {
  if (state.leafletMap) {
    renderLeafletMap();
    return;
  }
  if (!state.mapCanvas || !state.mapContext) return;
  scheduleMapDraw();
  if (!state.hasFittedMap && state.filtered.some(hasCoordinates)) {
    state.hasFittedMap = true;
    requestAnimationFrame(() => fitVisibleEvents({ silent: true, instant: true }));
  }
}

function renderLeafletMap() {
  const mappedEvents = state.filtered.filter(hasCoordinates);
  state.leafletLayer.clearLayers();
  state.leafletMarkers.clear();
  if (state.mapEmpty) state.mapEmpty.hidden = mappedEvents.length > 0;

  const prioritizedEvents = [...mappedEvents].sort((a, b) => b.severityScore - a.severityScore || newestFirst(a, b));
  const visibleEvents = prioritizedEvents.slice(0, LEAFLET_MARKER_LIMIT);
  const selectedEvent = mappedEvents.find((event) => event.id === state.selectedId);
  if (selectedEvent && !visibleEvents.some((event) => event.id === selectedEvent.id)) {
    visibleEvents.push(selectedEvent);
  }

  for (const event of visibleEvents) {
    const marker = createLeafletMarker(event);
    marker.addTo(state.leafletLayer);
    state.leafletMarkers.set(event.id, marker);
  }

  state.leafletMap.invalidateSize();

  if (!state.hasFittedMap && mappedEvents.length) {
    state.hasFittedMap = true;
    setTimeout(() => fitVisibleEvents({ silent: true, instant: true }), 80);
  }
}

function createLeafletMarker(event) {
  const selected = event.id === state.selectedId;
  const marker = L.circleMarker([Number(event.lat), Number(event.lon)], leafletMarkerStyle(event, selected));

  marker.__event = event;
  marker.on("click", () => {
    selectEvent(event.id, { pan: false, openPopup: false });
    openLeafletMarkerPopup(marker);
  });
  if (selected) marker.bringToFront();
  return marker;
}

function openLeafletMarkerPopup(marker) {
  if (!marker || !marker.__event) return;
  if (!marker.getPopup()) {
    marker.bindPopup(leafletPopupHtml(marker.__event), {
      className: "god-eye-popup",
      maxWidth: 310,
      autoPan: true
    });
  }
  marker.openPopup();
}

function leafletMarkerStyle(event, selected = false) {
  const color = categoryColors[event.category] || "#ffd166";
  const radius = selected ? 11 : Math.max(4, Math.min(8, 3.5 + (event.severityScore || 0) / 22));

  return {
    renderer: state.leafletRenderer,
    radius,
    color: selected ? "#ffffff" : severityColors[event.severity] || color,
    weight: selected ? 2.5 : event.severity === "critical" ? 1.8 : 1,
    opacity: selected ? 1 : 0.86,
    fillColor: color,
    fillOpacity: event.severity === "low" ? 0.58 : 0.82,
    bubblingMouseEvents: false,
    interactive: true
  };
}

function syncLeafletSelection(previousId, nextId) {
  const previousMarker = state.leafletMarkers.get(previousId);
  const nextMarker = state.leafletMarkers.get(nextId);

  if (previousMarker?.setStyle && previousMarker.__event) {
    previousMarker.setStyle(leafletMarkerStyle(previousMarker.__event, false));
  }

  if (nextMarker?.setStyle && nextMarker.__event) {
    nextMarker.setStyle(leafletMarkerStyle(nextMarker.__event, true));
    nextMarker.bringToFront();
  }
}

function leafletPopupHtml(event) {
  const rows = [
    ["Source", event.source],
    ["Severity", `${event.severity.toUpperCase()} ${event.severityScore}`],
    ["Area", event.area || "Global"],
    ["Time", formatAbsoluteTime(event.time)],
    hasCoordinates(event) ? ["Coords", `${Number(event.lat).toFixed(3)}, ${Number(event.lon).toFixed(3)}`] : null
  ].filter(Boolean);

  return `
    <div class="map-popup">
      <div class="map-popup-title">${escapeHtml(event.title)}</div>
      <div class="map-popup-summary">${escapeHtml(event.summary || "")}</div>
      ${rows
        .map(
          ([key, value]) => `
            <div class="map-popup-row">
              <span class="k">${escapeHtml(key)}</span>
              <span class="v">${escapeHtml(value)}</span>
            </div>
          `
        )
        .join("")}
      ${event.url ? `<a href="${escapeAttr(event.url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
    </div>
  `;
}

function drawCanvasMap() {
  state.mapRenderPending = false;
  if (!resizeMapCanvas()) return;

  const canvas = state.mapCanvas;
  const ctx = state.mapContext;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const metrics = mapMetrics(width, height);
  const mappedEvents = state.filtered.filter(hasCoordinates).slice(0, 1200);

  state.markers.clear();
  if (state.mapEmpty) state.mapEmpty.hidden = mappedEvents.length > 0;

  drawMapBackground(ctx, width, height, metrics);
  drawMapGrid(ctx, metrics);
  drawLandMasses(ctx, metrics);
  drawMapLabels(ctx, metrics);
  drawEventMarkers(ctx, metrics, mappedEvents);
  drawMapFrame(ctx, width, height);
}

function scheduleMapDraw() {
  if (state.mapRenderPending) return;
  state.mapRenderPending = true;
  requestAnimationFrame(drawCanvasMap);
}

function resizeMapCanvas() {
  const canvas = state.mapCanvas;
  const rect = canvas?.getBoundingClientRect();
  if (!canvas || !rect || rect.width < 10 || rect.height < 10) return false;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  state.mapContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

function mapMetrics(width, height) {
  const padding = Math.max(22, Math.min(width, height) * 0.055);
  const baseScale = Math.min((width - padding * 2) / 360, (height - padding * 2) / 170);
  const mapWidth = 360 * baseScale * state.mapView.zoom;
  const mapHeight = 170 * baseScale * state.mapView.zoom;

  return {
    width,
    height,
    padding,
    baseScale,
    mapWidth,
    mapHeight,
    originX: width / 2 - mapWidth / 2 + state.mapView.panX,
    originY: height / 2 - mapHeight / 2 + state.mapView.panY
  };
}

function drawMapBackground(ctx, width, height, metrics) {
  const ocean = ctx.createLinearGradient(0, 0, width, height);
  ocean.addColorStop(0, "#071525");
  ocean.addColorStop(0.5, "#030913");
  ocean.addColorStop(1, "#09101a");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.48, 10, width * 0.5, height * 0.48, Math.max(width, height) * 0.58);
  glow.addColorStop(0, "rgba(41, 212, 245, 0.18)");
  glow.addColorStop(1, "rgba(41, 212, 245, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  roundRectPath(ctx, metrics.originX, metrics.originY, metrics.mapWidth, metrics.mapHeight, 10);
  ctx.clip();
  const mapFill = ctx.createLinearGradient(metrics.originX, metrics.originY, metrics.originX, metrics.originY + metrics.mapHeight);
  mapFill.addColorStop(0, "#061322");
  mapFill.addColorStop(1, "#030811");
  ctx.fillStyle = mapFill;
  ctx.fillRect(metrics.originX, metrics.originY, metrics.mapWidth, metrics.mapHeight);
  ctx.restore();
}

function drawMapGrid(ctx, metrics) {
  ctx.save();
  clipMap(ctx, metrics);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(41, 212, 245, 0.15)";
  ctx.setLineDash([4, 8]);

  for (let lon = -180; lon <= 180; lon += 30) {
    const start = projectLatLon(85, lon, metrics);
    const end = projectLatLon(-85, lon, metrics);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (let lat = -60; lat <= 60; lat += 20) {
    const start = projectLatLon(lat, -180, metrics);
    const end = projectLatLon(lat, 180, metrics);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(41, 212, 245, 0.28)";
  const equatorStart = projectLatLon(0, -180, metrics);
  const equatorEnd = projectLatLon(0, 180, metrics);
  ctx.beginPath();
  ctx.moveTo(equatorStart.x, equatorStart.y);
  ctx.lineTo(equatorEnd.x, equatorEnd.y);
  ctx.stroke();
  ctx.restore();
}

function drawLandMasses(ctx, metrics) {
  ctx.save();
  clipMap(ctx, metrics);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const land of landMasses) {
    drawLandPath(ctx, land.points, metrics);
    ctx.fillStyle = land.name === "Antarctica" ? "rgba(45, 76, 98, 0.52)" : "rgba(35, 67, 92, 0.76)";
    ctx.strokeStyle = "rgba(41, 212, 245, 0.28)";
    ctx.lineWidth = Math.max(1, metrics.baseScale * state.mapView.zoom * 0.45);
    ctx.fill();
    ctx.stroke();
  }

  drawIslandDots(ctx, metrics);
  ctx.restore();
}

function drawLandPath(ctx, points, metrics) {
  ctx.beginPath();
  points.forEach(([lon, lat], index) => {
    const point = projectLatLon(lat, lon, metrics);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function drawIslandDots(ctx, metrics) {
  const islands = [
    { lat: 36, lon: 138, r: 2.4 },
    { lat: 23, lon: 121, r: 1.7 },
    { lat: 13, lon: 122, r: 2.2 },
    { lat: -2, lon: 118, r: 2.6 },
    { lat: -6, lon: 147, r: 2.2 },
    { lat: 21, lon: -78, r: 2 },
    { lat: 18, lon: -66, r: 1.6 },
    { lat: 65, lon: -19, r: 2 },
    { lat: 55, lon: -4, r: 2.2 },
    { lat: 41, lon: 29, r: 1.6 },
    { lat: 7, lon: 81, r: 1.8 },
    { lat: -20, lon: 47, r: 2.4 }
  ];

  ctx.fillStyle = "rgba(35, 67, 92, 0.78)";
  ctx.strokeStyle = "rgba(41, 212, 245, 0.24)";
  for (const island of islands) {
    const point = projectLatLon(island.lat, island.lon, metrics);
    const radius = Math.max(1.2, island.r * metrics.baseScale * state.mapView.zoom * 0.34);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawMapLabels(ctx, metrics) {
  ctx.save();
  clipMap(ctx, metrics);
  ctx.font = `800 ${Math.max(10, Math.min(18, metrics.baseScale * state.mapView.zoom * 2.7))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const label of mapLabels) {
    const point = projectLatLon(label.lat, label.lon, metrics);
    ctx.fillStyle = label.text.includes("Ocean") || label.text === "Pacific" || label.text === "Atlantic"
      ? "rgba(41, 212, 245, 0.18)"
      : "rgba(232, 244, 255, 0.22)";
    ctx.fillText(label.text.toUpperCase(), point.x, point.y);
  }

  ctx.restore();
}

function drawEventMarkers(ctx, metrics, events) {
  const labels = [...events].sort((a, b) => b.severityScore - a.severityScore || newestFirst(a, b)).slice(0, 180);
  const labelledIds = new Set(labels.map((event) => event.id));

  ctx.save();
  clipMap(ctx, metrics);

  for (const event of events) {
    const point = eventCanvasPoint(event, metrics);
    const color = categoryColors[event.category] || "#ffd166";
    const selected = event.id === state.selectedId;
    const radius = selected ? 9 : Math.max(4, Math.min(8, 3 + event.severityScore / 18));

    ctx.globalAlpha = event.severity === "low" ? 0.68 : 0.9;
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? "#ffffff" : severityColors[event.severity] || color;
    ctx.lineWidth = selected ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (event.severity === "critical" || selected) {
      ctx.globalAlpha = selected ? 0.34 : 0.2;
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 5 : 3;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + (selected ? 8 : 5), 0, Math.PI * 2);
      ctx.stroke();
    }

    state.markers.set(event.id, {
      event,
      x: point.x,
      y: point.y,
      radius: labelledIds.has(event.id) ? 14 : radius + 5
    });
  }

  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 9px Inter, system-ui, sans-serif";

  for (const event of labels) {
    const marker = state.markers.get(event.id);
    if (!marker) continue;
    const color = categoryColors[event.category] || "#ffd166";
    const label = mapIconLabels[event.category] || "EV";
    const boxWidth = 26;
    const boxHeight = 16;
    const x = marker.x + 12;
    const y = marker.y - 11;

    ctx.fillStyle = "rgba(9, 13, 12, 0.76)";
    roundRectPath(ctx, x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, 8);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + 0.5);
  }

  ctx.restore();
}

function eventCanvasPoint(event, metrics) {
  const point = projectLatLon(Number(event.lat), Number(event.lon), metrics);
  const jitter = markerJitter(event.id);
  return {
    x: point.x + jitter.x * Math.max(1, Math.min(2.2, state.mapView.zoom)),
    y: point.y + jitter.y * Math.max(1, Math.min(2.2, state.mapView.zoom))
  };
}

function drawMapFrame(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(41, 212, 245, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.restore();
}

function projectLatLon(lat, lon, metrics) {
  const clampedLat = Math.max(-85, Math.min(85, Number(lat)));
  const clampedLon = Math.max(-180, Math.min(180, Number(lon)));
  return {
    x: metrics.originX + ((clampedLon + 180) / 360) * metrics.mapWidth,
    y: metrics.originY + ((85 - clampedLat) / 170) * metrics.mapHeight
  };
}

function canvasToLatLon(x, y) {
  const rect = state.mapCanvas.getBoundingClientRect();
  const metrics = mapMetrics(rect.width, rect.height);
  return {
    lon: ((x - metrics.originX) / metrics.mapWidth) * 360 - 180,
    lat: 85 - ((y - metrics.originY) / metrics.mapHeight) * 170
  };
}

function clipMap(ctx, metrics) {
  roundRectPath(ctx, metrics.originX, metrics.originY, metrics.mapWidth, metrics.mapHeight, 10);
  ctx.clip();
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function markerJitter(id) {
  let hash = 0;
  for (const char of String(id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const angle = (hash % 360) * (Math.PI / 180);
  const radius = ((hash % 7) / 7) * 2.1;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function bindCanvasMapEvents() {
  const canvas = state.mapCanvas;
  if (!canvas) return;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    state.mapDragging = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: state.mapView.panX,
      panY: state.mapView.panY,
      moved: false
    };
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerPoint(event);
    updateCoordBar(point.x, point.y);
    if (state.mapDragging) {
      const dx = event.clientX - state.mapDragging.x;
      const dy = event.clientY - state.mapDragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.mapDragging.moved = true;
      state.mapView.panX = state.mapDragging.panX + dx;
      state.mapView.panY = state.mapDragging.panY + dy;
      scheduleMapDraw();
      return;
    }
    updateMapHover(point.x, point.y);
  });

  canvas.addEventListener("pointerup", (event) => {
    const point = pointerPoint(event);
    const dragged = state.mapDragging?.moved;
    state.mapDragging = null;
    if (!dragged) {
      const marker = nearestMarker(point.x, point.y);
      if (marker) selectEvent(marker.event.id, { pan: false });
    }
  });

  canvas.addEventListener("pointerleave", () => {
    state.mapDragging = null;
    hideMapTooltip();
    setText("coord-bar", "Hover the map for coordinates");
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = pointerPoint(event);
      zoomMapAt(point.x, point.y, event.deltaY < 0 ? 1.16 : 0.86);
    },
    { passive: false }
  );

  canvas.addEventListener("dblclick", (event) => {
    const point = pointerPoint(event);
    zoomMapAt(point.x, point.y, 1.45);
  });
}

function pointerPoint(event) {
  const rect = state.mapCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function zoomMapAt(x, y, factor) {
  const before = canvasToLatLon(x, y);
  state.mapView.zoom = Math.max(0.8, Math.min(8, state.mapView.zoom * factor));
  const rect = state.mapCanvas.getBoundingClientRect();
  const metrics = mapMetrics(rect.width, rect.height);
  const after = projectLatLon(before.lat, before.lon, metrics);
  state.mapView.panX += x - after.x;
  state.mapView.panY += y - after.y;
  scheduleMapDraw();
}

function zoomMapFromCenter(factor) {
  if (!state.mapCanvas) return;
  const rect = state.mapCanvas.getBoundingClientRect();
  zoomMapAt(rect.width / 2, rect.height / 2, factor);
}

function updateCoordBar(x, y) {
  if (!state.mapCanvas) return;
  const coords = canvasToLatLon(x, y);
  const lat = Math.max(-85, Math.min(85, coords.lat));
  const lon = Math.max(-180, Math.min(180, coords.lon));
  const latSuffix = lat >= 0 ? "N" : "S";
  const lonSuffix = lon >= 0 ? "E" : "W";
  setText("coord-bar", `${Math.abs(lat).toFixed(3)} ${latSuffix} / ${Math.abs(lon).toFixed(3)} ${lonSuffix}`);
}

function updateMapHover(x, y) {
  const marker = nearestMarker(x, y);
  if (!marker) {
    hideMapTooltip();
    return;
  }

  const event = marker.event;
  state.mapCanvas.style.cursor = "pointer";
  state.mapTooltip.hidden = false;
  state.mapTooltip.innerHTML = `
    <strong>${escapeHtml(event.title)}</strong>
    <span>${escapeHtml(labelForCategory(event.category))} - ${escapeHtml(event.severity.toUpperCase())} ${
      event.severityScore
    }</span>
    <small>${escapeHtml(event.area || "Global")} - ${formatRelativeTime(event.time)}</small>
  `;
  state.mapTooltip.style.left = `${Math.min(x + 16, state.map.clientWidth - 260)}px`;
  state.mapTooltip.style.top = `${Math.max(12, y - 18)}px`;
}

function hideMapTooltip() {
  if (state.mapTooltip) state.mapTooltip.hidden = true;
  if (state.mapCanvas) state.mapCanvas.style.cursor = "grab";
}

function nearestMarker(x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const marker of state.markers.values()) {
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (distance <= marker.radius && distance < bestDistance) {
      best = marker;
      bestDistance = distance;
    }
  }
  return best;
}

function setMapViewForEvents(events, options = {}) {
  if (!state.mapCanvas || !events.length) return;
  const rect = state.mapCanvas.getBoundingClientRect();
  const padding = Math.max(22, Math.min(rect.width, rect.height) * 0.055);
  const baseScale = Math.min((rect.width - padding * 2) / 360, (rect.height - padding * 2) / 170);
  const lats = events.map((event) => Number(event.lat));
  const lons = events.map((event) => Number(event.lon));
  const minLat = Math.max(-85, Math.min(...lats));
  const maxLat = Math.min(85, Math.max(...lats));
  const minLon = Math.max(-180, Math.min(...lons));
  const maxLon = Math.min(180, Math.max(...lons));
  const latSpan = Math.max(8, maxLat - minLat);
  const lonSpan = Math.max(10, maxLon - minLon);
  const zoomX = (rect.width * 0.78) / (baseScale * lonSpan);
  const zoomY = (rect.height * 0.78) / (baseScale * latSpan);
  const zoom = Math.max(0.9, Math.min(options.maxZoom || 5.2, zoomX, zoomY));
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  state.mapView.zoom = options.instant ? zoom : zoom;
  const metrics = mapMetrics(rect.width, rect.height);
  const center = projectLatLon(centerLat, centerLon, metrics);
  state.mapView.panX += rect.width / 2 - center.x;
  state.mapView.panY += rect.height / 2 - center.y;
  scheduleMapDraw();
}

function fitVisibleEvents(options = {}) {
  const mappedEvents = state.filtered.filter(hasCoordinates);
  if (!mappedEvents.length) {
    resetMapView();
    if (!options.silent) showToast("No mapped events are visible.");
    return;
  }

  if (state.leafletMap && window.L) {
    const points = mappedEvents.map((event) => [Number(event.lat), Number(event.lon)]);
    if (points.length === 1) {
      state.leafletMap.flyTo(points[0], options.maxZoom || 6, { animate: !options.instant, duration: 1.1 });
    } else {
      state.leafletMap.fitBounds(L.latLngBounds(points), {
        padding: [86, 86],
        maxZoom: options.maxZoom || 6,
        animate: !options.instant,
        duration: 1
      });
    }
    if (!options.silent) showToast("Map fitted to visible events.");
    return;
  }

  setMapViewForEvents(mappedEvents, { maxZoom: options.maxZoom || 5, instant: options.instant });
  if (!options.silent) showToast("Map fitted to visible events.");
}

function focusHighestPriority() {
  const event = state.filtered.filter(hasCoordinates).sort((a, b) => b.severityScore - a.severityScore || newestFirst(a, b))[0];
  if (!event) {
    showToast("No mapped priority item is visible.");
    return;
  }
  selectEvent(event.id, { pan: true, zoom: 5 });
}

function selectEvent(id, options = {}) {
  const previousId = state.selectedId;
  state.selectedId = id;
  const event = state.events.find((item) => item.id === id);
  renderEventList();
  renderSelectedEvent();

  if (state.leafletMap) {
    if (event && hasCoordinates(event) && !state.leafletMarkers.has(id)) {
      renderLeafletMap();
    } else {
      syncLeafletSelection(previousId, id);
    }
    const marker = state.leafletMarkers.get(id);
    if (options.pan && event && hasCoordinates(event)) {
      state.leafletMap.flyTo([Number(event.lat), Number(event.lon)], options.zoom || 6, { duration: 1.1 });
    }
    if (marker && options.openPopup !== false) {
      setTimeout(() => openLeafletMarkerPopup(marker), options.pan ? 700 : 0);
    }
    renderIcons();
    return;
  }

  if (options.pan && event && hasCoordinates(event)) {
    setMapViewForEvents([event], { maxZoom: options.zoom || 5.8, instant: true });
  } else {
    renderMap();
  }

  renderIcons();
}

function resetMapView() {
  if (state.leafletMap) {
    state.leafletMap.flyTo([20, 10], 3, { duration: 1.1 });
    return;
  }

  state.mapView.zoom = 1;
  state.mapView.panX = 0;
  state.mapView.panY = 0;
  scheduleMapDraw();
}

function queueMapResize() {
  clearTimeout(state.mapResizeTimer);
  state.mapResizeTimer = setTimeout(renderMap, 80);
}

function renderCategoryToggles() {
  els.categoryToggles.innerHTML = categories
    .map(
      (category) => `
        <button class="category-toggle active"
          type="button"
          data-category="${category}"
          style="--category-color:${categoryColors[category] || "#ffd166"}">
          <span class="category-dot"></span>
          <span>${categoryLabels[category] || category}</span>
        </button>
      `
    )
    .join("");

  els.categoryToggles.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.category;
      if (state.selectedCategories.has(category)) {
        state.selectedCategories.delete(category);
      } else {
        state.selectedCategories.add(category);
      }
      button.classList.toggle("active", state.selectedCategories.has(category));
      applyFilters();
    });
  });
}

function renderLegend() {
  const legendCategories = ["earthquake", "wildfire", "storm", "flood", "geopolitical", "military", "weather", "news"];
  els.mapLegend.innerHTML = legendCategories
    .map(
      (category) => `
      <span class="legend-chip">
        <span class="category-dot" style="--category-color:${categoryColors[category]}"></span>
        ${categoryLabels[category]}
      </span>
    `
    )
    .join("");
}

function resetFilters() {
  clearTimeout(state.searchDebounce);
  state.selectedCategories = new Set(categories);
  state.severity = "all";
  state.sort = "priority";
  state.search = "";
  state.mappedOnly = false;
  els.searchInput.value = "";
  els.severitySelect.value = "all";
  els.sortSelect.value = "priority";
  els.mappedOnly.checked = false;
  els.categoryToggles.querySelectorAll("[data-category]").forEach((button) => button.classList.add("active"));
  applyFilters();
  showToast("Filters reset.");
}

function scheduleNextRefresh() {
  clearTimeout(state.refreshTimer);
  if (!state.autoRefresh) {
    state.nextRefreshAt = null;
    els.nextRefresh.textContent = "Paused";
    return;
  }
  state.nextRefreshAt = Date.now() + 5 * 60 * 1000;
  state.refreshTimer = setTimeout(() => refreshData(), 5 * 60 * 1000);
}

function startCountdown() {
  clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (!state.autoRefresh || !state.nextRefreshAt) return;
    const remaining = Math.max(0, state.nextRefreshAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    els.nextRefresh.textContent = `Next in ${minutes}:${String(seconds).padStart(2, "0")}`;
  }, 1000);
}

function exportCsv() {
  const rows = [
    ["title", "category", "severity", "score", "source", "time", "area", "lat", "lon", "url"],
    ...state.filtered.map((event) => [
      event.title,
      event.category,
      event.severity,
      event.severityScore,
      event.source,
      event.time,
      event.area,
      event.lat ?? "",
      event.lon ?? "",
      event.url ?? ""
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `god-eyes-osint-${state.range}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyBrief() {
  const brief = buildBrief(state.filtered);
  const text = [
    "GOD EYES OSINT Brief",
    `Updated: ${state.lastPayload?.refreshedAt || new Date().toISOString()}`,
    "",
    ...brief.overview.map((line) => `- ${line}`),
    "",
    "Priority Watchlist:",
    ...brief.watchlist.map((event) => `- ${event.title} | ${event.area} | ${event.severity}`)
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    showToast("Brief copied.");
  } catch {
    showToast("Clipboard is unavailable in this browser.");
  }
}

function buildHotspots(events) {
  const buckets = new Map();
  for (const event of events) {
    const name = normalizeArea(event.area);
    if (!name) continue;
    const existing = buckets.get(name) || { name, count: 0, maxSeverity: 0, categories: new Set() };
    existing.count += 1;
    existing.maxSeverity = Math.max(existing.maxSeverity, event.severityScore);
    existing.categories.add(event.category);
    buckets.set(name, existing);
  }

  return [...buckets.values()]
    .map((hotspot) => ({
      ...hotspot,
      categories: [...hotspot.categories],
      score: hotspot.count * 8 + hotspot.maxSeverity
    }))
    .sort((a, b) => b.score - a.score);
}

function normalizeArea(area = "") {
  return String(area)
    .replace(/\b\d+\s*(km|mi|miles|kilometers)\b/gi, "")
    .split(/\sof\s/i)
    .at(-1)
    .split(",")
    .slice(-2)
    .join(",")
    .trim();
}

function setLiveStatus(status, label) {
  els.liveStatus.classList.toggle("online", status === "online");
  els.liveStatus.classList.toggle("warning", status === "warning");
  els.liveStatus.classList.toggle("error", status === "error");
  els.liveStatus.querySelector("span:last-child").textContent = label;
}

function hasSourceFailures() {
  return state.sourceHealth.some((source) => !source.ok);
}

function liveStatusForSources() {
  const liveCount = state.sourceHealth.filter((source) => source.ok).length;
  const total = state.sourceHealth.length;
  if (!total || !liveCount) return ["error", "Offline"];
  if (liveCount === total) return ["online", "Live"];
  if (liveCount >= Math.max(2, total - 1)) return ["warning", "Live + Retry"];
  return ["warning", "Partial Live"];
}

function hasCoordinates(event) {
  const lat = Number(event.lat);
  const lon = Number(event.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return false;
  return !(lat === 0 && lon === 0);
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function entriesByCount(object) {
  return Object.entries(object).sort((a, b) => b[1] - a[1]);
}

function labelForCategory(category) {
  return categoryLabels[category] || category.replace(/-/g, " ");
}

function categoryBadge(event) {
  return `<span class="category-badge">${escapeHtml(labelForCategory(event.category))}</span>`;
}

function severityBadge(event) {
  return `<span class="severity-badge">${escapeHtml(event.severity)} ${event.severityScore}</span>`;
}

function styleVars(event) {
  return `--category-color:${categoryColors[event.category] || "#ffd166"};--severity-color:${
    severityColors[event.severity] || "#f4cf5d"
  };`;
}

function formatRelativeTime(value) {
  if (!value) return "time unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unknown";
  const delta = date.getTime() - Date.now();
  const abs = Math.abs(delta);
  const units = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000]
  ];

  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      const value = Math.round(delta / ms);
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
    }
  }
  return "just now";
}

function formatAbsoluteTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}


