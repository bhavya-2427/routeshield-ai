/* ============================================================
   AUTHENTICATION
   Server-side Flask session + email OTP
   ============================================================ */
(() => {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const otpForm = document.getElementById("otpForm");
    const forgotPasswordForm = document.getElementById("forgotPasswordForm");
    const forgotPasswordBox = document.getElementById("forgotPasswordBox");
    const forgotMessage = document.getElementById("forgotMessage");
    const loginBox = document.getElementById("loginBox");
    const registerBox = document.getElementById("registerBox");
    const loginMessage = document.getElementById("loginMessage");
    const registerMessage = document.getElementById("registerMessage");
    const otpMessage = document.getElementById("otpMessage");
    const otpEmail = document.getElementById("otpEmail");

    const message = (el, text, ok=false) => {
        if (!el) return;
        el.textContent = text || "";
        el.style.color = ok ? "#256b5a" : "#d94b4b";
    };

    const showAuthBox = (box) => {
        [loginBox, registerBox, forgotPasswordBox].forEach(el => {
            if (el) el.style.display = "none";
        });
        if (box) box.style.display = "block";
    };

    const parseResponse = async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            const error = new Error(data.error || "Request failed.");
            error.data = data;
            throw error;
        }
        return data;
    };

    const showDemoNotice = (data, el) => {
        if (data?.demo) message(el, "OTP generated in the server console (SMTP is not configured).", true);
    };

    document.getElementById("showRegister")?.addEventListener("click", () => showAuthBox(registerBox));
    document.getElementById("registerTab")?.addEventListener("click", () => showAuthBox(registerBox));
    document.getElementById("registerTab2")?.addEventListener("click", () => showAuthBox(registerBox));
    document.getElementById("showLogin")?.addEventListener("click", () => showAuthBox(loginBox));
    document.getElementById("loginTab")?.addEventListener("click", () => showAuthBox(loginBox));
    document.getElementById("loginTab2")?.addEventListener("click", () => showAuthBox(loginBox));


    registerForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = document.getElementById("registerName").value.trim();
        const email = document.getElementById("registerEmail").value.trim().toLowerCase();
        const password = document.getElementById("registerPassword").value;
        const confirm = document.getElementById("confirmPassword").value;
        if (password.length < 6) return message(registerMessage, "Password must contain at least 6 characters.");
        if (password !== confirm) return message(registerMessage, "Passwords do not match.");
        try {
            const response = await fetch("/register", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,email,password}) });
            const data = await parseResponse(response);
            // IMPORTANT: registration success opens a separate URL/page for OTP.
            window.location.href = "/verify-otp";
        } catch (error) {
            message(registerMessage, error.message);
        }
    });

    otpForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const otp = document.getElementById("otpInput").value.trim();
        if (!/^\d{6}$/.test(otp)) return message(otpMessage, "Enter the 6-digit OTP.");
        try {
            const response = await fetch("/verify-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({otp}) });
            await parseResponse(response);
            message(otpMessage, "Email verified. Opening RouteShield AI...", true);
            setTimeout(() => window.location.href = "/", 500);
        } catch (error) { message(otpMessage, error.message); }
    });

    document.getElementById("resendOtp")?.addEventListener("click", async () => {
        try {
            const response = await fetch("/resend-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({}) });
            const data = await parseResponse(response);
            message(otpMessage, data.message, true);
            showDemoNotice(data, otpMessage);
        } catch (error) { message(otpMessage, error.message); }
    });

    document.getElementById("backToAuth")?.addEventListener("click", () => { window.location.href = "/"; });

    loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = document.getElementById("loginEmail").value.trim().toLowerCase();
        const password = document.getElementById("loginPassword").value;
        try {
            const response = await fetch("/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email,password}) });
            const data = await response.json().catch(() => ({}));
            if (data.needs_verification) {
                window.location.href = "/verify-otp";
                return;
            }
            if (!response.ok || !data.success) throw new Error(data.error || "Login failed.");
            window.location.href = "/";
        } catch (error) { message(loginMessage, error.message); }
    });

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
        try { await fetch("/logout", {method:"POST"}); } finally { window.location.href = "/"; }
    });
})();


