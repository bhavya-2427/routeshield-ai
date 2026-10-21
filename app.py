"""RouteShield AI - Flask backend.

Endpoints the frontend (static/js/script.js) calls:
  GET  /                      app (auth gate if not logged in)
  GET  /verify-otp            OTP page
  POST /register /verify-otp /resend-otp /login /logout
  POST /analyze-route         core ML route analysis
  POST /nearby-emergency      nearest police / hospital / public safe spot
  GET|PUT /api/profile
  GET|POST /api/trusted-contacts, DELETE /api/trusted-contacts/<id>
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from flask import Flask, g, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import engine
import services

IST = ZoneInfo("Asia/Kolkata")
BASE = Path(__file__).parent
DB_PATH = os.getenv("DB_PATH", str(BASE / "instance" / "routeshield.db"))
OTP_TTL_MIN = 10
OTP_MAX_TRIES = 5
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)  # set SECRET_KEY on Render!
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("FLASK_ENV") == "production" or bool(os.getenv("RENDER")),
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
)


# ------------------------------------------------------------------ database
def db() -> sqlite3.Connection:
    if "db" not in g:
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  otp_hash TEXT, otp_expires TEXT, otp_tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL, relationship TEXT,
  created_at TEXT NOT NULL
);
"""


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(SCHEMA)


init_db()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ helpers
def ok(**kw):
    return jsonify(success=True, **kw)


def fail(msg, code=400, **kw):
    return jsonify(success=False, error=msg, **kw), code


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        if not session.get("user_id"):
            return fail("Please log in first.", 401)
        return fn(*a, **k)
    return wrapper


def current_user():
    return db().execute("SELECT * FROM users WHERE id=?", (session.get("user_id"),)).fetchone()


# ------------------------------------------------------------------ OTP / mail
def _otp_hash(otp: str) -> str:
    return hashlib.sha256((otp + app.secret_key).encode()).hexdigest()


def send_otp(user) -> dict:
    """Create + store an OTP. Returns {'demo': True} when SMTP isn't configured."""
    otp = f"{secrets.randbelow(10**6):06d}"
    db().execute(
        "UPDATE users SET otp_hash=?, otp_expires=?, otp_tries=0 WHERE id=?",
        (_otp_hash(otp), (datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MIN)).isoformat(), user["id"]),
    )
    db().commit()
    host, mail_user, mail_pass = os.getenv("SMTP_HOST"), os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD")
    if not (host and mail_user and mail_pass):
        app.logger.warning("DEMO MODE - OTP for %s is %s", user["email"], otp)
        return {"demo": True}
    msg = EmailMessage()
    msg["Subject"] = "Your RouteShield AI verification code"
    msg["From"] = os.getenv("SMTP_FROM", mail_user)
    msg["To"] = user["email"]
    msg.set_content(f"Hi {user['name']},\n\nYour RouteShield AI code is {otp}. It expires in {OTP_TTL_MIN} minutes.\n")
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as s:
        s.starttls()
        s.login(mail_user, mail_pass)
        s.send_message(msg)
    return {}


def start_session(user):
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["user_name"] = user["name"]


# ------------------------------------------------------------------ pages + auth
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/verify-otp")
def verify_page():
    uid = session.get("pending_user_id")
    if session.get("user_id") or not uid:
        return redirect("/")
    u = db().execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        return redirect("/")
    return render_template("index.html", auth_page="otp", otp_email=u["email"])


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model": engine.BUNDLE["model_name"], "areas": len(engine.PROFILES)}


