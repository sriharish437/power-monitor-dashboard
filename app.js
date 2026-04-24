/* =========================================================
   SMART POWER MONITORING SYSTEM — APP LOGIC
   ThingSpeak API | Real-time | Chart.js
   =========================================================

   ⚠️  CONFIGURATION — Replace these with your credentials:
   --------------------------------------------------------- */

const CONFIG = {
  CHANNEL_ID: "3350037",      // e.g. "2312456"
  READ_API_KEY: "XLDS982NVGOC9S4M",    // e.g. "ABCDEFGH12345678"
  RESULTS: 10,                     // number of readings for chart
  REFRESH_MS: 5000,                   // auto-refresh interval (ms)
  MAX_POWER: 3000,                   // max expected W per phase (for bar %)
};

/* =========================================================
   DOM References
   ========================================================= */
const dom = {
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  lastUpdateTime: document.getElementById("lastUpdateTime"),
  refreshBtn: document.getElementById("refreshBtn"),

  p1Value: document.getElementById("p1-value"),
  p2Value: document.getElementById("p2-value"),
  p3Value: document.getElementById("p3-value"),

  barP1: document.getElementById("bar-p1"),
  barP2: document.getElementById("bar-p2"),
  barP3: document.getElementById("bar-p3"),

  indicatorP1: document.getElementById("indicator-p1"),
  indicatorP2: document.getElementById("indicator-p2"),
  indicatorP3: document.getElementById("indicator-p3"),

  statusP1: document.getElementById("status-p1"),
  statusP2: document.getElementById("status-p2"),
  statusP3: document.getElementById("status-p3"),

  badgeP1: document.getElementById("badge-p1"),
  badgeP2: document.getElementById("badge-p2"),
  badgeP3: document.getElementById("badge-p3"),

  cardP1: document.getElementById("card-phase1"),
  cardP2: document.getElementById("card-phase2"),
  cardP3: document.getElementById("card-phase3"),

  totalPower: document.getElementById("totalPower"),
  avgPower: document.getElementById("avgPower"),
  peakPower: document.getElementById("peakPower"),
  nextRefresh: document.getElementById("nextRefresh"),

  activePhaseValue: document.getElementById("activePhaseValue"),
  activePhaseBadge: document.getElementById("activePhaseBadge"),

  errorBanner: document.getElementById("errorBanner"),
  errorMessage: document.getElementById("errorMessage"),

  footerChannel: document.getElementById("footerChannel"),
  powerChart: document.getElementById("powerChart"),
};

/* =========================================================
   State
   ========================================================= */
const state = {
  history: {
    labels: [],
    p1: [],
    p2: [],
    p3: [],
  },
  countdown: CONFIG.REFRESH_MS / 1000,
  countdownTimer: null,
  refreshTimer: null,
  chart: null,
  lastValues: { p1: null, p2: null, p3: null },
};

/* =========================================================
   ThingSpeak API
   ========================================================= */
function buildApiUrl() {
  return "https://api.allorigins.win/raw?url=" + encodeURIComponent(
    "https://api.thingspeak.com/channels/3350037/feeds.json?api_key=XLDS982NVGOC9S4M&results=1"
  );
}

async function fetchThingSpeak() {
  const url = buildApiUrl();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json();
  if (!data || !data.feeds || data.feeds.length === 0) throw new Error("No feeds in API response");
  return data;
}

/* =========================================================
   Data Parsing
   ========================================================= */
function parseFeeds(data) {
  const feeds = data.feeds;

  // Build history arrays (all readings)
  const labels = [], p1Arr = [], p2Arr = [], p3Arr = [];
  feeds.forEach(feed => {
    const t = new Date(feed.created_at);
    labels.push(formatTime(t));
    p1Arr.push(parseFloat(feed.field1) || 0);
    p2Arr.push(parseFloat(feed.field2) || 0);
    p3Arr.push(parseFloat(feed.field3) || 0);
  });

  // Latest reading
  const latest = feeds[feeds.length - 1];
  const p1 = parseFloat(latest.field1);
  const p2 = parseFloat(latest.field2);
  const p3 = parseFloat(latest.field3);

  return { labels, p1Arr, p2Arr, p3Arr, p1, p2, p3 };
}

