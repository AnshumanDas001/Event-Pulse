/* ==========================================================================
   Event Plan Optima forecasting & recommendation engine
   --------------------------------------------------------------------------
   Two real, validated ML models do the predicting (see
   pipeline/train_models.py for how they were fit, and model_data.json["ml"]
   for their coefficients + holdout/cross-validation metrics):

     - Closure Risk — LogisticRegression, P(this event needs a road closure)
     - Duration     — Ridge regression on log(hours)

   Both are linear models on purpose: a traffic control room needs to be
   able to ask "why did it recommend that?" and get a straight answer, so
   every prediction here is a transparent, inspectable weighted sum of
   *learned* coefficients — never an opaque black box. (A Random Forest
   benchmark was evaluated for both and is reported in the metrics; it did
   not score meaningfully better than the linear model, so the
   interpretable one shipped.)

   Severity Index (0 – ~1.2, clipped to 1 for the gauge)
     0.30 × historical High-priority rate for this cause (institutional —
            named corridors are always "High priority" by designation)
   + 0.25 × ML-predicted duration for this cause+corridor+time (capped 12h)
   + 0.20 × road-closure signal (explicit toggle, else the ML Closure Risk
            model's predicted probability for this exact combination)
   + 0.15 × this corridor's historical incident density vs. the busiest corridor
   + 0.10 × how close the chosen time is to this cause's historical peak hour
   … then multiplied by an event-scale factor (Small 0.7 → Mega 1.8).

   Bands:  < 0.35 Low · 0.35–0.55 Moderate · 0.55–0.75 High · ≥ 0.75 Critical
   ========================================================================== */

