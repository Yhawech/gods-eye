const els = {};
const state = {
  health: null,
  trends: null,
  reports: [],
  latestReport: null,
  toastTimer: null,
  reportSearchTimer: null
};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initClock();
  seedChat();
  refreshAll();
  setInterval(refreshAll, 5 * 60 * 1000);
});

function bindElements() {
  [
    "refreshBtn",
    "totalEvents",
    "highPriority",
    "reportCount",
    "aiEngine",
    "backendStatus",
    "incidentForm",
    "incidentInput",
    "reportDays",
    "reportTemplate",
    "reportLabel",
    "reportMeta",
    "reportSummary",
    "reportPreview",
    "reportPdfBtn",
    "sourceStatus",
    "categoryBars",
    "timeline",
    "dashboardAnalytics",
    "sourceCredibility",
    "duplicateGroups",
    "mapIntel",
    "topEvents",
    "hotspots",
    "reportSearch",
    "libraryTemplate",
    "reportHistory",
    "reportBtn",
    "chatLog",
    "chatForm",
    "chatInput",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshAll);
  els.incidentForm.addEventListener("submit", generateIncidentReport);
  els.chatForm.addEventListener("submit", sendChat);
  els.reportBtn.addEventListener("click", generateSituationReport);
  els.reportPdfBtn.addEventListener("click", downloadLatestReportPdf);
  els.reportHistory.addEventListener("click", handleReportHistoryClick);
  els.reportSearch.addEventListener("input", queueReportLibraryRefresh);
  els.libraryTemplate.addEventListener("change", refreshReportsAndMetrics);
}

function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  document.getElementById("clk-time").textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  document.getElementById("clk-date").textContent = `${now
    .toLocaleDateString("en", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" })
    .toUpperCase()} UTC`;
}

function seedChat() {
  appendChat(
    "assistant",
    "GOD EYE v2 analyst online. Ask for military updates, geopolitical hotspots, economic impact, cyber incidents, energy risk, or a saved incident brief."
  );
}

async function refreshAll() {
  setText("backendStatus", "Syncing");
  try {
    await getJson("/api/events?range=7d").catch((error) => {
      showToast(`Live feed sync skipped: ${error.message}`);
      return null;
    });
    const [health, trends, reports] = await Promise.all([
      getJson("/api/v2/health"),
      getJson("/api/v2/trends?days=30"),
      getJson(reportHistoryUrl())
    ]);
    state.health = health;
    state.trends = trends;
    state.reports = reports.items || [];
    renderAll();
    setText("backendStatus", "FastAPI");
    showToast("v2 intelligence refreshed.");
  } catch (error) {
    setText("backendStatus", "Offline");
    showToast(error.message || "Refresh failed.");
  }
}

async function refreshReportsAndMetrics() {
  const [trends, reports] = await Promise.all([
    getJson("/api/v2/trends?days=30"),
    getJson(reportHistoryUrl())
  ]);
  state.trends = trends;
  state.reports = reports.items || [];
  renderMetrics();
  renderReportHistory();
}

function reportHistoryUrl() {
  const params = new URLSearchParams({ limit: "40" });
  const query = els.reportSearch?.value?.trim();
  const template = els.libraryTemplate?.value || "";
  if (query) params.set("q", query);
  if (template) params.set("template", template);
  return `/api/v2/reports/history?${params.toString()}`;
}

function queueReportLibraryRefresh() {
  clearTimeout(state.reportSearchTimer);
  state.reportSearchTimer = setTimeout(refreshReportsAndMetrics, 250);
}

async function generateIncidentReport(event) {
  event.preventDefault();
  const focus = els.incidentInput.value.trim();
  const days = Number(els.reportDays.value || 7);
  const template = els.reportTemplate.value || "executive";

  els.incidentInput.disabled = true;
  els.reportDays.disabled = true;
  els.reportTemplate.disabled = true;
  try {
    const result = await postJson("/api/v2/report", { focus, days, template });
    renderReport(result);
    els.incidentInput.value = "";
    await refreshReportsAndMetrics();
    showToast(`Analyst report #${result.id} saved.`);
  } catch (error) {
    showToast(error.message || "Report failed.");
  } finally {
    els.incidentInput.disabled = false;
    els.reportDays.disabled = false;
    els.reportTemplate.disabled = false;
    els.incidentInput.focus();
  }
}

async function generateSituationReport() {
  try {
    const template = els.reportTemplate.value || "executive";
    const result = await getJson(`/api/v2/report?days=7&template=${encodeURIComponent(template)}`);
    renderReport(result);
    appendChat("assistant", `${result.report}\n\nSaved as analyst report #${result.id}.`);
    await refreshReportsAndMetrics();
    showToast(`Situation report #${result.id} saved.`);
  } catch (error) {
    showToast(error.message || "Report failed.");
  }
}