/* =========================================================
   UI Updaters
   ========================================================= */
function setConnectionStatus(type) {
  dom.statusDot.className = "status-dot " + type;
  if (type === "online") dom.statusLabel.textContent = "Live";
  else if (type === "error") dom.statusLabel.textContent = "Error";
  else dom.statusLabel.textContent = "Connecting...";
}

function showError(msg) {
  dom.errorBanner.hidden = false;
  dom.errorMessage.textContent = msg;
  setConnectionStatus("error");
}

function hideError() {
  dom.errorBanner.hidden = true;
}

function flashValue(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // reflow
  el.classList.add("flash");
}

function getStatusColor(value) {
  if (isNaN(value) || value <= 0) return "red";
  if (value < 500) return "yellow";
  return "green";
}

function getStatusText(value) {
  if (isNaN(value) || value <= 0) return "No signal";
  if (value < 500) return "Low load";
  if (value < 1500) return "Moderate";
  return "High load";
}

function getBadgeText(value) {
  if (isNaN(value) || value <= 0) return "OFF";
  if (value < 500) return "LOW";
  if (value < 1500) return "MED";
  return "HIGH";
}

function getBarWidth(value) {
  const pct = Math.min(100, Math.max(0, (value / CONFIG.MAX_POWER) * 100));
  return pct.toFixed(1) + "%";
}

function updateCard(valueEl, barEl, indicatorEl, statusEl, badgeEl, cardEl, value) {
  const color = getStatusColor(value);
  const display = isNaN(value) ? "--" : value.toFixed(1);

  // Flash if value changed
  if (valueEl.textContent !== display) {
    valueEl.textContent = display;
    flashValue(valueEl);
  }

  barEl.style.width = isNaN(value) ? "0%" : getBarWidth(value);
  indicatorEl.className = "card-status-indicator " + color;
  statusEl.textContent = getStatusText(value);
  badgeEl.textContent = getBadgeText(value);
}

function updateActivePhase(p1, p2, p3) {
  const phases = [
    { name: "Phase 1 (L1)", val: p1, card: dom.cardP1 },
    { name: "Phase 2 (L2)", val: p2, card: dom.cardP2 },
    { name: "Phase 3 (L3)", val: p3, card: dom.cardP3 },
  ];

  // Clear active
  [dom.cardP1, dom.cardP2, dom.cardP3].forEach(c => c.classList.remove("active-card"));

  const valid = phases.filter(p => !isNaN(p.val) && p.val > 0);
  if (valid.length === 0) {
    dom.activePhaseValue.textContent = "--";
    dom.activePhaseBadge.textContent = "No Data";
    return;
  }

  const active = valid.reduce((a, b) => a.val > b.val ? a : b);
  active.card.classList.add("active-card");
  dom.activePhaseValue.textContent = `${active.name}  —  ${active.val.toFixed(1)} W`;
  dom.activePhaseBadge.textContent = "Dominant";
}

