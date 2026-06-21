/* Event Plan Optima — UI wiring. All forecasting math lives in engine.js;
   this file only renders model_data.json and reacts to user input. */

const CAUSE_COLORS = {
  vehicle_breakdown: "#f2a93b",
  pot_holes:         "#9aa5b1",
  construction:      "#5da9e9",
  water_logging:     "#3fb6c9",
  accident:          "#e4483b",
  tree_fall:         "#8c6a4f",
  congestion:        "#b07cc6",
  public_event:      "#e8d34b",
  procession:        "#c97fd4",
  vip_movement:      "#2bb3a3",
  protest:           "#b5495a",
  debris:            "#707c8c",
  road_conditions:   "#707c8c",
  others:            "#707c8c",
};
function causeColor(c) { return CAUSE_COLORS[c] || "#707c8c"; }
function causeLabel(model, c) {
  return (model.cause_profile[c] && model.cause_profile[c].label) || c;
}

let MODEL = null;
let MAP = null;
let MARKER_LAYER = null;
let MAP_TILE_LAYER = null;

function tileUrlForTheme(theme) {
  return theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
}

function updateMapTileTheme(theme) {
  if (!MAP) return;
  if (MAP_TILE_LAYER) MAP.removeLayer(MAP_TILE_LAYER);
  MAP_TILE_LAYER = L.tileLayer(tileUrlForTheme(theme), {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  }).addTo(MAP);
}

function fmtNum(n) { return n.toLocaleString("en-IN"); }

function startClock() {
  function tick() {
    const now = new Date();
    const ist = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (5.5 * 3600000));
    const hh = String(ist.getHours()).padStart(2, "0");
    const mm = String(ist.getMinutes()).padStart(2, "0");
    const ss = String(ist.getSeconds()).padStart(2, "0");
    const el = document.getElementById("clock");
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
  }
  tick();
  setInterval(tick, 1000);
}

function renderKpis(model) {
  const k = model.kpis;
  const items = [
    { v: fmtNum(k.total_events), l: "Events Analyzed" },
    { v: `${k.pct_high_priority}%`, l: "Flagged High Priority" },
    { v: `${k.median_resolution_hr}h`, l: "Median Resolution Time" },
    { v: `${k.pct_road_closure}%`, l: "Required Road Closure" },
    { v: k.tracked_corridors, l: "Corridors Tracked" },
  ];
  if (model.ml && model.ml.metrics) {
    items.push({ v: model.ml.metrics.closure_risk.holdout_auc, l: "Closure Model AUC", accent: true });
  }
  const strip = document.getElementById("kpiStrip");
  strip.innerHTML = items.map(it => `
    <div class="kpi-card${it.accent ? " accent" : ""}">
      <div class="kpi-value">${it.v}</div>
      <div class="kpi-label">${it.l}</div>
    </div>`).join("");
}

function initMap(model) {
  MAP = L.map("map", { zoomControl: true, attributionControl: true })
    .setView([12.9716, 77.5946], 11);

  updateMapTileTheme(EventPulseTheme ? EventPulseTheme.current() : "dark");

  MARKER_LAYER = L.layerGroup({ renderer: L.canvas() }).addTo(MAP);
  drawHeatPoints(model, "");

  // legend — top causes by total volume
  const totals = {};
  model.heat_points.forEach(p => { totals[p.cause] = (totals[p.cause] || 0) + p.n; });
  const topCauses = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  document.getElementById("mapLegend").innerHTML = topCauses.map(c => `
    <span><span class="legend-dot" style="background:${causeColor(c)}"></span>${causeLabel(model, c)}</span>
  `).join("");
}

function drawHeatPoints(model, corridorFilter) {
  MARKER_LAYER.clearLayers();
  const pts = corridorFilter
    ? model.heat_points.filter(p => p.corridor === corridorFilter)
    : model.heat_points;

  pts.forEach(p => {
    const r = Math.min(3 + Math.sqrt(p.n) * 1.4, 16);
    L.circleMarker([p.lat, p.lon], {
      radius: r,
      color: causeColor(p.cause),
      weight: 0,
      fillOpacity: 0.55,
      fillColor: causeColor(p.cause),
    }).bindTooltip(`${causeLabel(model, p.cause)} · ${p.n} record${p.n > 1 ? "s" : ""}<br>${p.corridor}`)
      .addTo(MARKER_LAYER);
  });

  if (corridorFilter) {
    const c = model.corridor_profile[corridorFilter];
    if (c && c.centroid[0] != null) {
      MAP.flyTo([c.centroid[0], c.centroid[1]], 13, { duration: 0.6 });
    }
  } else {
    MAP.flyTo([12.9716, 77.5946], 11, { duration: 0.6 });
  }
}