function parseDurationMinutes(duration) {
    if (typeof duration === "number") return duration;
    if (!duration) return 0;

    const text = String(duration).toLowerCase().trim();
    let totalMinutes = 0;

    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs)/);
    if (hourMatch) {
        totalMinutes += parseFloat(hourMatch[1]) * 60;
    }

    const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins)/);
    if (minuteMatch) {
        totalMinutes += parseFloat(minuteMatch[1]);
    }

    if (totalMinutes === 0) {
        const numericValue = parseFloat(text);
        if (!isNaN(numericValue)) totalMinutes = numericValue;
    }

    return Math.round(totalMinutes);
}
function parseDistanceKm(distance) {
    // If backend already sends a number
    if (typeof distance === "number") {
        return distance;
    }

    // If value is missing
    if (!distance) {
        return 0;
    }

    const text = String(distance).toLowerCase().trim();

    // Handles values such as "1.48 km"
    const kmMatch = text.match(/(\d+(?:\.\d+)?)\s*km/);

    if (kmMatch) {
        return parseFloat(kmMatch[1]);
    }

    // Handles values such as "850 m"
    const meterMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:eters?)?/);

    if (meterMatch) {
        return parseFloat(meterMatch[1]) / 1000;
    }

    // Handles plain numeric values
    const numericValue = parseFloat(text);

    if (!isNaN(numericValue)) {
        return numericValue;
    }

    return 0;
}
/* ============================================================
   RouteShield AI
   Main Frontend JavaScript
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

    /* ========================================================
       DOM ELEMENTS
       ======================================================== */

    const startInput = document.getElementById("start-input");
    const destInput = document.getElementById("dest-input");

    const timeInput = document.getElementById("time-input");
    const modeSelect = document.getElementById("mode-select");

    const avoidDarkCheckbox =
        document.getElementById("avoid-dark");

    const analyzeBtn =
        document.getElementById("analyze-btn");

    const locationBtn =
        document.getElementById("location-btn");

    const routeList =
        document.getElementById(
            "route-recommendations-list"
        );

    const heroScore =
        document.getElementById(
            "hero-safety-score"
        );

    const analysisPanel =
        document.getElementById(
            "route-analysis-panel"
        );

    const analysisSummary =
        document.getElementById(
            "analysis-summary"
        );

    const analysisParameters =
        document.getElementById(
            "analysis-parameters"
        );

    /* ========================================================
       EMERGENCY DOM
       ======================================================== */

    const policeName =
        document.getElementById("police-name");

    const policeDist =
        document.getElementById("police-dist");

    const hospitalName =
        document.getElementById("hospital-name");

    const hospitalDist =
        document.getElementById("hospital-dist");

    const publicName =
        document.getElementById("public-name");

    const publicDist =
        document.getElementById("public-dist");


    /* ========================================================
       SOS DOM
       ======================================================== */

    const sosModal =
        document.getElementById("sos-modal");

    const openSosBtn =
        document.getElementById("open-sos-btn");

    const closeSosBtn =
        document.getElementById("close-sos-btn");

    const cancelSosBtn =
        document.getElementById("cancel-sos-btn");

    const shareLocationBtn =
        document.getElementById("share-location-btn");

    const sosLocationText =
        document.getElementById(
            "sos-location-text"
        );


    /* ========================================================
       MAP
       ======================================================== */

    let map = null;

    let routeLayers = [];

    let startMarker = null;

    let destinationMarker = null;

    let emergencyMarkers = [];

    let currentLocation = null;

    let lastAnalysis = null;
    let displayRoutesData = [];
    let selectedRouteIndex = 0;


    /* ========================================================
       INITIALIZE MAP
       ======================================================== */

    function initializeMap() {

        if (
            typeof L === "undefined" ||
            !document.getElementById("map")
        ) {

            console.error(
                "Leaflet or map element not found."
            );

            return;
        }

        map = L.map("map").setView(
            [28.4744, 77.5030],
            13
        );
        window.__routeShieldMap = map;

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(map);

        setTimeout(() => {
            map.invalidateSize();
        }, 300);
    }


    initializeMap();


    /* ========================================================
       UTILITY FUNCTIONS
       ======================================================== */

    function escapeHtml(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }



    /* ========================================================
       EXPLAINABLE AI SAFETY SCORE
       Additive feature: does not change existing route scoring
       ======================================================== */

    function getFallbackSafetyExplanation(route, routeType) {
        const params = route.analysis_parameters || {};
        const positiveFactors = [];
        const warningFactors = [];

        const emergencyCoverage = Number(params.emergency_service_coverage || 0);

        if (emergencyCoverage >= 100) {
            positiveFactors.push("Strong emergency-service coverage is available near this route.");
        } else if (emergencyCoverage >= 66) {
            positiveFactors.push("Good emergency-service coverage is available along this route.");
        } else if (emergencyCoverage > 0) {
            warningFactors.push("Emergency-service coverage is limited for this route.");
        } else {
            warningFactors.push("No nearby emergency-service coverage was detected during the analysis.");
        }

        if (params.night_travel) {
            warningFactors.push("Late-night travel conditions increase the route's safety risk.");
        } else {
            positiveFactors.push("The selected travel time is outside the late-night risk period.");
        }

        if (Number(params.mode_penalty || 0) > 0) {
            warningFactors.push(`${params.travel_mode || "Selected"} travel mode has additional safety exposure.`);
        } else {
            positiveFactors.push(`${params.travel_mode || "Driving"} mode has no additional mode-related penalty.`);
        }

        if (params.avoid_dark_roads) {
            positiveFactors.push("Avoid-dark-road preference is enabled for safer route selection.");
        } else {
            warningFactors.push("Avoid-dark-road preference is disabled.");
        }

        const distance = Number(params.route_distance_km ?? route.distance_val ?? 0);

        if (distance > 0 && distance <= 5) {
            positiveFactors.push("Short travel distance reduces overall travel exposure.");
        } else if (distance <= 15) {
            positiveFactors.push("Moderate route distance keeps travel exposure manageable.");
        } else if (distance > 15) {
            warningFactors.push("Longer travel distance increases overall travel exposure.");
        }

        let recommendation;

        if (routeType === "safe") {
            recommendation = "Recommended because this route provides the strongest overall balance of safety conditions, emergency accessibility, and travel efficiency.";
        } else if (routeType === "moderate") {
            recommendation = "This is a reasonable alternative, but it involves more safety trade-offs than the recommended route.";
        } else {
            recommendation = "Choose a safer alternative when possible because this route has comparatively higher risk.";
        }

        return {
            positive_factors: positiveFactors,
            warning_factors: warningFactors,
            recommendation: recommendation
        };
    }


    function getSafetyExplanation(route, routeType) {
        const explanation = route.safety_explanation;

        if (explanation && typeof explanation === "object") {
            return {
                positive_factors: Array.isArray(explanation.positive_factors)
                    ? explanation.positive_factors
                    : [],
                warning_factors: Array.isArray(explanation.warning_factors)
                    ? explanation.warning_factors
                    : [],
                recommendation: explanation.recommendation || ""
            };
        }

        return getFallbackSafetyExplanation(route, routeType);
    }


    function buildSafetyExplanationHtml(route, routeType) {
        const explanation = getSafetyExplanation(route, routeType);

        const positiveHtml = explanation.positive_factors.length
            ? explanation.positive_factors.map(
                factor => `
                    <li class="explain-factor explain-positive">
                        <span>✓</span>
                        <span>${escapeHtml(factor)}</span>
                    </li>
                `
            ).join("")
            : `
                <li class="explain-factor explain-neutral">
                    <span>•</span>
                    <span>No major positive factors available.</span>
                </li>
            `;

        const warningHtml = explanation.warning_factors.length
            ? explanation.warning_factors.map(
                factor => `
                    <li class="explain-factor explain-warning">
                        <span>⚠</span>
                        <span>${escapeHtml(factor)}</span>
                    </li>
                `
            ).join("")
            : `
                <li class="explain-factor explain-positive">
                    <span>✓</span>
                    <span>No major safety concerns were detected from the available route parameters.</span>
                </li>
            `;

        return `
            <div class="route-explanation">
                <button
                    type="button"
                    class="explanation-toggle"
                    aria-expanded="false"
                >
                    <span class="explanation-toggle-title">
                        ✦ Why this safety score?
                    </span>

                    <span class="explanation-toggle-action">
                        View AI analysis
                    </span>
                </button>

                <div class="explanation-content" hidden>
                    <div class="explanation-grid">

                        <div class="explanation-section">
                            <h4>
                                <span>✓</span>
                                Positive factors
                            </h4>

                            <ul>
                                ${positiveHtml}
                            </ul>
                        </div>

                        <div class="explanation-section">
                            <h4>
                                <span>⚠</span>
                                Things to consider
                            </h4>

                            <ul>
                                ${warningHtml}
                            </ul>
                        </div>

                    </div>

                    <div class="ai-recommendation">
                        <div class="ai-recommendation-title">
                            ✦ RouteShield AI recommendation
                        </div>

                        <p>
                            ${escapeHtml(
                                explanation.recommendation ||
                                "Safety analysis is based on the available route parameters."
                            )}
                        </p>
                    </div>
                </div>
            </div>
        `;
    }



    /* ========================================================
       DYNAMIC AI SAFETY ALERTS
       Additive feature: does not change route calculations
       ======================================================== */

    function getDynamicSafetyAlert(route, routeType) {
        const params = route.analysis_parameters || {};
        const score = Number(route.safety_score || 0);
        const emergencyCoverage = Number(
            params.emergency_service_coverage || 0
        );

        if (routeType === "safe") {
            return {
                level: "safe",
                icon: "✓",
                title: "AI Safety Alert: Safer Option",
                message:
                    "This route is currently the safer option based on the analyzed conditions.",
                tips: [
                    emergencyCoverage > 0
                        ? "Emergency support is available along or near the route."
                        : "Stay aware of nearby emergency support locations.",
                    "Keep your phone charged and route details accessible."
                ]
            };
        }

        if (routeType === "moderate") {
            return {
                level: "moderate",
                icon: "!",
                title: "AI Safety Alert: Stay Alert",
                message:
                    "Some safety concerns were detected. This route is usable, but requires more awareness than the recommended route.",
                tips: [
                    params.night_travel
                        ? "Late-night travel increases the safety risk."
                        : "Stay alert to changing surroundings during the journey.",
                    "Consider sharing your journey details with a trusted contact."
                ]
            };
        }

        return {
            level: "risk",
            icon: "⚠",
            title: "AI Safety Alert: Higher Risk Detected",
            message:
                "This route has comparatively higher safety risk. Consider choosing the recommended safer route whenever possible.",
            tips: [
                "Keep SOS and emergency contacts ready.",
                "Share your live location and avoid isolated areas when possible."
            ]
        };
    }


    function buildSafetyAlertHtml(route, routeType) {
        const alert = getDynamicSafetyAlert(route, routeType);

        return `
            <div class="dynamic-safety-alert safety-alert-${alert.level}">
                <div class="safety-alert-icon">
                    ${alert.icon}
                </div>

                <div class="safety-alert-body">
                    <div class="safety-alert-title">
                        ${escapeHtml(alert.title)}
                    </div>

                    <p class="safety-alert-message">
                        ${escapeHtml(alert.message)}
                    </p>

                    <ul class="safety-alert-tips">
                        ${alert.tips.map(
                            tip => `
                                <li>${escapeHtml(tip)}</li>
                            `
                        ).join("")}
                    </ul>
                </div>
            </div>
        `;
    }


    function showLoading() {

        if (analyzeBtn) {

            analyzeBtn.disabled = true;

            analyzeBtn.innerHTML =
                "Analysing routes...";
        }
    }


    function hideLoading() {

        if (analyzeBtn) {

            analyzeBtn.disabled = false;

            analyzeBtn.innerHTML =
                "Analyse Safest Routes";
        }
    }


    function showError(message) {

        alert(message);
    }


    function clearRoutes() {

        routeLayers.forEach(
            layer => {

                if (map) {
                    map.removeLayer(layer);
                }

            }
        );

        routeLayers = [];
    }


    function clearEmergencyMarkers() {

        emergencyMarkers.forEach(
            marker => {

                if (map) {
                    map.removeLayer(marker);
                }

            }
        );

        emergencyMarkers = [];
    }


    /* ========================================================
       MAP MARKERS
       ======================================================== */

    function addStartMarker(lat, lng) {

        if (!map) return;

        if (startMarker) {
            map.removeLayer(startMarker);
        }

        startMarker = L.marker(
            [lat, lng]
        )
            .addTo(map)
            .bindPopup(
                "<strong>Starting Point</strong>"
            );
    }


    function addDestinationMarker(lat, lng) {

        if (!map) return;

        if (destinationMarker) {
            map.removeLayer(destinationMarker);
        }

        destinationMarker = L.marker(
            [lat, lng]
        )
            .addTo(map)
            .bindPopup(
                "<strong>Destination</strong>"
            );
    }


    /* ========================================================
       ROUTE COLORS
       ======================================================== */

    function getRouteColor(route, index) {

        if (route && route.color) {
            return route.color;
        }

        if (index === 0) {
            return "#2e7d32";
        }

        if (index === 1) {
            return "#f57c00";
        }

        return "#d32f2f";
    }
    /* ========================================================
   ENSURE 3 ROUTE OPTIONS
   Safe + Moderate + High Risk
   ======================================================== */

function ensureThreeRoutes(routes) {
    /* Show ONLY the real routes returned by the backend (max 3).
       Earlier versions cloned route 1 and subtracted points from its
       score to fake a "moderate" and a "high-risk" route. */
    if (!routes || routes.length === 0) {
        return [];
    }
    return routes.slice(0, 3).map((route, index) => {
        const type = route.type || "moderate";
        const color =
            type === "safe" ? "#2e7d32"
            : type === "moderate" ? "#f57c00"
            : "#d32f2f";
        return { ...route, id: index + 1, type, color };
    });
}

    /* ========================================================
       DRAW ROUTES
       ======================================================== */

    /* ========================================================
   DRAW 3 ROUTES
   Green = Safe
   Orange = Moderate
   Red = High Risk
   ======================================================== */

let displayedRoutes = [];

function drawRoutes(routes) {

    if (!map) return;

    clearRoutes();

    displayedRoutes = ensureThreeRoutes(routes);

    if (typeof window.updateProfileRoutes === "function") {
        window.updateProfileRoutes(displayedRoutes, 0);
    }

    if (displayedRoutes.length === 0) {
        return;
    }

    const bounds = [];

    displayedRoutes.forEach((route, index) => {

        const coordinates =
            ((route.geojson && route.geojson.coordinates) || [])
                .map(coord => [coord[1], coord[0]]);

        const polyline = L.polyline(coordinates, {
            color: route.color,
            weight: 6,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round"
        }).addTo(map);

        polyline.bindTooltip(
            `${escapeHtml(route.label || "Route")} \u2022 ` +
            `${route.safety_score ?? "--"}/100 \u2022 ` +
            `${escapeHtml(route.distance || "--")} \u2022 ` +
            `${escapeHtml(route.duration || "--")}`,
            { sticky: true }
        );

        polyline.on("click", () => focusRoute(index, { fit: false }));

        routeLayers.push(polyline);
        coordinates.forEach(point => bounds.push(point));
    });

    window.__routeShieldRouteLayers = routeLayers;

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }

    highlightRoute(0);
}


/* Selected route = bold + on top; the others stay visible but dimmed. */
function highlightRoute(index) {

    selectedRouteIndex = index;
    window.__routeShieldSelectedRouteIndex = index;

    routeLayers.forEach((layer, i) => {
        const selected = i === index;
        layer.setStyle({
            weight: selected ? 9 : 5,
            opacity: selected ? 1 : 0.28
        });
        if (selected) layer.bringToFront();
    });

    if (routeList) {
        routeList.querySelectorAll(".route-card").forEach(card => {
            const selected = Number(card.dataset.routeIndex) === index;
            card.classList.toggle("route-selected", selected);
            card.classList.toggle("route-dimmed", !selected);
            card.setAttribute("aria-pressed", String(selected));
        });
    }
}

    /* ========================================================
       ROUTE CARDS
       ======================================================== */

    /* ========================================================
   3 ROUTE CARDS
   ======================================================== */



/* ========================================================
   REAL CRIME SEVERITY
   The backend is the single source of truth. The frontend never
   assigns Low/Medium/High from route rank, route type or score.
   ======================================================== */

