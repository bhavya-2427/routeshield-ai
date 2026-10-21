"""Safety engine: turns an OSRM route into model features and a safety score.

Idea
----
The classifier was trained on area-level records (one row = one Delhi location at
one moment). A route is a line, so we:
  1. sample points along the route geometry,
  2. map every sample to the nearest of the 40 known Delhi areas,
  3. build the same 44-feature vector the model was trained on (area stats for the
     requested time of day + weather + date),
  4. average the model's class probabilities over the whole route.
"""
from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE = Path(__file__).parent
BUNDLE = joblib.load(BASE / "model" / "routeshield_model_bundle.pkl")
_P = json.loads((BASE / "model" / "location_profiles.json").read_text())
PROFILES: dict = _P["locations"]
WEATHER_VIS: dict = _P["weather_visibility"]

MODEL = BUNDLE["model"]
FEATURES = BUNDLE["feature_columns"]
CLASSES = list(BUNDLE["target_encoder"].classes_)  # ['Moderate', 'Safe', 'Unsafe']
LOC_NAMES = list(PROFILES)
LOC_LAT = np.array([PROFILES[n]["lat"] for n in LOC_NAMES])
LOC_LON = np.array([PROFILES[n]["lon"] for n in LOC_NAMES])

MAX_MATCH_KM = 12.0  # farther than this from every known area = outside coverage
SAFE_T, MOD_T = 66.0, 35.0  # score thresholds, same as the dataset's label rule


# ----------------------------------------------------------------- geometry
def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def nearest_location(lat: float, lon: float):
    d = haversine_km(lat, lon, LOC_LAT, LOC_LON)
    i = int(np.argmin(d))
    return LOC_NAMES[i], float(d[i])


def sample_route(coords: list[list[float]], step_km: float = 0.4, max_pts: int = 30):
    """coords = GeoJSON [lon, lat] pairs. Returns evenly spaced (lat, lon) samples."""
    if not coords:
        return []
    pts = [(c[1], c[0]) for c in coords]
    out, acc = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        acc += float(haversine_km(a[0], a[1], b[0], b[1]))
        if acc >= step_km:
            out.append(b)
            acc = 0.0
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    if len(out) > max_pts:
        idx = np.linspace(0, len(out) - 1, max_pts).round().astype(int)
        out = [out[i] for i in idx]
    return out


def time_of_day(hour: int) -> str:
    if 6 <= hour < 12:
        return "Morning"
    if 12 <= hour < 17:
        return "Afternoon"
    if 17 <= hour < 21:
        return "Evening"
    return "Night"


# ----------------------------------------------------------------- features
def _row(profile: dict, lat: float, lon: float, loc: str, tod: str, weather: str, dt: datetime, hour: int):
    stats = profile["by_time"].get(tod) or profile["mean"]
    r = {c: 0 for c in FEATURES}
    for k, v in stats.items():
        if k in r:
            r[k] = v
    # visibility depends on weather, not on the area
    r["Weather_Visibility_KM"] = WEATHER_VIS.get(weather, stats["Weather_Visibility_KM"])
    r["Latitude"], r["Longitude"] = lat, lon
    r["Month"], r["Hour"] = dt.month, hour
    r["Location"] = int(BUNDLE["label_encoders"]["Location"].transform([loc])[0])
    for col in (
        f"Crime_Type_{profile['crime_type']}", f"Area_Type_{profile['area_type']}",
        f"Weather_Condition_{weather}", f"Time_of_Day_{tod}", f"Day_of_Week_{dt.strftime('%A')}",
    ):
        if col in r:
            r[col] = 1
    return r


def predict_points(points, dt: datetime, weather: str = "Sunny"):
    hour = dt.hour
    tod = time_of_day(hour)
    rows, meta = [], []
    for lat, lon in points:
        loc, dist = nearest_location(lat, lon)
        rows.append(_row(PROFILES[loc], lat, lon, loc, tod, weather, dt, hour))
        meta.append((loc, dist))
    X = pd.DataFrame(rows, columns=FEATURES)
    num = BUNDLE["numeric_feature_cols"]
    X[num] = BUNDLE["scaler"].transform(X[num])
    proba = MODEL.predict_proba(X)
    return proba, meta, tod