function populateCorridorDropdowns(model) {
  const corridors = Object.entries(model.corridor_profile)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([name]) => name);

  const filterSel = document.getElementById("corridorFilter");
  corridors.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    filterSel.appendChild(o);
  });
  filterSel.addEventListener("change", () => drawHeatPoints(model, filterSel.value));

  const eventSel = document.getElementById("eventCorridor");
  corridors.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = `${c} (${model.corridor_profile[c].n} historical events)`;
    eventSel.appendChild(o);
  });
}

function populateCauseDropdown(model) {
  const kindSel = document.getElementById("eventKind");
  const causeSel = document.getElementById("eventCause");
  const scaleField = document.getElementById("scaleField");

  function refresh() {
    const kind = kindSel.value;
    const list = kind === "planned" ? model.planned_causes : model.unplanned_causes;
    causeSel.innerHTML = list.map(c => `<option value="${c}">${causeLabel(model, c)}</option>`).join("");
    scaleField.style.display = kind === "planned" ? "" : "none";
  }
  kindSel.addEventListener("change", refresh);
  refresh();
}

function wireScaleButtons() {
  const row = document.getElementById("scaleRow");
  row.querySelectorAll(".scale-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      row.querySelectorAll(".scale-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}
function currentScale() {
  const active = document.querySelector("#scaleRow .scale-btn.active");
  return active ? parseFloat(active.dataset.scale) : 1.0;
}

function updateClosureHint(model) {
  const hintEl = document.getElementById("closureHint");
  if (!hintEl) return;
  const cause = document.getElementById("eventCause").value;
  const corridor = document.getElementById("eventCorridor").value;
  const timeStr = document.getElementById("eventTime").value || "18:00";
  const hour = parseInt(timeStr.split(":")[0], 10);
  const cp = model.cause_profile[cause];
  if (!cp) { hintEl.textContent = "Model estimate: —"; return; }

  const hourBin = EventPulseEngine.hourToBin(hour);
  const eventType = cp.is_planned ? "planned" : "unplanned";
  const prob = EventPulseEngine.predictClosureProb(model, { cause, corridor, hourBin, eventType });
  const isToggledOn = document.getElementById("closureToggle").checked;

  if (prob === null) { hintEl.textContent = "Model estimate unavailable"; return; }
  const pct = Math.round(prob * 100);
  hintEl.classList.toggle("low", pct < 35);
  const jointN = (model.cause_corridor_n[corridor] && model.cause_corridor_n[corridor][cause]) || 0;
  const thinSampleNote = jointN < 15
    ? ` (only ${jointN} historical record${jointN === 1 ? "" : "s"} for this exact cause+corridor pairing — treat as directional, not precise)`
    : "";
  if (isToggledOn) {
    hintEl.textContent = `Closure toggled on — overriding the model's ${pct}% baseline estimate for this combination.${thinSampleNote}`;
  } else {
    hintEl.textContent = `Logistic Regression estimate: ${pct}% historical likelihood this combination needs a closure.${thinSampleNote}`;
  }
}

function wireClosureHint(model) {
  ["eventKind", "eventCause", "eventCorridor", "eventTime", "closureToggle"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => updateClosureHint(model));
  });
  updateClosureHint(model);
}

function runForecast(model) {
  const cause = document.getElementById("eventCause").value;
  const corridor = document.getElementById("eventCorridor").value;
  const timeStr = document.getElementById("eventTime").value || "18:00";
  const hour = parseInt(timeStr.split(":")[0], 10);
  const requiresClosure = document.getElementById("closureToggle").checked;
  const kind = document.getElementById("eventKind").value;
  const scale = kind === "planned" ? currentScale() : 1.0;

  const result = EventPulseEngine.forecast(model, { cause, corridor, hour, scale, requiresClosure });
  renderResult(model, result, { cause, corridor });
}

