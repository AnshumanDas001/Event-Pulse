# Event Plan Optima
### Event Congestion Intelligence for Bengaluru Traffic Police

Forecasts the traffic impact of **planned** events (rallies, festivals, construction)
and **unplanned** ones (breakdowns, accidents, flooding), and recommends the
manpower, barricading, and diversion plan to meet it — grounded entirely in a
real, anonymized 6-month Bengaluru Traffic Police event export (8,173 records,
Nov 2023 – Apr 2024).

Built for the hackathon theme **"Event-Driven Congestion (Planned & Unplanned)."**

---

## What's in this repository

```
eventpulse/
├── pipeline/                  Python data pipeline (raw CSV → aggregated model)
│   ├── data_pipeline.py       Aggregates: KPIs, corridor/cause profiles, map grid
│   ├── train_models.py        Trains + validates the two ML models (see below)
│   └── requirements.txt
├── dashboard/                 The product — a static, zero-backend, multi-page web app
│   ├── index.html              Overview / landing page
│   ├── forecast.html           Event density map + single-event forecaster
│   ├── outlook.html            7-day predicted hotspots + week planner
│   ├── insights.html           Historical charts (six months of events)
│   ├── models.html             Model validation (real holdout/CV metrics)
│   ├── feedback.html           Post-event feedback (learning loop) + live operations triage
│   ├── model_data.json        Output of the pipeline (privacy-safe aggregates)
│   └── assets/
│       ├── style.css
│       ├── app.js             UI wiring (charts, map, form handling) — shared by every page
│       ├── engine.js           Forecast + Triage + Outlook recommendation engine
│       ├── leaflet.js / .css   Self-hosted map library (forecast.html only)
│       ├── chart.umd.min.js    Self-hosted charting library (insights.html only)
│       └── fonts/              Self-hosted webfonts
└── deck/                       Pitch deck source
    ├── build_deck.js           pptxgenjs script that generates the .pptx
    ├── icons.js
    └── images/                 Dashboard screenshots used in the deck
```