# ----------------------------------------------------------------- scoring
def score_route(coords, dt: datetime, weather="Sunny", mode="Driving", avoid_dark=False, emergency_cov=None):
    pts = sample_route(coords)
    proba, meta, tod = predict_points(pts, dt, weather)
    ci = {c: i for i, c in enumerate(CLASSES)}
    p_safe, p_mod, p_uns = (proba[:, ci[c]].mean() for c in ("Safe", "Moderate", "Unsafe"))
    base = 100 * p_safe + 50 * p_mod  # expected safety on a 0-100 scale

    # lighting / CCTV / crime evidence along the route
    stats = [PROFILES[m[0]]["by_time"].get(tod) or PROFILES[m[0]]["mean"] for m in meta]
    light = float(np.mean([s["Street_Light_Density"] for s in stats]))
    cctv = float(np.mean([s["Nearby_CCTV_Cameras"] for s in stats]))
    crime = float(np.mean([s["Crime_Severity"] for s in stats]))
    pol = float(np.mean([s["Num_Police_Stations_Nearby"] for s in stats]))
    complaints = float(np.mean([s["Public_Complaints"] for s in stats]))
    night = tod == "Night"

    penalty = 0.0
    mode_penalty = 0.0
    if mode in ("Walking", "Bicycling") and night:
        mode_penalty = 4.0 if mode == "Walking" else 3.0
    penalty += mode_penalty
    if avoid_dark and light < 4.0:
        penalty += (4.0 - light) * 2.5  # extra weight on poorly lit routes when the user asks
    score = max(0.0, min(100.0, base - penalty))

    worst = sorted(zip(pts, meta, proba[:, ci["Unsafe"]]), key=lambda t: -t[2])[0]
    areas = []
    for m in meta:
        if m[0] not in areas:
            areas.append(m[0])
    coverage = sum(1 for m in meta if m[1] <= MAX_MATCH_KM) / len(meta)
    return {
        "score": round(score, 1),
        "p_safe": float(p_safe), "p_moderate": float(p_mod), "p_unsafe": float(p_uns),
        "predicted_class": CLASSES[int(np.argmax([ {'Moderate': p_mod, 'Safe': p_safe, 'Unsafe': p_uns}[c] for c in CLASSES]))],
        "tod": tod, "night": night, "light": light, "cctv": cctv, "crime": crime,
        "police": pol, "complaints": complaints, "areas": areas,
        "worst_area": worst[1][0], "worst_p_unsafe": float(worst[2]),
        "mode_penalty": mode_penalty, "data_coverage": coverage, "n_samples": len(pts),
    }


def label_for(score: float) -> str:
    return "safe" if score >= SAFE_T else "moderate" if score >= MOD_T else "risk"


def explain(r: dict, kind: str) -> dict:
    pos, warn = [], []
    if r["light"] >= 6:
        pos.append(f"Good street lighting along the route (avg {r['light']:.1f}/10)")
    elif r["light"] < 4:
        warn.append(f"Poor street lighting (avg {r['light']:.1f}/10)")
    if r["cctv"] >= 4:
        pos.append(f"Reasonable CCTV presence (~{r['cctv']:.1f} cameras per area)")
    elif r["cctv"] < 2.5:
        warn.append(f"Limited CCTV coverage (~{r['cctv']:.1f} cameras per area)")
    if r["crime"] <= 4.5:
        pos.append(f"Lower historical crime severity (avg {r['crime']:.1f}/10)")
    elif r["crime"] >= 6:
        warn.append(f"Higher historical crime severity (avg {r['crime']:.1f}/10)")
    if r["police"] >= 2:
        pos.append("Police stations are typically nearby")
    elif r["police"] < 1:
        warn.append("Few police stations near this stretch")
    if r["night"]:
        warn.append("Night-time travel lowers visibility and foot traffic")
    if r["worst_p_unsafe"] > 0.5:
        warn.append(f"Highest-risk stretch is around {r['worst_area']}")
    rec = {
        "safe": "Recommended. This route scores best on lighting, CCTV and historical crime.",
        "moderate": "Usable with care. Stay on main roads and share your live location.",
        "risk": "Avoid if possible, especially alone. Prefer the safer alternative.",
    }[kind]
    return {"positive_factors": pos, "warning_factors": warn, "recommendation": rec}
