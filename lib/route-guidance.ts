import * as THREE from "three";

export const VISITOR_SPEED_METERS_PER_SECOND = 1.35;

export type RouteWorldPoint = [number, number, number];

export type RouteMetrics = {
  points: THREE.Vector3[];
  cumulativeDistances: number[];
  totalDistance: number;
};

export type RoutePlaybackSnapshot = {
  distance: number;
  progress: number;
  segmentIndex: number;
  position: RouteWorldPoint;
  direction: RouteWorldPoint;
};

export type RouteGuidance = {
  kind: "straight" | "left" | "right" | "arrive";
  label: string;
  distance: number;
};

export function createRouteMetrics(
  sourcePoints: RouteWorldPoint[],
): RouteMetrics | null {
  const points = sourcePoints
    .map((point) => new THREE.Vector3(...point))
    .filter(
      (point, index, collection) =>
        index === 0 || point.distanceToSquared(collection[index - 1]) > 0.000001,
    );
  if (points.length < 2) return null;

  const cumulativeDistances = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1] +
        points[index].distanceTo(points[index - 1]),
    );
  }
  return {
    points,
    cumulativeDistances,
    totalDistance: cumulativeDistances.at(-1) ?? 0,
  };
}

export function sampleRouteAtDistance(
  metrics: RouteMetrics,
  requestedDistance: number,
) {
  const distance = THREE.MathUtils.clamp(
    requestedDistance,
    0,
    metrics.totalDistance,
  );
  let segmentIndex = Math.max(0, metrics.points.length - 2);
  for (let index = 0; index < metrics.cumulativeDistances.length - 1; index += 1) {
    if (distance <= metrics.cumulativeDistances[index + 1]) {
      segmentIndex = index;
      break;
    }
  }

  const startDistance = metrics.cumulativeDistances[segmentIndex];
  const endDistance = metrics.cumulativeDistances[segmentIndex + 1];
  const segmentLength = Math.max(endDistance - startDistance, 0.000001);
  const alpha = THREE.MathUtils.clamp(
    (distance - startDistance) / segmentLength,
    0,
    1,
  );
  const start = metrics.points[segmentIndex];
  const end = metrics.points[segmentIndex + 1];
  const point = start.clone().lerp(end, alpha);
  const direction = end.clone().sub(start);
  direction.y = 0;
  if (direction.lengthSq() < 0.000001) direction.set(0, 0, 1);
  direction.normalize();
  return { distance, segmentIndex, point, direction };
}

export function createPlaybackSnapshot(
  metrics: RouteMetrics,
  distance: number,
): RoutePlaybackSnapshot {
  const sample = sampleRouteAtDistance(metrics, distance);
  return {
    distance: sample.distance,
    progress:
      metrics.totalDistance > 0 ? sample.distance / metrics.totalDistance : 1,
    segmentIndex: sample.segmentIndex,
    position: sample.point.toArray() as RouteWorldPoint,
    direction: sample.direction.toArray() as RouteWorldPoint,
  };
}

export function getRouteGuidance(
  metrics: RouteMetrics,
  requestedDistance: number,
): RouteGuidance {
  const sample = sampleRouteAtDistance(metrics, requestedDistance);
  const remaining = Math.max(metrics.totalDistance - sample.distance, 0);
  if (remaining <= 1.4) {
    return { kind: "arrive", label: "Tujuan di depan", distance: remaining };
  }

  for (
    let index = sample.segmentIndex + 1;
    index < metrics.points.length - 1;
    index += 1
  ) {
    const before = metrics.points[index]
      .clone()
      .sub(metrics.points[index - 1]);
    const after = metrics.points[index + 1]
      .clone()
      .sub(metrics.points[index]);
    before.y = 0;
    after.y = 0;
    if (before.lengthSq() < 0.04 || after.lengthSq() < 0.04) continue;
    before.normalize();
    after.normalize();
    const angle = THREE.MathUtils.radToDeg(before.angleTo(after));
    if (angle < 28) continue;

    const maneuverDistance = Math.max(
      metrics.cumulativeDistances[index] - sample.distance,
      0,
    );
    const crossY = before.z * after.x - before.x * after.z;
    return {
      kind: crossY >= 0 ? "right" : "left",
      label: crossY >= 0 ? "Belok kanan" : "Belok kiri",
      distance: maneuverDistance,
    };
  }

  return { kind: "straight", label: "Lurus", distance: remaining };
}
