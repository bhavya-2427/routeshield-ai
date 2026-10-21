# RouteShield AI

Safety-aware route recommendation for Delhi. Enter a source and destination; OSRM returns candidate routes, a
Gradient Boosting classifier scores each one (Safe / Moderate / Unsafe + probabilities), and the best route is shown
on a colour-coded Leaflet map with an explanation.

## Stack
Flask, SQLite, scikit-learn (Gradient Boosting), OSRM, Nominatim, Overpass (OSM), Open-Meteo, Leaflet, Render.

## How a route gets scored (`engine.py`)
1. Sample a point every ~400 m along the OSRM geometry.
2. Match each point to the nearest of 40 Delhi areas in the training data.
3. Build the model's 44 features (area stats for the chosen time of day + live weather + date).
4. Average class probabilities over the route -> safety score `100*P(Safe) + 50*P(Moderate)`, minus small penalties
   (night walking/cycling, detour length, "avoid dark roads" with poor lighting).

## Run locally
```bash
pip install -r requirements.txt
python train.py          # rebuilds model/ from data/*.csv (95.06% test accuracy)
python tests/test_app.py # offline smoke tests (external services mocked)
python app.py            # http://localhost:5000
```
Without SMTP settings the OTP is printed in the server log. Set `DEMO_AUTO_VERIFY=1` to skip OTP entirely.

## Deploy on Render
Push this folder to GitHub -> Render -> New -> Blueprint -> pick the repo (`render.yaml` is picked up).
Optional env vars for real OTP mail: `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM`.
Note: Render's free tier has an ephemeral disk, so SQLite users reset on redeploy; use a Render Postgres/disk for persistence.

## Honest limitations
* Training data is synthetic; labels are a deterministic function of Safety_Score, so accuracy reflects the rule, not real crime.
* Coverage: Delhi-NCR only (40 reference areas).
* Public OSRM / Nominatim / Overpass servers are rate limited.