function renderResult(model, r, ctx) {
  const card = document.getElementById("resultCard");
  card.classList.add("show");

  const signalEl = document.getElementById("resultSignal");
  signalEl.className = `signal-light lit-${r.band.signal}`;

  document.getElementById("resultBandLabel").textContent = `${r.band.label} Impact`;
  document.getElementById("resultBandLabel").style.color =
    r.band.signal === "red" ? "var(--signal-red)" : r.band.signal === "green" ? "var(--signal-green)" : "#b9760a";
  document.getElementById("resultBandSub").textContent = r.band.sub;

  document.getElementById("resDuration").textContent =
    `${r.durationLowHr.toFixed(1)}–${r.durationHighHr.toFixed(1)} h`;
  document.getElementById("resManpower").textContent = `${r.manpower} personnel`;

  const list = document.getElementById("barricadeList");
  const rows = [];
  r.junctions.forEach(j => rows.push(`<li><span>${j.name}</span><span class="dist">${j.n} past incidents</span></li>`));
  r.stations.forEach(s => rows.push(`<li><span>${s.name} (coordinating PS)</span><span class="dist">${s.n} past incidents</span></li>`));
  list.innerHTML = rows.length ? rows.join("") :
    `<li><span>No corridor-specific history — coordinate with the nearest zonal control room.</span></li>`;

  const divBox = document.getElementById("diversionBox");
  if (r.diversion) {
    const redText = r.diversion.reduction != null
      ? `, carrying roughly <b>${Math.abs(r.diversion.reduction)}% ${r.diversion.reduction >= 0 ? "less" : "more"}</b> historical incident load`
      : "";
    divBox.innerHTML = `Route through-traffic via <b>${r.diversion.corridor}</b> (${r.diversion.zone})${redText}.`;
  } else {
    divBox.innerHTML = `No alternate corridor on record for this zone — recommend on-ground signal timing adjustment instead.`;
  }

  const note = document.getElementById("methodologyNote");
  if (r.usedML) {
    const closurePct = Math.round(r.closureProb * 100);
    note.textContent = `Severity Index ${r.rawScore.toFixed(2)} — closure risk (${closurePct}% baseline likelihood) from a trained Logistic Regression, duration from a Ridge regression model, blended with this cause's historical priority rate, this corridor's historical load, and time-of-day pattern, then scaled by event size.`;
  } else {
    note.textContent = `Severity Index ${r.rawScore.toFixed(2)} — built from this cause's historical priority rate, typical duration, closure rate, this corridor's historical load, and time-of-day pattern, scaled by event size.`;
  }
  if (r.barricadeNote) note.textContent += " " + r.barricadeNote;
}

let CHARTS = {};

function themeChartColors() {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  return { text: light ? "#495260" : "#aab3c0", grid: light ? "#d8dce2" : "#2c3440" };
}

function destroyCharts() {
  Object.values(CHARTS).forEach(c => { if (c) c.destroy(); });
  CHARTS = {};
}

