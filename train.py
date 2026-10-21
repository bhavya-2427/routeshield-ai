"""RouteShield AI - model training.

Re-creates the notebook pipeline (RouteShield_AI_Model.ipynb) as a script and
also builds the per-location profile table used by the backend to turn a route
into model features.

Run:  python train.py
Out:  model/routeshield_model_bundle.pkl
      model/location_profiles.json
      model/metrics.json
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

BASE = Path(__file__).parent
CSV = BASE / "data" / "RouteShield_Synthetic_Delhi_35000.csv"
OUT = BASE / "model"
OUT.mkdir(exist_ok=True)
SEED = 42
TARGET = "Safety_Label"

df = pd.read_csv(CSV)
raw = df.copy()

# ---- 1. drop zero-variance + leaking columns (Safety_Score defines the label)
df = df.drop(columns=["City", "Safety_Score"])

# ---- 2. feature engineering
df["Date"] = pd.to_datetime(df["Date"])
df["Day_of_Week"] = df["Date"].dt.day_name()
df["Month"] = df["Date"].dt.month
df["Hour"] = pd.to_datetime(df["Time"], format="%H:%M").dt.hour
df = df.drop(columns=["Date", "Time"])

feature_cols = [c for c in df.columns if c != TARGET]
cat_cols = [c for c in feature_cols if not pd.api.types.is_numeric_dtype(df[c])]
num_cols = [c for c in feature_cols if pd.api.types.is_numeric_dtype(df[c])]

# ---- 3. encoding (same rule as notebook: cardinality <= 15 -> one-hot else label)
onehot_cols = [c for c in cat_cols if df[c].nunique() <= 15]
label_cols = [c for c in cat_cols if df[c].nunique() > 15]
enc = df.copy()
label_encoders = {}
for c in label_cols:
    le = LabelEncoder()
    enc[c] = le.fit_transform(enc[c])
    label_encoders[c] = le
enc = pd.get_dummies(enc, columns=onehot_cols, drop_first=False)
target_encoder = LabelEncoder()
enc[TARGET] = target_encoder.fit_transform(enc[TARGET])

X = enc.drop(columns=[TARGET])
y = enc[TARGET]
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=SEED, stratify=y)

# ---- 4. scaling - fitted on the TRAIN split only (notebook fitted on all rows)
scaler = StandardScaler().fit(X_tr[num_cols])
X_tr = X_tr.copy(); X_te = X_te.copy()
X_tr[num_cols] = scaler.transform(X_tr[num_cols])
X_te[num_cols] = scaler.transform(X_te[num_cols])

# ---- 5. model
params = dict(n_estimators=100, learning_rate=0.1, max_depth=3, random_state=SEED)
model = GradientBoostingClassifier(**params).fit(X_tr, y_tr)
pred = model.predict(X_te)
names = list(target_encoder.classes_)
report = classification_report(y_te, pred, target_names=names, output_dict=True)
cv = cross_val_score(
    GradientBoostingClassifier(**params), pd.concat([X_tr, X_te]), pd.concat([y_tr, y_te]),
    cv=StratifiedKFold(5, shuffle=True, random_state=SEED), scoring="accuracy", n_jobs=-1,
)
imp = pd.Series(model.feature_importances_, index=X.columns).sort_values(ascending=False)

metrics = {
    "n_records": int(len(df)),
    "n_train": int(len(X_tr)), "n_test": int(len(X_te)),
    "n_features": int(X.shape[1]),
    "params": params,
    "accuracy": float(accuracy_score(y_te, pred)),
    "f1_weighted": float(f1_score(y_te, pred, average="weighted")),
    "per_class": {k: {m: float(report[k][m]) for m in ("precision", "recall", "f1-score", "support")} for k in names},
    "confusion_matrix": {"labels": names, "matrix": confusion_matrix(y_te, pred).tolist()},
    "cv5_accuracy_mean": float(cv.mean()), "cv5_accuracy_std": float(cv.std()),
    "top_features": {k: float(v) for k, v in imp.head(10).items()},
    "class_distribution": raw[TARGET].value_counts().to_dict(),
    "label_thresholds_from_Safety_Score": {
        k: [float(v.min()), float(v.max())] for k, v in raw.groupby(TARGET)["Safety_Score"]
    },
}
(OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))

joblib.dump(
    {
        "model": model, "model_name": "Gradient Boosting",
        "label_encoders": label_encoders, "target_encoder": target_encoder, "scaler": scaler,
        "feature_columns": list(X.columns), "onehot_cols": onehot_cols, "numeric_feature_cols": num_cols,
    },
    OUT / "routeshield_model_bundle.pkl", compress=3,
)

# ---- 6. location profiles: what the backend knows about each Delhi area
metric_cols = [
    "Crime_Severity", "Police_Response_Time_Minutes", "Weather_Visibility_KM", "Traffic_Congestion_Level",
    "Road_Accidents_Reported", "Nearby_CCTV_Cameras", "Street_Light_Density", "Public_Complaints",
    "Num_Police_Stations_Nearby",
]
profiles = {}
for loc, g in raw.groupby("Location"):
    p = {
        "lat": float(g.Latitude.mean()), "lon": float(g.Longitude.mean()),
        "area_type": g.Area_Type.mode()[0], "crime_type": g.Crime_Type.mode()[0], "n": int(len(g)),
        "mean": {c: float(g[c].mean()) for c in metric_cols},
        "by_time": {},
    }
    for tod, gt in g.groupby("Time_of_Day"):
        p["by_time"][tod] = {c: float(gt[c].mean()) for c in metric_cols}
    profiles[loc] = p
weather_vis = raw.groupby("Weather_Condition").Weather_Visibility_KM.mean().to_dict()
(OUT / "location_profiles.json").write_text(
    json.dumps({"locations": profiles, "weather_visibility": weather_vis}, indent=1)
)

print(f"accuracy={metrics['accuracy']:.4f}  f1={metrics['f1_weighted']:.4f}  cv5={cv.mean():.4f}+-{cv.std():.4f}")
print(imp.head(8).round(3).to_string())