@app.post("/register")
def register():
    d = request.get_json(silent=True) or {}
    name, email, pw = (d.get("name") or "").strip(), (d.get("email") or "").strip().lower(), d.get("password") or ""
    if len(name) < 2:
        return fail("Please enter your name.")
    if not EMAIL_RE.match(email):
        return fail("Enter a valid email address.")
    if len(pw) < 6:
        return fail("Password must contain at least 6 characters.")
    row = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if row and row["is_verified"]:
        return fail("An account with this email already exists. Please log in.", 409)
    if row:  # unverified leftover: refresh credentials
        db().execute("UPDATE users SET name=?, password_hash=? WHERE id=?", (name, generate_password_hash(pw), row["id"]))
    else:
        db().execute(
            "INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)",
            (name, email, generate_password_hash(pw), now_iso()),
        )
    db().commit()
    user = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    session.clear()
    session["pending_user_id"] = user["id"]
    try:
        extra = send_otp(user)
    except Exception:
        app.logger.exception("OTP email failed")
        return fail("Could not send the verification email. Please try again.", 502)
    if extra.get("demo") and os.getenv("DEMO_AUTO_VERIFY") == "1":
        db().execute("UPDATE users SET is_verified=1 WHERE id=?", (user["id"],))
        db().commit()
        start_session(user)
    return ok(message="Verification code sent.", **extra)


@app.post("/verify-otp")
def verify_otp():
    uid = session.get("pending_user_id")
    otp = ((request.get_json(silent=True) or {}).get("otp") or "").strip()
    if not uid:
        return fail("Session expired. Please register or log in again.", 401)
    u = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u or not u["otp_hash"]:
        return fail("No code is pending. Request a new one.")
    if u["otp_tries"] >= OTP_MAX_TRIES:
        return fail("Too many wrong attempts. Request a new code.", 429)
    if datetime.fromisoformat(u["otp_expires"]) < datetime.now(timezone.utc):
        return fail("Code expired. Request a new one.")
    if _otp_hash(otp) != u["otp_hash"]:
        db().execute("UPDATE users SET otp_tries=otp_tries+1 WHERE id=?", (uid,))
        db().commit()
        return fail("Incorrect code.")
    db().execute("UPDATE users SET is_verified=1, otp_hash=NULL, otp_expires=NULL WHERE id=?", (uid,))
    db().commit()
    start_session(u)
    return ok(message="Email verified.")


@app.post("/resend-otp")
def resend_otp():
    uid = session.get("pending_user_id")
    u = uid and db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        return fail("Session expired. Please register or log in again.", 401)
    try:
        extra = send_otp(u)
    except Exception:
        app.logger.exception("OTP email failed")
        return fail("Could not send the verification email.", 502)
    return ok(message="A new code has been sent.", **extra)


@app.post("/login")
def login():
    d = request.get_json(silent=True) or {}
    email, pw = (d.get("email") or "").strip().lower(), d.get("password") or ""
    u = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not u or not check_password_hash(u["password_hash"], pw):
        return fail("Incorrect email or password.", 401)
    if not u["is_verified"]:
        session.clear()
        session["pending_user_id"] = u["id"]
        send_otp(u)
        return jsonify(success=False, needs_verification=True, error="Please verify your email."), 403
    start_session(u)
    return ok(message="Logged in.")


@app.post("/logout")
def logout():
    session.clear()
    return ok()


# ------------------------------------------------------------------ profile + contacts
@app.get("/api/profile")
@login_required
def get_profile():
    u = current_user()
    if not u:
        return fail("Account not found.", 404)
    return ok(profile={"name": u["name"], "email": u["email"], "is_verified": bool(u["is_verified"]),
                       "created_at": u["created_at"]})


@app.put("/api/profile")
@login_required
def put_profile():
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if len(name) < 2 or len(name) > 60:
        return fail("Please enter a valid name.")
    db().execute("UPDATE users SET name=? WHERE id=?", (name, session["user_id"]))
    db().commit()
    session["user_name"] = name
    return ok(name=name, message="Profile updated successfully.")


@app.get("/api/trusted-contacts")
@login_required
def list_contacts():
    rows = db().execute("SELECT id,name,phone,relationship FROM trusted_contacts WHERE user_id=? ORDER BY id",
                        (session["user_id"],)).fetchall()
    return ok(contacts=[dict(r) for r in rows])