function getCrimeSeverityDetails(route) {
    const crime = route && route.crime_severity;

    if (
        !crime ||
        crime.available !== true ||
        crime.score === null ||
        crime.score === undefined
    ) {
        return {
            available: false,
            severity: "Data match pending",
            score: null,
            className: "crime-unavailable",
            icon: "i",
            message:
                (crime && crime.reason)
                    ? crime.reason
                    : "Historical crime data could not be matched to this route area.",
            meta:
                "Historical incident dataset (Delhi, synthetic)"
        };
    }

    const severity = String(crime.level || "Medium");
    const score = Number(crime.score);

    const className =
        severity === "Low"
            ? "crime-low"
            : severity === "Medium"
                ? "crime-medium"
                : "crime-high";

    const icon =
        severity === "Low"
            ? "✓"
            : severity === "Medium"
                ? "!"
                : "⚠";

    const area = crime.area || "route area";
    const year = crime.year || 2023;
    const metric = crime.official_metric;
    const metricLabel =
        crime.metric_label || "official historical crime metric";

    return {
        available: true,
        severity,
        score,
        className,
        icon,
        message:
            `${severity} historical crime severity based on ${year} incident records for ${area}.`,
        meta:
            metric !== null && metric !== undefined
                ? `${metricLabel}: ${metric} • Normalized severity: ${score}/100`
                : `Historical incident dataset • ${score}/100`
    };
}


function buildCrimeSeverityHtml(route) {
    const crime = getCrimeSeverityDetails(route);

    return `
        <div class="crime-severity-box ${crime.className}">
            <div class="crime-severity-icon">
                ${crime.icon}
            </div>

            <div class="crime-severity-content">
                <span class="crime-severity-label">
                    Crime Severity
                </span>

                <strong>
                    ${escapeHtml(crime.severity)}
                    ${
                        crime.available
                            ? `<span class="crime-score-value">${escapeHtml(String(crime.score))}/100</span>`
                            : ""
                    }
                </strong>

                <small>
                    ${escapeHtml(crime.message)}
                </small>

                <small class="crime-severity-meta">
                    ${escapeHtml(crime.meta)}
                </small>
            </div>
        </div>
    `;
}





/* ========================================================
   ROUTE COMPARISON
   Additive feature: compares existing analyzed routes only
   ======================================================== */

function getComparisonRouteType(route, index) {
    return route.type || (index === 0 ? "safe" : index === 1 ? "moderate" : "risk");
}

function getComparisonCrowd(route, index) {
    return route.crowd_ratio || route.crowdRatio ||
        (index === 0 ? "High" : index === 1 ? "Medium" : "Low");
}

function getRouteCctvDensity(route, index = 0) {
    // Prefer a real value returned by the backend/API.
    const existing = route.cctv_density ?? route.cctvDensity ?? route.cctv;
    if (existing !== undefined && existing !== null && String(existing).trim() !== "") {
        return String(existing);
    }

    // Dynamic fallback: a deterministic route-specific estimate, not a fixed
    // value based only on the route's display index.
    const params = route.analysis_parameters || {};
    const safetyScore = Number(route.safety_score || 0);
    const emergencyCoverage = Number(params.emergency_service_coverage || 0);
    const duration = parseDurationMinutes(route.duration);
    const distance = parseDistanceKm(route.distance);

    // Each route gets a different estimate from its own analysed properties.
    // Distance/duration represent route exposure, while safety/emergency values
    // provide route-context variation. Result is capped at a sensible range.
    let estimate =
        4 +
        (safetyScore * 0.18) +
        (emergencyCoverage * 0.06) +
        Math.min(distance, 25) * 0.55 +
        Math.min(duration, 90) * 0.035;

    if (params.night_travel) estimate -= 1.5;
    if (Number(params.mode_penalty || 0) > 0) estimate -= 0.75;

    estimate = Math.max(1, Math.min(35, estimate));
    return `~${Math.round(estimate)}`;
}

function getComparisonCctv(route, index) {
    const value = getRouteCctvDensity(route, index);
    const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric)) return value;
    if (numeric >= 22) return `High (~${Math.round(numeric)})`;
    if (numeric >= 12) return `Medium (~${Math.round(numeric)})`;
    return `Low (~${Math.round(numeric)})`;
}

function getComparisonLighting(route, index) {
    const type = getComparisonRouteType(route, index);
    return type === "safe" ? "Well-lit" : type === "moderate" ? "Moderate" : "Poor";
}

function getComparisonLabel(route, index) {
    const type = getComparisonRouteType(route, index);
    return type === "safe" ? "Safer Route" :
        type === "moderate" ? "Moderate Route" : "High-Risk Route";
}

function buildRouteComparisonHtml(routes) {
    if (!Array.isArray(routes) || routes.length < 2) return "";

    const sortedRoutes = [...routes]
        .map((route, index) => ({
            route,
            originalIndex: index,
            score: Number(route.safety_score || 0)
        }))
        .sort((a, b) => b.score - a.score);

    const best = sortedRoutes[0];
    const runnerUp = sortedRoutes[1];
    const scoreDifference = best.score - runnerUp.score;

    const factors = [
        { label: "Safety Score", value: item => `${item.score}/100` },
        { label: "CCTV Coverage", value: item => getComparisonCctv(item.route, item.originalIndex) },
        { label: "Public Activity", value: item => getComparisonCrowd(item.route, item.originalIndex) },
        { label: "Lighting", value: item => getComparisonLighting(item.route, item.originalIndex) }
    ];

    const headerHtml = sortedRoutes.map(item => `
        <div class="comparison-route-heading">
            ${escapeHtml(getComparisonLabel(item.route, item.originalIndex))}
            ${item === best ? `<span class="comparison-best-badge">Recommended</span>` : ""}
        </div>
    `).join("");

    const rowsHtml = factors.map(row => `
        <div class="comparison-row">
            <div class="comparison-factor">${escapeHtml(row.label)}</div>
            ${sortedRoutes.map(item => `
                <div class="comparison-value ${item === best ? "comparison-best-value" : ""}">
                    ${escapeHtml(String(row.value(item)))}
                </div>
            `).join("")}
        </div>
    `).join("");

    const recommendation = scoreDifference > 0
        ? `${getComparisonLabel(best.route, best.originalIndex)} is recommended because it has the highest safety score, with a ${scoreDifference}-point advantage over the next option and a stronger overall balance of route safety conditions.`
        : `${getComparisonLabel(best.route, best.originalIndex)} is recommended because it provides the strongest overall safety balance among the available routes.`;

    return `
        <section class="route-comparison">
            <div class="route-comparison-header">
                <span class="comparison-kicker">AI ROUTE COMPARISON</span>
                <h3>Why is this route safer?</h3>
                <p>Compare the available routes using the same safety factors analyzed by RouteShield AI.</p>
            </div>

            <div class="comparison-table-wrap">
                <div class="comparison-table comparison-route-header-row">
                    <div class="comparison-factor comparison-factor-heading">Factor</div>
                    ${headerHtml}
                </div>
                ${rowsHtml}
            </div>

            <div class="comparison-ai-summary">
                <div class="comparison-summary-icon">AI</div>
                <div>
                    <strong>Why this route is recommended</strong>
                    <p>${escapeHtml(recommendation)}</p>
                </div>
            </div>
        </section>
    `;
}


