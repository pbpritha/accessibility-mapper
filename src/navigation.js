import L from 'leaflet';
import { haversineMeters, bearingDegrees, cumulativeDistances, nearestPointOnPath } from './geo.js';

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
const BLOCK_RADIUS_METERS = 15;

// Live guidance tuning.
const OFF_ROUTE_METERS = 30;
const OFF_ROUTE_STRIKES_LIMIT = 3;
const ARRIVE_METERS = 20;
const STEP_ADVANCE_MARGIN_METERS = 6;
const BLOCKER_AHEAD_WINDOW_METERS = 300;

// ORS maneuver `type` -> Material Symbol name.
const MANEUVER_ICONS = {
  0: 'turn_left',
  1: 'turn_right',
  2: 'turn_sharp_left',
  3: 'turn_sharp_right',
  4: 'turn_slight_left',
  5: 'turn_slight_right',
  6: 'straight',
  7: 'roundabout_right',
  8: 'roundabout_right',
  9: 'u_turn_left',
  10: 'flag',
  11: 'my_location',
  12: 'turn_slight_left',
  13: 'turn_slight_right',
};

let map = null;
let getBlockers = () => [];
let cancelReportFlow = () => {};

let navBtn, navPanel, navStatus, navInstructions, navActionBtn, navStartBtn, navSummary, navSummaryStats;
let navLiveBanner, navLiveIcon, navLiveDistance, navLiveInstruction, navRecenterBtn;

let navMode = 'idle'; // 'idle' | 'awaiting-start' | 'awaiting-destination' | 'routed'
let startLatLng = null;
let startMarker = null;
let destMarker = null;
let routeLine = null;

// Parsed model of the currently drawn route, built fresh each time a route
// is (re)calculated. Powers the live guidance loop below.
let currentRoute = null; // { path, cumulative, steps, totalDistance, totalDuration, destLatLng }

// Live guidance state.
let guidanceActive = false;
let watchId = null;
let wakeLock = null;
let userMarker = null;
let accuracyCircle = null;
let followMode = true;
let lastFix = null;
let currentStepIndex = 0;
let offRouteStrikes = 0;
let reroutingInFlight = false;
let notifiedBlockerIds = new Set();

export function initNavigation(mapInstance, getBlockersFn, cancelReportFlowFn) {
  map = mapInstance;
  getBlockers = getBlockersFn;
  cancelReportFlow = cancelReportFlowFn || cancelReportFlow;

  navBtn = document.getElementById('nav-btn');
  navPanel = document.getElementById('nav-panel');
  navStatus = document.getElementById('nav-status');
  navInstructions = document.getElementById('nav-instructions');
  navActionBtn = document.getElementById('nav-action-btn');
  navStartBtn = document.getElementById('nav-start-btn');
  navSummary = document.getElementById('nav-summary');
  navSummaryStats = document.getElementById('nav-summary-stats');
  navLiveBanner = document.getElementById('nav-live-banner');
  navLiveIcon = document.getElementById('nav-live-icon');
  navLiveDistance = document.getElementById('nav-live-distance');
  navLiveInstruction = document.getElementById('nav-live-instruction');
  navRecenterBtn = document.getElementById('nav-recenter-btn');

  navBtn.addEventListener('click', startNavFlow);
  navStartBtn.addEventListener('click', startGuidance);
  navActionBtn.addEventListener('click', () => {
    if (navMode === 'routed') {
      stopNavigation();
    } else {
      cancelNavigation();
    }
  });
  navRecenterBtn.addEventListener('click', recenterOnUser);
  map.on('dragstart', handleMapDragStart);
}

function setNavPanelActive(active) {
  document.body.classList.toggle('nav-mode', active);
  // Leaflet caches its container size; the split layout resizes #map via CSS,
  // so it needs to be told to remeasure once the reflow has happened.
  setTimeout(() => map.invalidateSize(), 0);
}

