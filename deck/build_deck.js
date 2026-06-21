const pptxgen = require("pptxgenjs");
const { iconPng } = require("./icons");

// ---------------------------------------------------------------------------
// Design tokens — same system as the dashboard, kept identical for brand
// continuity across the product and the deck.
// ---------------------------------------------------------------------------
const C = {
  asphalt: "1B2027",
  asphalt2: "232A33",
  hairline: "384150",
  amber: "F2A93B",
  amberDim: "8A6B2E",
  red: "E4483B",
  green: "3FB68B",
  white: "FFFFFF",
  ink: "161A1F",
  ink1: "495260",
  ink2: "707C8C",
  card: "F4F5F3",
  line: "DCDFE1",
  blue: "5DA9E9",
};

const FONT_HEAD = "Cambria";
const FONT_BODY = "Calibri";
const FONT_MONO = "Courier New";

const W = 13.333, H = 7.5;

function shadow() {
  return { type: "outer", color: "000000", blur: 7, offset: 3, angle: 90, opacity: 0.12 };
}

function addSignal(slide, x, y, w, h, lit) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.06, fill: { color: C.ink }, line: { type: "none" } });
  const lampD = w * 0.56;
  const lx = x + (w - lampD) / 2;
  const gap = h * 0.06;
  const lampH = (h - gap * 4) / 3;
  const colors = [
    lit === "red" ? C.red : "39414C",
    lit === "amber" ? C.amber : "39414C",
    lit === "green" ? C.green : "39414C",
  ];
  colors.forEach((col, i) => {
    slide.addShape("ellipse", {
      x: lx, y: y + gap + i * (lampH + gap), w: lampD, h: lampH,
      fill: { color: col }, line: { type: "none" },
      shadow: (col !== "39414C") ? { type: "outer", color: col, blur: 10, offset: 0, angle: 0, opacity: 0.7 } : undefined,
    });
  });
}

function iconCircle(slide, iconData, x, y, d, bg = C.asphalt, iconScale = 0.52) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: bg }, line: { type: "none" } });
  const s = d * iconScale;
  slide.addImage({ data: iconData, x: x + (d - s) / 2, y: y + (d - s) / 2, w: s, h: s });
}

function pageNum(slide, n) {
  slide.addText(String(n).padStart(2, "0"), {
    x: W - 0.7, y: H - 0.42, w: 0.5, h: 0.3, fontFace: FONT_MONO, fontSize: 9, color: C.ink2, align: "right",
  });
}

function kicker(slide, text, opts = {}) {
  slide.addText(text.toUpperCase(), {
    x: opts.x ?? 0.6, y: opts.y ?? 0.42, w: opts.w ?? 9, h: 0.3,
    fontFace: FONT_BODY, fontSize: 11.5, bold: true, color: opts.color ?? C.amberDim, charSpacing: 1.5,
  });
}

function title(slide, text, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? 0.6, y: opts.y ?? 0.7, w: opts.w ?? 11.8, h: opts.h ?? 0.7,
    fontFace: FONT_HEAD, fontSize: opts.size ?? 28, bold: true, color: opts.color ?? C.ink, margin: 0,
  });
}

function footerStrip(slide, n, opts = {}) {
  slide.addText("EVENTPULSE", {
    x: 0.6, y: H - 0.42, w: 3, h: 0.3, fontFace: FONT_HEAD, fontSize: 10, bold: true,
    color: opts.dark ? C.ink2 : "5A6472",
  });
  pageNum(slide, n);
}