function renderRouteCards(routes) {

    if (!routeList) {
        return;
    }

    routeList.innerHTML = "";

    const displayRoutes =
        ensureThreeRoutes(routes);

    if (
        !displayRoutes ||
        displayRoutes.length === 0
    ) {

        routeList.innerHTML =
            `
            <div class="route-empty">
                No route alternatives found.
            </div>
            `;

        return;
    }

    displayRoutes.forEach(
        (route, index) => {

            const type =
                route.type ||
                (
                    index === 0
                        ? "safe"
                        : index === 1
                            ? "moderate"
                            : "risk"
                );

            const score =
                Number(
                    route.safety_score
                ) || 0;

            let riskClass;
            let riskText;
            let icon;
            let color;

            if (type === "safe") {

                riskClass =
                    "route-safe";

                riskText = index === 0 ? "Safer Route (Recommended)" : "Safe Route (Alternative)";

                icon = "✓";

                color =
                    "#2e7d32";

            }
            else if (
                type === "moderate"
            ) {

                riskClass =
                    "route-moderate";

                riskText = index === 0 ? "Moderate Risk Route (Best Available)" : "Moderate Risk Route";

                icon = "!";

                color =
                    "#f57c00";

            }
            else {

                riskClass =
                    "route-high-risk";

                riskText =
                    "High-Risk Route";

                icon = "×";

                color =
                    "#d32f2f";
            }

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                `route-card ${riskClass}`;

            /* --------------------------------------------
               DISPLAY INFORMATION
               -------------------------------------------- */

            const params =
                route.analysis_parameters ||
                {};

            const emergencyCoverage =
                params.emergency_service_coverage ??
                "--";

            const nightTravel =
                params.night_travel;

            let lightingText;

            if (type === "safe") {

                lightingText =
                    "Well-lit streets";

            }
            else if (
                type === "moderate"
            ) {

                lightingText =
                    "Moderate lighting";

            }
            else {

                lightingText =
                    "Poor lighting";

            }

            const cctvDensity = getRouteCctvDensity(route, index);
            const cctvNumeric = Number(
                String(cctvDensity).replace(/[^0-9.]/g, "")
            );

            let cctvText;

            if (Number.isFinite(cctvNumeric) && cctvNumeric >= 22) {
                cctvText = `High CCTV coverage (${cctvDensity})`;
            } else if (Number.isFinite(cctvNumeric) && cctvNumeric >= 12) {
                cctvText = `Moderate CCTV coverage (${cctvDensity})`;
            } else {
                cctvText = `Limited CCTV coverage (${cctvDensity})`;
            }

            let crowdText;

            if (type === "safe") {

                crowdText =
                    "High public activity";

            }
            else if (
                type === "moderate"
            ) {

                crowdText =
                    "Moderate public activity";

            }
            else {

                crowdText =
                    "Low public activity";
            }

            card.innerHTML =
                `
                <div
                    class="route-card-icon"
                    style="
                        color:${color};
                        border-color:${color};
                    "
                >
                    <div class="route-shield-shape">
                        ${icon}
                    </div>
                </div>

                <div class="route-card-content">

                    <div class="route-card-main">

                        <div class="route-card-title">
                            ${escapeHtml(
                                riskText
                            )}
                        </div>

                        <div class="route-card-distance">
                            <strong>Distance:</strong>
                            ${escapeHtml(
                                route.distance ||
                                "--"
                            )}

                            <span class="route-separator">|</span>

                            <strong>Duration:</strong>
                            ${escapeHtml(
                                route.duration ||
                                "--"
                            )}
                        </div>

                        <div class="route-card-secondary">
                            <strong>CCTV Density:</strong>
                            ${escapeHtml(
                                getRouteCctvDensity(
                                    route,
                                    index
                                )
                            )}

                            <span class="route-separator">|</span>

                            <strong>Crowd Ratio:</strong>
                            ${escapeHtml(
                                route.crowd_ratio ||
                                route.crowdRatio ||
                                (
                                    index === 0
                                        ? "High (Well Populated)"
                                        : index === 1
                                            ? "Medium (Moderate Activity)"
                                            : "Low (Less Populated)"
                                )
                            )}
                        </div>

                    </div>

                    <div class="route-score-box">
                        <strong>${score}</strong>
                        <span>SAFETY SCORE</span>
                    </div>

                    <div class="route-indicators">

                        <div class="route-indicator">
                            <span class="indicator-icon">${icon}</span>
                            ${escapeHtml(lightingText)}
                        </div>

                        <div class="route-indicator">
                            <span class="indicator-icon">${icon}</span>
                            ${escapeHtml(cctvText)}
                        </div>

                        <div class="route-indicator">
                            <span class="indicator-icon">${icon}</span>
                            ${escapeHtml(crowdText)}
                        </div>

                    </div>

                    ${buildCrimeSeverityHtml(
                        route,
                        type
                    )}

                    ${buildSafetyAlertHtml(
                        route,
                        type
                    )}

                    ${buildSafetyExplanationHtml(
                        route,
                        type
                    )}

                </div>
                `;

            card.dataset.routeIndex = String(index);
            card.tabIndex = 0;
            card.setAttribute("role", "button");
            card.setAttribute("aria-label", `Show ${riskText} on the map`);
            card.addEventListener("click", event => {
                if (event.target.closest("button, a, .explanation-toggle")) return;
                focusRoute(index);
            });
            card.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    if (event.target.closest("button, a")) return;
                    event.preventDefault();
                    focusRoute(index);
                }
            });
            routeList.appendChild(card);
        }
    );


    /* --------------------------------------------
       ROUTE COMPARISON
       -------------------------------------------- */

    routeList.insertAdjacentHTML(
        "beforeend",
        displayRoutes.length < 2
            ? `<div class="route-empty">Only one route is available between these places, so there is nothing to compare.</div>`
            : buildRouteComparisonHtml(displayRoutes)
    );


    /* --------------------------------------------
       EXPLAINABLE AI TOGGLES
       -------------------------------------------- */

    routeList
        .querySelectorAll(
            ".explanation-toggle"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const explanation =
                            button.parentElement
                                .querySelector(
                                    ".explanation-content"
                                );

                        if (!explanation) {
                            return;
                        }

                        const isOpen =
                            !explanation.hidden;

                        explanation.hidden =
                            isOpen;

                        button.setAttribute(
                            "aria-expanded",
                            String(!isOpen)
                        );

                        const action =
                            button.querySelector(
                                ".explanation-toggle-action"
                            );

                        if (action) {
                            action.textContent =
                                isOpen
                                    ? "View AI analysis"
                                    : "Hide AI analysis";
                        }
                    }
                );
            }
        );


    /* --------------------------------------------
       VIEW ROUTE BUTTONS
       -------------------------------------------- */

    document
        .querySelectorAll(
            ".route-view-btn"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const index =
                            Number(
                                button.dataset
                                    .routeIndex
                            );

                        focusRoute(
                            index
                        );
                    }
                );
            }
        );
}

    /* ========================================================
       FOCUS INDIVIDUAL ROUTE
       ======================================================== */

    function focusRoute(index, opts = {}) {

        const route = displayedRoutes[index];
        if (!route) return;

        highlightRoute(index);

        if (opts.fit !== false && map && route.geojson && route.geojson.coordinates) {
            const points = route.geojson.coordinates.map(c => [c[1], c[0]]);
            if (points.length) {
                map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
            }
        }

        renderAnalysisForRoute(route, index);
    }

    /* Profile route selector can reuse the existing map/analysis logic. */
    window.routeShieldFocusRoute = focusRoute;


    /* ========================================================
       TRUST / ANALYSIS PANEL
       ======================================================== */

    function renderAnalysisForRoute(
        route,
        index
    ) {

        if (
            !analysisPanel ||
            !analysisSummary ||
            !analysisParameters
        ) {
            return;
        }

        const params =
            route.analysis_parameters ||
            {};

        const score =
            route.safety_score ?? "--";

        analysisPanel.style.display =
            "block";

        analysisSummary.innerHTML =
            `
            <strong>
                ${escapeHtml(
                    route.label ||
                    "Selected Route"
                )}
            </strong>

            has a safety score of
            <strong>${score}/100</strong>.

            The score is based on the same
            route and travel factors returned
            by the RouteShield AI backend.
            `;

        const parameterItems = [

            {
                label:
                    "Safety Score",

                value:
                    `${score} / 100`
            },

            {
                label:
                    "Route Distance",

                value:
                    `${params.route_distance_km ??
                        route.distance_val ??
                        "--"} km`
            },

            {
                label:
                    "Estimated Duration",

                value:
                    `${params.estimated_duration_min ??
                        route.duration_val ??
                        "--"} min`
            },

            {
                label:
                    "Night Travel",

                value:
                    params.night_travel
                        ? "Yes"
                        : "No"
            },

            {
                label:
                    "Travel Mode",

                value:
                    params.travel_mode ||
                    "Driving"
            },

            {
                label:
                    "Avoid Dark Roads",

                value:
                    params.avoid_dark_roads
                        ? "Enabled"
                        : "Disabled"
            },

            {
                label:
                    "Distance Exposure",

                value:
                    params.distance_exposure_factor ??
                    "--"
            },

            {
                label:
                    "Emergency Coverage",

                value:
                    `${
                        params.emergency_service_coverage ??
                        "--"
                    }%`
            },

            {
                label:
                    "Nearest Emergency",

                value:
                    params.nearest_emergency_distance_km !==
                    null &&
                    params.nearest_emergency_distance_km !==
                    undefined

                        ? `${params.nearest_emergency_distance_km} km`

                        : "Not available"
            }
        ];

        analysisParameters.innerHTML =
            parameterItems
                .map(
                    item =>
                        `
                        <div
                            class="analysis-parameter"
                            style="
                                padding:10px;
                                background:#f8fafc;
                                border:1px solid #e2e8f0;
                                border-radius:8px;
                            "
                        >

                            <div
                                style="
                                    font-size:0.75rem;
                                    color:#64748b;
                                    margin-bottom:4px;
                                "
                            >
                                ${escapeHtml(
                                    item.label
                                )}
                            </div>

                            <strong
                                style="
                                    color:#1e293b;
                                "
                            >
                                ${escapeHtml(
                                    item.value
                                )}
                            </strong>

                        </div>
                        `
                )
                .join("");
    }


    /* ========================================================
       EMERGENCY SERVICES
       ======================================================== */

    function updateEmergencyCard(
        item,
        nameElement,
        distanceElement,
        fallback
    ) {

        if (!nameElement || !distanceElement) {
            return;
        }

        if (!item) {

            nameElement.textContent =
                fallback;

            distanceElement.textContent =
                "-- km away";

            return;
        }

        nameElement.textContent =
            item.name ||
            "Nearby Facility";

        const distance =
            item.distance;

        distanceElement.textContent =
            distance !== null &&
            distance !== undefined

                ? `${distance} km away`

                : "-- km away";
    }


    function updateEmergencyServices(
        emergencyData
    ) {

        if (!emergencyData) {
            return;
        }

        updateEmergencyCard(

            emergencyData.police,

            policeName,

            policeDist,

            "No nearby police station found"
        );

        updateEmergencyCard(

            emergencyData.hospital,

            hospitalName,

            hospitalDist,

            "No nearby hospital found"
        );

        updateEmergencyCard(

            emergencyData.public,

            publicName,

            publicDist,

            "No nearby public facility found"
        );

        drawEmergencyMarkers(
            emergencyData
        );
    }


    /* ========================================================
       EMERGENCY MAP MARKERS
       ======================================================== */

    function drawEmergencyMarkers(
        emergencyData
    ) {

        if (!map) return;

        clearEmergencyMarkers();

        const facilities = [

            {
                item:
                    emergencyData.police,

                label:
                    "Police Station"
            },

            {
                item:
                    emergencyData.hospital,

                label:
                    "Hospital"
            },

            {
                item:
                    emergencyData.public,

                label:
                    "Public Safe Spot"
            }
        ];

        facilities.forEach(
            facility => {

                const item =
                    facility.item;

                if (
                    !item ||
                    item.latitude === undefined ||
                    item.longitude === undefined
                ) {
                    return;
                }

                const marker =
                    L.marker(
                        [
                            item.latitude,
                            item.longitude
                        ]
                    )
                    .addTo(map)
                    .bindPopup(
                        `
                        <strong>
                            ${escapeHtml(
                                facility.label
                            )}
                        </strong>

                        <br>

                        ${escapeHtml(
                            item.name ||
                            "Nearby Facility"
                        )}

                        <br>

                        Distance:
                        ${item.distance ?? "--"}
                        km

                        <br>

                        <small>
                            Source:
                            OpenStreetMap
                        </small>
                        `
                    );

                emergencyMarkers.push(
                    marker
                );
            }
        );
    }


    /* ========================================================
       FETCH EMERGENCY SERVICES
       ======================================================== */

    async function fetchEmergencyServices(
        lat,
        lng
    ) {

        try {

            const response =
                await fetch(
                    "/nearby-emergency",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                lat: lat,
                                lng: lng
                            })
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "Emergency service request failed."
                );
            }

            const data =
                await response.json();

            if (
                data.success
            ) {

                updateEmergencyServices(
                    data
                );
            }

            return data;

        } catch (error) {

            console.error(
                "Emergency service error:",
                error
            );

            return null;
        }
    }


    /* ========================================================
       CURRENT LOCATION
       ======================================================== */

    async function useCurrentLocation() {

        if (
            !navigator.geolocation
        ) {

            showError(
                "Geolocation is not supported by your browser."
            );

            return;
        }

        locationBtn.disabled = true;

        locationBtn.textContent =
            "Getting location...";

        navigator.geolocation.getCurrentPosition(

            async position => {

                const lat =
                    position.coords.latitude;

                const lng =
                    position.coords.longitude;

                currentLocation = {
                    lat: lat,
                    lng: lng
                };

                /*
                 * Important:
                 * Do NOT put "Current Location"
                 * as the only backend value.
                 *
                 * Send exact coordinates later.
                 */

                startInput.value =
                    "Current Location";

                startInput.dataset.lat =
                    lat;

                startInput.dataset.lng =
                    lng;

                addStartMarker(
                    lat,
                    lng
                );

                if (map) {

                    map.setView(
                        [lat, lng],
                        15
                    );
                }

                /* --------------------------------------------
                   Reverse geocode for a user-friendly
                   source recommendation.
                   -------------------------------------------- */

                try {

                    const response =
                        await fetch(
                            `/reverse-geocode?lat=${encodeURIComponent(
                                lat
                            )}&lng=${encodeURIComponent(
                                lng
                            )}`
                        );

                    const data =
                        await response.json();

                    if (
                        data.success &&
                        data.display_name
                    ) {

                        startInput.title =
                            data.display_name;
                    }

                } catch (error) {

                    console.warn(
                        "Reverse geocoding failed:",
                        error
                    );
                }

                /* --------------------------------------------
                   Dynamically update emergency services
                   immediately.
                   -------------------------------------------- */

                await fetchEmergencyServices(
                    lat,
                    lng
                );

                locationBtn.disabled =
                    false;

                locationBtn.textContent =
                    "Use My Current Location";
            },

            error => {

                console.error(
                    "Geolocation error:",
                    error
                );

                let message =
                    "Unable to get your current location.";

                if (
                    error.code ===
                    error.PERMISSION_DENIED
                ) {

                    message =
                        "Location permission was denied. Please allow location access in your browser.";

                } else if (
                    error.code ===
                    error.POSITION_UNAVAILABLE
                ) {

                    message =
                        "Your current location is unavailable.";

                } else if (
                    error.code ===
                    error.TIMEOUT
                ) {

                    message =
                        "Location request timed out.";
                }

                showError(message);

                locationBtn.disabled =
                    false;

                locationBtn.textContent =
                    "Use My Current Location";
            },

            {
                enableHighAccuracy: true,

                timeout: 15000,

                maximumAge: 0
            }
        );
    }


    /* ========================================================
       ROUTE ANALYSIS
       ======================================================== */

    async function analyzeRoutes() {

        const start =
            startInput.value.trim();

        const destination =
            destInput.value.trim();

        if (!start) {

            showError(
                "Please enter a starting point."
            );

            startInput.focus();

            return;
        }

        if (!destination) {

            showError(
                "Please enter a destination."
            );

            destInput.focus();

            return;
        }

        showLoading();

        try {

            /*
             * Build backend request.
             *
             * If Current Location was selected,
             * exact GPS coordinates are sent.
             */

            const payload = {

                start: start,

                destination:
                    destination,

                travel_time:
                    timeInput.value ||
                    "12:00",

                travel_mode:
                    modeSelect.value ||
                    "Driving",

                avoid_dark_roads:
                    avoidDarkCheckbox
                        ? avoidDarkCheckbox.checked
                        : false
            };

            /* ----------------------------------------------
               Exact current-location coordinates
               ---------------------------------------------- */

            if (
                startInput.dataset.lat &&
                startInput.dataset.lng
            ) {

                payload.start_lat =
                    Number(
                        startInput.dataset.lat
                    );

                payload.start_lng =
                    Number(
                        startInput.dataset.lng
                    );
            }

            /*
             * Send destination coordinates if an earlier
             * suggestion stored them.
             */

            if (
                destInput.dataset.lat &&
                destInput.dataset.lng
            ) {

                payload.destination_lat =
                    Number(
                        destInput.dataset.lat
                    );

                payload.destination_lng =
                    Number(
                        destInput.dataset.lng
                    );
            }

            const response =
                await fetch(
                    "/analyze-route",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Route analysis failed."
                );
            }

            lastAnalysis = data;
            window.__routeShieldLastAnalysis = data;

            /* ----------------------------------------------
               HERO SCORE
               ---------------------------------------------- */

            if (heroScore) {

                heroScore.textContent =
                    data.hero_safety_score ??
                    "--";
            }

            /* ----------------------------------------------
               Routes
               ---------------------------------------------- */

            renderRouteCards(
                data.routes
            );

            drawRoutes(
                data.routes
            );

            /* ----------------------------------------------
               Start / destination markers
               ---------------------------------------------- */

            if (
                data.start_location
            ) {

                addStartMarker(

                    data.start_location.latitude,

                    data.start_location.longitude
                );
            }

            if (
                data.destination_location
            ) {

                addDestinationMarker(

                    data.destination_location.latitude,

                    data.destination_location.longitude
                );
            }

            /* ----------------------------------------------
               Emergency services
               ---------------------------------------------- */

            if (
                data.emergency_services
            ) {

                updateEmergencyServices(
                    data.emergency_services
                );
            }

            /* ----------------------------------------------
               Trust panel
               ---------------------------------------------- */

            if (
                data.routes &&
                data.routes.length > 0
            ) {

                renderAnalysisForRoute(
                    data.routes[0],
                    0
                );
            }

            /* ----------------------------------------------
               Smoothly bring user to route results
               ---------------------------------------------- */

            if (routeList) {

                routeList.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest"
                });
            }

        } catch (error) {

            console.error(
                "Route analysis error:",
                error
            );

            showError(
                error.message ||
                "Something went wrong while analysing the route."
            );

        } finally {

            hideLoading();
        }
    }


    /* ========================================================
       SOURCE / DESTINATION SUGGESTIONS
       ======================================================== */

    let suggestionTimers = {
        start: null,
        destination: null
    };


    function createSuggestionBox(
        input
    ) {

        let box =
            input.parentElement.querySelector(
                ".location-suggestions"
            );

        if (box) {
            return box;
        }

        box =
            document.createElement(
                "div"
            );

        box.className =
            "location-suggestions";

        box.style.cssText =
            `
            position:absolute;
            left:0;
            right:0;
            top:100%;
            z-index:10000;
            background:#ffffff;
            border:1px solid #dce7e3;
            border-radius:8px;
            box-shadow:0 8px 25px rgba(0,0,0,0.10);
            overflow:hidden;
            display:none;
            `;

        input.parentElement.style.position =
            "relative";

        input.parentElement.appendChild(
            box
        );

        return box;
    }


    async function searchLocationSuggestions(
        input,
        type
    ) {

        const query =
            input.value.trim();

        const box =
            createSuggestionBox(
                input
            );

        if (query.length < 3) {

            box.style.display =
                "none";

            return;
        }

        try {

            const response =
                await fetch(
                    "https://nominatim.openstreetmap.org/search?" +
                    new URLSearchParams({

                        q: query,

                        format: "json",

                        addressdetails: "1",

                        limit: "5",

                        countrycodes: "in"
                    }),
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "Suggestion request failed"
                );
            }

            const results =
                await response.json();

            /*
             * Make sure the user hasn't changed
             * the input while request was running.
             */

            if (
                input.value.trim() !==
                query
            ) {
                return;
            }

            box.innerHTML = "";

            if (
                !results ||
                results.length === 0
            ) {

                box.innerHTML =
                    `
                    <div
                        style="
                            padding:12px;
                            color:#64748b;
                        "
                    >
                        No locations found
                    </div>
                    `;

                box.style.display =
                    "block";

                return;
            }

            results.forEach(
                result => {

                    const item =
                        document.createElement(
                            "div"
                        );

                    item.className =
                        "location-suggestion-item";

                    item.style.cssText =
                        `
                        padding:11px 13px;
                        cursor:pointer;
                        border-bottom:1px solid #f1f5f9;
                        font-size:0.88rem;
                        color:#334155;
                        background:#fff;
                        `;

                    item.textContent =
                        result.display_name;

                    item.addEventListener(
                        "mouseenter",
                        () => {
                            item.style.background =
                                "#f8fafc";
                        }
                    );

                    item.addEventListener(
                        "mouseleave",
                        () => {
                            item.style.background =
                                "#fff";
                        }
                    );

                    item.addEventListener(
                        "click",
                        () => {

                            input.value =
                                result.display_name;

                            /*
                             * Store coordinates.
                             * Backend will use these instead
                             * of geocoding again.
                             */

                            input.dataset.lat =
                                result.lat;

                            input.dataset.lng =
                                result.lon;

                            box.style.display =
                                "none";

                            /*
                             * If this is the starting point,
                             * dynamically update emergency
                             * facilities immediately.
                             */

                            if (
                                type === "start"
                            ) {

                                fetchEmergencyServices(
                                    Number(
                                        result.lat
                                    ),
                                    Number(
                                        result.lon
                                    )
                                );

                                addStartMarker(
                                    Number(
                                        result.lat
                                    ),
                                    Number(
                                        result.lon
                                    )
                                );
                            }

                            if (
                                type === "destination"
                            ) {

                                addDestinationMarker(
                                    Number(
                                        result.lat
                                    ),
                                    Number(
                                        result.lon
                                    )
                                );
                            }
                        }
                    );

                    box.appendChild(
                        item
                    );
                }
            );

            box.style.display =
                "block";

        } catch (error) {

            console.warn(
                "Location suggestions unavailable:",
                error
            );

            box.style.display =
                "none";
        }
    }


    /* ========================================================
       INPUT EVENTS
       ======================================================== */

    if (startInput) {

        startInput.addEventListener(
            "input",
            () => {

                /*
                 * User has manually edited the input,
                 * so previously stored GPS coordinates
                 * should not be reused.
                 */

                delete startInput.dataset.lat;
                delete startInput.dataset.lng;

                clearTimeout(
                    suggestionTimers.start
                );

                suggestionTimers.start =
                    setTimeout(
                        () => {

                            searchLocationSuggestions(
                                startInput,
                                "start"
                            );

                        },
                        350
                    );
            }
        );
    }


    if (destInput) {

        destInput.addEventListener(
            "input",
            () => {

                delete destInput.dataset.lat;
                delete destInput.dataset.lng;

                clearTimeout(
                    suggestionTimers.destination
                );

                suggestionTimers.destination =
                    setTimeout(
                        () => {

                            searchLocationSuggestions(
                                destInput,
                                "destination"
                            );

                        },
                        350
                    );
            }
        );
    }


    /* ========================================================
       CLOSE SUGGESTIONS WHEN CLICKING OUTSIDE
       ======================================================== */

    document.addEventListener(
        "click",
        event => {

            document
                .querySelectorAll(
                    ".location-suggestions"
                )
                .forEach(
                    box => {

                        if (
                            !box.parentElement
                                .contains(
                                    event.target
                                )
                        ) {

                            box.style.display =
                                "none";
                        }
                    }
                );
        }
    );


    /* ========================================================
       BUTTON EVENTS
       ======================================================== */

    if (analyzeBtn) {

        analyzeBtn.addEventListener(
            "click",
            analyzeRoutes
        );
    }


    if (locationBtn) {

        locationBtn.addEventListener(
            "click",
            useCurrentLocation
        );
    }


    /* ========================================================
       ENTER KEY
       ======================================================== */

    [
        startInput,
        destInput
    ].forEach(
        input => {

            if (!input) return;

            input.addEventListener(
                "keydown",
                event => {

                    if (
                        event.key ===
                        "Enter"
                    ) {

                        event.preventDefault();

                        analyzeRoutes();
                    }
                }
            );
        }
    );


    /* ========================================================
       SOS
       ======================================================== */

    async function openSOS() {

        if (!sosModal) return;

        sosModal.classList.add(
            "show"
        );

        sosModal.style.display =
            "flex";

        if (sosLocationText) {

            sosLocationText.textContent =
                "Fetching current coordinates...";
        }

        if (
            !navigator.geolocation
        ) {

            if (sosLocationText) {

                sosLocationText.textContent =
                    "Geolocation is not supported by this browser.";
            }

            return;
        }

        navigator.geolocation.getCurrentPosition(

            position => {

                const lat =
                    position.coords.latitude;

                const lng =
                    position.coords.longitude;

                currentLocation = {
                    lat: lat,
                    lng: lng
                };

                const locationLink =
                    `https://www.google.com/maps?q=${lat},${lng}`;

                if (sosLocationText) {

                    sosLocationText.innerHTML =
                        `
                        <strong>
                            Current Coordinates
                        </strong>

                        <br>

                        Latitude:
                        ${lat.toFixed(6)}

                        <br>

                        Longitude:
                        ${lng.toFixed(6)}

                        <br><br>

                        <a
                            href="${locationLink}"
                            target="_blank"
                            rel="noopener"
                        >
                            Open location on map
                        </a>
                        `;
                }

                if (shareLocationBtn) {

                    shareLocationBtn.dataset.link =
                        locationLink;
                }
            },

            error => {

                console.error(
                    "SOS location error:",
                    error
                );

                if (sosLocationText) {

                    sosLocationText.textContent =
                        "Unable to retrieve your current location. Please enable location permission.";
                }
            },

            {
                enableHighAccuracy: true,

                timeout: 10000,

                maximumAge: 0
            }
        );
    }


    function closeSOS() {

        if (!sosModal) return;

        sosModal.classList.remove(
            "show"
        );

        sosModal.style.display =
            "none";
    }


    if (openSosBtn) {

        openSosBtn.addEventListener(
            "click",
            openSOS
        );
    }


    if (closeSosBtn) {

        closeSosBtn.addEventListener(
            "click",
            closeSOS
        );
    }


    if (cancelSosBtn) {

        cancelSosBtn.addEventListener(
            "click",
            closeSOS
        );
    }


    if (sosModal) {

        sosModal.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    sosModal
                ) {

                    closeSOS();
                }
            }
        );
    }


    /* ========================================================
       COPY SOS LOCATION
       ======================================================== */

    if (shareLocationBtn) {

        shareLocationBtn.addEventListener(
            "click",
            async () => {

                const link =
                    shareLocationBtn.dataset
                        .link;

                if (!link) {

                    showError(
                        "Current location is not available yet."
                    );

                    return;
                }

                try {

                    await navigator
                        .clipboard
                        .writeText(link);

                    const oldText =
                        shareLocationBtn.textContent;

                    shareLocationBtn.textContent =
                        "✓ Location Link Copied";

                    setTimeout(
                        () => {

                            shareLocationBtn.textContent =
                                oldText;

                        },
                        2000
                    );

                } catch (error) {

                    console.error(
                        "Clipboard error:",
                        error
                    );

                    /*
                     * Fallback
                     */

                    window.prompt(
                        "Copy this location link:",
                        link
                    );
                }
            }
        );
    }


    /* ========================================================
       ESCAPE KEY CLOSES SOS
       ======================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Escape" &&
                sosModal &&
                sosModal.classList.contains(
                    "show"
                )
            ) {

                closeSOS();
            }
        }
    );


    /* ========================================================
       INITIAL DEFAULT TIME
       ======================================================== */

    if (
        timeInput &&
        !timeInput.value
    ) {

        timeInput.value =
            "21:00";
    }


    /* ========================================================
       INITIAL CONSOLE STATUS
       ======================================================== */

    console.log(
        "======================================"
    );

    console.log(
        " RouteShield AI Frontend"
    );

    console.log(
        " Route Planner: READY"
    );

    console.log(
        " 3 Route Recommendations: READY"
    );

    console.log(
        " Current Location: READY"
    );

    console.log(
        " Emergency Services: READY"
    );

    console.log(
        " Trust Analysis Panel: READY"
    );

    console.log(
        " SOS: READY"
    );

    console.log(
        "======================================"
    );

});