The dashboard is a **six-page static site** — no server, no database, no
API keys, and only one shared `app.js` / `engine.js` across all six pages
(each page's `boot()` step only wires the sections that exist in that
page's HTML, so the same two scripts run unmodified everywhere). Every
number on every page comes from `model_data.json`, which is itself
generated once from the raw CSV by the Python pipeline.

| Page | What's on it |
|---|---|
| `index.html` | Landing page — KPI strip + a card linking to each of the five tools below |
| `forecast.html` | Event density map + the single-event forecaster |
| `outlook.html` | 7-day predicted hotspots + the "Plan Your Week" multi-event planner |
| `insights.html` | Four historical charts (cause, hour-of-day, top corridors, monthly trend) |
| `models.html` | Real ML validation metrics + the "why these two targets" writeup |
| `feedback.html` | Post-event learning loop (left) + live triage feed (right) — each feed row has a "Resolve" button that sends it straight into the loop |

That makes the whole thing trivial to run locally and to deploy publicly
for free.

---

## 1. Regenerating the data (optional — already done)

`dashboard/model_data.json` is already built and committed, so you can skip
straight to step 2. To rebuild it from the raw event export yourself:

```bash
cd pipeline
pip install -r requirements.txt
python3 data_pipeline.py /path/to/Astram_event_data.csv   # aggregates
python3 train_models.py /path/to/Astram_event_data.csv    # ML models (run second)
```

This writes `dashboard/model_data.json` (aggregates, then extended with an
`"ml"` key by the second script) and `deck/analysis_summary.json`.
The pipeline only ever writes *aggregates* — counts, medians, percentages,
learned model coefficients, and coordinates rounded to ~110 m grid cells.
No row-level record, vehicle number, citizen ID, or officer ID is ever
included in the output. `pip install scikit-learn` if it isn't already
present in your environment — it's the only extra dependency
`train_models.py` needs beyond `requirements.txt`.

## 2. Running the dashboard locally

Because the page `fetch()`s `model_data.json`, it needs to be served over
`http://`, not opened directly as a `file://` path. Any static file server
works:

```bash
cd dashboard
python3 -m http.server 8080
# then open http://localhost:8080 in a browser
```

or, with Node installed:

```bash
cd dashboard
npx serve .
```

No build step, no `npm install` required to run it — `assets/` already
contains the built Leaflet, Chart.js, and font files.

## 3. Deploying it publicly (for the Demo Link)

Pick whichever is fastest for you:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the
  `dashboard/` folder onto the page. You get a public URL in under a minute.
- **GitHub Pages** — push this repo to GitHub, then in
  *Settings → Pages* set the source to the `dashboard/` folder (or move its
  contents to the repo root / a `docs/` folder, whichever your Pages config
  expects). The published URL is your Demo Link.
- **Vercel** — `vercel dashboard` from the CLI after `npm i -g vercel`.

All three are free, require no backend, and no environment variables.

## 4. Rebuilding the pitch deck

```bash
cd deck
npm install
node build_deck.js
```

This regenerates `EventPulse_Pitch_Deck.pptx` from real numbers in
`analysis_summary.json` and the screenshots in `images/`. Native PowerPoint
charts are used throughout (not pasted images) so the deck stays editable.

---

## Forecasting what's coming, not just scoring what's named

Two more views sit right below the single-event forecaster, both reachable
without leaving the dashboard:

- **Predicted Hotspots (next 7 days)** — a pure statistical projection for
  *unplanned* events. `engine.js`'s `forecastOutlook()` takes each
  corridor+cause combination frequent enough to support a weekly-rate
  estimate (`model_data.json["hotspot_rates"]`, computed by
  `data_pipeline.py`), splits that rate across the next 7 calendar days
  using the cause's own historical day-of-week pattern, and ranks the
  result by *expected count × historical severity* rather than raw
  frequency — so a rare-but-severe risk (a protest, say) isn't drowned out
  by routine vehicle breakdowns. The single best corridor per cause is
  kept for each day, so the list shows a spread of different risks rather
  than three flavors of the same one. There's no live signal behind this —
  it's explicitly labeled as a statistical projection.
- **Plan Your Week** — for events you *do* already know about (a permitted
  rally, scheduled construction), add them by hand and get the same
  Severity Index, duration range, and personnel count as the single-event
  forecaster, plus a weekly summary (total personnel-slots, busiest day)
  and automatic conflict detection: two High/Critical events sharing a
  date and a zone get flagged before deployment day, not after.

## How the recommendation engine works

`dashboard/assets/engine.js` scores two real, trained, validated models —
not hand-tuned weights. `pipeline/train_models.py` fits them with
scikit-learn and exports their learned coefficients into
`model_data.json["ml"]`:

- **Closure Risk** — `LogisticRegression`, predicts P(this event needs a
  road closure) from cause + corridor + time-of-day + planned/unplanned.
  Holdout AUC 0.76, 5-fold CV AUC 0.77 (vs 0.50 random, vs 0.76 for a
  Random Forest benchmark — the linear model didn't give up meaningful
  accuracy for its interpretability).
- **Duration** — `Ridge` regression on log(hours), same features plus the
  closure flag. Honestly the noisiest signal in this dataset (test R² ≈
  0.08) — so the UI always shows it as a range built from the model's own
  residual spread, never a single false-confidence number.

**An important negative result that shaped both targets:** we first tried
training on `priority`, and found it's almost perfectly determined by
`corridor` alone — every named corridor is ~100% "High", "Non-corridor" is
~99.8% "Low". It's an operational designation, not a judgment call, and a
model "predicting" it would report a meaningless 99.9% AUC. We dropped it
and modeled the two genuinely uncertain signals in the data instead — see
the docstring in `train_models.py` for the full writeup.

Both models are linear on purpose: every prediction is a transparent,
inspectable weighted sum of learned coefficients, portable to ~40 lines of
JavaScript with no inference library required at runtime — a control room
can always ask "why this number?" and get a straight answer. The Random
Forest benchmarks are published in `model_data.json["ml"]["metrics"]` but
never shipped to the client, since their coefficients aren't portable.

`engine.js` has one more function, `triage()`, which is deliberately
**not** ML — for an incident already on the board (the "Live Operations
Feed"), priority and road-closure status are already known facts, not
predictions, so triage is a simple, direct lookup. Forecasting and triage
are different problems and the product treats them as two distinct tools
sharing the same underlying profile data.

The **Post-Event Learning Loop** widget closes the gap the original problem
statement calls out directly ("no post-event learning system"): resolving a
sample event with its actual outcome updates a running session accuracy
score, demonstrating how real deployment would continuously recalibrate.

## Regenerating the ML models

```bash
cd pipeline
python3 data_pipeline.py /path/to/Astram_event_data.csv   # aggregates first
python3 train_models.py /path/to/Astram_event_data.csv    # then ML models
```

`train_models.py` must run after `data_pipeline.py` — it loads the
existing `model_data.json` and adds an `"ml"` key to it rather than
regenerating the whole file. It prints both models' holdout metrics,
5-fold cross-validation scores, and Random Forest benchmark comparisons to
the console as it runs.

## Privacy

The source CSV already arrives anonymized. This project adds a second layer
on top before anything reaches the browser: map points are aggregated to
~110 m grid cells (counts only, no individual record), and the "Live
Operations Feed" only ever shows a place name and cause — never an ID of any
kind. `model_data.json` is the only file the browser ever loads, and it
contains no row-level data at all.

## Tech stack

Vanilla JavaScript, Leaflet (map), Chart.js (charts) — all self-hosted, no
CDN calls, works fully offline once loaded. Python + pandas for the
one-time data aggregation step. No backend, no database, no API keys.
