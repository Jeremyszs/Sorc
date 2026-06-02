/* ===================================================================
   analytics.js — Dashboard renderer & 9router health check
   =================================================================== */

let hourlyChartInstance = null;
const CHART_COLORS = {
  fill:   'rgba(59, 130, 246, 0.10)',
  border: 'rgba(59, 130, 246, 0.80)',
};

// Pick a readable grid color for the dark theme
function chartGridColor() {
  return 'rgba(255,255,255,0.08)';
}

/**
 * Update all dashboard elements in place from analytics data.
 */
function renderDashboard(data) {
  if (!data) return;

  document.getElementById('dash-msgs-today').textContent =
    data.messagesToday ?? '—';
  document.getElementById('dash-msgs-hour').textContent =
    data.messagesThisHour ?? '—';
  document.getElementById('dash-ai-replies').textContent =
    data.aiReplies ?? '—';
  document.getElementById('dash-handoffs').textContent =
    data.humanHandoffs ?? (window._handoffCount ?? '—');

  // Chart
  if (data.hourlyVolume && data.hourlyVolume.length) {
    renderChart(data.hourlyVolume);
  }
}

function renderChart(volume) {
  const canvas = document.getElementById('hourlyChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (hourlyChartInstance) {
    hourlyChartInstance.data.labels = volume.map(d => d.hour);
    hourlyChartInstance.data.datasets[0].data = volume.map(d => d.count);
    hourlyChartInstance.update('none');
    return;
  }

  hourlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: volume.map(d => d.hour),
      datasets: [{
        label: 'Messages',
        data: volume.map(d => d.count),
        backgroundColor: CHART_COLORS.fill,
        borderColor: CHART_COLORS.border,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, color: '#9ca3af' }, grid: { color: chartGridColor() } },
        x: { ticks: { maxRotation: 45, font: { size: 10 }, color: '#9ca3af' }, grid: { display: false } },
      },
    },
  });
}

// ---- 9router health check --------------------------------------------

function checkRouterStatus() {
  apiFetch('/api/router-health', {
    method: 'GET',
    signal: AbortSignal.timeout(4000),
  })
    .then((res) => res.json())
    .then((data) => setRouterStatus(data.connected))
    .catch(() => setRouterStatus(false));
}

function setRouterStatus(connected) {
  const dot = document.getElementById('ai-dot');
  const label = document.getElementById('ai-label');
  if (dot) dot.className = 'status-dot ' + (connected ? 'on' : 'off');
  if (label) label.textContent = connected ? '9router — Connected' : '9router — Disconnected';
}

checkRouterStatus();
setInterval(checkRouterStatus, 15000);

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