function resetNavState() {
  stopGuidance();

  navMode = 'idle';
  startLatLng = null;
  currentRoute = null;
  setNavPanelActive(false);
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
  navActionBtn.classList.add('btn-primary');
  navActionBtn.classList.remove('btn-secondary');
  navStartBtn.classList.add('hidden');
  navSummary.classList.add('hidden');
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
  setNavPanelActive(true);
  navPanel.classList.remove('hidden');
  navInstructions.innerHTML = '';
  navActionBtn.textContent = 'Cancel';
  navSummary.classList.add('hidden');

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

export function startNavigationTo(destLatLng) {
  cancelReportFlow();
  setNavPanelActive(true);
  navPanel.classList.remove('hidden');
  navInstructions.innerHTML = '';
  navActionBtn.textContent = 'Cancel';
  navSummary.classList.add('hidden');

  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker(destLatLng).addTo(map);

  if (navigator.geolocation) {
    navStatus.textContent = 'Getting your location…';
    navMode = 'awaiting-start';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startLatLng = [pos.coords.latitude, pos.coords.longitude];
        calculateRoute(startLatLng, destLatLng);
      },
      () => {
        navMode = 'awaiting-start';
        navStatus.textContent = 'Tap the map to set your starting point.';
        map.once('click', (e) => {
          startLatLng = [e.latlng.lat, e.latlng.lng];
          calculateRoute(startLatLng, destLatLng);
        });
      }
    );
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

function maneuverIcon(type) {
  return MANEUVER_ICONS[type] ?? 'straight';
}

function stepRoadSuffix(step) {
  return step.name && step.name !== '-' && !step.instruction.includes(step.name) ? ` on ${step.name}` : '';
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.max(0, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return '<1 min';
  return `${mins} min`;
}

// Builds the tracking model (path/cumulative/steps) from an ORS route
// feature and renders the static step list. Shared by the initial route and
// every reroute during live guidance.
function drawRoute(feature, destLatLng) {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  const path = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  routeLine = L.polyline(path, { color: '#1B432C', weight: 5 }).addTo(map);

  const cumulative = cumulativeDistances(path);
  const rawSteps = feature.properties.segments.flatMap((s) => s.steps);
  const steps = rawSteps.map((step) => ({
    instruction: step.instruction,
    name: step.name,
    distance: step.distance,
    duration: step.duration,
    type: step.type,
    startIdx: step.way_points[0],
    endIdx: step.way_points[1],
    maneuverLatLng: path[step.way_points[1]],
  }));

  const summary = feature.properties.summary;
  currentRoute = {
    path,
    cumulative,
    steps,
    totalDistance: summary?.distance ?? cumulative[cumulative.length - 1],
    totalDuration: summary?.duration ?? 0,
    destLatLng,
  };

  if (summary) {
    navSummaryStats.textContent = `${formatDistance(summary.distance)} • ${formatDuration(summary.duration)} walk`;
    navSummary.classList.remove('hidden');
  }

  navInstructions.innerHTML = '';
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = 'nav-step';
    li.id = `nav-step-${i}`;

    const badge = document.createElement('span');
    badge.className = 'nav-step-badge';
    badge.textContent = String(i + 1);

    const body = document.createElement('div');
    body.className = 'nav-step-body';
    const text = document.createElement('p');
    text.className = 'nav-step-text';
    text.textContent = `${step.instruction}${stepRoadSuffix(step)}`;
    const dist = document.createElement('p');
    dist.className = 'nav-step-distance';
    dist.textContent = formatDistance(step.distance);
    body.appendChild(text);
    body.appendChild(dist);

    li.appendChild(badge);
    li.appendChild(body);
    navInstructions.appendChild(li);
  });
}