function updateStats(p1, p2, p3) {
  const vals = [p1, p2, p3].filter(v => !isNaN(v) && v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = vals.length ? total / vals.length : 0;
  const peak = vals.length ? Math.max(...vals) : 0;

  dom.totalPower.textContent = total.toFixed(1);
  dom.avgPower.textContent = avg.toFixed(1);
  dom.peakPower.textContent = peak.toFixed(1);
}

function updateLastUpdateTime() {
  const now = new Date();
  dom.lastUpdateTime.textContent = formatTime(now);
}

/* =========================================================
   Chart.js Setup
   ========================================================= */
function initChart() {
  const ctx = dom.powerChart.getContext("2d");

  const gradient1 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient1.addColorStop(0, "rgba(56,189,248,0.3)");
  gradient1.addColorStop(1, "rgba(56,189,248,0)");

  const gradient2 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient2.addColorStop(0, "rgba(167,139,250,0.3)");
  gradient2.addColorStop(1, "rgba(167,139,250,0)");

  const gradient3 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient3.addColorStop(0, "rgba(52,211,153,0.3)");
  gradient3.addColorStop(1, "rgba(52,211,153,0)");

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Phase 1",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: gradient1,
          borderWidth: 2.5,
          pointBackgroundColor: "#38bdf8",
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBorderColor: "#0b1220",
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true,
        },
        {
          label: "Phase 2",
          data: [],
          borderColor: "#a78bfa",
          backgroundColor: gradient2,
          borderWidth: 2.5,
          pointBackgroundColor: "#a78bfa",
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBorderColor: "#0b1220",
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true,
        },
        {
          label: "Phase 3",
          data: [],
          borderColor: "#34d399",
          backgroundColor: gradient3,
          borderWidth: 2.5,
          pointBackgroundColor: "#34d399",
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBorderColor: "#0b1220",
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: "easeInOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(11,18,32,0.95)",
          borderColor: "rgba(99,133,200,0.3)",
          borderWidth: 1,
          titleColor: "#94a3b8",
          bodyColor: "#e2e8f0",
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} W`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
          ticks: {
            color: "#475569",
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            maxTicksLimit: 6,
          },
          border: { display: false },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
          ticks: {
            color: "#475569",
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            callback: v => v + " W",
          },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function updateChart(labels, p1Arr, p2Arr, p3Arr) {
  if (!state.chart) return;
  state.chart.data.labels = labels;
  state.chart.data.datasets[0].data = p1Arr;
  state.chart.data.datasets[1].data = p2Arr;
  state.chart.data.datasets[2].data = p3Arr;
  state.chart.update("active");
}

/* =========================================================
   Main Fetch + Update Cycle
   ========================================================= */
async function fetchAndUpdate() {
  try {
    // Animate refresh button
    dom.refreshBtn.classList.add("spinning");

    const data = await fetchThingSpeak();
    const { labels, p1Arr, p2Arr, p3Arr, p1, p2, p3 } = parseFeeds(data);

    // Update cards
    updateCard(dom.p1Value, dom.barP1, dom.indicatorP1, dom.statusP1, dom.badgeP1, dom.cardP1, p1);
    updateCard(dom.p2Value, dom.barP2, dom.indicatorP2, dom.statusP2, dom.badgeP2, dom.cardP2, p2);
    updateCard(dom.p3Value, dom.barP3, dom.indicatorP3, dom.statusP3, dom.badgeP3, dom.cardP3, p3);

    // Update chart
    updateChart(labels, p1Arr, p2Arr, p3Arr);

    // Update stats & active phase
    updateActivePhase(p1, p2, p3);
    updateStats(p1, p2, p3);
    updateLastUpdateTime();

    hideError();
    setConnectionStatus("online");

  } catch (err) {
    console.error("[PowerSense] Fetch error:", err);
    showError(`Connection error: ${err.message} — Retrying in ${CONFIG.REFRESH_MS / 1000}s`);
  } finally {
    dom.refreshBtn.classList.remove("spinning");
  }
}

/* =========================================================
   Countdown Timer
   ========================================================= */
function startCountdown() {
  clearInterval(state.countdownTimer);
  state.countdown = CONFIG.REFRESH_MS / 1000;

  state.countdownTimer = setInterval(() => {
    state.countdown = Math.max(0, state.countdown - 1);
    dom.nextRefresh.textContent = state.countdown + "s";
    if (state.countdown === 0) state.countdown = CONFIG.REFRESH_MS / 1000;
  }, 1000);
}

/* =========================================================
   Auto-Refresh
   ========================================================= */
function startAutoRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    fetchAndUpdate();
    startCountdown();
  }, CONFIG.REFRESH_MS);
  startCountdown();
}

/* =========================================================
   Helpers
   ========================================================= */
function formatTime(date) {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  // Show channel ID in footer
  dom.footerChannel.textContent = CONFIG.CHANNEL_ID;

  // Init Chart.js
  initChart();

  // Manual refresh button
  dom.refreshBtn.addEventListener("click", () => {
    fetchAndUpdate();
    startCountdown();
  });

  // Initial fetch
  fetchAndUpdate();

  // Start auto-refresh
  startAutoRefresh();
}

// Boot when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
