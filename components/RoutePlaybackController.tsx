"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  createPlaybackSnapshot,
  sampleRouteAtDistance,
  VISITOR_SPEED_METERS_PER_SECOND,
  type RouteMetrics,
  type RoutePlaybackSnapshot,
} from "@/lib/route-guidance";

type RoutePlaybackControllerProps = {
  metrics: RouteMetrics | null;
  active: boolean;
  paused: boolean;
  viewMode: "map" | "pov";
  restartToken: number;
  recenterToken: number;
  onProgress: (snapshot: RoutePlaybackSnapshot) => void;
  onComplete: () => void;
};

export function RoutePlaybackController({
  metrics,
  active,
  paused,
  viewMode,
  restartToken,
  recenterToken,
  onProgress,
  onComplete,
}: RoutePlaybackControllerProps) {
  const { camera, invalidate } = useThree();
  const traveledDistance = useRef(0);
  const lastPublishedAt = useRef(0);
  const completed = useRef(false);

  const placeCamera = useCallback(
    (distance: number) => {
      if (!metrics || !(camera instanceof THREE.PerspectiveCamera)) return;
      const current = sampleRouteAtDistance(metrics, distance);
      const ahead = sampleRouteAtDistance(
        metrics,
        Math.min(distance + 1.8, metrics.totalDistance),
      );
      const forward = ahead.point.clone().sub(current.point);
      forward.y = 0;
      if (forward.lengthSq() < 0.000001) forward.copy(current.direction);
      forward.normalize();

      const eye = current.point.clone();
      eye.y = Math.max(current.point.y + 1.53, 1.65);
      const lookTarget = eye.clone().add(forward.multiplyScalar(7));
      lookTarget.y = eye.y - 0.08;
      camera.position.copy(eye);
      camera.near = 0.05;
      camera.updateProjectionMatrix();
      camera.lookAt(lookTarget);
    },
    [camera, metrics],
  );

  const publish = useCallback(
    (force = false) => {
      if (!metrics) return;
      const now = performance.now();
      if (!force && now - lastPublishedAt.current < 100) return;
      lastPublishedAt.current = now;
      onProgress(createPlaybackSnapshot(metrics, traveledDistance.current));
    },
    [metrics, onProgress],
  );

  useEffect(() => {
    if (!metrics || !active) return;
    traveledDistance.current = 0;
    completed.current = false;
    placeCamera(0);
    publish(true);
    invalidate();
  }, [active, invalidate, metrics, placeCamera, publish, restartToken]);

  useEffect(() => {
    if (!metrics || !active || viewMode !== "pov") return;
    placeCamera(traveledDistance.current);
    publish(true);
    invalidate();
  }, [
    active,
    invalidate,
    metrics,
    placeCamera,
    publish,
    recenterToken,
    viewMode,
  ]);

  useFrame((_state, delta) => {
    if (!metrics || !active || paused || viewMode !== "pov") return;
    traveledDistance.current = Math.min(
      traveledDistance.current +
        Math.min(delta, 0.1) * VISITOR_SPEED_METERS_PER_SECOND,
      metrics.totalDistance,
    );
    placeCamera(traveledDistance.current);
    publish();

    if (
      traveledDistance.current >= metrics.totalDistance &&
      !completed.current
    ) {
      completed.current = true;
      publish(true);
      onComplete();
      return;
    }
    invalidate();
  });

  return null;
}