function renderCharts(model) {
  destroyCharts();
  const tc = themeChartColors();
  Chart.defaults.color = tc.text;
  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.font.size = 11;

  const causeData = model.cause_chart;
  CHARTS.cause = new Chart(document.getElementById("chartCause"), {
    type: "bar",
    data: {
      labels: causeData.labels,
      datasets: [{
        data: causeData.values,
        backgroundColor: causeData.keys.map(k => causeColor(k)),
      }],
    },
    options: chartOpts({ indexAxis: "y" }),
  });

  CHARTS.hour = new Chart(document.getElementById("chartHour"), {
    type: "line",
    data: {
      labels: model.hour_chart.labels,
      datasets: [{
        data: model.hour_chart.values,
        borderColor: "#f2a93b",
        backgroundColor: "rgba(242,169,59,0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: chartOpts({}),
  });

  CHARTS.corridor = new Chart(document.getElementById("chartCorridor"), {
    type: "bar",
    data: {
      labels: model.top_corridors_chart.labels,
      datasets: [{
        data: model.top_corridors_chart.values,
        backgroundColor: "#5da9e9",
      }],
    },
    options: chartOpts({ indexAxis: "y" }),
  });

  CHARTS.monthly = new Chart(document.getElementById("chartMonthly"), {
    type: "bar",
    data: {
      labels: model.monthly_trend.months,
      datasets: [
        { label: "Unplanned", data: model.monthly_trend.unplanned, backgroundColor: "#707c8c" },
        { label: "Planned", data: model.monthly_trend.planned, backgroundColor: "#f2a93b" },
      ],
    },
    options: chartOpts({ stacked: true, legend: true }),
  });
}

function chartOpts({ indexAxis = "x", stacked = false, legend = false } = {}) {
  const tc = themeChartColors();
  return {
    indexAxis,
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: legend, labels: { boxWidth: 10, font: { size: 10.5 }, color: tc.text } } },
    scales: {
      x: { stacked, grid: { color: tc.grid }, ticks: { font: { size: 10 }, color: tc.text } },
      y: { stacked, grid: { color: tc.grid }, ticks: { font: { size: 10 }, color: tc.text } },
    },
  };
}

let FEED_PREDICTIONS = {}; // id -> predicted midpoint duration

function renderFeed(model) {
  const list = document.getElementById("feedList");
  const loopSelect = document.getElementById("loopEventSelect");
  const statsEl = document.getElementById("feedbackStats");
  const html = [];
  const opts = [];
  let highCount = 0, criticalBandCount = 0, manpowerTotal = 0;

  model.live_feed.forEach((item, idx) => {
    const id = `feed-${idx}`;
    const result = EventPulseEngine.triage(item);
    const cp = model.cause_profile[item.cause];
    const hourBin = EventPulseEngine.hourToBin(new Date().getHours());
    const eventType = cp && cp.is_planned ? "planned" : "unplanned";
    const mlDur = EventPulseEngine.predictDuration(model, {
      cause: item.cause, corridor: item.corridor, hourBin, eventType,
      closure: item.requires_road_closure ? 1 : 0,
    });
    const predictedDuration = mlDur ? mlDur.hours : (cp ? cp.median_duration_hr * (item.requires_road_closure ? 1.25 : 1.0) : 2);
    FEED_PREDICTIONS[id] = predictedDuration;

    if (item.priority === "High") highCount++;
    if (result.band.key === "high" || result.band.key === "critical") criticalBandCount++;
    manpowerTotal += result.manpower;

    const tagClass = item.priority === "High" ? "high" : "low";
    const action = `Suggested: ${result.manpower} personnel · ${result.band.label.toLowerCase()} impact band`;

    html.push(`
      <div class="feed-item">
        <div class="signal-light lit-${result.band.signal}">
          <span class="lamp red"></span><span class="lamp amber"></span><span class="lamp green"></span>
        </div>
        <div class="feed-main">
          <div class="feed-cause">${item.label} <span class="tag ${tagClass}">${item.priority}</span></div>
          <div class="feed-addr">${item.address} · ${item.corridor}</div>
          <div class="feed-action">${action}</div>
        </div>
        <button class="feed-resolve-btn" data-feed-id="${id}" title="Send to Learning Loop">Resolve &rarr;</button>
      </div>`);

    opts.push(`<option value="${id}">${item.label} — ${item.address}</option>`);
  });

  list.innerHTML = html.join("");
  loopSelect.innerHTML = opts.join("");

  if (statsEl) {
    const n = model.live_feed.length;
    statsEl.innerHTML = `
      <div class="fb-stat"><div class="v">${n}</div><div class="l">Live Incidents</div></div>
      <div class="fb-stat"><div class="v">${highCount}</div><div class="l">High Priority</div></div>
      <div class="fb-stat"><div class="v">${criticalBandCount}</div><div class="l">High / Critical Band</div></div>
      <div class="fb-stat"><div class="v">${manpowerTotal}</div><div class="l">Total Personnel Suggested</div></div>
    `;
  }

  list.querySelectorAll(".feed-resolve-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.feedId;
      const select = document.getElementById("loopEventSelect");
      const durationInput = document.getElementById("loopActualDuration");
      select.value = id;
      const loopPanel = select.closest(".panel");
      if (loopPanel) loopPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      durationInput.focus();
      durationInput.classList.add("flash");
      setTimeout(() => durationInput.classList.remove("flash"), 900);
    });
  });
}

