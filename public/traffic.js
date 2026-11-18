const trafficState = {
  region: "global",
  contacts: [],
  selectedId: null,
  sourceHealth: [],
  map: null,
  renderer: null,
  tileLayer: null,
  styleIndex: 0,
  layers: {},
  markers: new Map(),
  movingTimer: null,
  refreshTimer: null
};

const trafficStyles = [
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

const typeColors = {
  civil: "#29d4f5",
  military: "#f0c030"
};

const layerLimits = {
  civil: 650,
  military: 450
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  initClock();
  initMap();
  bindEvents();
  refreshAll();
  trafficState.refreshTimer = setInterval(refreshAll, 5 * 60_000);
});

function bindElements() {
  [
    "civilCount",
    "milCount",
    "regionSelect",
    "refreshBtn",
    "civilStatus",
    "milStatus",
    "civilToggle",
    "milToggle",
    "contactList",
    "contactCount",
    "syncStatus",
    "trafficTitle",
    "mappedCount",
    "styleName",
    "sourceCount",
    "lastSync",
    "selectedContact",
    "sourceHealth",
    "fitBtn",
    "styleBtn",
    "zoomInBtn",
    "zoomOutBtn",
    "fitMapBtn",
    "coordBar",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshAll);
  els.regionSelect.addEventListener("change", () => {
    trafficState.region = els.regionSelect.value;
    trafficState.selectedId = null;
    refreshAll();
  });

  [els.civilToggle, els.milToggle].forEach((toggle) => {
    toggle.addEventListener("change", render);
  });

  els.fitBtn.addEventListener("click", fitMap);
  els.fitMapBtn.addEventListener("click", fitMap);
  els.styleBtn.addEventListener("click", cycleStyle);
  els.zoomInBtn.addEventListener("click", () => trafficState.map?.zoomIn(0.5));
  els.zoomOutBtn.addEventListener("click", () => trafficState.map?.zoomOut(0.5));
}

function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  setText("clk-time", `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`);
  setText(
    "clk-date",
    `${now.toLocaleDateString("en", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).toUpperCase()} UTC`
  );
}

function initMap() {
  if (!window.L) {
    showToast("Map library unavailable. Traffic data panels will still load.");
    return;
  }

  trafficState.renderer = L.canvas({ padding: 0.35, tolerance: 8 });
  trafficState.map = L.map("map", {
    center: [20, 10],
    zoom: 3,
    minZoom: 2,
    maxZoom: 14,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    renderer: trafficState.renderer,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    fadeAnimation: false,
    markerZoomAnimation: false
  });

  applyStyle(0);
  trafficState.layers.civil = L.layerGroup().addTo(trafficState.map);
  trafficState.layers.military = L.layerGroup().addTo(trafficState.map);

  trafficState.map.on("mousemove", (event) => {
    const lat = event.latlng.lat;
    const lon = event.latlng.lng;
    setText(
      "coordBar",
      `${Math.abs(lat).toFixed(3)} ${lat >= 0 ? "N" : "S"} / ${Math.abs(lon).toFixed(3)} ${lon >= 0 ? "E" : "W"}`
    );
  });
  trafficState.map.on("mouseout", () => setText("coordBar", "Hover the map for coordinates"));
  trafficState.map.on("movestart zoomstart", () => {
    clearTimeout(trafficState.movingTimer);
    document.body.classList.add("map-moving");
  });
  trafficState.map.on("moveend zoomend", () => {
    clearTimeout(trafficState.movingTimer);
    trafficState.movingTimer = setTimeout(() => document.body.classList.remove("map-moving"), 120);
  });

  setTimeout(() => trafficState.map.invalidateSize(), 120);
}

function applyStyle(index) {
  if (!trafficState.map || !window.L) return;
  const style = trafficStyles[index] || trafficStyles[0];
  if (trafficState.tileLayer) trafficState.map.removeLayer(trafficState.tileLayer);
  trafficState.tileLayer = L.tileLayer(style.url, {
    maxZoom: 19,
    subdomains: "abc",
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    detectRetina: false
  }).addTo(trafficState.map);
  trafficState.tileLayer.bringToBack();

  let filterStyle = document.getElementById("trafficTileFilter");
  if (!filterStyle) {
    filterStyle = document.createElement("style");
    filterStyle.id = "trafficTileFilter";
    document.head.appendChild(filterStyle);
  }
  filterStyle.textContent = `.leaflet-tile{filter:${style.filter}!important}body.map-moving .leaflet-tile{filter:none!important}`;
  setText("styleName", style.name);
}

function cycleStyle() {
  trafficState.styleIndex = (trafficState.styleIndex + 1) % trafficStyles.length;
  applyStyle(trafficState.styleIndex);
}