@app.post("/api/trusted-contacts")
@login_required
def add_contact():
    d = request.get_json(silent=True) or {}
    name, phone, rel = (d.get("name") or "").strip(), re.sub(r"[^\d+]", "", d.get("phone") or ""), (d.get("relationship") or "").strip()
    if len(name) < 2:
        return fail("Enter the contact's name.")
    if not re.fullmatch(r"\+?\d{10,13}", phone):
        return fail("Enter a valid phone number (10-13 digits).")
    n = db().execute("SELECT COUNT(*) c FROM trusted_contacts WHERE user_id=?", (session["user_id"],)).fetchone()["c"]
    if n >= 5:
        return fail("You can save up to 5 trusted contacts.")
    cur = db().execute(
        "INSERT INTO trusted_contacts(user_id,name,phone,relationship,created_at) VALUES(?,?,?,?,?)",
        (session["user_id"], name[:60], phone, rel[:40], now_iso()),
    )
    db().commit()
    return ok(contact={"id": cur.lastrowid, "name": name, "phone": phone, "relationship": rel})


@app.delete("/api/trusted-contacts/<int:cid>")
@login_required
def delete_contact(cid):
    cur = db().execute("DELETE FROM trusted_contacts WHERE id=? AND user_id=?", (cid, session["user_id"]))
    db().commit()
    if not cur.rowcount:
        return fail("Contact not found.", 404)
    return ok()


# ------------------------------------------------------------------ emergency
@app.post("/nearby-emergency")
@login_required
def nearby_emergency():
    d = request.get_json(silent=True) or {}
    try:
        lat, lng = float(d["lat"]), float(d["lng"])
    except (KeyError, TypeError, ValueError):
        return fail("lat and lng are required.")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return fail("Invalid coordinates.")
    return ok(**services.emergency_around(lat, lng))


# ------------------------------------------------------------------ route analysis
def fmt_duration(sec: float) -> str:
    m = max(1, round(sec / 60))
    return f"{m} mins" if m < 60 else f"{m // 60} hr {m % 60} mins" if m % 60 else f"{m // 60} hr"


def crime_block(r):
    sev = r["crime"]  # 1-10 dataset scale
    level = "Low" if sev < 4.5 else "Medium" if sev < 6 else "High"
    area = r["areas"][0] if r["areas"] else "route area"
    return {"available": True, "score": round(sev * 10), "level": level, "area": area, "year": "2023-2025",
            "official_metric": round(sev, 2), "metric_label": "Avg incident severity (dataset, out of 10)"}


def parse_time(s: str) -> datetime:
    now = datetime.now(IST)
    try:
        h, m = (int(x) for x in str(s).split(":")[:2])
        return now.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        return now