async function sendChat(event) {
  event.preventDefault();
  const message = els.chatInput.value.trim();
  if (!message) return;

  els.chatInput.value = "";
  appendChat("user", message);
  appendChat("assistant", "Analyzing open-source context...");
  const pending = els.chatLog.lastElementChild;

  try {
    const result = await postJson("/api/v2/chat", { message });
    pending.textContent = result.reply || "No reply generated.";
    if (result.reportId) {
      renderReport({
        id: result.reportId,
        days: 30,
        focus: message,
        report: result.report,
        template: result.template || "executive",
        templateLabel: result.templateLabel || "Executive Brief",
        ai: result.ai || {}
      });
      await refreshReportsAndMetrics();
    }
  } catch (error) {
    pending.textContent = error.message || "Analyst request failed.";
  }
}

function handleReportHistoryClick(event) {
  const pdfButton = event.target.closest("[data-report-pdf-id]");
  if (pdfButton) {
    downloadReportPdf(pdfButton.dataset.reportPdfId);
    return;
  }
  showSavedReport(event);
}

function showSavedReport(event) {
  const button = event.target.closest("[data-report-id]");
  if (!button) return;
  const report = state.reports.find((item) => String(item.id) === button.dataset.reportId);
  if (!report) return;
  renderReport({
    id: report.id,
    days: report.days,
    focus: report.focus,
    report: report.report,
    template: report.template,
    templateLabel: report.templateLabel,
    ai: { provider: report.aiProvider || "Stored", model: report.model || "unknown" }
  });
}

function renderAll() {
  renderMetrics();
  renderSourceStatus();
  renderCategoryBars();
  renderTimeline();
  renderDashboardAnalytics();
  renderSourceCredibility();
  renderDuplicateGroups();
  renderMapIntel();
  renderTopEvents();
  renderHotspots();
  renderReportHistory();
}

function renderMetrics() {
  const totals = state.trends?.totals || {};
  setText("totalEvents", formatNumber(totals.events || 0));
  setText("highPriority", formatNumber(totals.highPriority || 0));
  setText("reportCount", formatNumber(totals.reports || state.reports.length || 0));
  const ai = state.health?.ai || {};
  setText("aiEngine", ai.configured ? "READY" : "LOCAL");
}

function renderDashboardAnalytics() {
  const analytics = state.trends?.analytics || {};
  const totals = state.trends?.totals || {};
  const bands = analytics.priorityBands || {};
  const topAreas = analytics.topAreas || [];
  const templates = analytics.templateCounts || {};
  els.dashboardAnalytics.innerHTML = `
    <div class="intel-kpi-row">
      <span><strong>${formatNumber(analytics.averagePriority || 0)}</strong><em>Avg priority</em></span>
      <span><strong>${formatNumber(totals.confirmedItems || 0)}</strong><em>Confirmed</em></span>
      <span><strong>${formatNumber(totals.duplicateGroups || 0)}</strong><em>Groups</em></span>
    </div>
    <div class="mini-bars">
      ${Object.entries(bands)
        .map(([name, count]) => `<span><b>${escapeHtml(labelForCategory(name))}</b><i>${formatNumber(count)}</i></span>`)
        .join("")}
    </div>
    <div class="tag-row">
      ${topAreas.slice(0, 5).map((item) => `<span>${escapeHtml(item.name)} ${formatNumber(item.count)}</span>`).join("") || "<span>No area data</span>"}
    </div>
    <div class="tag-row muted">
      ${Object.entries(templates).slice(0, 4).map(([name, count]) => `<span>${escapeHtml(name)} ${formatNumber(count)}</span>`).join("") || "<span>No template data</span>"}
    </div>
  `;
}

function renderSourceCredibility() {
  const summary = state.trends?.sourceCredibilitySummary || {};
  const sources = summary.sources || [];
  els.sourceCredibility.innerHTML = sources.length
    ? `
      <div class="credibility-head">
        <strong>${formatNumber(summary.average || 0)}/100</strong>
        <span>${escapeHtml(summary.label || "unknown")} credibility across ${formatNumber(summary.sourceCount || 0)} sources</span>
      </div>
      ${sources
        .slice(0, 6)
        .map(
          (source) => `
          <article class="intel-row">
            <span>
              <strong>${escapeHtml(source.source)}</strong>
              <em>${formatNumber(source.count)} item${source.count === 1 ? "" : "s"} | ${escapeHtml(source.type || "source")}</em>
            </span>
            <b class="risk-badge ${escapeAttr(source.label)}">${formatNumber(source.score)}</b>
          </article>
        `
        )
        .join("")}
    `
    : `<div class="empty-state">No source credibility data yet.</div>`;
}