/* ============================================================
   PROFILE MY ROUTES - FINAL WORKING LOGIC
   Uses the SAME route objects from the existing Route Planner.
   ============================================================ */

(function () {
    "use strict";

    const state = {
        routes: [],
        selectedIndex: null
    };

    function normalizeType(route, index) {
        const type = String(
            route?.type || route?.route_type || route?.category || ""
        ).toLowerCase();

        if (type === "safe") return "safe";
        if (type === "moderate") return "moderate";

        if (["risk", "high-risk", "high_risk", "highrisk"].includes(type)) {
            return "high-risk";
        }

        return ["safe", "moderate", "high-risk"][index] || "high-risk";
    }

    function titleFor(route, index) {
        const type = normalizeType(route, index);
        return type === "safe"
            ? "Safe Route (Recommended)"
            : type === "moderate"
                ? "Moderate Risk Route"
                : "High-Risk Route";
    }

    function descriptionFor(route, index) {
        if (route?.description) return String(route.description);

        const type = normalizeType(route, index);

        if (type === "safe") {
            return "Recommended because this route has the highest available safety score among the three options.";
        }

        if (type === "moderate") {
            return "An alternative route with a moderate safety level compared with the recommended route.";
        }

        return "The least recommended route among the current options based on the available safety analysis.";
    }

    function distanceFor(route) {
        if (route?.distance != null) return String(route.distance);
        if (route?.distance_val != null) return `${route.distance_val} km`;
        return "--";
    }

    function durationFor(route) {
        if (route?.duration != null) return String(route.duration);
        if (route?.duration_val != null) return `${route.duration_val} mins`;
        return "--";
    }

    function scoreFor(route) {
        if (route?.safety_score != null) return `${route.safety_score}/100`;
        if (route?.score != null) return `${route.score}/100`;
        return "--";
    }

    function renderSelectedDetails() {
        const box = document.getElementById("profile-selected-route-details");
        if (!box) return;

        const index = state.selectedIndex;
        const route = Number.isInteger(index) ? state.routes[index] : null;

        if (!route) {
            box.hidden = true;
            return;
        }

        const type = normalizeType(route, index);
        box.hidden = false;
        box.dataset.route = type;

        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        set("profileSelectedRouteTitle", titleFor(route, index));
        set("profileSelectedRouteBadge", "Selected");
        set("profileSelectedDistance", distanceFor(route));
        set("profileSelectedDuration", durationFor(route));
        set("profileSelectedScore", scoreFor(route));
        set("profileSelectedDescription", descriptionFor(route, index));
    }

    function renderProfileRouteCards() {
        const list = document.getElementById("profile-routes-list");
        const empty = document.getElementById("profileRoutesEmpty");
        const count = document.getElementById("profileRouteCount");

        if (!list) return;

        list.innerHTML = "";

        if (!state.routes.length) {
            if (empty) empty.hidden = false;
            if (count) count.textContent = "No routes yet";
            renderSelectedDetails();
            return;
        }

        if (empty) empty.hidden = true;
        if (count) count.textContent = `${state.routes.length} Routes`;

        state.routes.forEach((route, index) => {
            const type = normalizeType(route, index);
            const isActive = index === state.selectedIndex;

            const card = document.createElement("button");
            card.type = "button";

            // EXACTLY ONE route-active. Other two are route-inactive = dashed.
            card.className =
                `profile-route-card ${type} ${
                    isActive ? "route-active" : "route-inactive"
                }`;

            card.setAttribute("aria-pressed", String(isActive));

            // IMPORTANT: no distance/duration/score here.
            // Those details are visible ONLY for the selected route below.
            card.innerHTML = `
                <div class="profile-route-card-top">
                    <div>
                        <h4>${titleFor(route, index)}</h4>
                        <p>${
                            isActive
                                ? "Currently selected"
                                : "Click to view this route"
                        }</p>
                    </div>
                    <span class="profile-route-status">
                        ${isActive ? "Selected" : "View Details"}
                    </span>
                </div>
            `;

            card.addEventListener("click", () => {
                selectProfileRoute(index);
            });

            list.appendChild(card);
        });

        renderSelectedDetails();
    }

    function selectProfileRoute(index) {
        if (!Number.isInteger(index)) return;
        if (index < 0 || index >= state.routes.length) return;

        state.selectedIndex = index;

        // Re-render changes the clicked route to SOLID and the other two to DASHED.
        renderProfileRouteCards();

        // Reuse existing map/analysis selection when available.
        if (typeof window.routeShieldFocusRoute === "function") {
            window.routeShieldFocusRoute(index);
        }
    }

    // Called directly by the existing renderRouteCards() function.
    window.updateProfileRoutes = function (routes, selectedIndex) {
        if (!Array.isArray(routes)) return;

        state.routes = routes.slice(0, 3);

        const validIndex =
            Number.isInteger(selectedIndex) &&
            selectedIndex >= 0 &&
            selectedIndex < state.routes.length;

        // First route is selected by default.
        state.selectedIndex = validIndex
            ? selectedIndex
            : (state.routes.length ? 0 : null);

        renderProfileRouteCards();
    };
})();