function highlightActiveStep(index) {
  navInstructions.querySelectorAll('.nav-step').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  const activeEl = document.getElementById(`nav-step-${index}`);
  activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function calculateRoute(start, dest) {
  if (!guidanceActive) {
    navStatus.textContent = 'Calculating route…';
    navInstructions.innerHTML = '';
  }

  const blockers = getBlockers();
  const avoidPolygons = buildAvoidPolygons(blockers);

  let result;
  try {
    result = await requestRoute(start, dest, avoidPolygons);
  } catch (err) {
    console.error('ORS request failed', err);
    reportRouteFailure("Couldn't calculate a route right now. Try again in a moment.");
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
        reportRouteFailure('No route could be found to this destination.');
        return;
      }
      if (retry.ok && retry.json.features?.length) {
        onRouteReady(retry.json.features[0], dest, 'This route may cross a reported blocker — no clear path was found around it.');
        return;
      }
      reportRouteFailure('No route could be found to this destination.');
      return;
    }

    if (pointNotFound) {
      reportRouteFailure('No route could be found to this destination.');
      return;
    }

    console.error('ORS error', result.json);
    reportRouteFailure("Couldn't calculate a route right now. Try again in a moment.");
    return;
  }

  if (!result.json.features?.length) {
    reportRouteFailure('No route could be found to this destination.');
    return;
  }

  onRouteReady(result.json.features[0], dest, 'Route ready.');
}

function reportRouteFailure(message) {
  if (guidanceActive) {
    // Mid-walk, don't derail into destination re-picking — just surface the
    // error and let the next GPS fix retry the reroute.
    navLiveInstruction.textContent = message;
    reroutingInFlight = false;
    return;
  }
  navStatus.textContent = message;
  armDestinationTap();
}

function onRouteReady(feature, destLatLng, statusMessage) {
  drawRoute(feature, destLatLng);
  navMode = 'routed';
  reroutingInFlight = false;

  if (guidanceActive) {
    currentStepIndex = 0;
    offRouteStrikes = 0;
    notifiedBlockerIds = new Set();
    highlightActiveStep(0);
    updateLiveBannerForStep(0);
    if (lastFix) updateLiveDistances(nearestPointOnPath(lastFix, currentRoute.path)?.alongMeters ?? 0);
    return;
  }

  navStatus.textContent = statusMessage;
  navActionBtn.textContent = 'Stop navigation';
  navActionBtn.classList.remove('btn-primary');
  navActionBtn.classList.add('btn-secondary');
  navStartBtn.classList.remove('hidden');
}

// --- Live guidance -------------------------------------------------------

function updateLiveBannerForStep(index) {
  const step = currentRoute.steps[index];
  if (!step) return;
  navLiveIcon.textContent = maneuverIcon(step.type);
  navLiveInstruction.textContent = `${step.instruction}${stepRoadSuffix(step)}`;
  navLiveDistance.textContent = formatDistance(step.distance);
  highlightActiveStep(index);
}

function advanceStepIfNeeded(alongMeters) {
  const steps = currentRoute.steps;
  let advanced = false;
  while (
    currentStepIndex < steps.length - 1 &&
    alongMeters >= currentRoute.cumulative[steps[currentStepIndex].endIdx] - STEP_ADVANCE_MARGIN_METERS
  ) {
    currentStepIndex++;
    advanced = true;
  }
  if (advanced) updateLiveBannerForStep(currentStepIndex);
}

function updateLiveDistances(alongMeters) {
  const step = currentRoute.steps[currentStepIndex];
  if (!step) return;
  const distanceToManeuver = Math.max(0, currentRoute.cumulative[step.endIdx] - alongMeters);
  navLiveDistance.textContent = formatDistance(distanceToManeuver);
}

function checkBlockersAhead(alongMeters) {
  if (reroutingInFlight) return;
  const blockers = getBlockers();
  for (const blocker of blockers) {
    if (notifiedBlockerIds.has(blocker.id)) continue;
    const proj = nearestPointOnPath([blocker.lat, blocker.lng], currentRoute.path);
    if (!proj) continue;
    const isAhead = proj.alongMeters > alongMeters;
    const isNear = proj.distanceMeters < BLOCK_RADIUS_METERS;
    const isSoon = proj.alongMeters - alongMeters < BLOCKER_AHEAD_WINDOW_METERS;
    if (isAhead && isNear && isSoon) {
      notifiedBlockerIds.add(blocker.id);
      rerouteFrom(lastFix, 'New blocker ahead — rerouting…');
      return;
    }
  }
}