function renderDuplicateGroups() {
  const groups = state.trends?.duplicateGroups || [];
  els.duplicateGroups.innerHTML = groups.length
    ? groups
        .slice(0, 6)
        .map(
          (group) => `
          <article class="intel-row">
            <span>
              <strong>${escapeHtml(group.title)}</strong>
              <em>${escapeHtml(group.area || "Global")} | ${formatNumber(group.sourceCount || 1)} source${group.sourceCount === 1 ? "" : "s"} | ${formatNumber(group.count || 1)} related item${group.count === 1 ? "" : "s"}</em>
            </span>
            <b class="risk-badge">${formatNumber(group.maxPriority || 0)}</b>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No confirmed duplicate groups yet.</div>`;
}

function renderMapIntel() {
  const map = state.trends?.mapIntelligence || {};
  const layers = map.layers || {};
  const hotspots = map.topHotspots || [];
  els.mapIntel.innerHTML = `
    <div class="intel-kpi-row">
      <span><strong>${formatNumber(map.coveragePct || 0)}%</strong><em>Mapped</em></span>
      <span><strong>${formatNumber(map.mapped || 0)}</strong><em>Coords</em></span>
      <span><strong>${formatNumber(map.hotspotCount || 0)}</strong><em>Hotspots</em></span>
    </div>
    <div class="tag-row">
      ${Object.entries(layers).slice(0, 6).map(([name, count]) => `<span>${escapeHtml(labelForCategory(name))} ${formatNumber(count)}</span>`).join("") || "<span>No map layers</span>"}
    </div>
    <div class="map-spark">
      ${hotspots.slice(0, 5).map((item) => `<span style="--x:${hotspotX(item)}%;--y:${hotspotY(item)}%" title="${escapeAttr(item.name)}"></span>`).join("")}
    </div>
  `;
}

function renderSourceStatus() {
  const ai = state.health?.ai || {};
  const sources = state.health?.sourceCatalog || [];
  const rows = [
    {
      name: "DeepSeek Analyst",
      scope: ai.model || "rule-based local fallback",
      value: ai.configured ? "READY" : ai.env || "DEEPSEEK_API_KEY",
      ok: Boolean(ai.configured)
    },
    ...sources.map((source) => ({
      name: source.name,
      scope: source.scope,
      value: `${source.count} source${source.count === 1 ? "" : "s"}`,
      ok: true
    }))
  ];

  els.sourceStatus.innerHTML = rows.length
    ? rows
        .map(
          (item) => `
          <div class="provider-row ${item.ok ? "ok" : "missing"}">
            <span>
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.scope)}</span>
            </span>
            <span>${escapeHtml(item.value)}</span>
          </div>
        `
        )
        .join("")
    : `<div class="empty-state">Source status unavailable.</div>`;
}

function renderReport(result) {
  state.latestReport = result;
  const ai = result.ai || {};
  const templateLabel = result.templateLabel || result.ai?.templateLabel || "Executive Brief";
  setText("reportLabel", result.focus ? "Incident Report Saved" : "Situation Report Saved");
  setText("reportMeta", `#${result.id || "--"} | ${result.days || 7}d | ${templateLabel} | ${ai.provider || "Local"} ${ai.model || ""}`.trim());
  setText("reportSummary", summarizeReportText(result.report || "Report generated."));
  els.reportPreview.textContent = result.report || "Report generated.";
  els.reportPdfBtn.disabled = !result.id;
  els.reportPdfBtn.dataset.reportId = result.id || "";
}

function renderCategoryBars() {
  const counts = state.trends?.categoryCounts || {};
  const entries = Object.entries(counts).slice(0, 9);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  els.categoryBars.innerHTML = entries.length
    ? entries
        .map(([name, count]) => {
          const width = Math.max(6, Math.round((count / max) * 100));
          return `
            <div class="bar-row">
              <span class="bar-label">${escapeHtml(labelForCategory(name))}</span>
              <span class="bar-track"><span style="--w:${width}%"></span></span>
              <span class="bar-count">${formatNumber(count)}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No stored category data yet.</div>`;
}

function renderTimeline() {
  const counts = state.trends?.dailyCounts || {};
  const entries = Object.entries(counts).slice(-30);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  els.timeline.innerHTML = entries.length
    ? entries
        .map(([day, count]) => {
          const height = Math.max(8, Math.round((count / max) * 145));
          return `<span class="timeline-bar" style="height:${height}px" title="${escapeAttr(day)} - ${formatNumber(count)}"></span>`;
        })
        .join("")
    : `<div class="empty-state">No stored daily activity yet.</div>`;
}

function renderTopEvents() {
  const events = state.trends?.topEvents || [];
  els.topEvents.innerHTML = events.length
    ? events
        .slice(0, 8)
        .map(
          (event) => `
          <article class="event-item">
            <strong>${escapeHtml(event.title)}</strong>
            <div class="event-meta">
              <span>${escapeHtml(labelForCategory(event.category || "event"))}</span>
              <span>priority ${event.analyst_priority || event.severity_score || 0}</span>
              <span>${formatNumber(event.source_count || event.sourceCount || 1)} source${(event.source_count || event.sourceCount || 1) === 1 ? "" : "s"}</span>
              <span>${formatNumber(event.source_credibility || event.sourceCredibility || 0)}/100 source</span>
              <span>${escapeHtml(event.area || "Global")}</span>
            </div>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">Refresh live feeds to populate stored events.</div>`;
}

function renderHotspots() {
  const hotspots = state.trends?.hotspots || [];
  els.hotspots.innerHTML = hotspots.length
    ? hotspots
        .slice(0, 8)
        .map(
          (hotspot) => `
          <article class="hotspot-item">
            <strong>${escapeHtml(hotspot.name)}</strong>
            <span>${formatNumber(hotspot.count)} item${hotspot.count === 1 ? "" : "s"} | max ${hotspot.maxSeverity} | confirmed ${formatNumber(hotspot.confirmed || 0)}</span>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No hotspots stored yet.</div>`;
}

function renderReportHistory() {
  els.reportHistory.innerHTML = state.reports.length
    ? state.reports
        .map(
          (item) => `
          <article class="history-item report-history-item">
            <button class="history-select" type="button" data-report-id="${escapeAttr(item.id)}">
              <strong>${escapeHtml(item.title)}</strong>
              <span class="history-meta">
                <span>${formatRelativeTime(item.createdAt)}</span>
                <span>${escapeHtml(item.days)}d</span>
                <span>${escapeHtml(item.templateLabel || "Executive Brief")}</span>
                <span>${escapeHtml(item.aiProvider || item.model || "local")}</span>
              </span>
              <span class="report-history-summary">${escapeHtml(item.summary)}</span>
              <span class="history-meta">
                <span>${formatNumber(item.eventCount || 0)} events</span>
                <span>${formatNumber(item.highPriorityCount || 0)} priority</span>
                <span>${escapeHtml(item.topHotspot || "Global")}</span>
                <span>${formatNumber(item.credibility?.average || 0)}/100 source</span>
              </span>
              <span class="tag-row compact-tags">
                ${(item.tags || []).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
              </span>
            </button>
            <span class="history-actions">
              <span class="risk-badge">${escapeHtml(item.template || "report")}</span>
              <button class="icon-button compact history-pdf" type="button" data-report-pdf-id="${escapeAttr(item.id)}" title="Download PDF">PDF</button>
            </span>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">No analyst reports saved yet.</div>`;
}

function downloadLatestReportPdf() {
  const reportId = state.latestReport?.id || els.reportPdfBtn.dataset.reportId;
  downloadReportPdf(reportId);
}

function downloadReportPdf(reportId) {
  if (!reportId) {
    showToast("Generate or select a saved report first.");
    return;
  }
  const link = document.createElement("a");
  link.href = `/api/v2/reports/${encodeURIComponent(reportId)}/pdf?t=${Date.now()}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast(`Downloading report #${reportId} PDF.`);
}

function appendChat(role, text) {
  const item = document.createElement("div");
  item.className = `chat-message ${role}`;
  item.textContent = text;
  els.chatLog.appendChild(item);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function getJson(url) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function setText(id, value) {
  const element = els[id] || document.getElementById(id);
  if (element) element.textContent = value;
}

function summarizeReportText(report) {
  const line = String(report || "")
    .split("\n")
    .map((item) => item.replace(/^[-#\s]+/, "").trim())
    .find((item) => item && !item.toLowerCase().startsWith("generated:") && !item.toLowerCase().startsWith("window:"));
  return line || "Analyst report generated and stored.";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en").format(value || 0);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const [unit, seconds] = units.find(([, size]) => abs >= size) || units.at(-1);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diffSeconds / seconds), unit);
}

function hotspotX(item) {
  const lon = Number(item?.lon);
  if (Number.isFinite(lon)) return clampNumber(((lon + 180) / 360) * 100, 4, 96);
  return 12 + (stableHash(item?.name || "hotspot") % 76);
}

function hotspotY(item) {
  const lat = Number(item?.lat);
  if (Number.isFinite(lat)) return clampNumber(((90 - lat) / 180) * 100, 6, 94);
  return 14 + (stableHash(`${item?.name || "hotspot"}:y`) % 72);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableHash(value) {
  return String(value)
    .split("")
    .reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 0);
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
    weather: "Weather",
    geopolitical: "Geopolitical",
    military: "Military",
    economic: "Economic",
    cyber: "Cyber",
    energy: "Energy",
    news: "News",
    disaster: "Natural Disaster",
    manmade: "Manmade"
  };
  return labels[category] || category.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
