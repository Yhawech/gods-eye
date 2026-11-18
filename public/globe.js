const GLOBE_FALLBACK_URL = "http://127.0.0.1:4174";

const state = {
  globeUrl: GLOBE_FALLBACK_URL,
};

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function setStatus(online) {
  const status = document.getElementById("globeStatus");
  if (!status) return;
  status.textContent = online ? "Online" : "Start globe server";
  status.classList.toggle("warn", !online);
}

function setLaunchUrl(url) {
  state.globeUrl = url || GLOBE_FALLBACK_URL;
  const link = document.getElementById("openGlobe");
  if (link) link.href = state.globeUrl;
}

async function loadConfig() {
  try {
    const response = await fetch("/api/v2/globe/config");
    const config = await response.json();
    setLaunchUrl(config.localUrl);
    document.getElementById("googleState").textContent = config.googleMapsConfigured ? "Configured" : "Needs key in .env";
    document.getElementById("deepseekState").textContent = config.deepseekConfigured ? "Configured" : "Fallback";
  } catch {
    document.getElementById("googleState").textContent = "Check .env";
    document.getElementById("deepseekState").textContent = "Check app";
  }
}

async function checkGlobe() {
  try {
    await fetch(state.globeUrl, { mode: "no-cors", cache: "no-store" });
    setStatus(true);
    const frame = document.getElementById("globeFrame");
    if (frame && frame.src === "about:blank") frame.src = state.globeUrl;
  } catch {
    setStatus(false);
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (button) {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast("Command copied");
    } catch {
      showToast(button.dataset.copy);
    }
  }

  if (event.target.id === "reloadFrame") {
    const frame = document.getElementById("globeFrame");
    if (frame) frame.src = state.globeUrl;
    checkGlobe();
  }
});

loadConfig().then(checkGlobe);
window.setInterval(checkGlobe, 30000);