async function refreshAll() {
  setText("syncStatus", "Loading");
  const [flights, military] = await Promise.all([fetchTraffic("flights"), fetchTraffic("military")]);
  const contacts = [];

  if (flights.ok) contacts.push(...flights.aircraft.map((item) => ({ ...item, type: "civil" })));
  if (military.ok) contacts.push(...military.aircraft.map((item) => ({ ...item, type: "military" })));

  trafficState.contacts = contacts;
  trafficState.sourceHealth = [
    healthFromPayload("Civil Aircraft", flights),
    healthFromPayload("Military Aviation", military)
  ];
  render();
  setText("syncStatus", "Live");
  showToast("Traffic refreshed.");
}

async function fetchTraffic(kind) {
  try {
    const response = await fetch(`/api/traffic/${kind}?region=${encodeURIComponent(trafficState.region)}&t=${Date.now()}`);
    return await response.json();
  } catch (error) {
    return { ok: false, kind, count: 0, aircraft: [], error: error.message };
  }
}

function healthFromPayload(name, payload) {
  return {
    name,
    ok: !!payload.ok,
    count: payload.count || 0,
    source: payload.source || name,
    error: payload.error || null,
    requiresKey: payload.requiresKey || false,
    refreshedAt: payload.refreshedAt || new Date().toISOString()
  };
}

function render() {
  renderCounts();
  renderSourceHealth();
  renderContacts();
  renderMap();
  renderSelected();
}

function renderCounts() {
  const civil = trafficState.contacts.filter((contact) => contact.type === "civil").length;
  const military = trafficState.contacts.filter((contact) => contact.type === "military").length;
  const shown = visibleContacts();
  const healthy = trafficState.sourceHealth.filter((source) => source.ok).length;

  setText("civilCount", formatNumber(civil));
  setText("milCount", formatNumber(military));
  setText("contactCount", `${formatNumber(shown.length)} shown`);
  setText("mappedCount", formatNumber(shown.length));
  setText("sourceCount", `${healthy}/2`);
  setText("trafficTitle", `${formatNumber(shown.length)} live contacts mapped`);
  setText("lastSync", formatRelativeTime(new Date().toISOString()));

  setText("civilStatus", sourceStatusText("Civil Aircraft"));
  setText("milStatus", sourceStatusText("Military Aviation"));
}

function sourceStatusText(name) {
  const source = trafficState.sourceHealth.find((item) => item.name === name);
  if (!source) return "Waiting";
  if (source.ok) return `${source.count} contacts`;
  if (source.requiresKey) return "Key required";
  return source.error || "Offline";
}

function visibleContacts() {
  return trafficState.contacts.filter((contact) => {
    if (contact.type === "civil") return els.civilToggle.checked;
    if (contact.type === "military") return els.milToggle.checked;
    return true;
  });
}

function renderSourceHealth() {
  els.sourceHealth.innerHTML = trafficState.sourceHealth
    .map(
      (source) => `
        <div class="source-row">
          <span>${escapeHtml(source.name)}</span>
          <span>${source.ok ? `${formatNumber(source.count)} contacts` : escapeHtml(source.error || "Offline")}</span>
        </div>
      `
    )
    .join("");
}

function renderContacts() {
  const contacts = visibleContacts().sort(sortContacts).slice(0, 140);
  els.contactList.innerHTML = contacts.length
    ? contacts.map(contactCardHtml).join("")
    : `<div class="empty-state">No visible contacts in this region.</div>`;

  els.contactList.querySelectorAll("[data-contact-id]").forEach((button) => {
    button.addEventListener("click", () => selectContact(button.dataset.contactId, { pan: true }));
  });
}

function contactCardHtml(contact) {
  const accent = typeColors[contact.type] || "#29d4f5";
  return `
    <button class="contact-card ${contact.id === trafficState.selectedId ? "selected" : ""}"
      type="button"
      data-contact-id="${escapeAttr(contact.id)}"
      style="--accent:${accent}">
      <strong>${escapeHtml(contact.label || contact.callsign || contact.mmsi || contact.hex || "Contact")}</strong>
      <span>${escapeHtml(typeLabel(contact.type))} - ${escapeHtml(contact.category || "Unknown")}</span>
      <small>${contact.speedKnots ?? "-"} kt - ${contact.altitudeFeet ?? "-"} ft - ${formatRelativeTime(contact.lastSeen)}</small>
    </button>
  `;
}

