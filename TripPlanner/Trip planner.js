let holidayName = "";
let segments = [];
let nextId = 1;
let map, routeLayer, markersLayer;
let routeCache = new Map();
let geocodeCache = new Map();
let railwayCache = new Map();
let maritimeCache = new Map();
let isDrawingRoutes = false;
let drawRequested = false;
const METRO_ZOOM_LEVEL = 15;
let currentNotesLegId = null;
let compactViewActive = false;
let currentFileHandle = null;
let selectedLegId = null;

let autocompleteCache = new Map();
let activeAutocompleteRequests = new Map();
let globalAutocompleteId = 0;

function closeAutocompleteDropdownForField(fieldDiv) {
  const existing = fieldDiv.querySelector(".autocomplete-dropdown");
  if (existing) existing.remove();
}

function attachAutocompleteToField(
  fieldDiv,
  inputElement,
  segmentId,
  fieldType,
) {
  closeAutocompleteDropdownForField(fieldDiv);
  let currentSuggestions = [];
  let selectedIndex = -1;
  let dropdownVisible = false;
  const dropdown = document.createElement("div");
  dropdown.className = "autocomplete-dropdown";
  dropdown.style.display = "none";
  fieldDiv.appendChild(dropdown);

  function renderDropdown(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      dropdown.style.display = "none";
      dropdownVisible = false;
      dropdown.innerHTML = "";
      return;
    }
    dropdown.style.display = "block";
    dropdownVisible = true;
    dropdown.innerHTML = "";
    suggestions.forEach((sug, idx) => {
      const item = document.createElement("div");
      item.className =
        "autocomplete-item" + (idx === selectedIndex ? " selected" : "");
      item.textContent = sug.display_name || sug.name || sug.place_name || sug;
      item.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const selectedName =
          sug.display_name || sug.name || sug.place_name || sug;
        inputElement.value = selectedName;
        dropdown.style.display = "none";
        dropdownVisible = false;
        closeAutocompleteDropdownForField(fieldDiv);
        window.updateSegmentField(segmentId, fieldType, selectedName);
      });
      dropdown.appendChild(item);
    });
    if (selectedIndex >= 0 && selectedIndex < dropdown.children.length) {
      dropdown.children[selectedIndex].classList.add("selected");
      dropdown.children[selectedIndex].scrollIntoView({
        block: "nearest",
      });
    }
  }

  async function fetchAutocomplete(query) {
    if (!query || query.length < 3) return [];
    const cacheKey = query.toLowerCase().trim();
    if (autocompleteCache.has(cacheKey)) return autocompleteCache.get(cacheKey);
    const thisRequestId = ++globalAutocompleteId;
    activeAutocompleteRequests.set(fieldType + "_" + segmentId, thisRequestId);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=0`;
      const res = await fetch(url, {
        headers: { "User-Agent": "WanderPlan/2.0" },
      });
      const data = await res.json();
      const storedReqId = activeAutocompleteRequests.get(
        fieldType + "_" + segmentId,
      );
      if (storedReqId !== thisRequestId) return [];
      if (data && Array.isArray(data)) {
        autocompleteCache.set(cacheKey, data);
        return data;
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  let debounceTimer = null;
  inputElement.addEventListener("input", (e) => {
    const query = e.target.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.length < 3) {
      dropdown.style.display = "none";
      dropdownVisible = false;
      return;
    }
    debounceTimer = setTimeout(async () => {
      const suggestions = await fetchAutocomplete(query);
      const storedReqId = activeAutocompleteRequests.get(
        fieldType + "_" + segmentId,
      );
      if (storedReqId !== globalAutocompleteId && storedReqId !== undefined)
        return;
      currentSuggestions = suggestions;
      selectedIndex = -1;
      renderDropdown(currentSuggestions);
    }, 350);
  });

  inputElement.addEventListener("keydown", (e) => {
    if (dropdownVisible && currentSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % currentSuggestions.length;
        renderDropdown(currentSuggestions);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex =
          (selectedIndex - 1 + currentSuggestions.length) %
          currentSuggestions.length;
        renderDropdown(currentSuggestions);
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && currentSuggestions[selectedIndex]) {
          const selectedName =
            currentSuggestions[selectedIndex].display_name ||
            currentSuggestions[selectedIndex].name ||
            currentSuggestions[selectedIndex].place_name ||
            currentSuggestions[selectedIndex];
          inputElement.value = selectedName;
          dropdown.style.display = "none";
          dropdownVisible = false;
          closeAutocompleteDropdownForField(fieldDiv);
          window.updateSegmentField(segmentId, fieldType, selectedName);
        } else {
          dropdown.style.display = "none";
          dropdownVisible = false;
          closeAutocompleteDropdownForField(fieldDiv);
          inputElement.blur();
        }
        return;
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
        dropdownVisible = false;
        return;
      }
    }
    if (e.key === "Tab") {
      if (dropdownVisible) {
        dropdown.style.display = "none";
        dropdownVisible = false;
        closeAutocompleteDropdownForField(fieldDiv);
      }
      return;
    }
  });

  inputElement.addEventListener("blur", () => {
    setTimeout(() => {
      if (!fieldDiv.contains(document.activeElement)) {
        dropdown.style.display = "none";
        dropdownVisible = false;
      }
    }, 150);
  });

  document.addEventListener("click", function onClickOutside(e) {
    if (!fieldDiv.contains(e.target)) {
      dropdown.style.display = "none";
      dropdownVisible = false;
    }
  });
}

function formatDateToDMY(dateString) {
  if (!dateString) return "";
  const date = parseISODate(dateString);
  if (!date) return dateString;
  return `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getFullYear().toString().slice(-2)}`;
}
function parseISODate(dateString) {
  if (!dateString) return null;
  const parts = dateString.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function formatDateToYYYYMMDD(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : parseISODate(date);
  if (!d || isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}
function parseDMYToDate(dmyString) {
  if (!dmyString) return "";
  const parts = dmyString.split("/");
  if (parts.length === 3) {
    let year = parts[2].trim();
    if (year.length === 2) year = `20${parseInt(year, 10)}`;
    return `${year}-${parts[1].trim().padStart(2, "0")}-${parts[0].trim().padStart(2, "0")}`;
  }
  return dmyString;
}
function calculateNights(arrival, departure) {
  const a = parseISODate(arrival);
  const d = parseISODate(departure);
  if (!a || !d || d <= a) return 0;
  return Math.round((d - a) / (1000 * 60 * 60 * 24));
}
function addDays(dateString, days) {
  const d = parseISODate(dateString);
  if (!d) return "";
  d.setDate(d.getDate() + days);
  return formatDateToYYYYMMDD(d);
}
function recalculateDatesFrom(index) {
  for (let i = index; i < segments.length; i++) {
    const seg = segments[i];

    const existingNights =
      calculateNights(seg.arrivalDate, seg.departureDate) || 3;

    if (i > 0) {
      const previous = segments[i - 1];

      if (!seg.arrivalLocked) {
        seg.arrivalDate = previous.departureDate;
        seg.departureDate = addDays(seg.arrivalDate, existingNights);
      }
    }

    if (!seg.departureLocked) {
      seg.departureDate = addDays(seg.arrivalDate, existingNights);
    }

    if (seg.departureDate < seg.arrivalDate) {
      seg.departureDate = seg.arrivalDate;
    }

    seg.nights = calculateNights(seg.arrivalDate, seg.departureDate);
  }
}
async function geocodePlace(placeName) {
    if (!placeName?.trim() || placeName === "TBA") return null;
    const cacheKey = placeName.toLowerCase().trim();
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(placeName)}&limit=1`;
        const res = await fetch(url, {
            headers: { "User-Agent": "WanderPlan/2.0" },
        });
        const data = await res.json();
        if (data?.length) {
            const result = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                country: data[0].display_name?.split(", ").pop() || "",
                countryCode: data[0].address?.country_code?.toUpperCase() || "",
            };
            geocodeCache.set(cacheKey, result);
            return result;
        }
    } catch (e) {
        console.warn(e);
    }
    return null;
}
function generateGreatCircleArc(
  startLat,
  startLng,
  endLat,
  endLng,
  flipCurve = false,
) {
  const points = [];
  const steps = 30;
  const lat1 = (startLat * Math.PI) / 180,
    lon1 = (startLng * Math.PI) / 180;
  const lat2 = (endLat * Math.PI) / 180,
    lon2 = (endLng * Math.PI) / 180;
  const d = Math.acos(
    Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1),
  );
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y =
      A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    points.push([
      (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
      (Math.atan2(y, x) * 180) / Math.PI,
    ]);
  }
  return flipCurve ? flipArcCurve(points) : points;
}
function flipArcCurve(points) {
  if (points.length < 3) return points;
  const [startLat, startLng] = points[0];
  const [endLat, endLng] = points[points.length - 1];
  const deltaLat = endLat - startLat;
  const deltaLng = endLng - startLng;
  const span = deltaLat * deltaLat + deltaLng * deltaLng || 1;
  return points.map(([lat, lng], i) => {
    if (i === 0 || i === points.length - 1) return [lat, lng];
    const t =
      ((lat - startLat) * deltaLat + (lng - startLng) * deltaLng) / span;
    const projLat = startLat + t * deltaLat;
    const projLng = startLng + t * deltaLng;
    return [2 * projLat - lat, 2 * projLng - lng];
  });
}
function shouldFlipArcForTravelDirection(
  startLat,
  startLng,
  endLat,
  endLng,
  points,
) {
  const deltaLat = endLat - startLat;
  const deltaLng = endLng - startLng;
  const midIdx = Math.floor(points.length / 2);
  const [midLat, midLng] = points[midIdx];
  const bulgeLat = midLat - (startLat + endLat) / 2;
  const bulgeLng = midLng - (startLng + endLng) / 2;
  if (Math.abs(deltaLng) >= Math.abs(deltaLat)) {
    return deltaLng < 0 ? bulgeLat > 0 : bulgeLat < 0;
  }
  return deltaLat > 0 ? bulgeLng > 0 : bulgeLng < 0;
}
function buildGreatCircleRoute(startLat, startLng, endLat, endLng) {
  const points = generateGreatCircleArc(
    startLat,
    startLng,
    endLat,
    endLng,
    false,
  );
  const flip = shouldFlipArcForTravelDirection(
    startLat,
    startLng,
    endLat,
    endLng,
    points,
  );
  return flip ? flipArcCurve(points) : points;
}
function shouldFlipArcForMode(travelMode) {
  return (
    travelMode === "air" || travelMode === "ferry" || travelMode === "ship"
  );
}
async function fetchRoadRoute(startLat, startLng, endLat, endLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
    }
  } catch (e) {}
  return null;
}
async function fetchRailwayRoute(startLat, startLng, endLat, endLng) {
  const cacheKey = `${Math.floor(startLat * 10)}_${Math.floor(startLng * 10)}_${Math.floor(endLat * 10)}_${Math.floor(endLng * 10)}`;
  if (railwayCache.has(cacheKey)) return railwayCache.get(cacheKey);
  const buffer = 0.15;
  const bbox = `${Math.min(startLat, endLat) - buffer},${Math.min(startLng, endLng) - buffer},${Math.max(startLat, endLat) + buffer},${Math.max(startLng, endLng) + buffer}`;
  const query = `[out:json][timeout:10];(way["railway"="rail"](${bbox});way["railway"="light_rail"](${bbox});way["railway"="subway"](${bbox}););out geom;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await res.json();
    if (data.elements && data.elements.length > 0) {
      let bestRoute = null,
        bestScore = 0;
      for (let element of data.elements) {
        if (element.geometry && element.geometry.length > 2) {
          const coords = element.geometry.map((g) => [g.lat, g.lon]);
          let minDistToStart = Infinity,
            minDistToEnd = Infinity;
          for (let point of coords) {
            const distToStart = Math.hypot(
              point[0] - startLat,
              point[1] - startLng,
            );
            const distToEnd = Math.hypot(point[0] - endLat, point[1] - endLng);
            if (distToStart < minDistToStart) minDistToStart = distToStart;
            if (distToEnd < minDistToEnd) minDistToEnd = distToEnd;
          }
          if (minDistToStart < 0.2 && minDistToEnd < 0.2) {
            const score = coords.length - minDistToStart * 5 - minDistToEnd * 5;
            if (score > bestScore) {
              bestScore = score;
              bestRoute = coords;
            }
          }
        }
      }
      if (bestRoute) {
        railwayCache.set(cacheKey, bestRoute);
        return bestRoute;
      }
    }
  } catch (e) {}
  railwayCache.set(cacheKey, null);
  return null;
}
async function fetchMaritimeRoute(
  startLat,
  startLng,
  endLat,
  endLng,
  routeType = "ferry",
) {
  const cacheKey = `${routeType}_${Math.floor(startLat * 10)}_${Math.floor(startLng * 10)}_${Math.floor(endLat * 10)}_${Math.floor(endLng * 10)}`;
  if (maritimeCache.has(cacheKey)) return maritimeCache.get(cacheKey);
  const buffer = 0.5;
  const bbox = `${Math.min(startLat, endLat) - buffer},${Math.min(startLng, endLng) - buffer},${Math.max(startLat, endLat) + buffer},${Math.max(startLng, endLng) + buffer}`;
  let query =
    routeType === "ferry"
      ? `[out:json][timeout:15];(way["route"="ferry"](${bbox});relation["route"="ferry"](${bbox});way["ferry"="yes"](${bbox}););out geom;`
      : `[out:json][timeout:15];(way["route"="ferry"](${bbox});relation["route"="ferry"](${bbox});way["ship"="yes"](${bbox});way["route"="shipping"](${bbox}););out geom;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await res.json();
    if (data.elements && data.elements.length > 0) {
      let bestRoute = null,
        bestScore = 0;
      for (let element of data.elements) {
        if (element.geometry && element.geometry.length > 2) {
          const coords = element.geometry.map((g) => [g.lat, g.lon]);
          let minDistToStart = Infinity,
            minDistToEnd = Infinity;
          for (let point of coords) {
            const distToStart = Math.hypot(
              point[0] - startLat,
              point[1] - startLng,
            );
            const distToEnd = Math.hypot(point[0] - endLat, point[1] - endLng);
            if (distToStart < minDistToStart) minDistToStart = distToStart;
            if (distToEnd < minDistToEnd) minDistToEnd = distToEnd;
          }
          if (minDistToStart < 0.5 && minDistToEnd < 0.5) {
            const score = coords.length - minDistToStart * 2 - minDistToEnd * 2;
            if (score > bestScore) {
              bestScore = score;
              bestRoute = coords;
            }
          }
        }
      }
      if (bestRoute) {
        maritimeCache.set(cacheKey, bestRoute);
        return bestRoute;
      }
    }
  } catch (e) {}
  maritimeCache.set(cacheKey, null);
  return null;
}
async function getTrainRoute(startLat, startLng, endLat, endLng) {
  const rail = await fetchRailwayRoute(startLat, startLng, endLat, endLng);
  if (rail) return rail;
  const road = await fetchRoadRoute(startLat, startLng, endLat, endLng);
  return road || generateGreatCircleArc(startLat, startLng, endLat, endLng);
}
async function getFerryRoute(startLat, startLng, endLat, endLng) {
  const ferry = await fetchMaritimeRoute(
    startLat,
    startLng,
    endLat,
    endLng,
    "ferry",
  );
  return ferry || buildGreatCircleRoute(startLat, startLng, endLat, endLng);
}
async function getShipRoute(startLat, startLng, endLat, endLng) {
  const ship = await fetchMaritimeRoute(
    startLat,
    startLng,
    endLat,
    endLng,
    "ship",
  );
  return ship || buildGreatCircleRoute(startLat, startLng, endLat, endLng);
}
async function getRouteForSegment(segment, segmentIndex = -1) {
  if (!segment.latStart || !segment.latDest || segment.travelMode === "tba")
    return null;
  const arcMode = shouldFlipArcForMode(segment.travelMode);
  const cacheKey = `route_${segment.id}_${segment.travelMode}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);
  let route = null;
  const start = { lat: segment.latStart, lng: segment.lngStart };
  const end = { lat: segment.latDest, lng: segment.lngDest };
  if (segment.travelMode === "road")
    route = await fetchRoadRoute(start.lat, start.lng, end.lat, end.lng);
  else if (segment.travelMode === "train")
    route = await getTrainRoute(start.lat, start.lng, end.lat, end.lng);
  else if (segment.travelMode === "ferry")
    route = await getFerryRoute(start.lat, start.lng, end.lat, end.lng);
  else if (segment.travelMode === "ship")
    route = await getShipRoute(start.lat, start.lng, end.lat, end.lng);
  else route = buildGreatCircleRoute(start.lat, start.lng, end.lat, end.lng);
  if (!route)
    route = arcMode
      ? buildGreatCircleRoute(start.lat, start.lng, end.lat, end.lng)
      : generateGreatCircleArc(start.lat, start.lng, end.lat, end.lng);
  routeCache.set(cacheKey, route);
  return route;
}
function getCountryPinColor(countryCode) {
    if (!countryCode) return "#3A86FF";

    if (!window.countryPinColors) {
        window.countryPinColors = {};
    }

    if (!window.countryPinColors[countryCode]) {
        let colour;
        let attempts = 0;

do {
        colour = `#${Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, "0")}`;
        attempts++;
    } while (
        Object.values(window.countryPinColors).includes(colour)
    );

        window.countryPinColors[countryCode] = colour;
    }

    return window.countryPinColors[countryCode];
}
function getRouteStyle(segment) {
  if (segment.travelMode === "ferry") {
    return { color: "#0EA5E9", dashArray: "8,8", weight: 4 };
  }
  if (segment.travelMode === "ship") {
    return { color: "#0EA5E9", dashArray: "8,8", weight: 5 };
  }
  if (segment.travelMode === "air") {
    return { color: "#E9C46A", dashArray: "10,8", weight: 3 };
  }
  if (segment.travelMode === "road") {
    return { color: "#F4A261", weight: 4 };
  }
  if (segment.travelMode === "train") {
    return { color: "#E76F51", dashArray: "8,5", weight: 5 };
  }
  return { color: "#3A86FF", weight: 4 };
}
function hasSavedCoordinates(segment) {
  return [
    segment.latStart,
    segment.lngStart,
    segment.latDest,
    segment.lngDest,
  ].every(Number.isFinite);
}
function restoreRouteCache(savedRoutes) {
  routeCache.clear();
  if (!savedRoutes || typeof savedRoutes !== "object") return;
  Object.entries(savedRoutes).forEach(([key, route]) => {
    if (Array.isArray(route) && route.length > 1) {
      routeCache.set(key, route);
    }
  });
}
async function updateSegmentCoordinates(segment) {
    let changed = false;

    if (segment.startName?.trim()) {
        const coords = await geocodePlace(segment.startName);

        if (
            coords &&
            (segment.latStart !== coords.lat ||
                segment.lngStart !== coords.lng ||
                segment.countryStart !== coords.country ||
                segment.countryCodeStart !== coords.countryCode)
        ) {
            segment.latStart = coords.lat;
            segment.lngStart = coords.lng;
            segment.countryStart = coords.country;
            segment.countryCodeStart = coords.countryCode;
            changed = true;
        }
    }

    if (segment.destName?.trim()) {
        const coords = await geocodePlace(segment.destName);

        if (
            coords &&
            (segment.latDest !== coords.lat ||
                segment.lngDest !== coords.lng ||
                segment.countryDest !== coords.country ||
                segment.countryCodeDest !== coords.countryCode)
        ) {
            segment.latDest = coords.lat;
            segment.lngDest = coords.lng;
            segment.countryDest = coords.country;
            segment.countryCodeDest = coords.countryCode;
            changed = true;
        }
    }

    return changed;
}
function zoomToLegPoints(segment) {
  if (!map) return;
  const points = [];
  if (segment.latStart && segment.lngStart)
    points.push([segment.latStart, segment.lngStart]);
  if (segment.latDest && segment.lngDest)
    points.push([segment.latDest, segment.lngDest]);
  if (points.length >= 2) {
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  } else if (points.length === 1) {
    map.setView(points[0], METRO_ZOOM_LEVEL);
  }
}
function zoomToFitAllPoints() {
  if (!map) return;
  const points = [];
  segments.forEach((seg) => {
    if (
      Number.isFinite(Number(seg.latStart)) &&
      Number.isFinite(Number(seg.lngStart))
    )
      points.push([seg.latStart, seg.lngStart]);
    if (
      Number.isFinite(Number(seg.latDest)) &&
      Number.isFinite(Number(seg.lngDest))
    )
      points.push([seg.latDest, seg.lngDest]);
  });
  if (points.length === 0) return;
  if (points.length === 1) map.setView(points[0], METRO_ZOOM_LEVEL);
  else
    map.fitBounds(L.latLngBounds(points), {
      padding: [10, 10],
      maxZoom: 12,
      animate: true,
    });
}
function zoomToMetroLevel(lat, lng) {
  if (map) map.setView([lat, lng], METRO_ZOOM_LEVEL);
}
function updateMetroHintVisibility() {
  const hint = document.getElementById("metroZoomHint");
  if (hint && map)
    map.getZoom() < METRO_ZOOM_LEVEL
      ? hint.classList.add("visible")
      : hint.classList.remove("visible");
}
function openNotesModal(legId) {
  currentNotesLegId = legId;
  const leg = segments.find((s) => s.id === legId);
  document.getElementById("notesTextarea").value = leg?.notes || "";
  const deleteNoteBtn = document.getElementById("deleteNoteBtn");
  if (deleteNoteBtn) {
    deleteNoteBtn.style.display = leg?.notes?.trim() ? "block" : "none";
  }
  document.getElementById("notesModal").classList.add("active");
}
function closeNotesModal() {
  document.getElementById("notesModal").classList.remove("active");
  currentNotesLegId = null;
}
function saveCurrentNotes() {
  if (currentNotesLegId !== null) {
    const leg = segments.find((s) => s.id === currentNotesLegId);
    if (leg) {
      leg.notes = document.getElementById("notesTextarea").value;
      renderItinerary();
      saveToLocalStorage();
    }
  }
  closeNotesModal();
}
function deleteCurrentNotes() {
  if (currentNotesLegId !== null) {
    const leg = segments.find((s) => s.id === currentNotesLegId);
    if (leg) {
      leg.notes = "";
      renderItinerary();
      saveToLocalStorage();
    }
  }
  closeNotesModal();
}
function getLegStatusClass(seg) {
  const statusClass =
    seg.bookingStatus === "booked" ? "leg-booked" : "leg-planned";
  return `${statusClass}${seg.id === selectedLegId ? " leg-selected" : ""}`;
}
function getBookingToggleHtml(seg) {
  const isBooked = seg.bookingStatus === "booked";
  const label = isBooked ? "Booked" : "Planned";
  const icon = isBooked ? "fa-check-circle" : "fa-clock";
  const stateClass = isBooked ? "booked" : "planned";
  return `<button class="booking-toggle-btn ${stateClass}" title="Toggle planned/booked" onclick="event.stopPropagation(); toggleLegBookingStatus(${seg.id})"><i class="fas ${icon}"></i> ${label}</button>`;
}
function toggleLegBookingStatus(id) {
  const seg = segments.find((s) => s.id === id);
  if (!seg) return;
  seg.bookingStatus = seg.bookingStatus === "booked" ? "planned" : "booked";
  renderItinerary();
  saveToLocalStorage();
}
function migrateSegmentFields() {
  for (let seg of segments) {
    if (seg.notes === undefined) seg.notes = "";
    if (!seg.bookingStatus) seg.bookingStatus = "planned";
  }
}
function scrollToLegElement(legId) {
  setTimeout(() => {
    const el = document.querySelector(
      `.itinerary-item[data-leg-id="${legId}"], .compact-item[data-leg-id="${legId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("highlight-new");
      setTimeout(() => el.classList.remove("highlight-new"), 1200);
    }
  }, 100);
}
async function addSegment() {
  const defaultStart =
    segments.length > 0 ? segments[segments.length - 1].destName : "";
  const today = new Date();
  let arrivalDate = today.toISOString().slice(0, 10);
  let departureDate = new Date(today.setDate(today.getDate() + 3))
    .toISOString()
    .slice(0, 10);
  if (segments.length > 0 && segments[segments.length - 1].departureDate) {
    arrivalDate = segments[segments.length - 1].departureDate;
    const arrive = new Date(arrivalDate);
    departureDate = new Date(arrive.setDate(arrive.getDate() + 3))
      .toISOString()
      .slice(0, 10);
  }
  const newSeg = {
    id: nextId++,
    startName: defaultStart || "",
    travelMode: "tba",
    destName: "",
    arrivalDate,
    departureDate,
    arrivalLocked: false,
    departureLocked: false,
    nights: calculateNights(arrivalDate, departureDate),
    transportCost: 0,
    accommodationCost: 0,
    spendingPerDay: 0,
    latStart: null,
    lngStart: null,
    latDest: null,
    lngDest: null,
    notes: "",
    bookingStatus: "planned",
  };
  segments.push(newSeg);
  routeCache.clear();
  renderItinerary();
  scrollToLegElement(newSeg.id);
  await updateSegmentCoordinates(newSeg);
  renderItinerary();
  await drawAllRoutes();
  if (newSeg.latStart && newSeg.lngStart)
    zoomToMetroLevel(newSeg.latStart, newSeg.lngStart);
  saveToLocalStorage();
}
function removeSegment(id) {
  segments = segments.filter((s) => s.id !== id);
  routeCache.clear();
  renderItinerary();
  drawAllRoutes();
  saveToLocalStorage();
}
async function updateSegmentField(id, field, value) {
  const seg = segments.find((s) => s.id === id);
  if (!seg) return;
  if (field === "arrivalDateDisplay") {
    value = parseDMYToDate(value);
    field = "arrivalDate";
  }

  if (field === "departureDateDisplay") {
    value = parseDMYToDate(value);
    field = "departureDate";
  }

  seg[field] = value;
  const currentIndex = segments.findIndex((s) => s.id === id);

  if (field === "arrivalDate") {
    seg.arrivalLocked = true;

    if (currentIndex > 0) {
      const previous = segments[currentIndex - 1];
      previous.departureDate = seg.arrivalDate;
      if (previous.departureDate < previous.arrivalDate) {
        previous.departureDate = previous.arrivalDate;
      }
      previous.nights = calculateNights(
        previous.arrivalDate,
        previous.departureDate,
      );
    }

    recalculateDatesFrom(currentIndex);
  }

  if (field === "departureDate") {
    seg.departureLocked = true;

    if (seg.departureDate < seg.arrivalDate) {
      seg.departureDate = seg.arrivalDate;
    }

    recalculateDatesFrom(currentIndex + 1);
  }
  if (field === "arrivalDate" || field === "departureDate")
    seg.nights = calculateNights(seg.arrivalDate, seg.departureDate);
  if (field === "travelMode") routeCache.clear();
  renderItinerary();

  if (field === "startName" || field === "destName") {
    if (await updateSegmentCoordinates(seg)) {
      routeCache.clear();
      await drawAllRoutes();
      if (
        field === "destName" &&
        seg.latStart &&
        seg.lngStart &&
        seg.latDest &&
        seg.lngDest
      ) {
        zoomToLegPoints(seg);
      } else if (field === "startName" && seg.latStart && seg.lngStart) {
        zoomToMetroLevel(seg.latStart, seg.lngStart);
      } else if (seg.latStart && seg.lngStart) {
        zoomToMetroLevel(seg.latStart, seg.lngStart);
      } else if (seg.latDest && seg.lngDest) {
        zoomToMetroLevel(seg.latDest, seg.lngDest);
      }
    }
  } else {
    await drawAllRoutes();
  }
  saveToLocalStorage();
}
function onLegClick(segment) {
  selectedLegId = segment.id;
  renderItinerary();
  if (
    segment.latStart &&
    segment.lngStart &&
    segment.latDest &&
    segment.lngDest
  ) {
    zoomToLegPoints(segment);
  } else if (segment.latStart && segment.lngStart) {
    zoomToMetroLevel(segment.latStart, segment.lngStart);
  } else if (segment.latDest && segment.lngDest) {
    zoomToMetroLevel(segment.latDest, segment.lngDest);
  }
}
function updateCostSummary() {
  let totalTransport = 0,
    totalAccommodation = 0,
    totalSpending = 0,
    totalNights = 0;
  for (let seg of segments) {
    totalTransport += seg.transportCost || 0;
    totalAccommodation += seg.accommodationCost || 0;
    const nights = seg.nights || 0;
    totalSpending += (seg.spendingPerDay || 0) * nights;
    totalNights += nights;
  }
  document.getElementById("costSummary").innerHTML =
    `<div><span>✈️ Travel:</span> <strong>$${totalTransport.toFixed(2)}</strong></div><div><span>🏨 Accommodation:</span> <strong>$${totalAccommodation.toFixed(2)}</strong></div><div><span>💰 Spending (${totalNights} nights):</span> <strong>$${totalSpending.toFixed(2)}</strong></div><div class="total"><span>🎯 TOTAL TRIP:</span> <strong>$${(totalTransport + totalAccommodation + totalSpending).toFixed(2)}</strong></div>`;
}
function renderItinerary() {
  const container = document.getElementById("itineraryList");
  if (!container) return;
  if (segments.length === 0) {
    container.innerHTML = `<div style="padding:1rem;text-align:center;">✨ Click "Add Leg" to start</div>`;
    updateCostSummary();
    return;
  }
  if (compactViewActive) {
    let html = "";
    segments.forEach((seg, idx) => {
      const modeIcons = {
        tba: "⏳",
        road: "🚗",
        train: "🚆",
        air: "✈️",
        ferry: "⛴️",
        ship: "🚢",
      };
      const modeIcon = modeIcons[seg.travelMode] || "❓";
      const modeFull =
        {
          tba: "TBA",
          road: "Road",
          train: "Train",
          air: "Air",
          ferry: "Ferry",
          ship: "Ship",
        }[seg.travelMode] || "";
      const hasNotes = seg.notes && seg.notes.trim() ? true : false;
      html += `<div class="compact-item ${getLegStatusClass(seg)}" data-leg-id="${seg.id}"><div class="compact-header-row"><span class="compact-leg-badge"><i class="fas fa-route"></i> Leg ${idx + 1} <span style="margin-left:4px; font-size:0.7rem;">${modeIcon} ${modeFull}</span></span><div class="compact-action-buttons">${getBookingToggleHtml(seg)}<button class="notes-btn${hasNotes ? " has-notes" : ""}" onclick="event.stopPropagation(); openNotesModal(${seg.id})"><i class="fas ${hasNotes ? "fa-paperclip" : "fa-sticky-note"}"></i> Notes</button><button class="remove-btn" onclick="event.stopPropagation(); removeSegment(${seg.id})"><i class="fas fa-trash-alt"></i> Remove</button></div></div><div class="compact-route-line">📍 ${escapeHtml(seg.startName || "?")} → ${escapeHtml(seg.destName || "?")}</div><div class="compact-dates"><span>📅 ${formatDateToDMY(seg.arrivalDate)} → ${formatDateToDMY(seg.departureDate)}</span><span>🌙 ${seg.nights || 0} nights</span></div><div class="compact-costs"><span><i class="fas fa-dollar-sign"></i> Travel $${(seg.transportCost || 0).toFixed(0)}</span><span><i class="fas fa-bed"></i> Accom $${(seg.accommodationCost || 0).toFixed(0)}</span><span><i class="fas fa-coffee"></i> Daily $${(seg.spendingPerDay || 0).toFixed(0)}</span></div></div>`;
    });
    container.innerHTML = html;
    document.querySelectorAll(".compact-item").forEach((el) => {
      const id = parseInt(el.dataset.legId);
      const seg = segments.find((s) => s.id === id);
      if (seg)
        el.addEventListener("click", (e) => {
          if (
            e.target.tagName !== "BUTTON" &&
            !e.target.closest(".notes-btn") &&
            !e.target.closest(".booking-toggle-btn") &&
            !e.target.closest(".remove-btn")
          )
            onLegClick(seg);
        });
    });
  } else {
    let html = "";
    segments.forEach((seg, idx) => {
      /* const notesIconHtml =
              seg.notes && seg.notes.trim()
                ? `<span class="notes-indicator" title="Notes available"><i class="fas fa-paperclip"></i></span>`
                : "";*/
      html += `<div class="itinerary-item ${getLegStatusClass(seg)}" data-leg-id="${seg.id}"><div style="display:flex; justify-content:space-between; margin-bottom:6px;"><strong>Leg ${idx + 1}</strong><div class="leg-actions">${getBookingToggleHtml(seg)}<button class="notes-btn${seg.notes && seg.notes.trim() ? " planned" : ""}" onclick="event.stopPropagation(); openNotesModal(${seg.id})"><i class="fas ${seg.notes && seg.notes.trim() ? "fa-paperclip" : "fa-sticky-note"}"></i> Notes</button><button class="remove-btn" onclick="event.stopPropagation(); removeSegment(${seg.id})"><i class="fas fa-trash-alt"></i> Remove</button></div></div><div class="flex-row"><div class="field"><label>📍Arrive</label><input type="text" id="start_input_${seg.id}" value="${escapeHtml(seg.startName)}" placeholder="City"></div><div class="field"><label>🏝️ Depart To</label><input type="text" id="dest_input_${seg.id}" value="${escapeHtml(seg.destName)}" placeholder="Destination"></div></div><div class="flex-row">

<div class="field">
    <label>
        <i class="fas fa-calendar-alt calendar-icon"></i> Arrival
    </label>

<input
    type="text"
    id="arrival_display_${seg.id}"
    class="date-display-input"
    value="${formatDateToDMY(seg.arrivalDate)}"
    placeholder="dd/mm/yy"
    readonly

    onclick="
        const picker = document.getElementById('arrival_date_${seg.id}');
        if (picker.showPicker) {
            picker.showPicker();
        } else {
            picker.click();
        }
        event.stopPropagation();
    "
>

    <input
        type="date"
        id="arrival_date_${seg.id}"
        value="${seg.arrivalDate}"
        class="hidden-date-input"
        onchange="
            updateSegmentField(${seg.id}, 'arrivalDate', this.value);
            document.getElementById('arrival_display_${seg.id}').value = formatDateToDMY(this.value);
        "
    >
</div>

<div class="field">
    <label>
        <i class="fas fa-calendar-alt calendar-icon"></i> Departure
    </label>

    <input
        type="text"
        id="departure_display_${seg.id}"
        class="date-display-input"
        value="${formatDateToDMY(seg.departureDate)}"
        placeholder="dd/mm/yy"
        readonly
        onclick="
            const picker = document.getElementById('departure_date_${seg.id}');
            if (picker.showPicker) {
                picker.showPicker();
            } else {
                picker.click();
            }
            event.stopPropagation();
        "
    >

    <input
        type="date"
        id="departure_date_${seg.id}"
        value="${seg.departureDate}"
        class="hidden-date-input"
        onchange="
            updateSegmentField(${seg.id}, 'departureDate', this.value);
            document.getElementById('departure_display_${seg.id}').value = formatDateToDMY(this.value);
        "
    >
</div>
                    <div class="field"><label>🌙 Nights</label><div class="nights-badge">${seg.nights || 0} nights</div></div></div><div class="flex-row"><div class="field">
                        <label>🚗 Mode</label><select onchange="updateSegmentField(${seg.id}, 'travelMode', this.value)" onclick="event.stopPropagation()">${[
                          ["tba", "⏳ TBA"],
                          ["road", "🚗 Road"],
                          ["train", "🚆 Train"],
                          ["air", "✈️ Air"],
                          ["ferry", "⛴️ Ferry"],
                          ["ship", "🚢 Ship"],
                        ]
                          .map(
                            ([val, label]) =>
                              `<option value="${val}" ${seg.travelMode === val ? "selected" : ""}>${label}</option>`,
                          )
                          .join(
                            "",
                          )}</select></div><div class="field"><label>🚀 Transport ($)</label><input type="number" value="${seg.transportCost}" step="10" onchange="updateSegmentField(${seg.id}, 'transportCost', parseFloat(this.value)||0)" onclick="event.stopPropagation()"></div></div><div class="flex-row"><div class="field"><label>🏨 Accom ($)</label><input type="number" value="${seg.accommodationCost}" step="10" onchange="updateSegmentField(${seg.id}, 'accommodationCost', parseFloat(this.value)||0)" onclick="event.stopPropagation()"></div><div class="field"><label>💸 Daily Spend ($)</label><input type="number" value="${seg.spendingPerDay || 0}" step="10" onchange="updateSegmentField(${seg.id}, 'spendingPerDay', parseFloat(this.value)||0)" onclick="event.stopPropagation()"></div></div></div>`;
    });
    container.innerHTML = html;
    segments.forEach((seg) => {
      const fromInput = document.getElementById(`start_input_${seg.id}`);
      const toInput = document.getElementById(`dest_input_${seg.id}`);
      if (fromInput) {
        fromInput.addEventListener("change", (e) => {
          updateSegmentField(seg.id, "startName", e.target.value);
        });
        const fieldDiv = fromInput.closest(".field");
        attachAutocompleteToField(fieldDiv, fromInput, seg.id, "startName");
      }
      if (toInput) {
        toInput.addEventListener("change", (e) => {
          updateSegmentField(seg.id, "destName", e.target.value);
        });
        const fieldDiv = toInput.closest(".field");
        attachAutocompleteToField(fieldDiv, toInput, seg.id, "destName");
      }
      const el = document.querySelector(
        `.itinerary-item[data-leg-id="${seg.id}"]`,
      );
      if (el)
        el.addEventListener("click", (e) => {
          if (
            e.target.tagName !== "BUTTON" &&
            e.target.tagName !== "INPUT" &&
            e.target.tagName !== "SELECT" &&
            !e.target.closest(".remove-btn") &&
            !e.target.closest(".notes-btn") &&
            !e.target.closest(".booking-toggle-btn")
          )
            onLegClick(seg);
        });
    });
  }
  updateCostSummary();
  window.formatDateToDMY = formatDateToDMY;
}
function initMap() {
  map = L.map("map").setView([20, 0], 2);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri", maxZoom: 18 },
  ).addTo(map);
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OSM & CARTO",
      maxZoom: 18,
      subdomains: "abcd",
    },
  ).addTo(map);
  map.on("zoomend", updateMetroHintVisibility);
  routeLayer = L.layerGroup().addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  setTimeout(updateMetroHintVisibility, 100);
}
async function drawAllRoutes() {
  if (isDrawingRoutes) {
    drawRequested = true;
    return;
  }

  isDrawingRoutes = true;
  drawRequested = false;

  const loading = document.getElementById("loadingIndicator");
  loading.style.display = "flex";

  try {
    markersLayer.clearLayers();

    const validSegments = segments.filter(
      (s) => s.latStart && s.lngStart && s.latDest && s.lngDest,
    );

    for (let seg of validSegments) {
      L.marker([seg.latStart, seg.lngStart], {
icon: L.divIcon({
    className: "",
    html: `<div style="position:relative; background:${getCountryPinColor(seg.countryCodeStart)}; width:18.75px; height:30.75px; clip-path: polygon(50% 100%, 0 45%, 0 30%, 15% 10%, 35% 0, 65% 0, 85% 10%, 100% 30%, 100% 45%);"><div style="position:absolute; width:6.75px; height:6.75px; background:white; border-radius:50%; left:6px; top:6px;"></div></div>`,
    iconSize: [18.75, 30.75],
    iconAnchor: [9.375, 30.75],
}),
})
        .on("click", () => zoomToMetroLevel(seg.latStart, seg.lngStart))
        .bindTooltip(seg.startName)
        .addTo(markersLayer);

      L.marker([seg.latDest, seg.lngDest], {
    icon: L.divIcon({
        className: "",
        html: `<div style="position:relative; background:${getCountryPinColor(seg.countryCodeDest)}; width:18.75px; height:30.75px; clip-path: polygon(50% 100%, 0 45%, 0 30%, 15% 10%, 35% 0, 65% 0, 85% 10%, 100% 30%, 100% 45%);"><div style="position:absolute; width:6.75px; height:6.75px; background:white; border-radius:50%; left:6px; top:6px;"></div></div>`,
        iconSize: [18.75, 30.75],
        iconAnchor: [9.375, 30.75],
    }),
})
        .on("click", () => zoomToMetroLevel(seg.latDest, seg.lngDest))
        .bindTooltip(seg.destName)
        .addTo(markersLayer);
    }

    const routePromises = validSegments
      .filter((s) => s.travelMode !== "tba")
      .map(async (seg) => {
        const segmentIndex = segments.findIndex((s) => s.id === seg.id);
        const route = await getRouteForSegment(seg, segmentIndex);

        if (!route) return null;

        const style = { ...getRouteStyle(seg), opacity: 0.9 };

        return {
          route,
          style,
          popup: `${seg.travelMode.toUpperCase()}<br>${seg.startName} → ${seg.destName}`,
        };
      });

    const results = await Promise.all(routePromises);

    routeLayer.clearLayers();

    for (let r of results) {
      if (r) {
        L.polyline(r.route, r.style).addTo(routeLayer).bindPopup(r.popup);
      }
    }

    updateMetroHintVisibility();
  } finally {
    loading.style.display = "none";
    isDrawingRoutes = false;

    if (drawRequested) {
      drawAllRoutes();
    }
  }
}
function saveToLocalStorage() {
  sessionStorage.setItem(
    "wanderplan_session",
    JSON.stringify({
      holidayName,
      segments,
      nextId,
      routeCache: Object.fromEntries(routeCache),
      version: 29,
      countryPinColors: window.countryPinColors || {},
    }),
  );
}
async function loadFromLocalStorage() {
  const raw = sessionStorage.getItem("wanderplan_session");
  if (raw) {
    const data = JSON.parse(raw);
if (data.segments) segments = data.segments;
    if (data.nextId) nextId = data.nextId;
    if (data.holidayName) holidayName = data.holidayName;
    document.getElementById("holidayNameInput").value = holidayName;
    window.countryPinColors = data.countryPinColors || {};
    migrateSegmentFields();
    restoreRouteCache(data.routeCache);
    renderItinerary();
    for (let seg of segments) {
      if (
        !hasSavedCoordinates(seg) ||
        !seg.countryStart ||
        !seg.countryDest ||
        !seg.countryCodeStart ||
        !seg.countryCodeDest
      ) {
        await updateSegmentCoordinates(seg);
      }
    }
    renderItinerary();
    await drawAllRoutes();
    setTimeout(() => {
      map?.invalidateSize();
      zoomToFitAllPoints();
    }, 150);
  }
}
async function exportToJSON() {
  const tripName =
    document.getElementById("holidayNameInput").value || "Holiday";
const data = {
  holidayName: tripName,
  segments,
  nextId,
  routeCache: Object.fromEntries(routeCache),
  version: 29,
  countryPinColors: window.countryPinColors || {},
  exported: new Date().toISOString(),
};
  const json = JSON.stringify(data, null, 2);
  const fileName = `${tripName.replace(/\s+/g, "_")}_plan.json`;
  if ("showSaveFilePicker" in window) {
    try {
      const fileHandle =
        currentFileHandle ||
        (await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "Trip planner JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        }));
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      currentFileHandle = fileHandle;
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      currentFileHandle = null;
    }
  }
  const blob = new Blob([json], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(blob);
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const data = JSON.parse(e.target.result);
    if (data.segments) segments = data.segments;
    if (data.nextId) nextId = data.nextId;
    if (data.holidayName) {
      holidayName = data.holidayName;
      document.getElementById("holidayNameInput").value = holidayName;
    }
    window.countryPinColors = data.countryPinColors || {};
    migrateSegmentFields();
    restoreRouteCache(data.routeCache);
    railwayCache.clear();
    maritimeCache.clear();
    renderItinerary();
 for (let seg of segments) {
      if (
        !hasSavedCoordinates(seg) ||
        !seg.countryStart ||
        !seg.countryDest ||
        !seg.countryCodeStart ||
        !seg.countryCodeDest
      ) {
        await updateSegmentCoordinates(seg);
      }
    }
    renderItinerary();
    await drawAllRoutes();
    saveToLocalStorage();
    setTimeout(() => {
      map?.invalidateSize();
      zoomToFitAllPoints();
    }, 150);
  };
  reader.readAsText(file);
}
async function openJSONFile() {
  if ("showOpenFilePicker" in window) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Trip planner JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      currentFileHandle = fileHandle;
      importJSON(await fileHandle.getFile());
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  document.getElementById("loadFileInput").click();
}
function resetPlanner() {
  if (confirm("⚠️ RESET ALL? This will delete your itinerary.")) {
    sessionStorage.removeItem("wanderplan_session");
    segments = [];
    nextId = 1;
    holidayName = "";
    document.getElementById("holidayNameInput").value = holidayName;
    routeCache.clear();
    railwayCache.clear();
    maritimeCache.clear();
    renderItinerary();
    if (map) {
      markersLayer?.clearLayers();
      routeLayer?.clearLayers();
      map.setView([20, 0], 2);
    }
  }
}
function toggleCompactView() {
  compactViewActive = !compactViewActive;
  const toggleBtn = document.getElementById("toggleViewBtn");
  if (compactViewActive) {
    toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i> Detailed';
    toggleBtn.classList.add("primary");
  } else {
    toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i> Compact';
    toggleBtn.classList.remove("primary");
  }
  renderItinerary();
}
let printMaps = [];
let printMapFitData = [];
function collectMapBoundsPoints(start, end, route) {
  const points = [];
  if (Array.isArray(start)) points.push(start);
  if (Array.isArray(end)) points.push(end);
  if (Array.isArray(route)) route.forEach((pt) => points.push(pt));
  return points;
}
function fitPrintMapToPoints(targetMap, points, options = {}) {
  if (!targetMap || !points.length) return;
  const bounds = L.latLngBounds(points);
  if (!bounds.isValid()) return;
  targetMap.fitBounds(bounds, {
    padding: options.padding || [25, 25],
    animate: false,
    maxZoom: options.maxZoom,
  });
}
function refitPrintMaps() {
  printMaps.forEach((printMap) => printMap.invalidateSize());
  printMapFitData.forEach(({ map, points, options }) => {
    fitPrintMapToPoints(map, points, options);
  });
}
function addPrintBaseLayers(targetMap) {
  const imageryLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 18,
    },
  ).addTo(targetMap);
  const labelsLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OSM & CARTO",
      maxZoom: 18,
      subdomains: "abcd",
    },
  ).addTo(targetMap);
  return [imageryLayer, labelsLayer];
}
function waitForPrintTiles(tileLayers, timeout = 15000) {
  return Promise.all(
    tileLayers.map(
      (layer) =>
        new Promise((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(finish, timeout);
          layer.once("load", finish);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!layer.isLoading()) finish();
            });
          });
        }),
    ),
  );
}
function hasSegmentCoordinates(seg) {
  return (
    Number.isFinite(Number(seg.latStart)) &&
    Number.isFinite(Number(seg.lngStart)) &&
    Number.isFinite(Number(seg.latDest)) &&
    Number.isFinite(Number(seg.lngDest))
  );
}
function destroyPrintMaps() {
  printMaps.forEach((printMap) => printMap.remove());
  printMaps = [];
  printMapFitData = [];
}
async function buildPrintMapReport() {
  destroyPrintMaps();
  const report = document.getElementById("printMapReport");
  const tripName =
    document.getElementById("holidayNameInput").value || "Trip Planner";
  const printableSegments = segments.filter(hasSegmentCoordinates);
  const itineraryItems = segments
    .map(
      (seg, index) =>
        `<li><strong>Leg ${index + 1}:</strong> ${escapeHtml(seg.startName || "?")} to ${escapeHtml(seg.destName || "?")} — ${formatDateToDMY(seg.arrivalDate)} to ${formatDateToDMY(seg.departureDate)} · ${seg.nights || 0} nights · ${String(seg.travelMode || "tba").toUpperCase()}</li>`,
    )
    .join("");

  report.classList.add("print-preparing");
  report.innerHTML = `<h1>${escapeHtml(tripName)}</h1><h2>Full trip map</h2><div id="printFullMap" class="print-map-full"></div><section class="print-itinerary-summary"><h2>Full itinerary</h2><ol>${itineraryItems}</ol></section><div id="printLegMaps"></div>`;

  const fullMap = L.map("printFullMap", {
    zoomControl: false,
    attributionControl: false,
    fadeAnimation: false,
    zoomAnimation: false,
  });
  printMaps.push(fullMap);
  const fullMapTileLayers = addPrintBaseLayers(fullMap);

  const allFullPoints = [];
  for (const seg of printableSegments) {
    const start = [seg.latStart, seg.lngStart];
    const end = [seg.latDest, seg.lngDest];
    L.marker(start).bindTooltip(seg.startName).addTo(fullMap);
    L.marker(end).bindTooltip(seg.destName).addTo(fullMap);
    const route = await getRouteForSegment(
      seg,
      segments.findIndex((s) => s.id === seg.id),
    );
    if (route) L.polyline(route, getRouteStyle(seg)).addTo(fullMap);
    allFullPoints.push(...collectMapBoundsPoints(start, end, route));
  }
  printMapFitData.push({
    map: fullMap,
    points: allFullPoints,
    options: { padding: [25, 25], maxZoom: 12 },
  });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  refitPrintMaps();
  await waitForPrintTiles(fullMapTileLayers);

  const legMaps = document.getElementById("printLegMaps");
  let legHtml = "";
  for (let i = 0; i < printableSegments.length; i += 2) {
    legHtml += '<div class="print-leg-row">';
    printableSegments.slice(i, i + 2).forEach((seg, offset) => {
      const legNumber = i + offset + 1;
      legHtml += `<section class="print-leg"><h3>Leg ${legNumber}: ${escapeHtml(seg.startName || "?")} to ${escapeHtml(seg.destName || "?")}</h3><p>${formatDateToDMY(seg.arrivalDate)} to ${formatDateToDMY(seg.departureDate)} &middot; ${seg.nights || 0} nights &middot; ${String(seg.travelMode || "tba").toUpperCase()}</p><div id="printLegMap_${seg.id}" class="print-leg-map"></div></section>`;
    });
    legHtml += "</div>";
  }
  legMaps.innerHTML = legHtml;

  for (const seg of printableSegments) {
    const legMap = L.map(`printLegMap_${seg.id}`, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: false,
    });
    printMaps.push(legMap);
    const legMapTileLayers = addPrintBaseLayers(legMap);

    const start = [seg.latStart, seg.lngStart];
    const end = [seg.latDest, seg.lngDest];
    L.marker(start).bindTooltip(seg.startName).addTo(legMap);
    L.marker(end).bindTooltip(seg.destName).addTo(legMap);
    const route = await getRouteForSegment(
      seg,
      segments.findIndex((s) => s.id === seg.id),
    );
    if (route) L.polyline(route, getRouteStyle(seg)).addTo(legMap);
    const legMapFitData = {
      map: legMap,
      points: collectMapBoundsPoints(start, end, route),
      options: { padding: [25, 25] },
    };
    printMapFitData.push(legMapFitData);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    legMap.invalidateSize();
    fitPrintMapToPoints(
      legMapFitData.map,
      legMapFitData.points,
      legMapFitData.options,
    );
    await waitForPrintTiles(legMapTileLayers);
  }
}
async function printItinerary() {
  await buildPrintMapReport();
  window.print();
}
window.updateSegmentField = updateSegmentField;
window.removeSegment = removeSegment;
window.formatDateToDMY = formatDateToDMY;
window.openNotesModal = openNotesModal;
window.toggleLegBookingStatus = toggleLegBookingStatus;
document.getElementById("saveJsonBtn").onclick = exportToJSON;
document.getElementById("loadJsonBtn").onclick = openJSONFile;
document.getElementById("resetBtn").onclick = resetPlanner;
document.getElementById("addSegmentBtn").onclick = addSegment;
document.getElementById("printBtn").onclick = printItinerary;
document.getElementById("zoomToFitBtn").onclick = zoomToFitAllPoints;
document.getElementById("loadFileInput").onchange = (e) => {
  currentFileHandle = null;
  if (e.target.files[0]) importJSON(e.target.files[0]);
  e.target.value = "";
};
document.getElementById("holidayNameInput").oninput = (e) => {
  holidayName = e.target.value;
  saveToLocalStorage();
};
document.getElementById("closeModalBtn").onclick = closeNotesModal;
document.getElementById("cancelNotesBtn").onclick = closeNotesModal;
document.getElementById("saveNotesBtn").onclick = saveCurrentNotes;
document.getElementById("deleteNoteBtn").onclick = deleteCurrentNotes;
document.getElementById("toggleViewBtn").onclick = toggleCompactView;
window.addEventListener("beforeunload", () => saveToLocalStorage());
window.addEventListener("DOMContentLoaded", async () => {
  initMap();
  await loadFromLocalStorage();
  if (segments.length === 0) {
    renderItinerary();
  }
});
function escapeHtml(str) {
  return (
    str?.replace(
      /[&<>]/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m],
    ) || ""
  );
}
