"""
EventPulse — Data Pipeline
===========================
Turns the raw anonymized Bengaluru Traffic Police event export into:

  1. dashboard/model_data.json
     Aggregated, privacy-safe statistics that power the EventPulse
     dashboard's charts, map heat-layer, and the client-side
     forecasting / resource-recommendation engine.

  2. deck/analysis_summary.json
     The same headline numbers, reshaped for easy use when building
     the pitch deck charts.

No row-level record (vehicle number, citizen id, internal user id,
police id, etc.) is ever written to the outputs. Map points are
rounded to ~110m grid cells and only aggregate counts per cell are
kept, so no single real incident can be re-identified from the
output files.

Run:
    python3 data_pipeline.py /path/to/Astram_event_data.csv
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_INPUT = "/mnt/user-data/uploads/Astram_event_data_anonymized_-_Astram_event_data_anonymizedb40ac87.csv"
OUT_DASHBOARD = Path(__file__).resolve().parent.parent / "dashboard" / "model_data.json"
OUT_DECK = Path(__file__).resolve().parent.parent / "deck" / "analysis_summary.json"

MAX_DURATION_HR = 48          # clip outlier / data-entry-error durations
GRID_DECIMALS = 3             # ~110m grid cells for the privacy-safe heatmap
MAX_HEAT_CELLS = 4000
SAMPLE_FEED_SIZE = 24         # rows shown in the "Live Ops Feed" demo widget

CAUSE_LABELS = {
    "vehicle_breakdown": "Vehicle Breakdown",
    "others": "Other",
    "pot_holes": "Pothole",
    "construction": "Construction",
    "water_logging": "Water-logging",
    "accident": "Accident",
    "tree_fall": "Tree Fall",
    "road_conditions": "Road Conditions",
    "congestion": "Congestion",
    "public_event": "Public Event",
    "procession": "Procession",
    "vip_movement": "VIP Movement",
    "protest": "Protest",
    "debris": "Debris",
    "Debris": "Debris",
    "test_demo": "Test / Demo",
    "Fog / Low Visibility": "Fog / Low Visibility",
}


def norm_cause(c):
    if pd.isna(c):
        return "others"
    c = str(c).strip()
    if c.lower() == "debris":
        return "debris"
    return c


def safe_float(x, default=0.0):
    try:
        if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    print(f"Loading {src} ...")
    df = pd.read_csv(src, low_memory=False)
    print(f"Loaded {len(df):,} rows, {len(df.columns)} columns")

    # -- normalize -----------------------------------------------------
    df["event_cause"] = df["event_cause"].apply(norm_cause)
    df["start_datetime"] = pd.to_datetime(df["start_datetime"], errors="coerce", utc=True)
    df["closed_datetime"] = pd.to_datetime(df["closed_datetime"], errors="coerce", utc=True)
    df["resolved_datetime"] = pd.to_datetime(df["resolved_datetime"], errors="coerce", utc=True)
    df["modified_datetime"] = pd.to_datetime(df["modified_datetime"], errors="coerce", utc=True)
    df["end_best"] = (
        df["closed_datetime"].fillna(df["resolved_datetime"]).fillna(df["modified_datetime"])
    )
    df["duration_hr"] = (df["end_best"] - df["start_datetime"]).dt.total_seconds() / 3600.0
    df["hour"] = df["start_datetime"].dt.hour
    df["dow"] = df["start_datetime"].dt.day_name()
    df["dayofweek"] = df["start_datetime"].dt.dayofweek  # Monday=0 .. Sunday=6
    df["month"] = df["start_datetime"].dt.strftime("%Y-%m")
    df["corridor"] = df["corridor"].fillna("Non-corridor").replace("", "Non-corridor")
    df["priority"] = df["priority"].fillna("Low")

    dur_ok = df["duration_hr"].between(0, MAX_DURATION_HR)

    # -----------------------------------------------------------------
    # 1. Headline KPIs
    # -----------------------------------------------------------------
    n_total = len(df)
    n_planned = int((df["event_type"] == "planned").sum())
    n_unplanned = int((df["event_type"] == "unplanned").sum())
    pct_high_priority = round(100 * (df["priority"] == "High").mean(), 1)
    pct_road_closure = round(100 * df["requires_road_closure"].astype(bool).mean(), 1)
    median_resolution_hr = round(df.loc[dur_ok, "duration_hr"].median(), 2)
    n_corridors = int(df.loc[df["corridor"] != "Non-corridor", "corridor"].nunique())
    date_min = str(df["start_datetime"].min().date())
    date_max = str(df["start_datetime"].max().date())

    kpis = {
        "total_events": n_total,
        "planned_events": n_planned,
        "unplanned_events": n_unplanned,
        "pct_high_priority": pct_high_priority,
        "pct_road_closure": pct_road_closure,
        "median_resolution_hr": median_resolution_hr,
        "tracked_corridors": n_corridors,
        "date_range": [date_min, date_max],
    }

    # -----------------------------------------------------------------
    # 2. Per-cause profile (drives the forecasting engine)
    # -----------------------------------------------------------------
    cause_profile = {}
    for cause, g in df.groupby("event_cause"):
        d = g.loc[g["duration_hr"].between(0, MAX_DURATION_HR), "duration_hr"]
        hour_counts = g["hour"].value_counts().reindex(range(24), fill_value=0)
        hour_dist = (hour_counts / max(hour_counts.sum(), 1)).round(4).tolist()
        dow_counts = g["dayofweek"].value_counts().reindex(range(7), fill_value=0)
        dow_dist = (dow_counts / max(dow_counts.sum(), 1)).round(4).tolist()
        cause_profile[cause] = {
            "label": CAUSE_LABELS.get(cause, cause.replace("_", " ").title()),
            "n": int(len(g)),
            "pct_high_priority": round(100 * (g["priority"] == "High").mean(), 1),
            "pct_road_closure": round(100 * g["requires_road_closure"].astype(bool).mean(), 1),
            "median_duration_hr": round(float(d.median()) if len(d) else 1.0, 2),
            "p75_duration_hr": round(float(d.quantile(0.75)) if len(d) else 1.5, 2),
            "is_planned": bool((g["event_type"] == "planned").mode().iat[0]) if len(g) else False,
            "hour_distribution": hour_dist,
            "peak_hour": int(np.argmax(hour_dist)),
            "dow_distribution": dow_dist,
        }

    # Order causes: planned-style first (as used in the "plan an event" form),
    # then unplanned causes, by frequency.
    MIN_CAUSE_N = 10  # drop noise/test rows (e.g. "test_demo") from selectable options
    planned_causes = [c for c, p in cause_profile.items() if p["is_planned"] and p["n"] >= MIN_CAUSE_N]
    unplanned_causes = [c for c, p in cause_profile.items() if not p["is_planned"] and p["n"] >= MIN_CAUSE_N]
    planned_causes.sort(key=lambda c: -cause_profile[c]["n"])
    unplanned_causes.sort(key=lambda c: -cause_profile[c]["n"])

    # -----------------------------------------------------------------
    # 3. Per-corridor profile (density baseline + zone + barricade points)
    # -----------------------------------------------------------------
    corridor_profile = {}
    for corridor, g in df.groupby("corridor"):
        zone_mode = g["zone"].dropna()
        zone = zone_mode.mode().iat[0] if len(zone_mode) else "Unzoned"
        lat = g["latitude"].replace(0, np.nan).dropna()
        lon = g["longitude"].replace(0, np.nan).dropna()
        top_causes = g["event_cause"].value_counts().head(3)
        corridor_profile[corridor] = {
            "n": int(len(g)),
            "zone": zone,
            "centroid": [round(float(lat.mean()), 5) if len(lat) else None,
                         round(float(lon.mean()), 5) if len(lon) else None],
            "pct_high_priority": round(100 * (g["priority"] == "High").mean(), 1),
            "top_causes": [{"cause": c, "n": int(n)} for c, n in top_causes.items()],
        }

    max_corridor_n = max(p["n"] for p in corridor_profile.values())
    for p in corridor_profile.values():
        p["density_norm"] = round(p["n"] / max_corridor_n, 4)

    # joint cause x corridor counts — lets the UI flag forecasts that
    # extrapolate the (additive, no-interaction) ML models far beyond what
    # was actually observed for that exact combination.
    cause_corridor_n = {}
    for (corridor, cause), g in df.groupby(["corridor", "event_cause"]):
        cause_corridor_n.setdefault(corridor, {})[cause] = int(len(g))

    # zone -> list of corridors, used for diversion suggestions
    zone_corridors = {}
    for corridor, p in corridor_profile.items():
        zone_corridors.setdefault(p["zone"], []).append(corridor)

    # -----------------------------------------------------------------
    # 3b. Hotspot rates — corridor x cause combinations frequent enough to
    # support a "how many of these per week, typically" estimate. This is
    # what powers the Upcoming Outlook's auto-forecast of likely unplanned
    # hotspots: rate_per_week x that cause's day-of-week share gives an
    # expected count for any specific upcoming calendar day.
    # -----------------------------------------------------------------
    MIN_HOTSPOT_N = 15
    span_days = (df["start_datetime"].max() - df["start_datetime"].min()).days
    weeks_span = max(span_days / 7.0, 1.0)

    hotspot_rates = []
    for (corridor, cause), g in df.groupby(["corridor", "event_cause"]):
        n = len(g)
        if n < MIN_HOTSPOT_N or cause not in cause_profile or corridor == "Non-corridor":
            continue
        hotspot_rates.append({
            "corridor": corridor,
            "cause": cause,
            "n": int(n),
            "rate_per_week": round(n / weeks_span, 3),
            "peak_hour": cause_profile[cause]["peak_hour"],
            "is_planned": cause_profile[cause]["is_planned"],
        })
    hotspot_rates.sort(key=lambda r: -r["rate_per_week"])
    hotspot_rates = hotspot_rates[:80]

    # -----------------------------------------------------------------
    # 4. Barricade / response points: junctions & police stations per corridor
    # -----------------------------------------------------------------
    junction_points = {}
    jdf = df.dropna(subset=["junction"])
    jdf = jdf[jdf["junction"].astype(str).str.strip() != ""]
    for corridor, g in jdf.groupby("corridor"):
        pts = []
        for junction, gg in g.groupby("junction"):
            lat = gg["latitude"].replace(0, np.nan).dropna()
            lon = gg["longitude"].replace(0, np.nan).dropna()
            if len(lat) == 0:
                continue
            pts.append({
                "name": str(junction),
                "lat": round(float(lat.mean()), 5),
                "lon": round(float(lon.mean()), 5),
                "n": int(len(gg)),
            })
        pts.sort(key=lambda x: -x["n"])
        if pts:
            junction_points[corridor] = pts[:6]

    station_points = {}
    sdf = df.dropna(subset=["police_station"])
    for corridor, g in sdf.groupby("corridor"):
        pts = []
        for station, gg in g.groupby("police_station"):
            lat = gg["latitude"].replace(0, np.nan).dropna()
            lon = gg["longitude"].replace(0, np.nan).dropna()
            if len(lat) == 0:
                continue
            pts.append({
                "name": str(station),
                "lat": round(float(lat.mean()), 5),
                "lon": round(float(lon.mean()), 5),
                "n": int(len(gg)),
            })
        pts.sort(key=lambda x: -x["n"])
        if pts:
            station_points[corridor] = pts[:4]

    # -----------------------------------------------------------------
    # 5. Privacy-safe heat grid for the map (rounded coords, counts only)
    # -----------------------------------------------------------------
    geo = df.copy()
    geo = geo[(geo["latitude"].notna()) & (geo["longitude"].notna())]
    geo = geo[(geo["latitude"] != 0) & (geo["longitude"] != 0)]
    geo["glat"] = geo["latitude"].round(GRID_DECIMALS)
    geo["glon"] = geo["longitude"].round(GRID_DECIMALS)
    grid = (
        geo.groupby(["glat", "glon", "event_cause", "corridor"])
        .size()
        .reset_index(name="n")
        .sort_values("n", ascending=False)
    )
    if len(grid) > MAX_HEAT_CELLS:
        grid = grid.head(MAX_HEAT_CELLS)
    heat_points = [
        {"lat": float(r.glat), "lon": float(r.glon), "cause": r.event_cause,
         "corridor": r.corridor, "n": int(r.n)}
        for r in grid.itertuples()
    ]

    # -----------------------------------------------------------------
    # 6. Monthly trend (planned vs unplanned)
    # -----------------------------------------------------------------
    monthly = (
        df.groupby(["month", "event_type"]).size().unstack(fill_value=0).sort_index()
    )
    monthly_trend = {
        "months": monthly.index.tolist(),
        "planned": monthly.get("planned", pd.Series([0] * len(monthly))).tolist(),
        "unplanned": monthly.get("unplanned", pd.Series([0] * len(monthly))).tolist(),
    }

    # -----------------------------------------------------------------
    # 7. Top corridors (for bar chart)
    # -----------------------------------------------------------------
    top_corridors = (
        df[df["corridor"] != "Non-corridor"]["corridor"].value_counts().head(10)
    )
    top_corridors_chart = {
        "labels": top_corridors.index.tolist(),
        "values": [int(v) for v in top_corridors.values],
    }

    # -----------------------------------------------------------------
    # 8. Sample "Live Ops Feed" rows (location text only, no IDs)
    # -----------------------------------------------------------------
    valid_causes = set(planned_causes) | set(unplanned_causes)
    feed_pool = df[df["event_cause"].isin(valid_causes)].dropna(subset=["address"])
    feed_rows = []
    rng = np.random.RandomState(42)
    causes_by_freq = feed_pool["event_cause"].value_counts().index.tolist()
    per_cause_quota = max(1, SAMPLE_FEED_SIZE // max(len(causes_by_freq), 1))
    for cause in causes_by_freq:
        pool = feed_pool[feed_pool["event_cause"] == cause]
        take = min(per_cause_quota, len(pool))
        if take:
            feed_rows.append(pool.sample(n=take, random_state=42))
        if sum(len(r) for r in feed_rows) >= SAMPLE_FEED_SIZE:
            break
    feed_src = pd.concat(feed_rows).sample(frac=1, random_state=7) if feed_rows else feed_pool.head(0)
    feed_src = feed_src.head(SAMPLE_FEED_SIZE)
    live_feed = []
    for r in feed_src.itertuples():
        addr = str(r.address)
        short_addr = addr.split(",")[0:2]
        short_addr = ", ".join(short_addr)
        live_feed.append({
            "cause": r.event_cause,
            "label": CAUSE_LABELS.get(r.event_cause, str(r.event_cause).title()),
            "priority": r.priority if isinstance(r.priority, str) else "Low",
            "corridor": r.corridor,
            "address": short_addr,
            "requires_road_closure": bool(r.requires_road_closure),
            "lat": safe_float(r.latitude),
            "lon": safe_float(r.longitude),
        })

    # -----------------------------------------------------------------
    # 9. Hour-of-day overall histogram (for the chart row)
    # -----------------------------------------------------------------
    overall_hour = df["hour"].value_counts().reindex(range(24), fill_value=0)
    hour_chart = {"labels": list(range(24)), "values": [int(v) for v in overall_hour.values]}

    cause_chart = df["event_cause"].value_counts().head(10)
    cause_chart_data = {
        "labels": [CAUSE_LABELS.get(c, c) for c in cause_chart.index],
        "keys": list(cause_chart.index),
        "values": [int(v) for v in cause_chart.values],
    }

    # -----------------------------------------------------------------
    # Assemble dashboard payload
    # -----------------------------------------------------------------
    model_data = {
        "generated_from": "Astram / B-TRAC anonymized event export",
        "kpis": kpis,
        "cause_profile": cause_profile,
        "planned_causes": planned_causes,
        "unplanned_causes": unplanned_causes,
        "corridor_profile": corridor_profile,
        "cause_corridor_n": cause_corridor_n,
        "hotspot_rates": hotspot_rates,
        "weeks_span": round(weeks_span, 2),
        "zone_corridors": zone_corridors,
        "junction_points": junction_points,
        "station_points": station_points,
        "heat_points": heat_points,
        "monthly_trend": monthly_trend,
        "top_corridors_chart": top_corridors_chart,
        "hour_chart": hour_chart,
        "cause_chart": cause_chart_data,
        "live_feed": live_feed,
    }

    OUT_DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_DASHBOARD, "w") as f:
        json.dump(model_data, f, indent=None, separators=(",", ":"))
    print(f"Wrote {OUT_DASHBOARD} ({OUT_DASHBOARD.stat().st_size/1024:.0f} KB)")

    # Slimmer summary for slide-building
    OUT_DECK.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_DECK, "w") as f:
        json.dump({
            "kpis": kpis,
            "cause_chart": cause_chart_data,
            "hour_chart": hour_chart,
            "top_corridors_chart": top_corridors_chart,
            "monthly_trend": monthly_trend,
            "cause_profile": {k: {kk: vv for kk, vv in v.items() if kk != "hour_distribution"}
                               for k, v in cause_profile.items()},
        }, f, indent=2)
    print(f"Wrote {OUT_DECK}")


if __name__ == "__main__":
    main()