// ---------------------------------------------------------------------------
async function build() {
  const icons = {};
  const names = [
    "FaSearchLocation", "FaUsers", "FaSyncAlt", "FaDatabase", "FaChartBar",
    "FaRoute", "FaShieldAlt", "FaSatelliteDish", "FaMobileAlt", "FaBullhorn",
    "FaHardHat", "FaExclamationTriangle", "FaMapMarkedAlt", "FaTrafficLight",
    "FaLink", "FaBrain", "FaCalendarAlt", "FaChartLine", "FaClock", "FaCheckCircle",
  ];
  for (const n of names) icons[n] = await iconPng(n, "#F2A93B", 300);
  const iconsInk = {};
  for (const n of ["FaDatabase", "FaChartBar", "FaTrafficLight", "FaRoute", "FaSyncAlt", "FaBrain", "FaMapMarkedAlt", "FaShieldAlt", "FaLink"]) {
    iconsInk[n] = await iconPng(n, "#1B2027", 300);
  }

  let pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "EventPulse";
  pres.title = "EventPulse — Event Congestion Intelligence";

  // =========================================================================
  // Slide 1 — Problem Statement
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.asphalt };

    addSignal(s, 0.6, 0.55, 0.34, 0.78, "amber");
    s.addText([
      { text: "EVENT", options: { color: C.white } },
      { text: "PULSE", options: { color: C.amber } },
    ], { x: 1.08, y: 0.55, w: 5, h: 0.55, fontFace: FONT_HEAD, fontSize: 22, bold: true, margin: 0 });
    s.addText("EVENT-DRIVEN CONGESTION — PLANNED & UNPLANNED", {
      x: 1.1, y: 1.05, w: 7, h: 0.3, fontFace: FONT_MONO, fontSize: 10, color: "8089A0", charSpacing: 1,
    });

    kicker(s, "The Problem Statement", { color: C.amber, y: 1.85 });
    s.addText("When the city gathers, traffic breaks — and nobody saw it coming", {
      x: 0.6, y: 2.18, w: 11.8, h: 1.1, fontFace: FONT_HEAD, fontSize: 30, bold: true, color: C.white, lineSpacingMultiple: 1.08,
    });
    s.addText(
      "Political rallies, festivals, sports events, construction activity, and sudden gatherings all create " +
      "localized traffic breakdowns across Bengaluru. Some are scheduled weeks in advance; others happen with " +
      "no warning at all. Either way, the response today depends on whoever happens to be on shift — not on " +
      "what six months of incident history already says will happen.",
      { x: 0.6, y: 3.35, w: 9.2, h: 1.15, fontFace: FONT_BODY, fontSize: 13.5, color: "C4CAD4", lineSpacingMultiple: 1.3 }
    );

    const pains = [
      ["FaSearchLocation", "Impact isn't quantified in advance"],
      ["FaUsers", "Deployment is experience-driven"],
      ["FaSyncAlt", "No post-event learning system"],
    ];
    let px = 0.6;
    pains.forEach(([icon, label]) => {
      s.addShape("roundRect", { x: px, y: 4.85, w: 3.7, h: 1.35, rectRadius: 0.08, fill: { color: C.asphalt2 }, line: { color: C.hairline, width: 1 } });
      iconCircle(s, icons[icon], px + 0.22, 5.07, 0.62, C.asphalt, 0.5);
      s.addText(label, { x: px + 1.0, y: 4.97, w: 2.5, h: 0.95, fontFace: FONT_BODY, fontSize: 12, bold: true, color: C.white, lineSpacingMultiple: 1.15, valign: "middle" });
      px += 3.95;
    });

    s.addText("PROTOTYPE ROUND 2 SUBMISSION · 2026", {
      x: 0.6, y: H - 0.42, w: 5, h: 0.3, fontFace: FONT_MONO, fontSize: 9.5, color: "5A6472",
    });
    pageNum(s, 1);
  }

  // =========================================================================
  // Slide 2 — Proposed Solution: Features
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    kicker(s, "Proposed Solution — Part 1");
    title(s, "Five tools, one historical record");
    s.addText(
      "EventPulse is trained on a real, anonymized 6-month Bengaluru Traffic Police event export — 8,173 records across 21 corridors — and turns it into five working tools.",
      { x: 0.6, y: 1.35, w: 11.8, h: 0.45, fontFace: FONT_BODY, fontSize: 12.5, color: C.ink1 }
    );

    const features = [
      ["FaMapMarkedAlt", "Forecast & Map", "Score a planned or unplanned event before it happens: Severity Index, duration, personnel, barricades, and a named diversion."],
      ["FaCalendarAlt", "Upcoming Outlook", "A 7-day statistical projection of likely hotspots, plus a week planner with automatic conflict detection."],
      ["FaChartLine", "Historical Insights", "Six months of patterns: cause breakdown, the hourly dual-peak, top corridors, and the planned-vs-unplanned trend."],
      ["FaBrain", "Model Validation", "Two real, cross-validated ML models with their honest holdout metrics and benchmarks published, not asserted."],
      ["FaShieldAlt", "Live Ops Triage", "Already-known incidents triaged directly by their own priority and closure flags — a different problem from forecasting."],
      ["FaSyncAlt", "Learning Loop", "Resolved events compared against their own forecast, building a running accuracy score in real time."],
    ];
    const cw = 3.78, ch = 2.05, gx = 0.2, gy = 0.2;
    features.forEach(([icon, h4, body], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 0.6 + col * (cw + gx), y = 2.0 + row * (ch + gy);
      s.addShape("roundRect", { x, y, w: cw, h: ch, rectRadius: 0.09, fill: { color: C.card }, line: { type: "none" }, shadow: shadow() });
      iconCircle(s, icons[icon], x + 0.2, y + 0.2, 0.56, C.asphalt, 0.52);
      s.addText(h4, { x: x + 0.2, y: y + 0.85, w: cw - 0.4, h: 0.32, fontFace: FONT_HEAD, fontSize: 13.5, bold: true, color: C.ink, margin: 0 });
      s.addText(body, { x: x + 0.2, y: y + 1.18, w: cw - 0.4, h: 0.8, fontFace: FONT_BODY, fontSize: 9.5, color: C.ink1, lineSpacingMultiple: 1.18 });
    });

    footerStrip(s, 2);
  }

  // =========================================================================
  // Slide 3 — Proposed Solution: How It Helps
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    kicker(s, "Proposed Solution — Part 2");
    title(s, "How this answers the brief, point by point");

    const rows = [
      ["FaSearchLocation", "\u201CImpact isn't quantified in advance\u201D", "The Forecast and Outlook tools quantify it before the event starts: a Severity Index, a duration range, and a personnel count, scaled by expected event size."],
      ["FaUsers", "\u201CDeployment is experience-driven\u201D", "Manpower and barricade recommendations are grounded in this cause's and corridor's actual historical record, not a flat default or individual judgment."],
      ["FaSyncAlt", "\u201CNo post-event learning system\u201D", "The Learning Loop compares each resolved event's actual outcome against its forecast, building a running accuracy score that closes the gap directly."],
    ];
    let ry = 1.55;
    rows.forEach(([icon, problem, solution]) => {
      s.addShape("roundRect", { x: 0.6, y: ry, w: 12.1, h: 1.45, rectRadius: 0.09, fill: { color: C.card }, line: { type: "none" }, shadow: shadow() });
      iconCircle(s, icons[icon], 0.85, ry + 0.4, 0.66, C.asphalt, 0.5);
      s.addText(problem, { x: 1.75, y: ry + 0.16, w: 3.85, h: 1.15, fontFace: FONT_HEAD, fontSize: 13, bold: true, italic: true, color: C.ink, valign: "middle", lineSpacingMultiple: 1.15 });
      s.addShape("line", { x: 5.75, y: ry + 0.22, w: 0, h: 1.0, line: { color: C.line, width: 1 } });
      s.addText(solution, { x: 6.0, y: ry + 0.16, w: 6.5, h: 1.15, fontFace: FONT_BODY, fontSize: 11.5, color: C.ink1, valign: "middle", lineSpacingMultiple: 1.25 });
      ry += 1.68;
    });

    footerStrip(s, 3);
  }

  // =========================================================================
  // Slide 4 — Technical Architecture: Workflow
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    kicker(s, "Technical Architecture — Workflow");
    title(s, "Three layers, zero servers");

    const laneLabelOpts = { fontFace: FONT_BODY, fontSize: 10, bold: true, color: C.ink2, charSpacing: 0.8 };

    s.addText("OFFLINE — RUN ONCE, IN PYTHON", { x: 0.6, y: 1.5, w: 6, h: 0.3, ...laneLabelOpts });
    const l1Y = 1.85, l1H = 0.95, l1W = 2.55, l1Gap = 0.35;
    const l1 = [
      ["FaDatabase", "Raw Event CSV", "Anonymized B-TRAC\nexport, 8,173 rows"],
      ["FaChartBar", "data_pipeline.py", "pandas — aggregates,\nmap grid, junctions"],
      ["FaBrain", "train_models.py", "scikit-learn — Logistic\nRegression + Ridge, validated"],
    ];
    let lx = 0.6;
    l1.forEach(([icon, h4, sub], i) => {
      s.addShape("roundRect", { x: lx, y: l1Y, w: l1W, h: l1H, rectRadius: 0.07, fill: { color: C.card }, line: { type: "none" }, shadow: shadow() });
      iconCircle(s, iconsInk[icon] || icons[icon], lx + 0.14, l1Y + 0.18, 0.58, C.white, 0.52);
      s.addText(h4, { x: lx + 0.82, y: l1Y + 0.1, w: l1W - 0.95, h: 0.32, fontFace: FONT_HEAD, fontSize: 12, bold: true, color: C.ink, margin: 0 });
      s.addText(sub, { x: lx + 0.82, y: l1Y + 0.42, w: l1W - 0.95, h: 0.48, fontFace: FONT_BODY, fontSize: 8, color: C.ink2, lineSpacingMultiple: 1.05 });
      if (i < l1.length - 1) {
        s.addShape("triangle", { x: lx + l1W + l1Gap / 2 - 0.07, y: l1Y + l1H / 2 - 0.08, w: 0.14, h: 0.16, rotate: 90, fill: { color: C.ink2 }, line: { type: "none" } });
      }
      lx += l1W + l1Gap;
    });

    const artY = l1Y + l1H + 0.35;
    s.addShape("line", { x: W / 2, y: l1Y + l1H + 0.04, w: 0, h: 0.27, line: { color: C.ink2, width: 1.5 } });
    s.addShape("triangle", { x: W / 2 - 0.07, y: artY - 0.1, w: 0.14, h: 0.12, rotate: 180, fill: { color: C.ink2 }, line: { type: "none" } });

    const artW = 7.2, artH = 0.85;
    s.addShape("roundRect", { x: (W - artW) / 2, y: artY, w: artW, h: artH, rectRadius: 0.08, fill: { color: C.asphalt }, line: { type: "none" }, shadow: shadow() });
    iconCircle(s, icons["FaLink"], (W - artW) / 2 + 0.18, artY + 0.13, 0.58, C.asphalt2, 0.5);
    s.addText("model_data.json", { x: (W - artW) / 2 + 0.95, y: artY + 0.1, w: 4, h: 0.32, fontFace: FONT_HEAD, fontSize: 14, bold: true, color: C.white, margin: 0 });
    s.addText("~360 KB \u00B7 aggregates + learned model coefficients + validation metrics \u2014 the only artifact that crosses from Python to the browser", {
      x: (W - artW) / 2 + 0.95, y: artY + 0.44, w: artW - 1.1, h: 0.38, fontFace: FONT_BODY, fontSize: 9, color: "AAB3C0", lineSpacingMultiple: 1.1,
    });

    const l3LabelY = artY + artH + 0.3;
    s.addShape("line", { x: W / 2, y: artY + artH + 0.04, w: 0, h: 0.22, line: { color: C.ink2, width: 1.5 } });
    s.addShape("triangle", { x: W / 2 - 0.07, y: l3LabelY - 0.06, w: 0.14, h: 0.12, rotate: 180, fill: { color: C.ink2 }, line: { type: "none" } });

    s.addText("CLIENT — SIX STATIC PAGES, RUNS ENTIRELY IN THE BROWSER", { x: 0.6, y: l3LabelY + 0.12, w: 9, h: 0.3, ...laneLabelOpts });
    const l3Y = l3LabelY + 0.46, l3H = 0.95, l3W = 2.55, l3Gap = 0.35;
    const l3 = [
      ["FaMapMarkedAlt", "app.js + Leaflet", "Map, charts, form\nwiring (Chart.js too)"],
      ["FaTrafficLight", "engine.js", "Sigmoid + linear dot-\nproducts \u2014 the ML, inline"],
      ["FaShieldAlt", "6 HTML pages", "Forecast, Outlook, Insights,\nModels, Live Ops + Overview"],
    ];
    lx = 0.6;
    l3.forEach(([icon, h4, sub], i) => {
      s.addShape("roundRect", { x: lx, y: l3Y, w: l3W, h: l3H, rectRadius: 0.07, fill: { color: C.card }, line: { type: "none" }, shadow: shadow() });
      iconCircle(s, iconsInk[icon] || icons[icon], lx + 0.14, l3Y + 0.18, 0.58, C.white, 0.52);
      s.addText(h4, { x: lx + 0.82, y: l3Y + 0.1, w: l3W - 0.95, h: 0.32, fontFace: FONT_HEAD, fontSize: 12, bold: true, color: C.ink, margin: 0 });
      s.addText(sub, { x: lx + 0.82, y: l3Y + 0.42, w: l3W - 0.95, h: 0.48, fontFace: FONT_BODY, fontSize: 8, color: C.ink2, lineSpacingMultiple: 1.05 });
      if (i < l3.length - 1) {
        s.addShape("triangle", { x: lx + l3W + l3Gap / 2 - 0.07, y: l3Y + l3H / 2 - 0.08, w: 0.14, h: 0.16, rotate: 90, fill: { color: C.ink2 }, line: { type: "none" } });
      }
      lx += l3W + l3Gap;
    });

    const calloutY = l3Y + l3H + 0.3;
    s.addShape("roundRect", { x: 0.6, y: calloutY, w: 11.45, h: 0.5, rectRadius: 0.1, fill: { color: "FFF4E0" }, line: { color: "F0DCAE", width: 1 } });
    s.addText("No server. No database. No API keys. Deploys as static files to GitHub Pages or Netlify in minutes.", {
      x: 0.6, y: calloutY, w: 11.45, h: 0.5, align: "center", valign: "middle", fontFace: FONT_BODY, fontSize: 11.5, bold: true, color: "7A4C0C",
    });

    footerStrip(s, 4);
  }

  // =========================================================================
  // Slide 5 — Technical Architecture: Models & Training
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    kicker(s, "Technical Architecture — Models & Training");
    title(s, "Two real, validated models — and the honest numbers");

    const cardY = 1.5, cardH = 4.65, cardW = 5.75, cardGap = 0.3;

    let cx = 0.6;
    s.addShape("roundRect", { x: cx, y: cardY, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: C.asphalt }, line: { type: "none" }, shadow: shadow() });
    s.addText("CLOSURE RISK MODEL", { x: cx + 0.3, y: cardY + 0.22, w: 3.5, h: 0.3, fontFace: FONT_HEAD, fontSize: 14, bold: true, color: C.white, margin: 0 });
    s.addText("Logistic Regression", { x: cx + 0.3, y: cardY + 0.22, w: cardW - 0.6, h: 0.3, align: "right", fontFace: FONT_MONO, fontSize: 9.5, color: "AAB3C0" });
    const cStats = [["0.76", "Holdout AUC"], ["0.77", "5-Fold CV AUC"], ["0.76", "RF Benchmark"]];
    cStats.forEach((st, i) => {
      const sx = cx + 0.3 + i * 1.85;
      s.addText(st[0], { x: sx, y: cardY + 0.62, w: 1.7, h: 0.42, fontFace: FONT_MONO, fontSize: 22, bold: true, color: C.white, margin: 0 });
      s.addText(st[1].toUpperCase(), { x: sx, y: cardY + 1.06, w: 1.7, h: 0.3, fontFace: FONT_BODY, fontSize: 8.5, color: "8089A0" });
    });
    s.addText(
      "Predicts P(road closure required) for a cause + corridor + time-of-day + planned/unplanned combination \u2014 trained on 8,173 events, never on priority (see right). Base rate: 8% of historical events required a closure.",
      { x: cx + 0.3, y: cardY + 1.55, w: cardW - 0.6, h: 1.0, fontFace: FONT_BODY, fontSize: 10.5, color: "AAB3C0", lineSpacingMultiple: 1.25 }
    );
    const cImp = [["Cause", 0.46], ["Corridor", 0.24], ["Planned?", 0.20], ["Time of Day", 0.10]];
    let ciy = cardY + 2.85;
    cImp.forEach(([label, pct]) => {
      s.addText(label, { x: cx + 0.3, y: ciy, w: 1.3, h: 0.26, fontFace: FONT_BODY, fontSize: 9.5, color: "AAB3C0" });
      s.addShape("roundRect", { x: cx + 1.65, y: ciy + 0.06, w: cardW - 2.35, h: 0.12, rectRadius: 0.06, fill: { color: C.asphalt2 }, line: { type: "none" } });
      s.addShape("roundRect", { x: cx + 1.65, y: ciy + 0.06, w: (cardW - 2.35) * pct, h: 0.12, rectRadius: 0.06, fill: { color: C.amber }, line: { type: "none" } });
      s.addText(`${Math.round(pct * 100)}%`, { x: cx + cardW - 0.65, y: ciy - 0.04, w: 0.55, h: 0.26, align: "right", fontFace: FONT_MONO, fontSize: 9, color: "AAB3C0" });
      ciy += 0.34;
    });
    s.addText("Feature importance (Random Forest benchmark)", { x: cx + 0.3, y: ciy + 0.06, w: cardW - 0.6, h: 0.3, fontFace: FONT_BODY, fontSize: 8.5, italic: true, color: "5A6472" });

    cx = 0.6 + cardW + cardGap;
    s.addShape("roundRect", { x: cx, y: cardY, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: C.asphalt }, line: { type: "none" }, shadow: shadow() });
    s.addText("DURATION MODEL", { x: cx + 0.3, y: cardY + 0.22, w: 3.5, h: 0.3, fontFace: FONT_HEAD, fontSize: 14, bold: true, color: C.white, margin: 0 });
    s.addText("Ridge Regression", { x: cx + 0.3, y: cardY + 0.22, w: cardW - 0.6, h: 0.3, align: "right", fontFace: FONT_MONO, fontSize: 9.5, color: "AAB3C0" });
    const dStats = [["1.82h", "Holdout MAE"], ["0.08", "5-Fold CV R\u00B2"], ["3.7%", "vs Naive Median"]];
    dStats.forEach((st, i) => {
      const sx = cx + 0.3 + i * 1.85;
      s.addText(st[0], { x: sx, y: cardY + 0.62, w: 1.7, h: 0.42, fontFace: FONT_MONO, fontSize: 22, bold: true, color: C.white, margin: 0 });
      s.addText(st[1].toUpperCase(), { x: sx, y: cardY + 1.06, w: 1.7, h: 0.3, fontFace: FONT_BODY, fontSize: 8.5, color: "8089A0" });
    });
    s.addText(
      "Duration is the noisiest signal in this dataset \u2014 even the Random Forest benchmark only reaches R\u00B2=0.09. Rather than overclaim, the duration is always shown as a range, never a single false-confidence number.",
      { x: cx + 0.3, y: cardY + 1.55, w: cardW - 0.6, h: 1.0, fontFace: FONT_BODY, fontSize: 10.5, color: "AAB3C0", lineSpacingMultiple: 1.25 }
    );
    const dImp = [["Corridor", 0.36], ["Cause", 0.32], ["Time of Day", 0.19], ["Planned?", 0.09]];
    ciy = cardY + 2.85;
    dImp.forEach(([label, pct]) => {
      s.addText(label, { x: cx + 0.3, y: ciy, w: 1.3, h: 0.26, fontFace: FONT_BODY, fontSize: 9.5, color: "AAB3C0" });
      s.addShape("roundRect", { x: cx + 1.65, y: ciy + 0.06, w: cardW - 2.35, h: 0.12, rectRadius: 0.06, fill: { color: C.asphalt2 }, line: { type: "none" } });
      s.addShape("roundRect", { x: cx + 1.65, y: ciy + 0.06, w: (cardW - 2.35) * pct, h: 0.12, rectRadius: 0.06, fill: { color: C.amber }, line: { type: "none" } });
      s.addText(`${Math.round(pct * 100)}%`, { x: cx + cardW - 0.65, y: ciy - 0.04, w: 0.55, h: 0.26, align: "right", fontFace: FONT_MONO, fontSize: 9, color: "AAB3C0" });
      ciy += 0.34;
    });
    s.addText("Trained on 7,402 events with a valid duration", { x: cx + 0.3, y: ciy + 0.06, w: cardW - 0.6, h: 0.3, fontFace: FONT_BODY, fontSize: 8.5, italic: true, color: "5A6472" });

    footerStrip(s, 5);
  }

  // =========================================================================
  // Slide 6 — Application Walkthrough 1: Forecast & Map
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.asphalt };
    kicker(s, "Inside The Application", { color: C.amber });
    s.addText("Forecast & Map — score an event before it happens", {
      x: 0.6, y: 0.7, w: 11.8, h: 0.55, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.white,
    });
    s.addText(
      "A Large public event on Mysore Road, with a road closure: High Impact, a duration range, a personnel count, the corridor's own highest-incident junctions, and a named diversion — all on forecast.html.",
      { x: 0.6, y: 1.28, w: 11.8, h: 0.45, fontFace: FONT_BODY, fontSize: 11.5, color: "AAB3C0" }
    );

    const imgH = 5.55, imgW = imgH * (1078 / 1974);
    s.addImage({ path: "images/shot_forecast_clean.png", x: (W - imgW) / 2, y: 1.85, w: imgW, h: imgH,
      shadow: { type: "outer", color: "000000", blur: 14, offset: 6, angle: 90, opacity: 0.45 } });

    footerStrip(s, 6, { dark: true });
  }

  // =========================================================================
  // Slide 7 — Application Walkthrough 2: Upcoming Outlook
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.asphalt };
    kicker(s, "Inside The Application", { color: C.amber });
    s.addText("Upcoming Outlook — what's coming, not just what's named", {
      x: 0.6, y: 0.7, w: 11.8, h: 0.55, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.white,
    });
    s.addText(
      "Left: a 7-day statistical projection of unplanned hotspots from historical patterns. Right: known events added by hand get the same forecast, plus automatic conflict detection — here, two high-impact events on the same date and zone.",
      { x: 0.6, y: 1.28, w: 11.8, h: 0.55, fontFace: FONT_BODY, fontSize: 11.5, color: "AAB3C0", lineSpacingMultiple: 1.2 }
    );

    const imgW = 10.6, imgH = imgW * (1606 / 2736);
    s.addImage({ path: "images/shot_outlook.png", x: (W - imgW) / 2, y: 2.0, w: imgW, h: imgH,
      shadow: { type: "outer", color: "000000", blur: 14, offset: 6, angle: 90, opacity: 0.45 } });

    footerStrip(s, 7, { dark: true });
  }

  // =========================================================================
  // Slide 8 — Application Walkthrough 3: Live Ops & Learning Loop
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.asphalt };
    kicker(s, "Inside The Application", { color: C.amber });
    s.addText("Live Ops & Learning Loop — closing the feedback gap", {
      x: 0.6, y: 0.7, w: 11.8, h: 0.55, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.white,
    });
    s.addText(
      "Live incidents are triaged by their own known priority and closure flags, not predicted. Resolving one with its actual outcome updates a running session accuracy score — 72% here after one submission.",
      { x: 0.6, y: 1.28, w: 11.8, h: 0.45, fontFace: FONT_BODY, fontSize: 11.5, color: "AAB3C0" }
    );

    const imgW = 11.4, imgH = imgW * (970 / 2736);
    s.addImage({ path: "images/shot_liveops.png", x: (W - imgW) / 2, y: 2.0, w: imgW, h: imgH,
      shadow: { type: "outer", color: "000000", blur: 14, offset: 6, angle: 90, opacity: 0.45 } });

    footerStrip(s, 8, { dark: true });
  }

  // =========================================================================
  // Slide 9 — Conclusion & Future Scope
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.white };
    kicker(s, "Conclusion & Future Scope");
    title(s, "From hackathon prototype to control-room pilot");

    s.addText(
      "EventPulse is a fully working, deployable prototype today, built on real anonymized B-TRAC data, with " +
      "two validated ML models and no backend to provision. The fastest way to know if it earns its place in " +
      "the control room is to point it at one corridor's live events and watch it forecast.",
      { x: 0.6, y: 1.5, w: 11.8, h: 0.85, fontFace: FONT_BODY, fontSize: 13, color: C.ink1, lineSpacingMultiple: 1.3 }
    );

    const items = [
      ["FaSatelliteDish", "Live signal ingestion", "Real-time GPS/traffic-API feeds so the map reflects the city right now, not just history."],
      ["FaRoute", "Real road-graph routing", "Replace the corridor-load heuristic with an actual shortest-alternate-path engine."],
      ["FaMobileAlt", "A field app for officers", "Push the deployment plan straight to the assigned team's phone, one-tap acknowledgement."],
      ["FaDatabase", "B-TRAC / dispatch integration", "Ingest permit filings and live incident tickets automatically — no manual re-entry."],
    ];
    const cw = 2.85, ch = 2.5, gx = 0.2;
    items.forEach(([icon, h4, body], i) => {
      const x = 0.6 + i * (cw + gx);
      s.addShape("roundRect", { x, y: 2.65, w: cw, h: ch, rectRadius: 0.09, fill: { color: C.card }, line: { type: "none" }, shadow: shadow() });
      iconCircle(s, icons[icon], x + cw / 2 - 0.34, 2.95, 0.68, C.asphalt, 0.5);
      s.addText(h4, { x: x + 0.16, y: 3.78, w: cw - 0.32, h: 0.6, align: "center", fontFace: FONT_HEAD, fontSize: 12.5, bold: true, color: C.ink, margin: 0 });
      s.addText(body, { x: x + 0.18, y: 4.4, w: cw - 0.36, h: 0.68, align: "center", fontFace: FONT_BODY, fontSize: 9, color: C.ink1, lineSpacingMultiple: 1.18 });
    });

    s.addShape("roundRect", { x: 0.6, y: 5.5, w: 6.85, h: 0.46, rectRadius: 0.23, fill: { color: C.asphalt }, line: { type: "none" } });
    s.addText("THEME \u00B7 EVENT-DRIVEN CONGESTION \u2014 PLANNED & UNPLANNED", {
      x: 0.6, y: 5.5, w: 6.85, h: 0.46, align: "center", valign: "middle", fontFace: FONT_BODY, fontSize: 11, bold: true, color: C.amber, charSpacing: 0.5,
    });

    footerStrip(s, 9);
  }

  await pres.writeFile({ fileName: "EventPulse_Pitch_Deck.pptx" });
  console.log("Simplified deck written.");
}

build().catch(err => { console.error(err); process.exit(1); });
