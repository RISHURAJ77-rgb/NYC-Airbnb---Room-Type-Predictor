(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  // Order returned by model.predict_proba() — matches model.classes_
  const CLASS_ORDER = ["Entire home/apt", "Private room", "Shared room"];
  const CLASS_COLOR = {
    "Entire home/apt": "var(--home)",
    "Private room": "var(--private)",
    "Shared room": "var(--shared)",
  };

  const BOROUGH_MIDPOINTS = {
    "Manhattan": [40.7831, -73.9712],
    "Brooklyn": [40.6782, -73.9442],
    "Queens": [40.7282, -73.7949],
    "Bronx": [40.8448, -73.8648],
    "Staten Island": [40.5795, -74.1502],
  };

  const NEIGHBOURHOODS = {
    "Manhattan": ["Harlem", "Upper West Side", "Upper East Side", "Midtown", "Chelsea", "East Village", "West Village", "Financial District", "Washington Heights", "Hell's Kitchen"],
    "Brooklyn": ["Williamsburg", "Bushwick", "Park Slope", "Bedford-Stuyvesant", "Greenpoint", "Crown Heights", "DUMBO", "Sunset Park", "Flatbush", "Fort Greene"],
    "Queens": ["Astoria", "Long Island City", "Flushing", "Jamaica", "Ridgewood", "Sunnyside", "Forest Hills", "Rockaway Beach"],
    "Bronx": ["Riverdale", "Mott Haven", "Fordham", "Concourse", "City Island", "Kingsbridge"],
    "Staten Island": ["St. George", "Tompkinsville", "Stapleton", "Great Kills", "Todt Hill"],
  };

  const FIELD_RULES = {
    latitude: { min: -90, max: 90 },
    longitude: { min: -180, max: 180 },
    price: { gt: 0 },
    minimum_nights: { min: 1, max: 365 },
    number_of_reviews: { min: 0 },
    reviews_per_month: { min: 0 },
    calculated_host_listings_count: { min: 0 },
    availability_365: { min: 0, max: 365 },
  };

  /* ------------------------------------------------------------------ *
   * Elements
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const API_URL = "https://nyc-airbnb-room-type-predictor-4-4r64.onrender.com";

  const apiBaseInput = $("apiBase");
  const apiStatus = $("apiStatus");
  const form = $("predictForm");
  const boroughSelect = $("neighbourhood_group");
  const neighbourhoodInput = $("neighbourhood");
  const neighbourhoodList = $("neighbourhoodList");
  const availInput = $("availability_365");
  const availOut = $("availOut");
  const useNycCenterBtn = $("useNycCenter");
  const predictBtn = $("predictBtn");
  const formAlert = $("formAlert");
  const boardEmpty = $("boardEmpty");
  const boardResult = $("boardResult");
  const flapRow = $("flapRow");
  const probList = $("probList");
  const confidenceNote = $("confidenceNote");
  const boardClock = $("boardClock");
  const fareId = $("fareId");
  const toast = $("toast");

  /* ------------------------------------------------------------------ *
   * Little chrome: clock, fare id, live range readout
   * ------------------------------------------------------------------ */

  function tickClock() {
    const now = new Date();
    boardClock.textContent = now.toLocaleTimeString([], { hour12: false });
  }
  tickClock();
  setInterval(tickClock, 1000);

  fareId.textContent = "NO. " + String(Math.floor(Math.random() * 9000) + 1000);

  availInput.addEventListener("input", () => {
    availOut.textContent = availInput.value;
  });

  boroughSelect.addEventListener("change", () => {
    const options = NEIGHBOURHOODS[boroughSelect.value] || [];
    neighbourhoodList.innerHTML = options.map((n) => `<option value="${n}"></option>`).join("");
  });

  useNycCenterBtn.addEventListener("click", () => {
    const borough = boroughSelect.value;
    if (!borough) {
      showFormAlert("Pick a borough first, then I can drop in its midpoint.");
      return;
    }
    const [lat, lon] = BOROUGH_MIDPOINTS[borough];
    $("latitude").value = lat;
    $("longitude").value = lon;
  });

  /* ------------------------------------------------------------------ *
   * API status check
   * ------------------------------------------------------------------ */

  function setApiStatus(state, text) {
    apiStatus.dataset.state = state;
    apiStatus.querySelector(".status-text").textContent = text;
  }

  async function checkApi() {
    const base = API_URL;
    if (!base) {
      setApiStatus("offline", "no address set");
      return;
    }
    setApiStatus("checking", "checking service\u2026");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(base + "/", { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setApiStatus("online", "service running");
      } else {
        setApiStatus("offline", "service responded, status " + res.status);
      }
    } catch (err) {
      setApiStatus("offline", "can't reach that address");
    }
  }

  let apiCheckDebounce;
  apiBaseInput.addEventListener("input", () => {
    clearTimeout(apiCheckDebounce);
    apiCheckDebounce = setTimeout(checkApi, 600);
  });
  checkApi();

  /* ------------------------------------------------------------------ *
   * Validation
   * ------------------------------------------------------------------ */

  function showFormAlert(message) {
    formAlert.textContent = message;
    formAlert.hidden = false;
  }
  function clearFormAlert() {
    formAlert.hidden = true;
    formAlert.textContent = "";
  }

  function validate(data) {
    if (!data.neighbourhood_group) return "Pick a borough.";
    if (!data.neighbourhood.trim()) return "Add a neighbourhood name.";

    for (const [key, rule] of Object.entries(FIELD_RULES)) {
      const value = data[key];
      if (Number.isNaN(value)) return `"${labelFor(key)}" needs a number.`;
      if (rule.min !== undefined && value < rule.min) return `"${labelFor(key)}" can't be below ${rule.min}.`;
      if (rule.max !== undefined && value > rule.max) return `"${labelFor(key)}" can't be above ${rule.max}.`;
      if (rule.gt !== undefined && value <= rule.gt) return `"${labelFor(key)}" must be greater than ${rule.gt}.`;
    }
    return null;
  }

  function labelFor(key) {
    const el = document.querySelector(`label[for="${key}"]`);
    return el ? el.textContent.trim().split("\n")[0].trim() : key;
  }

  /* ------------------------------------------------------------------ *
   * Result rendering
   * ------------------------------------------------------------------ */

  function renderFlapRow(text) {
    flapRow.innerHTML = "";
    const chars = text.split("");
    chars.forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = "flap";
      span.textContent = ch === " " ? "\u00A0" : ch;
      span.style.animationDelay = `${i * 0.025}s`;
      flapRow.appendChild(span);
    });
  }

  function renderProbabilities(probabilities) {
    probList.innerHTML = "";
    const paired = CLASS_ORDER.map((label, i) => ({ label, p: probabilities[i] ?? 0 }))
      .sort((a, b) => b.p - a.p);

    paired.forEach(({ label, p }) => {
      const row = document.createElement("div");
      row.className = "prob-row";
      row.innerHTML = `
        <span class="prob-label">${label}</span>
        <span class="prob-track"><span class="prob-fill" style="background:${CLASS_COLOR[label]}"></span></span>
        <span class="prob-pct">${(p * 100).toFixed(1)}%</span>
      `;
      probList.appendChild(row);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          row.querySelector(".prob-fill").style.width = `${Math.max(p * 100, 2)}%`;
        });
      });
    });

    return paired[0];
  }

  function showResult(predictedLabel, probabilities) {
    boardEmpty.hidden = true;
    boardResult.hidden = false;

    renderFlapRow(predictedLabel.toUpperCase());
    const top = renderProbabilities(probabilities);

    const flapColor = CLASS_COLOR[predictedLabel] || "var(--home)";
    flapRow.querySelectorAll(".flap").forEach((f) => (f.style.background = flapColor));

    confidenceNote.textContent =
      `The model leans toward "${top.label}" with ${(top.p * 100).toFixed(1)}% confidence, ` +
      `based on this listing's stats compared with the training data.`;
  }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.dataset.show = "false";
    }, 5200);
  }

  /* ------------------------------------------------------------------ *
   * Submit
   * ------------------------------------------------------------------ */

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormAlert();

    const raw = Object.fromEntries(new FormData(form).entries());
    const payload = {
      neighbourhood_group: raw.neighbourhood_group,
      neighbourhood: raw.neighbourhood,
      latitude: parseFloat(raw.latitude),
      longitude: parseFloat(raw.longitude),
      price: parseFloat(raw.price),
      minimum_nights: parseInt(raw.minimum_nights, 10),
      number_of_reviews: parseInt(raw.number_of_reviews, 10),
      reviews_per_month: parseFloat(raw.reviews_per_month),
      calculated_host_listings_count: parseInt(raw.calculated_host_listings_count, 10),
      availability_365: parseInt(raw.availability_365, 10),
    };

    const problem = validate(payload);
    if (problem) {
      showFormAlert(problem);
      return;
    }

    const base = API_URL;
    if (!base) {
      showFormAlert("Set the API address above before predicting.");
      return;
    }

    predictBtn.dataset.loading = "true";
    predictBtn.disabled = true;

    try {
      const res = await fetch(base + "/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = `Request failed with status ${res.status}.`;
        try {
          const errBody = await res.json();
          if (errBody?.detail) {
            detail = Array.isArray(errBody.detail)
              ? errBody.detail.map((d) => d.msg).join(" ")
              : String(errBody.detail);
          }
        } catch (_) { /* keep default detail */ }
        throw new Error(detail);
      }

      const data = await res.json();
      const predicted = data.Predicted_room_type;
      const probabilities = data.Probability;

      if (!predicted || !Array.isArray(probabilities)) {
        throw new Error("The API responded, but not in the shape this page expects.");
      }

      showResult(predicted, probabilities);
      setApiStatus("online", "service running");
    } catch (err) {
      const message = err.name === "TypeError"
        ? "Couldn't reach the API. Check the address above and that CORS / the server is running."
        : err.message;
      showToast(message);
      setApiStatus("offline", "last request failed");
    } finally {
      predictBtn.dataset.loading = "false";
      predictBtn.disabled = false;
    }
  });
})();