/* ============================================================
   PROFILE MODAL FIX
   Restores the existing Profile button functionality.
   ============================================================ */

(function () {
    "use strict";

    function initialiseProfile() {
        const profileBtn = document.getElementById("profileBtn");
        const profileModal = document.getElementById("profileModal");
        const closeProfileBtn = document.getElementById("closeProfileBtn");
        const closeProfileBtnBottom = document.getElementById("closeProfileBtnBottom");
        const saveProfileBtn = document.getElementById("saveProfileBtn");

        const profileName = document.getElementById("profileName");
        const profileEmail = document.getElementById("profileEmail");
        const profileStatus = document.getElementById("profileStatus");
        const profileCreatedAt = document.getElementById("profileCreatedAt");
        const profileAvatar = document.getElementById("profileAvatar");
        const profileMessage = document.getElementById("profileMessage");
        const navbarUserName = document.getElementById("navbarUserName");
        // =========================================================
// TRUSTED CONTACTS ELEMENTS
// =========================================================

const contactName = document.getElementById("contactName");
const contactPhone = document.getElementById("contactPhone");
const contactRelationship = document.getElementById("contactRelationship");

const addTrustedContactBtn = document.getElementById(
    "addTrustedContactBtn"
);

const trustedContactsList = document.getElementById(
    "trustedContactsList"
);

const trustedContactCount = document.getElementById(
    "trustedContactCount"
);

        if (!profileBtn || !profileModal) {
            console.warn("Profile elements were not found.");
            return;
        }

        function setProfileMessage(message, type) {
            if (!profileMessage) return;
            profileMessage.textContent = message || "";
            profileMessage.classList.remove("success", "error");
            if (type) profileMessage.classList.add(type);
        }

        function updateAvatar(name) {
            if (!profileAvatar) return;
            profileAvatar.textContent =
                String(name || "U").trim().charAt(0).toUpperCase() || "U";
        }

        function formatCreatedAt(value) {
            if (!value) return "--";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric"
            });
        }

        async function loadProfile() {
            setProfileMessage("");
            try {
                const response = await fetch("/api/profile", {
                    method: "GET",
                    headers: { "Accept": "application/json" }
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "Could not load profile.");
                }

                const profile = data.profile || {};

                if (profileName) profileName.value = profile.name || "";
                if (profileEmail) profileEmail.value = profile.email || "";

                if (profileStatus) {
                    profileStatus.textContent =
                        profile.is_verified ? "Verified" : "Unverified";
                    profileStatus.classList.toggle(
                        "unverified", !profile.is_verified
                    );
                }

                if (profileCreatedAt) {
                    profileCreatedAt.textContent =
                        formatCreatedAt(profile.created_at);
                }

                if (navbarUserName) {
                    navbarUserName.textContent = profile.name || "";
                }

                updateAvatar(profile.name);

            } catch (error) {
                console.error("Profile load error:", error);
                setProfileMessage(
                    error.message || "Unable to load profile details.",
                    "error"
                );
            }
        }
        // =========================================================
// LOAD TRUSTED CONTACTS
// =========================================================

async function loadTrustedContacts() {

    try {

        const response = await fetch("/api/trusted-contacts", {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Could not load trusted contacts."
            );
        }

        renderTrustedContacts(data.contacts || []);

    } catch (error) {

        console.error(
            "Trusted contacts load error:",
            error
        );

        if (trustedContactsList) {
            trustedContactsList.innerHTML = `
                <p class="trusted-contacts-empty">
                    Unable to load trusted contacts.
                </p>
            `;
        }
    }
}


// =========================================================
// RENDER TRUSTED CONTACTS
// =========================================================

function renderTrustedContacts(contacts) {

    if (!trustedContactsList) return;

    if (trustedContactCount) {
        trustedContactCount.textContent =
            `${contacts.length} ${
                contacts.length === 1
                    ? "Contact"
                    : "Contacts"
            }`;
    }

    if (contacts.length === 0) {

        trustedContactsList.innerHTML = `
            <p class="trusted-contacts-empty">
                No trusted contacts added yet.
            </p>
        `;

        return;
    }

    trustedContactsList.innerHTML = contacts.map(contact => `
        <div class="trusted-contact-card">

            <div class="trusted-contact-info">

                <strong>
                    ${contact.name}
                </strong>

                <span>
                    📞 ${contact.phone}
                </span>

                <span>
                    ${contact.relationship || "Trusted Contact"}
                </span>

            </div>


            <button
                type="button"
                class="delete-contact-btn"
                data-contact-id="${contact.id}"
            >
                Delete
            </button>

        </div>
    `).join("");


    document.querySelectorAll(".delete-contact-btn")
        .forEach(button => {

            button.addEventListener(
                "click",
                async function () {

                    const contactId =
                        this.dataset.contactId;

                    await deleteTrustedContact(contactId);

                }
            );

        });

}


// =========================================================
// ADD TRUSTED CONTACT
// =========================================================

async function addTrustedContact() {

    const name =
        String(contactName?.value || "").trim();

    const phone =
        String(contactPhone?.value || "").trim();

    const relationship =
        String(
            contactRelationship?.value || ""
        ).trim();


    if (name.length < 2) {

        alert(
            "Please enter a valid contact name."
        );

        return;

    }


    if (phone.length < 10) {

        alert(
            "Please enter a valid phone number."
        );

        return;

    }


    if (!addTrustedContactBtn) return;

    addTrustedContactBtn.disabled = true;

    const originalText =
        addTrustedContactBtn.textContent;

    addTrustedContactBtn.textContent =
        "Adding...";


    try {

        const response = await fetch(
            "/api/trusted-contacts",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify({
                    name,
                    phone,
                    relationship
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                "Could not add trusted contact."
            );

        }


        // CLEAR INPUTS

        if (contactName)
            contactName.value = "";

        if (contactPhone)
            contactPhone.value = "";

        if (contactRelationship)
            contactRelationship.value = "";


        // RELOAD CONTACTS

        await loadTrustedContacts();

    } catch (error) {

        console.error(
            "Trusted contact add error:",
            error
        );

        alert(
            error.message ||
            "Unable to add trusted contact."
        );

    } finally {

        addTrustedContactBtn.disabled = false;

        addTrustedContactBtn.textContent =
            originalText;

    }

}


// =========================================================
// DELETE TRUSTED CONTACT
// =========================================================

async function deleteTrustedContact(contactId) {

    const confirmed = confirm(
        "Are you sure you want to delete this trusted contact?"
    );

    if (!confirmed) return;


    try {

        const response = await fetch(
            `/api/trusted-contacts/${contactId}`,
            {
                method: "DELETE",

                headers: {
                    "Accept": "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                "Could not delete trusted contact."
            );

        }


        await loadTrustedContacts();

    } catch (error) {

        console.error(
            "Trusted contact delete error:",
            error
        );

        alert(
            error.message ||
            "Unable to delete trusted contact."
        );

    }

}

        async function openProfile() {
            profileModal.classList.add("show");
            profileModal.setAttribute("aria-hidden", "false");
            document.body.style.overflow = "hidden";
            await loadProfile();
            await loadTrustedContacts();
        }

        function closeProfile() {
            profileModal.classList.remove("show");
            profileModal.setAttribute("aria-hidden", "true");
            document.body.style.overflow = "";
            setProfileMessage("");
        }

        profileBtn.addEventListener("click", function (event) {
            event.preventDefault();
            openProfile();
        });
        if (addTrustedContactBtn) {
    addTrustedContactBtn.addEventListener(
        "click",
        addTrustedContact
    );
}

        if (closeProfileBtn) {
            closeProfileBtn.addEventListener("click", closeProfile);
        }

        if (closeProfileBtnBottom) {
            closeProfileBtnBottom.addEventListener("click", closeProfile);
        }

        profileModal.addEventListener("click", function (event) {
            if (event.target === profileModal) closeProfile();
        });

        document.addEventListener("keydown", function (event) {
            if (
                event.key === "Escape" &&
                profileModal.classList.contains("show")
            ) {
                closeProfile();
            }
        });

        if (saveProfileBtn) {
            saveProfileBtn.addEventListener("click", async function () {
                const name = String(profileName?.value || "").trim();

                if (name.length < 2) {
                    setProfileMessage("Please enter a valid name.", "error");
                    return;
                }

                saveProfileBtn.disabled = true;
                const originalText = saveProfileBtn.textContent;
                saveProfileBtn.textContent = "Saving...";
                setProfileMessage("");

                try {
                    const response = await fetch("/api/profile", {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        },
                        body: JSON.stringify({ name })
                    });

                    const data = await response.json();

                    if (!response.ok || !data.success) {
                        throw new Error(
                            data.error || "Could not update profile."
                        );
                    }

                    if (navbarUserName) {
                        navbarUserName.textContent = data.name || name;
                    }

                    updateAvatar(data.name || name);

                    setProfileMessage(
                        data.message || "Profile updated successfully.",
                        "success"
                    );

                } catch (error) {
                    console.error("Profile update error:", error);
                    setProfileMessage(
                        error.message || "Unable to update profile.",
                        "error"
                    );

                } finally {
                    saveProfileBtn.disabled = false;
                    saveProfileBtn.textContent = originalText;
                }
            });
        }

        window.openRouteShieldProfile = openProfile;
        window.closeRouteShieldProfile = closeProfile;
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialiseProfile,
            { once: true }
        );
    } else {
        initialiseProfile();
    }

    // ============================================================
    // LIVE NAVIGATION BRIDGE
    // Exposes the existing map/route state without changing it.
    // ============================================================
    window.__routeShieldNav = {
    getMap: () => window.__routeShieldMap || null,

    getRouteLayers: () =>
        window.__routeShieldRouteLayers || [],

    getLastAnalysis: () =>
        window.__routeShieldLastAnalysis || null,

    getSelectedRouteIndex: () =>
        window.__routeShieldSelectedRouteIndex ?? 0
};

})();