function renderMap() {
  if (!trafficState.map) return;
  for (const layer of Object.values(trafficState.layers)) layer.clearLayers();
  trafficState.markers.clear();

  const byType = { civil: 0, military: 0 };
  for (const contact of visibleContacts().sort(sortContacts)) {
    if (byType[contact.type] >= (layerLimits[contact.type] || 400)) continue;
    byType[contact.type] += 1;
    const marker = createMarker(contact);
    marker.addTo(trafficState.layers[contact.type]);
    trafficState.markers.set(contact.id, marker);
  }
}

function createMarker(contact) {
  const selected = contact.id === trafficState.selectedId;
  const marker = L.circleMarker([Number(contact.lat), Number(contact.lon)], {
    renderer: trafficState.renderer,
    radius: selected ? 10 : 6,
    color: selected ? "#ffffff" : typeColors[contact.type],
    weight: selected ? 2.5 : 1.2,
    opacity: 0.9,
    fillColor: typeColors[contact.type],
    fillOpacity: 0.82,
    bubblingMouseEvents: false
  });
  marker.__contact = contact;
  marker.on("click", () => {
    selectContact(contact.id, { pan: false, openPopup: false });
    openPopup(marker);
  });
  return marker;
}

function selectContact(id, options = {}) {
  trafficState.selectedId = id;
  const contact = trafficState.contacts.find((item) => item.id === id);
  renderContacts();
  renderSelected();
  renderMap();

  const marker = trafficState.markers.get(id);
  if (contact && trafficState.map && options.pan) {
    trafficState.map.flyTo([Number(contact.lat), Number(contact.lon)], 6, { duration: 1 });
  }
  if (marker && options.openPopup !== false) {
    setTimeout(() => openPopup(marker), options.pan ? 650 : 0);
  }
}

function openPopup(marker) {
  if (!marker?.__contact) return;
  if (!marker.getPopup()) {
    marker.bindPopup(popupHtml(marker.__contact), { className: "traffic-popup", maxWidth: 280, autoPan: true });
  }
  marker.openPopup();
}

function popupHtml(contact) {
  return `
    <div>
      <div class="popup-title">${escapeHtml(contact.label || contact.callsign || contact.mmsi || "Contact")}</div>
      <div class="popup-meta">${escapeHtml(typeLabel(contact.type))} - ${escapeHtml(contact.source || "Live source")}</div>
      <div class="popup-meta">${Number(contact.lat).toFixed(3)}, ${Number(contact.lon).toFixed(3)}</div>
    </div>
  `;
}

function renderSelected() {
  const contact = trafficState.contacts.find((item) => item.id === trafficState.selectedId);
  if (!contact) {
    els.selectedContact.className = "empty-state";
    els.selectedContact.textContent = "Select an aircraft or feed item.";
    return;
  }

  els.selectedContact.className = "selected-grid";
  const rows = [
    ["Type", typeLabel(contact.type)],
    ["Label", contact.label || contact.callsign || contact.mmsi || contact.hex],
    ["Category", contact.category || "Unknown"],
    ["Source", contact.source || "Live source"],
    ["Speed", contact.speedKnots === null || contact.speedKnots === undefined ? "Unknown" : `${contact.speedKnots} kt`],
    ["Altitude", contact.altitudeFeet === null || contact.altitudeFeet === undefined ? "Unknown" : `${contact.altitudeFeet} ft`],
    ["Track", contact.track === null || contact.track === undefined ? "Unknown" : `${Math.round(contact.track)} deg`],
    ["Coords", `${Number(contact.lat).toFixed(4)}, ${Number(contact.lon).toFixed(4)}`],
    ["Last Seen", formatRelativeTime(contact.lastSeen)]
  ];

  els.selectedContact.innerHTML = rows
    .map(
      ([key, value]) => `
        <div class="detail-row">
          <span>${escapeHtml(key)}</span>
          <span>${escapeHtml(value ?? "Unknown")}</span>
        </div>
      `
    )
    .join("");
}

function fitMap() {
  if (!trafficState.map) return;
  const points = visibleContacts().map((contact) => [Number(contact.lat), Number(contact.lon)]);
  if (!points.length) {
    trafficState.map.flyTo([20, 10], 3, { duration: 1 });
    return;
  }
  trafficState.map.fitBounds(L.latLngBounds(points), { padding: [72, 72], maxZoom: 7, duration: 1 });
}

function sortContacts(a, b) {
  const typeRank = { military: 0, civil: 1 };
  return (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9) || (b.speedKnots || 0) - (a.speedKnots || 0);
}

function typeLabel(type) {
  return {
    civil: "Civil aircraft",
    military: "Military aviation"
  }[type] || type;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatRelativeTime(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const delta = date.getTime() - Date.now();
  const abs = Math.abs(delta);
  const units = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000]
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(delta / ms), unit);
    }
  }
  return "just now";
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
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3000);
}