function wireLearningLoop() {
  const errors = [];
  const log = document.getElementById("loopLog");
  const valueEl = document.getElementById("accuracyValue");
  const fillEl = document.getElementById("accuracyFill");

  document.getElementById("loopSubmitBtn").addEventListener("click", () => {
    const id = document.getElementById("loopEventSelect").value;
    const actual = parseFloat(document.getElementById("loopActualDuration").value);
    if (!id || isNaN(actual) || actual <= 0) return;

    const predicted = FEED_PREDICTIONS[id] || 0;
    const pctError = predicted > 0 ? Math.abs(predicted - actual) / Math.max(predicted, actual) : 1;
    errors.push(pctError);

    const meanErr = errors.reduce((a, b) => a + b, 0) / errors.length;
    const accuracy = Math.round(100 * (1 - meanErr));
    valueEl.textContent = `${Math.max(0, accuracy)}%`;
    fillEl.style.width = `${Math.max(0, Math.min(100, accuracy))}%`;
    fillEl.style.background = accuracy >= 70 ? "var(--signal-green)" : accuracy >= 40 ? "var(--signal-amber)" : "var(--signal-red)";

    const entry = document.createElement("div");
    entry.textContent = `#${errors.length} predicted ${predicted.toFixed(1)}h vs actual ${actual.toFixed(1)}h — ${Math.round(100 - pctError * 100)}% match`;
    log.prepend(entry);

    document.getElementById("loopActualDuration").value = "";
  });
}

const IMPORTANCE_LABELS = {
  event_cause: "Cause", corridor: "Corridor", hour_bin: "Time of Day",
  event_type: "Planned?", closure: "Closure Flag",
};