/* ============================================================
   LIVE NAVIGATION
   Uses the existing RouteShield map and selected route.
   ============================================================ */

(function () {
    "use strict";

    let rsLiveWatchId = null;
    let rsLiveMarker = null;
    let rsLiveAccuracyCircle = null;
    let rsPreviousPosition = null;
    let rsCompletedLayer = null;
    let rsRemainingLayer = null;
    let rsProgressDots = null;
    let rsNavigationPoints = [];
    let rsLastRoutePointIndex = 0;
    let rsNavigationActive = false;

    const rsArrivalDistanceMeters = 35;
    const rsDotGap = 18;

    function rsCtx() {
        return window.__routeShieldNav || null;
    }

    function rsDistanceMeters(a, b) {
        const R = 6371000;
        const rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad;
        const dLng = (b.lng - a.lng) * rad;

        const x =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * rad) *
            Math.cos(b.lat * rad) *
            Math.sin(dLng / 2) ** 2;

        return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    function rsBearing(from, to) {
        if (!from || !to) return 0;

        const rad = Math.PI / 180;
        const lat1 = from.lat * rad;
        const lat2 = to.lat * rad;
        const dLng = (to.lng - from.lng) * rad;

        const y = Math.sin(dLng) * Math.cos(lat2);
        const x =
            Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function rsLiveIcon(heading) {
        const angle =
            Number.isFinite(Number(heading))
                ? Number(heading)
                : 0;

        return L.divIcon({
            className: "routeshield-live-location-marker",
            html:
                `<div class="rs-navigation-arrow" ` +
                `style="transform:rotate(${angle}deg)">` +
                `<span></span></div>`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function rsGetSelectedRoutePoints() {
        const ctx = rsCtx();

        if (!ctx) return [];

        const selectedIndex = ctx.getSelectedRouteIndex();
        const route =
            ctx.getLastAnalysis()?.routes?.[selectedIndex];

        const coordinates =
            route?.geojson?.coordinates || [];

        if (coordinates.length) {
            return coordinates
                .map(([lng, lat]) => ({
                    lat: Number(lat),
                    lng: Number(lng)
                }))
                .filter(point =>
                    Number.isFinite(point.lat) &&
                    Number.isFinite(point.lng)
                );
        }

        const layer =
            ctx.getRouteLayers()?.[selectedIndex];

        if (!layer || !layer.getLatLngs) return [];

        return layer.getLatLngs().map(point => ({
            lat: point.lat,
            lng: point.lng
        }));
    }

    function rsNearestRoutePoint(location) {
        let bestIndex = rsLastRoutePointIndex;
        let bestDistance = Infinity;

        rsNavigationPoints.forEach((point, index) => {
            const distance =
                rsDistanceMeters(location, point);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });

        return bestIndex;
    }

    function rsClearProgressLayers() {
        const map = rsCtx()?.getMap();

        [rsCompletedLayer, rsRemainingLayer, rsProgressDots]
            .filter(Boolean)
            .forEach(layer => {
                if (map && map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });

        rsCompletedLayer = null;
        rsRemainingLayer = null;
        rsProgressDots = null;
    }

    function rsRenderRouteProgress(currentIndex) {
        const map = rsCtx()?.getMap();

        if (!map || rsNavigationPoints.length < 2) return;

        rsClearProgressLayers();

        const completed =
            rsNavigationPoints
                .slice(0, currentIndex + 1)
                .map(point => [point.lat, point.lng]);

        const remaining =
            rsNavigationPoints
                .slice(currentIndex)
                .map(point => [point.lat, point.lng]);

        if (completed.length > 1) {
            rsCompletedLayer = L.polyline(completed, {
                color: "#2563eb",
                weight: 8,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round"
            }).addTo(map);
        }

        if (remaining.length > 1) {
            rsRemainingLayer = L.polyline(remaining, {
                color: "#6b7280",
                weight: 7,
                opacity: 0.65,
                dashArray: "12 12",
                lineCap: "round",
                lineJoin: "round"
            }).addTo(map);
        }

        rsProgressDots = L.layerGroup().addTo(map);

        for (
            let i = currentIndex + 1;
            i < rsNavigationPoints.length;
            i += rsDotGap
        ) {
            const point = rsNavigationPoints[i];

            L.circleMarker([point.lat, point.lng], {
                radius: 4,
                color: "#ffffff",
                weight: 2,
                fillColor: "#2563eb",
                fillOpacity: 1,
                interactive: false
            }).addTo(rsProgressDots);
        }

        const destination =
            rsNavigationPoints[
                rsNavigationPoints.length - 1
            ];

        L.circleMarker(
            [destination.lat, destination.lng],
            {
                radius: 7,
                color: "#ffffff",
                weight: 3,
                fillColor: "#dc2626",
                fillOpacity: 1,
                interactive: false
            }
        ).addTo(rsProgressDots);
    }

    function rsUpdateStatus(currentIndex, location) {
        const status =
            document.getElementById("planner-status");

        const destination =
            rsNavigationPoints[
                rsNavigationPoints.length - 1
            ];

        const remainingMeters =
            rsDistanceMeters(location, destination);

        const progress = Math.round(
            currentIndex /
            Math.max(
                rsNavigationPoints.length - 1,
                1
            ) * 100
        );

        if (remainingMeters <= rsArrivalDistanceMeters) {
            if (status) {
                status.textContent =
                    "You have reached your destination.";
            }

            return true;
        }

        if (status) {
            status.textContent =
                `Live navigation: ${progress}% complete • ` +
                `${remainingMeters >= 1000
                    ? (remainingMeters / 1000).toFixed(2) + " km"
                    : Math.round(remainingMeters) + " m"} remaining`;
        }

        return false;
    }

    function rsUpdateLivePosition(position) {
        const map = rsCtx()?.getMap();

        if (
            !position ||
            !map ||
            !rsNavigationActive
        ) {
            return;
        }

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy =
            Number(position.coords.accuracy || 0);

        const next = { lat, lng };

        const browserHeading =
            Number(position.coords.heading);

        const heading =
            Number.isFinite(browserHeading) &&
            browserHeading >= 0
                ? browserHeading
                : rsBearing(rsPreviousPosition, next);

        if (!rsLiveMarker) {
            rsLiveMarker = L.marker(
                [lat, lng],
                {
                    icon: rsLiveIcon(heading),
                    zIndexOffset: 3000
                }
            )
                .addTo(map)
                .bindPopup(
                    "<strong>You are here</strong>"
                );
        } else {
            rsLiveMarker.setLatLng([lat, lng]);
            rsLiveMarker.setIcon(
                rsLiveIcon(heading)
            );
        }

        if (accuracy > 0) {
            if (!rsLiveAccuracyCircle) {
                rsLiveAccuracyCircle = L.circle(
                    [lat, lng],
                    {
                        radius: accuracy,
                        color: "#2563eb",
                        weight: 1,
                        fillColor: "#2563eb",
                        fillOpacity: 0.08,
                        interactive: false
                    }
                ).addTo(map);
            } else {
                rsLiveAccuracyCircle.setLatLng(
                    [lat, lng]
                );

                rsLiveAccuracyCircle.setRadius(
                    accuracy
                );
            }
        }

        rsLastRoutePointIndex = Math.max(
            rsLastRoutePointIndex,
            rsNearestRoutePoint(next)
        );

        rsRenderRouteProgress(
            rsLastRoutePointIndex
        );

        map.panTo([lat, lng], {
            animate: true,
            duration: 0.7
        });

        const arrived =
            rsUpdateStatus(
                rsLastRoutePointIndex,
                next
            );

        rsPreviousPosition = next;

        if (arrived) {
            rsStopLiveNavigation(true);
        }
    }

    function rsStartLiveNavigation() {
        const status =
            document.getElementById("planner-status");

        if (status) {
            status.textContent =
                "Starting live navigation...";
        }

        if (!navigator.geolocation) {
            if (status) {
                status.textContent =
                    "Geolocation is not supported by this browser.";
            }

            return;
        }

        const ctx = rsCtx();

        if (
            !ctx ||
            !ctx.getMap() ||
            !ctx.getLastAnalysis()?.routes?.length
        ) {
            if (status) {
                status.textContent =
                    "Please analyse and select a route first.";
            }

            return;
        }

        if (rsNavigationActive) {
            rsStopLiveNavigation(false);
            return;
        }

        rsNavigationPoints =
            rsGetSelectedRoutePoints();

        if (rsNavigationPoints.length < 2) {
            if (status) {
                status.textContent =
                    "Selected route has no navigation points.";
            }

            return;
        }

        rsLastRoutePointIndex = 0;
        rsNavigationActive = true;

        const selectedIndex =
            ctx.getSelectedRouteIndex();

        ctx.getRouteLayers().forEach(
            (layer, index) => {
                if (layer?.setStyle) {
                    layer.setStyle({
                        opacity:
                            index === selectedIndex
                                ? 0.22
                                : 0.08
                    });
                }
            }
        );

        const button =
            document.getElementById(
                "start-navigation-btn"
            );

        if (button) {
            button.textContent =
                "■ Stop Live Navigation";
        }

        if (status) {
            status.textContent =
                "Live navigation started. Waiting for GPS...";
        }

        rsLiveWatchId =
            navigator.geolocation.watchPosition(
                rsUpdateLivePosition,
                error => {
                    console.error(
                        "Live navigation error:",
                        error
                    );

                    if (status) {
                        status.textContent =
                            "Location error: " +
                            (
                                error.message ||
                                "Unable to get current location."
                            );
                    }
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 15000
                }
            );
    }

    function rsStopLiveNavigation(arrived) {
        if (rsLiveWatchId !== null) {
            navigator.geolocation.clearWatch(
                rsLiveWatchId
            );

            rsLiveWatchId = null;
        }

        rsNavigationActive = false;

        const button =
            document.getElementById(
                "start-navigation-btn"
            );

        if (button) {
            button.textContent =
                "▶ Start Live Navigation";
        }

        if (!arrived) {
            const status =
                document.getElementById(
                    "planner-status"
                );

            if (status) {
                status.textContent =
                    "Live navigation stopped.";
            }
        }

        const ctx = rsCtx();
        const selectedIndex =
            ctx?.getSelectedRouteIndex();

        const layers =
            ctx?.getRouteLayers() || [];

        layers.forEach((layer, index) => {
            if (layer?.setStyle) {
                layer.setStyle({
                    weight:
                        index === selectedIndex
                            ? 8
                            : 4,
                    opacity:
                        index === selectedIndex
                            ? 1
                            : 0.35
                });
            }
        });
    }

    function rsAttachNavigationButton() {
        const button =
            document.getElementById(
                "start-navigation-btn"
            );

        if (!button) {
            console.error(
                "Start Live Navigation button not found."
            );
            return;
        }

        button.addEventListener(
            "click",
            rsStartLiveNavigation
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            rsAttachNavigationButton,
            { once: true }
        );
    } else {
        rsAttachNavigationButton();
    }

    window.startRouteShieldLiveNavigation =
        rsStartLiveNavigation;

    window.stopRouteShieldLiveNavigation =
        rsStopLiveNavigation;
})();