function rerouteFrom(fromLatLng, message) {
  if (!currentRoute || reroutingInFlight) return;
  reroutingInFlight = true;
  navLiveInstruction.textContent = message;
  calculateRoute(fromLatLng, currentRoute.destLatLng);
}

function userPuckIcon(heading) {
  const hasHeading = typeof heading === 'number' && !Number.isNaN(heading);
  const style = hasHeading ? ` style="--nav-heading:${heading}deg"` : '';
  return L.divIcon({
    className: '',
    html: `<div class="nav-user-puck${hasHeading ? ' has-heading' : ''}"${style}></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function updateUserMarker(latlng, accuracyMeters, heading) {
  const icon = userPuckIcon(heading);
  if (!userMarker) {
    userMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
    userMarker.setIcon(icon);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latlng, { radius: accuracyMeters || 0, color: '#1A73E8', weight: 1, fillOpacity: 0.08 }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latlng);
    accuracyCircle.setRadius(accuracyMeters || 0);
  }
}

function handleMapDragStart() {
  if (!guidanceActive) return;
  followMode = false;
  navRecenterBtn.classList.remove('hidden');
}

function recenterOnUser() {
  followMode = true;
  navRecenterBtn.classList.add('hidden');
  if (lastFix) map.setView(lastFix, Math.max(map.getZoom(), 17));
}

function showArrival() {
  navLiveIcon.textContent = 'flag';
  navLiveInstruction.textContent = 'You have arrived.';
  navLiveDistance.textContent = '0 m';
  navStatus.textContent = 'You have arrived at your destination.';
  stopGuidance();
}

function handlePositionUpdate(pos) {
  const latlng = [pos.coords.latitude, pos.coords.longitude];
  const heading = pos.coords.heading;
  const previousFix = lastFix;
  lastFix = latlng;

  updateUserMarker(latlng, pos.coords.accuracy, typeof heading === 'number' ? heading : previousFix ? bearingDegrees(previousFix, latlng) : null);

  if (followMode) map.setView(latlng, Math.max(map.getZoom(), 17));

  if (!currentRoute || reroutingInFlight) return;

  if (haversineMeters(latlng, currentRoute.destLatLng) < ARRIVE_METERS) {
    showArrival();
    return;
  }

  const proj = nearestPointOnPath(latlng, currentRoute.path);
  if (!proj) return;

  if (proj.distanceMeters > OFF_ROUTE_METERS) {
    offRouteStrikes++;
    if (offRouteStrikes >= OFF_ROUTE_STRIKES_LIMIT) {
      rerouteFrom(latlng, 'Rerouting…');
    }
    return;
  }
  offRouteStrikes = 0;

  advanceStepIfNeeded(proj.alongMeters);
  updateLiveDistances(proj.alongMeters);
  checkBlockersAhead(proj.alongMeters);
}

function handlePositionError(err) {
  console.error('watchPosition error', err);
}

async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch (err) {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function startGuidance() {
  if (!currentRoute || !navigator.geolocation) return;

  guidanceActive = true;
  currentStepIndex = 0;
  offRouteStrikes = 0;
  reroutingInFlight = false;
  followMode = true;
  notifiedBlockerIds = new Set();

  document.body.classList.add('nav-live');
  navLiveBanner.classList.remove('hidden');
  navStartBtn.classList.add('hidden');
  updateLiveBannerForStep(0);
  requestWakeLock();

  watchId = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
}

function stopGuidance() {
  if (!guidanceActive && watchId === null) return;

  guidanceActive = false;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  releaseWakeLock();

  if (userMarker) {
    map.removeLayer(userMarker);
    userMarker = null;
  }
  if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }

  document.body.classList.remove('nav-live');
  navLiveBanner.classList.add('hidden');
  navRecenterBtn.classList.add('hidden');

  followMode = true;
  lastFix = null;
  currentStepIndex = 0;
  offRouteStrikes = 0;
  reroutingInFlight = false;
  notifiedBlockerIds = new Set();
}