function importanceBars(importance) {
  return Object.entries(importance)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="imp-row">
        <div class="imp-label">${IMPORTANCE_LABELS[k] || k}</div>
        <div class="imp-track"><div class="imp-fill" style="width:${Math.round(v * 100)}%"></div></div>
        <div class="imp-pct">${Math.round(v * 100)}%</div>
      </div>`).join("");
}

function renderModelValidation(model) {
  const grid = document.getElementById("modelGrid");
  const ml = model.ml;
  if (!grid || !ml) { if (grid) grid.style.display = "none"; return; }

  const cm = ml.metrics.closure_risk;
  const dm = ml.metrics.duration;

  grid.innerHTML = `
    <div class="model-card">
      <div class="mc-head"><h3>Closure Risk Model</h3><span class="mc-type">Logistic Regression</span></div>
      <div class="mc-stat-row">
        <div class="mc-stat"><div class="v">${cm.holdout_auc}</div><div class="l">Holdout AUC</div></div>
        <div class="mc-stat"><div class="v">${cm.cv5_auc_mean}</div><div class="l">5-Fold CV AUC</div></div>
        <div class="mc-stat"><div class="v">${cm.holdout_recall}</div><div class="l">Recall</div></div>
      </div>
      <div class="mc-compare">vs <b>0.50</b> random guess · vs <b>${cm.rf_benchmark_auc}</b> Random Forest benchmark (kept only as a published comparison — its coefficients aren't portable to the client)</div>
      ${importanceBars(ml.metrics.closure_risk_rf_feature_importance)}
      <div class="mc-note">Predicts P(road closure required) for a cause + corridor + time-of-day + planned/unplanned combination — never trained on priority, which turned out to be a near-deterministic corridor designation rather than a real prediction target (see README). Base rate: ${Math.round(cm.base_rate_positive * 100)}% of historical events required a closure.</div>
    </div>
    <div class="model-card">
      <div class="mc-head"><h3>Duration Model</h3><span class="mc-type">Ridge Regression (log-hours)</span></div>
      <div class="mc-stat-row">
        <div class="mc-stat"><div class="v">${dm.holdout_mae_hours}h</div><div class="l">Holdout MAE</div></div>
        <div class="mc-stat"><div class="v">${dm.cv5_r2_mean}</div><div class="l">5-Fold CV R²</div></div>
        <div class="mc-stat"><div class="v">${dm.mae_improvement_vs_naive_pct}%</div><div class="l">vs Naive Median</div></div>
      </div>
      <div class="mc-compare">vs <b>${dm.naive_median_mae_hours}h</b> MAE for "always predict the median" · vs <b>${dm.rf_benchmark_mae_hours}h</b> Random Forest benchmark</div>
      ${importanceBars(ml.metrics.duration_rf_feature_importance)}
      <div class="mc-note">Duration is the noisiest signal in this dataset — even the Random Forest benchmark only reaches R²=${dm.rf_benchmark_r2_logspace}. Rather than overclaim, Event Plan Optima always shows duration as a range built from this model's own residual spread, never a single false-confidence number.</div>
    </div>
  `;
}

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDateShort(d) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function outlookItemHtml(model, item) {
  const r = item.result;
  const signal = r ? `lit-${r.band.signal}` : "";
  const bandLabel = r ? r.band.label : "—";
  return `
    <div class="outlook-item">
      <div class="signal-light ${signal}"><span class="lamp red"></span><span class="lamp amber"></span><span class="lamp green"></span></div>
      <div class="outlook-main">
        <div class="outlook-cause">${item.label} <span class="corridor-name">· ${item.corridor}</span></div>
        <div class="outlook-meta">
          <span>~<b>${item.expected.toFixed(1)}</b> expected</span>
          <span>${bandLabel} impact</span>
          ${r ? `<span>${r.manpower} personnel</span>` : ""}
        </div>
      </div>
    </div>`;
}

function renderOutlookDays(model) {
  const el = document.getElementById("outlookDays");
  if (!el) return;
  const days = EventPulseEngine.forecastOutlook(model, { daysAhead: 7, topPerDay: 3 });
  el.innerHTML = days.map(day => {
    const dayName = DOW_NAMES[day.pyDow];
    const body = day.items.length
      ? day.items.map(it => outlookItemHtml(model, it)).join("")
      : `<div class="outlook-empty">No elevated-risk combinations stand out for this day.</div>`;
    return `
      <div class="outlook-day-group">
        <div class="outlook-day-head">
          <span class="outlook-day-name">${dayName}</span>
          <span class="outlook-day-date">${fmtDateShort(day.date)}</span>
        </div>
        ${body}
      </div>`;
  }).join("");
}

function populateWeekPlanner(model) {
  const allCauses = [...model.planned_causes, ...model.unplanned_causes];
  const causeSel = document.getElementById("weekCause");
  causeSel.innerHTML = allCauses.map(c => `<option value="${c}">${causeLabel(model, c)}</option>`).join("");

  const corridorSel = document.getElementById("weekCorridor");
  const corridors = Object.entries(model.corridor_profile).sort((a, b) => b[1].n - a[1].n).map(([name]) => name);
  corridorSel.innerHTML = corridors.map(c => `<option value="${c}">${c}</option>`).join("");

  const dateEl = document.getElementById("weekDate");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateEl.value = tomorrow.toISOString().slice(0, 10);
  dateEl.min = new Date().toISOString().slice(0, 10);

  document.getElementById("weekScaleRow").querySelectorAll(".scale-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#weekScaleRow .scale-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  function refreshScaleVisibility() {
    const cp = model.cause_profile[causeSel.value];
    document.getElementById("weekScaleField").style.display = (cp && cp.is_planned) ? "" : "none";
  }
  causeSel.addEventListener("change", refreshScaleVisibility);
  refreshScaleVisibility();
}

let WEEK_EVENTS = [];
let weekEventSeq = 0;

function addWeekEvent(model) {
  const date = document.getElementById("weekDate").value;
  if (!date) return;
  const timeStr = document.getElementById("weekTime").value || "18:00";
  const hour = parseInt(timeStr.split(":")[0], 10);
  const cause = document.getElementById("weekCause").value;
  const corridor = document.getElementById("weekCorridor").value;
  const requiresClosure = document.getElementById("weekClosure").checked;
  const cp = model.cause_profile[cause];
  const activeScale = document.querySelector("#weekScaleRow .scale-btn.active");
  const scale = (cp && cp.is_planned && activeScale) ? parseFloat(activeScale.dataset.scale) : 1.0;

  let result;
  try {
    result = EventPulseEngine.forecast(model, { cause, corridor, hour, scale, requiresClosure });
  } catch (e) { return; }

  WEEK_EVENTS.push({
    id: ++weekEventSeq, date, hour, cause, corridor, requiresClosure,
    zone: (model.corridor_profile[corridor] || {}).zone || "Unzoned",
    label: causeLabel(model, cause), result,
  });
  WEEK_EVENTS.sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));
  renderWeekList(model);
}

function renderWeekList(model) {
  const listEl = document.getElementById("weekList");
  const summaryEl = document.getElementById("weekSummary");
  const conflictEl = document.getElementById("conflictBanner");

  if (WEEK_EVENTS.length === 0) {
    listEl.innerHTML = "";
    summaryEl.classList.remove("show");
    if (conflictEl) conflictEl.classList.remove("show");
    return;
  }

  listEl.innerHTML = WEEK_EVENTS.map(ev => `
    <div class="week-item">
      <div class="signal-light lit-${ev.result.band.signal}"><span class="lamp red"></span><span class="lamp amber"></span><span class="lamp green"></span></div>
      <div class="wi-main">
        <div><b>${ev.label}</b> · ${ev.corridor}</div>
        <div class="wi-meta">${ev.date} · ${String(ev.hour).padStart(2, "0")}:00 · ${ev.result.band.label} · ${ev.result.manpower} personnel</div>
      </div>
      <button class="wi-del" title="Remove" data-id="${ev.id}">&times;</button>
    </div>`).join("");

  listEl.querySelectorAll(".wi-del").forEach(btn => {
    btn.addEventListener("click", () => {
      WEEK_EVENTS = WEEK_EVENTS.filter(e => e.id !== parseInt(btn.dataset.id, 10));
      renderWeekList(model);
    });
  });

  const totalPersonnel = WEEK_EVENTS.reduce((s, e) => s + e.result.manpower, 0);
  const byDay = {};
  WEEK_EVENTS.forEach(e => { byDay[e.date] = (byDay[e.date] || 0) + e.result.manpower; });
  const busiestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

  summaryEl.classList.add("show");
  summaryEl.innerHTML = `
    <div class="ws-stat"><div class="v">${WEEK_EVENTS.length}</div><div class="l">Events Planned</div></div>
    <div class="ws-stat"><div class="v">${totalPersonnel}</div><div class="l">Total Personnel-Slots</div></div>
    <div class="ws-stat"><div class="v">${busiestDay ? busiestDay[0] : "—"}</div><div class="l">Busiest Day</div></div>
  `;

  // Conflict detection: 2+ High/Critical events sharing a date + zone.
  const groups = {};
  WEEK_EVENTS.forEach(e => {
    if (e.result.band.key === "high" || e.result.band.key === "critical") {
      const key = `${e.date}__${e.zone}`;
      (groups[key] = groups[key] || []).push(e);
    }
  });
  const conflicts = Object.entries(groups).filter(([, evs]) => evs.length > 1);
  if (conflictEl) {
    if (conflicts.length) {
      conflictEl.classList.add("show");
      conflictEl.innerHTML = conflicts.map(([key, evs]) => {
        const [date, zone] = key.split("__");
        return `&#9888; ${evs.length} high-impact events overlap on <b>${date}</b> in <b>${zone}</b> (${evs.map(e => e.label).join(", ")}) — consider redistributing personnel.`;
      }).join("<br>");
    } else {
      conflictEl.classList.remove("show");
    }
  }
}

