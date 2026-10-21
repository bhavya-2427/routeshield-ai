"""Offline smoke tests: external services are mocked, so no internet needed.
Run:  python tests/test_app.py
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ.pop("SMTP_HOST", None)

import numpy as np
import app as A, services

def line(a, b, n=60):
    return [[float(x), float(y)] for x, y in zip(np.linspace(a[1], b[1], n), np.linspace(a[0], b[0], n))]

CP, DW, NJ = (28.6315, 77.2167), (28.5921, 77.0460), (28.6129, 77.0200)
services.geocode = lambda q: ({"cp": CP, "dwarka": DW}.get(q.lower(), NJ) + (q,))
def fake_osrm(a, b, mode):
    g = line(a, b)
    bend = [[x + 0.02 * np.sin(np.pi * i / 59), y] for i, (x, y) in enumerate(g)]
    return [{"distance": 21000, "duration": 2100, "geometry": {"coordinates": g}},
            {"distance": 24000, "duration": 2400, "geometry": {"coordinates": bend}}]
services.osrm_routes = fake_osrm
services.weather_now = lambda *a: "Sunny"
services.facilities_in_bbox = lambda b: np.array([[28.62, 77.2], [28.60, 77.1]])
services.emergency_around = lambda *a, **k: {"police": {"name": "P", "distance": 1.0, "latitude": 28.6, "longitude": 77.2},
                                             "hospital": None, "public": None}

c = A.app.test_client()
def J(r): return r.get_json()

# auth gate
assert c.post("/analyze-route", json={}).status_code == 401
assert "authGate" in c.get("/").get_data(as_text=True)
r = c.post("/register", json={"name": "Test", "email": "t@x.com", "password": "secret1"}); assert J(r)["success"] and J(r)["demo"]
assert c.get("/verify-otp").status_code == 200
assert not J(c.post("/verify-otp", json={"otp": "000000"}))["success"]
with A.app.app_context():
    A.db()  # fresh conn
    import sqlite3
    conn = sqlite3.connect(os.environ["DB_PATH"])
    # swap in a known OTP
    conn.execute("UPDATE users SET otp_hash=?", (A._otp_hash("123456"),)); conn.commit()
assert J(c.post("/verify-otp", json={"otp": "123456"}))["success"]
assert "authGate" not in c.get("/").get_data(as_text=True)
assert J(c.get("/api/profile"))["profile"]["email"] == "t@x.com"
assert J(c.put("/api/profile", json={"name": "Bhavya"}))["name"] == "Bhavya"

# contacts
cid = J(c.post("/api/trusted-contacts", json={"name": "Mom", "phone": "9876543210", "relationship": "Mother"}))["contact"]["id"]
assert len(J(c.get("/api/trusted-contacts"))["contacts"]) == 1
assert not J(c.post("/api/trusted-contacts", json={"name": "X", "phone": "12"}))["success"]
assert J(c.delete(f"/api/trusted-contacts/{cid}"))["success"]

# analysis: day vs night, driving vs walking
def run(t, mode="Driving", dark=False, dest="dwarka"):
    d = J(c.post("/analyze-route", json={"start": "cp", "destination": dest, "travel_time": t, "travel_mode": mode, "avoid_dark_roads": dark}))
    assert d["success"], d
    return d
day, night = run("12:00"), run("23:30")
print("day  :", [(r["type"], r["safety_score"]) for r in day["routes"]])
print("night:", [(r["type"], r["safety_score"]) for r in night["routes"]])
assert night["routes"][0]["safety_score"] <= day["routes"][0]["safety_score"], "night should not be safer than day"
r0 = day["routes"][0]
for k in ("type", "label", "distance", "duration", "safety_score", "geojson", "analysis_parameters", "crime_severity", "safety_explanation", "cctv_density"):
    assert k in r0, k
assert run("23:30", "Walking")["routes"][0]["analysis_parameters"]["mode_penalty"] > 0
assert run("23:30", dark=True)["routes"][0]["safety_score"] <= night["routes"][0]["safety_score"]
assert not J(c.post("/analyze-route", json={"start": "", "destination": "x"}))["success"]
assert J(c.post("/nearby-emergency", json={"lat": 28.6, "lng": 77.2}))["success"]
assert not J(c.post("/nearby-emergency", json={"lat": "x"}))["success"]
c.post("/logout"); assert c.get("/api/profile").status_code == 401
print("ALL OK")
