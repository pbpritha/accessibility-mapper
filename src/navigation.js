import L from 'leaflet';

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
const BLOCK_RADIUS_METERS = 15;

let map = null;
let getBlockers = () => [];
let cancelReportFlow = () => {};

let navBtn, navPanel, navStatus, navInstructions, navActionBtn;

let navMode = 'idle'; // 'idle' | 'awaiting-start' | 'awaiting-destination' | 'routed'
let startLatLng = null;
let startMarker = null;
let destMarker = null;
let routeLine = null;

export function initNavigation(mapInstance, getBlockersFn, cancelReportFlowFn) {
  map = mapInstance;
  getBlockers = getBlockersFn;
  cancelReportFlow = cancelReportFlowFn || cancelReportFlow;

  navBtn = document.getElementById('nav-btn');
  navPanel = document.getElementById('nav-panel');
  navStatus = document.getElementById('nav-status');
  navInstructions = document.getElementById('nav-instructions');
  navActionBtn = document.getElementById('nav-action-btn');

  navBtn.addEventListener('click', startNavFlow);
  navActionBtn.addEventListener('click', () => {
    if (navMode === 'routed') {
      stopNavigation();
    } else {
      cancelNavigation();
    }
  });
}

function resetNavState() {
  navMode = 'idle';
  startLatLng = null;
  if (startMarker) {
    map.removeLayer(startMarker);
    startMarker = null;
  }
  if (destMarker) {
    map.removeLayer(destMarker);
    destMarker = null;
  }
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  navInstructions.innerHTML = '';
  navActionBtn.textContent = 'Cancel';
  navPanel.classList.add('hidden');
}

export function cancelNavigation() {
  if (navMode === 'idle') return;
  resetNavState();
}

export function stopNavigation() {
  resetNavState();
}

function startNavFlow() {
  cancelReportFlow();
  navPanel.classList.remove('hidden');
  navInstructions.innerHTML = '';
  navActionBtn.textContent = 'Cancel';

  if (navigator.geolocation) {
    navStatus.textContent = 'Getting your location…';
    navMode = 'awaiting-start';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startLatLng = [pos.coords.latitude, pos.coords.longitude];
        armDestinationTap();
      },
      () => armStartTap()
    );
  } else {
    armStartTap();
  }
}

function armStartTap() {
  navMode = 'awaiting-start';
  navStatus.textContent = 'Tap the map to set your starting point.';
  map.once('click', (e) => {
    startLatLng = [e.latlng.lat, e.latlng.lng];
    armDestinationTap();
  });
}

function armDestinationTap() {
  navMode = 'awaiting-destination';
  navStatus.textContent = 'Now tap the map to set your destination.';
  map.once('click', (e) => {
    const destLatLng = [e.latlng.lat, e.latlng.lng];
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker(destLatLng).addTo(map);
    calculateRoute(startLatLng, destLatLng);
  });
}

// Approximate a small circle around a blocker as a polygon, in [lng, lat] GeoJSON order.
function buildCirclePolygon(lat, lng, radiusMeters, points = 8) {
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(latRad);
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const angle = (2 * Math.PI * i) / points;
    const dLat = (radiusMeters * Math.sin(angle)) / metersPerDegLat;
    const dLng = (radiusMeters * Math.cos(angle)) / metersPerDegLng;
    coords.push([lng + dLng, lat + dLat]);
  }
  return coords;
}

function buildAvoidPolygons(blockers) {
  if (!blockers.length) return null;
  return {
    type: 'MultiPolygon',
    coordinates: blockers.map((b) => [buildCirclePolygon(b.lat, b.lng, BLOCK_RADIUS_METERS)]),
  };
}

async function requestRoute(start, dest, avoidPolygons) {
  const apiKey = import.meta.env.VITE_ORS_API_KEY;
  const body = {
    coordinates: [
      [start[1], start[0]],
      [dest[1], dest[0]],
    ],
    instructions: true,
  };
  if (avoidPolygons) body.options = { avoid_polygons: avoidPolygons };

  const response = await fetch(ORS_URL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { ok: response.ok, json };
}

function drawRoute(feature) {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  const latlngs = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  routeLine = L.polyline(latlngs, { color: '#1f6feb', weight: 5 }).addTo(map);

  navInstructions.innerHTML = '';
  const steps = feature.properties.segments.flatMap((s) => s.steps);
  steps.forEach((step) => {
    const li = document.createElement('li');
    const road = step.name && step.name !== '-' && !step.instruction.includes(step.name)
      ? ` on ${step.name}`
      : '';
    li.textContent = `${step.instruction}${road}, ${Math.round(step.distance)}m`;
    navInstructions.appendChild(li);
  });
}

async function calculateRoute(start, dest) {
  navStatus.textContent = 'Calculating route…';
  navInstructions.innerHTML = '';

  const blockers = getBlockers();
  const avoidPolygons = buildAvoidPolygons(blockers);

  let result;
  try {
    result = await requestRoute(start, dest, avoidPolygons);
  } catch (err) {
    console.error('ORS request failed', err);
    navStatus.textContent = "Couldn't calculate a route right now. Try again in a moment.";
    return;
  }

  if (!result.ok) {
    const message = result.json?.error?.message || '';
    const looksBlockedIn = avoidPolygons && /could not be found/i.test(message);
    const pointNotFound = /could not find routable point/i.test(message);

    if (looksBlockedIn) {
      let retry;
      try {
        retry = await requestRoute(start, dest, null);
      } catch (err) {
        console.error('ORS fallback request failed', err);
        navStatus.textContent = 'No route could be found to this destination.';
        armDestinationTap();
        return;
      }
      if (retry.ok && retry.json.features?.length) {
        drawRoute(retry.json.features[0]);
        navStatus.textContent = 'This route may cross a reported blocker — no clear path was found around it.';
        navActionBtn.textContent = 'Stop navigation';
        navMode = 'routed';
        return;
      }
      navStatus.textContent = 'No route could be found to this destination.';
      armDestinationTap();
      return;
    }

    if (pointNotFound) {
      navStatus.textContent = 'No route could be found to this destination.';
      armDestinationTap();
      return;
    }

    console.error('ORS error', result.json);
    navStatus.textContent = "Couldn't calculate a route right now. Try again in a moment.";
    return;
  }

  if (!result.json.features?.length) {
    navStatus.textContent = 'No route could be found to this destination.';
    armDestinationTap();
    return;
  }

  drawRoute(result.json.features[0]);
  navStatus.textContent = 'Route ready.';
  navActionBtn.textContent = 'Stop navigation';
  navMode = 'routed';
}