async function boot() {
  startClock();
  try {
    const res = await fetch("model_data.json");
    MODEL = await res.json();
  } catch (e) {
    const veilEl = document.getElementById("loadingVeil");
    if (veilEl) veilEl.textContent =
      "Could not load model_data.json — open this folder with a local server (see README) rather than a bare file:// path.";
    return;
  }

  const has = (id) => !!document.getElementById(id);

  if (has("kpiStrip")) renderKpis(MODEL);

  if (has("map")) {
    initMap(MODEL);
    populateCorridorDropdowns(MODEL);
  }

  if (has("eventCause")) {
    populateCauseDropdown(MODEL);
    wireScaleButtons();
    wireClosureHint(MODEL);
  }
  if (has("forecastBtn")) {
    document.getElementById("forecastBtn").addEventListener("click", () => runForecast(MODEL));
  }

  if (has("chartCause")) renderCharts(MODEL);
  if (has("modelGrid")) renderModelValidation(MODEL);
  if (has("feedList")) renderFeed(MODEL);
  if (has("loopEventSelect")) wireLearningLoop();

  if (has("outlookDays")) renderOutlookDays(MODEL);
  if (has("weekCause")) {
    populateWeekPlanner(MODEL);
    document.getElementById("weekAddBtn").addEventListener("click", () => addWeekEvent(MODEL));
  }

  const veil = document.getElementById("loadingVeil");
  if (veil) {
    veil.style.opacity = "0";
    setTimeout(() => veil.style.display = "none", 300);
  }

  window.addEventListener("eventpulse:themechange", (e) => {
    if (has("chartCause") && MODEL) renderCharts(MODEL);
    if (MAP) updateMapTileTheme(e.detail.theme);
  });
}

boot();
