// Pure lat/lng geometry helpers for live navigation tracking.
// All points are [lat, lng]. Distances use a local equirectangular
// approximation (same trick as buildCirclePolygon in navigation.js) since
// route legs are city-block scale, not long enough for that to matter.

function metersPerDegree(lat) {
  const latRad = (lat * Math.PI) / 180;
  return {
    lat: 111320,
    lng: 111320 * Math.cos(latRad),
  };
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a, b) {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

// Prefix sum of cumulative distance (meters) along a [lat,lng] path.
// cumulative[i] = distance from path[0] to path[i].
export function cumulativeDistances(path) {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  return cumulative;
}

// Converts a lat/lng point to a local flat-plane [x, y] in meters, relative
// to `origin`, for cheap 2D projection math.
function toLocalXY(point, origin, mpd) {
  return [(point[1] - origin[1]) * mpd.lng, (point[0] - origin[0]) * mpd.lat];
}

// Projects `latlng` onto the polyline `path`, returning the closest point on
// the path, which segment it falls on, how far along the whole path that is,
// and the perpendicular (cross-track) distance from `latlng` to the path.
export function nearestPointOnPath(latlng, path) {
  if (!path.length) return null;
  if (path.length === 1) {
    return {
      segmentIndex: 0,
      point: path[0],
      alongMeters: 0,
      distanceMeters: haversineMeters(latlng, path[0]),
    };
  }

  const mpd = metersPerDegree(latlng[0]);
  const p = toLocalXY(latlng, latlng, mpd); // always [0, 0]
  const cumulative = cumulativeDistances(path);

  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = toLocalXY(path[i], latlng, mpd);
    const b = toLocalXY(path[i + 1], latlng, mpd);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const segLenSq = abx * abx + aby * aby;
    let t = segLenSq === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a[0] + t * abx;
    const projY = a[1] + t * aby;
    const dist = Math.hypot(p[0] - projX, p[1] - projY);

    if (!best || dist < best.distanceMeters) {
      const segLen = cumulative[i + 1] - cumulative[i];
      best = {
        segmentIndex: i,
        point: [
          path[i][0] + t * (path[i + 1][0] - path[i][0]),
          path[i][1] + t * (path[i + 1][1] - path[i][1]),
        ],
        alongMeters: cumulative[i] + t * segLen,
        distanceMeters: dist,
      };
    }
  }
  return best;
}