const EventPulseEngine = (() => {

  const BANDS = [
    { max: 0.35, key: "low", label: "Low", signal: "green",
      sub: "Routine — standard patrol coverage is sufficient." },
    { max: 0.55, key: "moderate", label: "Moderate", signal: "amber",
      sub: "Notable impact expected — assign a dedicated response team." },
    { max: 0.75, key: "high", label: "High", signal: "amber",
      sub: "Significant congestion risk — pre-position personnel & barricades." },
    { max: Infinity, key: "critical", label: "Critical", signal: "red",
      sub: "Major disruption likely — full deployment plan, divert through-traffic." },
  ];

  const HOUR_BIN_EDGES = [
    [0, 4, "late_night"], [4, 8, "early_morning"], [8, 12, "morning"],
    [12, 16, "midday"], [16, 20, "evening_peak"], [20, 24, "night_peak"],
  ];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  function hourToBin(h) {
    for (const [lo, hi, name] of HOUR_BIN_EDGES) if (h >= lo && h < hi) return name;
    return "late_night";
  }

  function bandFor(score) {
    return BANDS.find(b => score < b.max) || BANDS[BANDS.length - 1];
  }

  /** Generic linear-model scorer for the {intercept, weights:{group:{cat:w}}}
   *  shape both trained models are exported in. Unknown categories score 0
   *  for that term (equivalent to scikit-learn's handle_unknown="ignore"). */
  function scoreLinear(modelBlock, { cause, corridor, hourBin, eventType, closure }) {
    if (!modelBlock) return null;
    const w = modelBlock.weights;
    let z = modelBlock.intercept;
    z += (w.event_cause && w.event_cause[cause]) || 0;
    z += (w.corridor && w.corridor[corridor]) || 0;
    z += (w.hour_bin && w.hour_bin[hourBin]) || 0;
    z += (w.event_type && w.event_type[eventType]) || 0;
    if (typeof closure === "number" && typeof w.closure === "number") z += w.closure * closure;
    return z;
  }

  function predictClosureProb(model, ctx) {
    const z = scoreLinear(model.ml && model.ml.closure_model, ctx);
    return z === null ? null : sigmoid(z);
  }

  /** Returns predicted hours plus a ~68% range from the model's own
   *  residual spread — duration is the noisiest signal in this dataset
   *  (see metrics.duration in model_data.json), so we never show a single
   *  false-confidence number for it. */
  function predictDuration(model, ctx) {
    const dm = model.ml && model.ml.duration_model;
    if (!dm) return null;
    const zLog = scoreLinear(dm, ctx);
    if (zLog === null) return null;
    const sd = dm.residual_std_logspace || 0.5;
    return {
      hours: Math.expm1(zLog),
      lowHours: Math.expm1(zLog - sd),
      highHours: Math.expm1(zLog + sd),
    };
  }

  /**
   * @param model  parsed model_data.json
   * @param input  { cause, corridor, hour (0-23), scale (0.7-1.8), requiresClosure }
   */
  function forecast(model, input) {
    const { cause, corridor, hour, scale, requiresClosure } = input;
    const cp = model.cause_profile[cause];
    const corr = model.corridor_profile[corridor] || { density_norm: 0, zone: "Unzoned", n: 0 };
    if (!cp) throw new Error(`Unknown cause: ${cause}`);

    const hourBin = hourToBin(hour);
    const eventType = cp.is_planned ? "planned" : "unplanned";
    const ctx = { cause, corridor, hourBin, eventType };

    // --- ML predictions -------------------------------------------------
    const closureProb = predictClosureProb(model, ctx);
    const durPred = predictDuration(model, { ...ctx, closure: requiresClosure ? 1 : 0 });
    const usedML = closureProb !== null && durPred !== null;

    const priorityNorm = cp.pct_high_priority / 100;
    const durationNorm = usedML
      ? clamp(durPred.hours / 12, 0, 1)
      : clamp(cp.median_duration_hr / 12, 0, 1); // fallback if ML block missing
    const closureNorm = requiresClosure ? 1 : (usedML ? closureProb : cp.pct_road_closure / 100);
    const densityNorm = corr.density_norm || 0;

    const hourDist = cp.hour_distribution || [];
    const maxHourShare = Math.max(...hourDist, 0.0001);
    const hourNorm = hourDist.length ? clamp((hourDist[hour] || 0) / maxHourShare, 0, 1) : 0.5;

    const rawScore =
      0.30 * priorityNorm +
      0.25 * durationNorm +
      0.20 * closureNorm +
      0.15 * densityNorm +
      0.10 * hourNorm;

    const scaledScore = rawScore * scale;
    const band = bandFor(scaledScore);
    const displayScore = clamp(scaledScore, 0, 1);

    // Duration range — ML range scaled by event size if available, else
    // the historical median/p75 fallback.
    let durLow, durHigh;
    if (usedML) {
      durLow = Math.max(0.1, durPred.lowHours) * scale;
      durHigh = Math.max(durLow + 0.1, durPred.highHours) * scale;
    } else {
      const closureDurationFactor = requiresClosure ? 1.25 : 1.0;
      durLow = cp.median_duration_hr * scale * closureDurationFactor;
      durHigh = cp.p75_duration_hr * scale * closureDurationFactor;
    }

    // Manpower: base scales with historical severity of the cause itself,
    // then adjusted for event scale, closure, and corridor load.
    const base = 4 + 6 * priorityNorm;
    let manpower = base * scale * (requiresClosure ? 1.3 : 1.0) * (1 + 0.3 * densityNorm);
    manpower = Math.max(2, Math.round(manpower / 2) * 2);

    // Barricade / staging points
    let junctions = (model.junction_points[corridor] || []).slice(0, 3);
    let stations = (model.station_points[corridor] || []).slice(0, 1);
    let barricadeNote = null;
    if (junctions.length === 0 && stations.length === 0) {
      const zone = corr.zone;
      const siblings = (model.zone_corridors[zone] || []).filter(c => c !== corridor);
      for (const sib of siblings) {
        if ((model.junction_points[sib] || []).length) {
          junctions = model.junction_points[sib].slice(0, 2);
          barricadeNote = `No corridor-specific junction history for "${corridor}" — showing the nearest staging points from ${sib}, same zone (${zone}).`;
          break;
        }
      }
      if (junctions.length === 0) {
        stations = Object.values(model.station_points).flat();
      }
    }

    // Diversion suggestion
    const zone = corr.zone;
    const siblings = (model.zone_corridors[zone] || []).filter(c => c !== corridor);
    let diversion = null;
    if (siblings.length) {
      const ranked = siblings
        .map(c => ({ name: c, density: model.corridor_profile[c].density_norm }))
        .sort((a, b) => a.density - b.density);
      const alt = ranked[0];
      const reduction = corr.density_norm > 0
        ? Math.round(100 * (corr.density_norm - alt.density) / corr.density_norm)
        : null;
      diversion = { corridor: alt.name, zone, reduction };
    }

    return {
      score: displayScore,
      rawScore: scaledScore,
      band,
      durationLowHr: durLow,
      durationHighHr: durHigh,
      manpower,
      junctions,
      stations,
      barricadeNote,
      diversion,
      usedML,
      closureProb,
      breakdown: {
        priorityNorm, durationNorm, closureNorm, densityNorm, hourNorm, scale,
      },
    };
  }

  /**
   * Triage for an already-logged live incident, where priority and
   * road-closure status are already known facts (not predictions). This is
   * deliberately simpler than forecast(): it answers "how should we
   * respond to this specific incident right now?" rather than "how big
   * could a not-yet-started event become?" — so it does not call the ML
   * models at all.
   */
  function triage(item) {
    const isHigh = item.priority === "High";
    const closure = !!item.requires_road_closure;
    let band;
    if (isHigh && closure) band = BANDS[3];       // critical
    else if (isHigh) band = BANDS[2];              // high
    else if (closure) band = BANDS[1];              // moderate
    else band = BANDS[0];                            // low

    let manpower = (isHigh ? 8 : 4) + (closure ? 2 : 0);
    return { band, manpower };
  }

  /**
   * Predicts likely *unplanned* hotspots for the next `daysAhead` calendar
   * days, purely from historical seasonality — no live signal exists for
   * this in the dataset, so this is explicitly a statistical projection:
   * rate_per_week (this corridor+cause combo's average weekly count) times
   * that cause's historical day-of-week share gives an expected count for
   * any specific upcoming date. Ranked by *risk-weighted* expected count
   * (expected count x a severity weight), not raw frequency, so a rare but
   * severe cause isn't drowned out by routine breakdowns.
   */
  function jsDateToPyDow(date) {
    return (date.getDay() + 6) % 7; // JS: 0=Sun..6=Sat -> Python dayofweek: 0=Mon..6=Sun
  }

  function forecastOutlook(model, opts = {}) {
    const { daysAhead = 7, startDate = new Date(), topPerDay = 3 } = opts;
    const rates = model.hotspot_rates || [];
    const days = [];

    for (let i = 0; i < daysAhead; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const pyDow = jsDateToPyDow(date);

      const scored = rates.map(h => {
        const cp = model.cause_profile[h.cause];
        const dowShare = (cp && cp.dow_distribution && cp.dow_distribution[pyDow] != null) ? cp.dow_distribution[pyDow] : (1 / 7);
        const expected = h.rate_per_week * dowShare;
        const severityWeight = 0.4 + 0.6 * ((cp ? cp.pct_high_priority : 50) / 100);
        return { ...h, label: cp ? cp.label : h.cause, expected, riskScore: expected * severityWeight };
      });

      // Keep only the single best corridor per cause, so the daily top list
      // reflects a spread of different risks rather than N corridors that
      // all happen to be "vehicle breakdown" (by far the most frequent cause).
      const bestPerCause = {};
      scored.forEach(s => {
        if (!bestPerCause[s.cause] || s.riskScore > bestPerCause[s.cause].riskScore) bestPerCause[s.cause] = s;
      });
      const diversified = Object.values(bestPerCause).sort((a, b) => b.riskScore - a.riskScore);
      const top = diversified.slice(0, topPerDay).filter(s => s.expected > 0.05);

      const items = top.map(h => {
        let result = null;
        try {
          result = forecast(model, { cause: h.cause, corridor: h.corridor, hour: h.peak_hour, scale: 1.0, requiresClosure: false });
        } catch (e) { /* unknown cause, skip scoring */ }
        return { ...h, result };
      });

      days.push({ date, pyDow, items });
    }
    return days;
  }

  return { forecast, triage, forecastOutlook, bandFor, clamp, predictClosureProb, predictDuration, hourToBin, jsDateToPyDow, sigmoid };
})();