@app.post("/analyze-route")
@login_required
def analyze_route():
    d = request.get_json(silent=True) or {}
    start, dest = (d.get("start") or "").strip(), (d.get("destination") or "").strip()
    mode = d.get("travel_mode") if d.get("travel_mode") in services.OSRM else "Driving"
    avoid_dark = bool(d.get("avoid_dark_roads"))
    if not start and d.get("start_lat") is None:
        return fail("Please enter a starting point.")
    if not dest and d.get("destination_lat") is None:
        return fail("Please enter a destination.")
    try:
        if d.get("start_lat") is not None and d.get("start_lng") is not None:
            a = (float(d["start_lat"]), float(d["start_lng"]))
            a_name = start or "Current location"
        else:
            *a, a_name = services.geocode(start)
            a = tuple(a)
        if d.get("destination_lat") is not None and d.get("destination_lng") is not None:
            b = (float(d["destination_lat"]), float(d["destination_lng"]))
            b_name = dest
        else:
            *b, b_name = services.geocode(dest)
            b = tuple(b)
        raw = services.osrm_routes(a, b, mode)
    except (services.ServiceError, ValueError) as e:
        return fail(str(e), 422 if isinstance(e, services.ServiceError) else 400)

    # coverage guard: the model only knows Delhi
    if engine.nearest_location(*a)[1] > 25 and engine.nearest_location(*b)[1] > 25:
        return fail("RouteShield AI currently covers Delhi-NCR only. Please pick places inside Delhi.", 422)

    dt = parse_time(d.get("travel_time"))
    weather = services.weather_now(*a)

    # emergency coverage for the whole corridor, one Overpass call
    all_pts = np.array([[c[1], c[0]] for rt in raw for c in rt["geometry"]["coordinates"]])
    pad = 0.02
    bbox = (all_pts[:, 0].min() - pad, all_pts[:, 1].min() - pad, all_pts[:, 0].max() + pad, all_pts[:, 1].max() + pad)
    fac = services.facilities_in_bbox(bbox) if (bbox[2] - bbox[0]) < 0.6 and (bbox[3] - bbox[1]) < 0.6 else np.empty((0, 2))

    routes = []
    for rt in raw[:3]:
        coords = rt["geometry"]["coordinates"]
        r = engine.score_route(coords, dt, weather, mode, avoid_dark)
        samples = engine.sample_route(coords)
        if len(fac):
            dmin = [float(np.min(engine.haversine_km(la, lo, fac[:, 0], fac[:, 1]))) for la, lo in samples]
            cov = round(100 * sum(1 for x in dmin if x <= 2.0) / len(dmin))
            nearest = round(min(dmin), 2)
        else:
            cov, nearest = None, None
        km = rt["distance"] / 1000
        # distance exposure: how much longer than the shortest option
        exposure = round(km / (min(x["distance"] for x in raw) / 1000), 2)
        score = max(0.0, r["score"] - max(0.0, (exposure - 1) * 8))  # small cost for detours
        kind = engine.label_for(score)
        routes.append({
            "type": kind, "label": {"safe": "Safe Route", "moderate": "Moderate Risk Route", "risk": "High-Risk Route"}[kind],
            "distance": f"{km:.1f} km", "distance_val": round(km, 2),
            "duration": fmt_duration(rt["duration"]), "duration_val": round(rt["duration"] / 60),
            "safety_score": round(score),
            "predicted_class": r["predicted_class"],
            "class_probabilities": {"safe": round(r["p_safe"], 3), "moderate": round(r["p_moderate"], 3),
                                    "unsafe": round(r["p_unsafe"], 3)},
            "cctv_density": f"~{round(r['cctv'] * 4)}",
            "crowd_ratio": "High (Well Populated)" if r["complaints"] < 3 and not r["night"] else
                           "Medium (Moderate Activity)" if r["complaints"] < 5 else "Low (Less Populated)",
            "crime_severity": crime_block(r),
            "safety_explanation": engine.explain(r, kind),
            "geojson": {"type": "LineString", "coordinates": coords},
            "analysis_parameters": {
                "route_distance_km": round(km, 2), "estimated_duration_min": round(rt["duration"] / 60),
                "night_travel": r["night"], "travel_mode": mode, "avoid_dark_roads": avoid_dark,
                "distance_exposure_factor": exposure, "mode_penalty": r["mode_penalty"],
                "emergency_service_coverage": cov, "nearest_emergency_distance_km": nearest,
                "weather": weather, "areas_on_route": r["areas"][:6],
            },
        })
    routes.sort(key=lambda x: -x["safety_score"])
    routes[0]["label"] = "Safe Route (Recommended)" if routes[0]["type"] == "safe" else routes[0]["label"] + " (Best Available)"
    return ok(
        routes=routes, hero_safety_score=routes[0]["safety_score"], weather=weather,
        travel_time=dt.strftime("%H:%M"),
        start_location={"name": a_name, "latitude": a[0], "longitude": a[1]},
        destination_location={"name": b_name, "latitude": b[0], "longitude": b[1]},
        emergency_services=services.emergency_around(*a),
    )


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", port=int(os.getenv("PORT", "5000")))
