"""Thin wrappers around the free external services RouteShield AI uses."""
from __future__ import annotations

import os
import requests
import numpy as np

from engine import haversine_km

UA = {"User-Agent": os.getenv("HTTP_USER_AGENT", "RouteShieldAI/1.0 (student project)")}
TIMEOUT = 12

OSRM = {
    "Driving": "https://router.project-osrm.org/route/v1/driving",
    "Walking": "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    "Bicycling": "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


class ServiceError(Exception):
    pass


def geocode(query: str):
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "in",
                    "viewbox": "76.8,28.95,77.5,28.35", "bounded": 0},
            headers=UA, timeout=TIMEOUT,
        )
        r.raise_for_status()
        hits = r.json()
    except requests.RequestException as e:
        raise ServiceError("Geocoding service is unavailable right now. Please try again.") from e
    if not hits:
        raise ServiceError(f"Could not find '{query}'. Try a more specific place name.")
    return float(hits[0]["lat"]), float(hits[0]["lon"]), hits[0].get("display_name", query)


def osrm_routes(a, b, mode="Driving"):
    """a, b = (lat, lon). Returns list of OSRM route dicts with GeoJSON geometry."""
    coords = f"{a[1]},{a[0]};{b[1]},{b[0]}"
    params = {"alternatives": "3", "overview": "full", "geometries": "geojson", "steps": "false"}
    last = None
    for base in (OSRM.get(mode, OSRM["Driving"]), OSRM["Driving"]):
        try:
            r = requests.get(f"{base}/{coords}", params=params, headers=UA, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            if data.get("code") == "Ok" and data.get("routes"):
                return data["routes"]
            last = data.get("message") or data.get("code")
        except requests.RequestException as e:
            last = str(e)
    raise ServiceError(f"No route found between these places ({last}).")


def weather_now(lat: float, lon: float) -> str:
    """Open-Meteo (no key). Maps WMO code to the dataset's 4 weather classes."""
    try:
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": lat, "longitude": lon, "current": "weather_code,visibility"},
            timeout=5,
        )
        cur = r.json()["current"]
        code, vis = int(cur["weather_code"]), float(cur.get("visibility", 10000))
        if code in (45, 48) or vis < 1000:
            return "Foggy"
        if code >= 51:
            return "Rainy"
        if code in (2, 3):
            return "Cloudy"
        return "Sunny"
    except Exception:
        return "Sunny"


def _overpass(query: str):
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": query}, headers=UA, timeout=20)
            if r.status_code == 200:
                return r.json().get("elements", [])
        except requests.RequestException:
            continue
    return []


def _el_latlon(e):
    if "lat" in e:
        return e["lat"], e["lon"]
    c = e.get("center") or {}
    return c.get("lat"), c.get("lon")


def emergency_around(lat: float, lon: float, radius_m: int = 3000):
    """Nearest police station, hospital and 'public safe spot' via OpenStreetMap."""
    q = f"""[out:json][timeout:20];
(
 nwr["amenity"="police"](around:{radius_m},{lat},{lon});
 nwr["amenity"="hospital"](around:{radius_m},{lat},{lon});
 nwr["amenity"="fuel"](around:{radius_m},{lat},{lon});
 nwr["railway"="station"](around:{radius_m},{lat},{lon});
 nwr["station"="subway"](around:{radius_m},{lat},{lon});
);
out center 150;"""
    els = _overpass(q)
    buckets = {"police": None, "hospital": None, "public": None}
    for e in els:
        tags = e.get("tags", {})
        la, lo = _el_latlon(e)
        if la is None:
            continue
        kind = ("police" if tags.get("amenity") == "police" else
                "hospital" if tags.get("amenity") == "hospital" else "public")
        d = float(haversine_km(lat, lon, la, lo))
        cur = buckets[kind]
        if cur is None or d < cur["distance"]:
            default = {"police": "Police Station", "hospital": "Hospital", "public": "Public Safe Spot"}[kind]
            buckets[kind] = {"name": tags.get("name") or tags.get("name:en") or default,
                             "distance": round(d, 2), "latitude": la, "longitude": lo}
    return buckets


def facilities_in_bbox(bbox):
    """Police + hospital points inside a bbox, used for route emergency coverage."""
    s, w, n, e_ = bbox
    q = f"""[out:json][timeout:20];
(nwr["amenity"="police"]({s},{w},{n},{e_}); nwr["amenity"="hospital"]({s},{w},{n},{e_}););
out center 300;"""
    pts = []
    for e in _overpass(q):
        la, lo = _el_latlon(e)
        if la is not None:
            pts.append((la, lo))
    return np.array(pts) if pts else np.empty((0, 2))
