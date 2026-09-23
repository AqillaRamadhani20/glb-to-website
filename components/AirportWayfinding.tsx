"use client";

import {
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useProgress } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  Box,
  Bug,
  ChevronRight,
  Crosshair,
  Flag,
  Info,
  LocateFixed,
  MapPin,
  Minus,
  MousePointer2,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Search,
  X,
} from "lucide-react";
import * as THREE from "three";
import {
  SceneModel,
  type SceneBounds,
  type SceneObjectRecord,
} from "@/components/SceneModel";
import { NavigationLayer } from "@/components/NavigationLayer";
import { RouteNavigationHud } from "@/components/RouteNavigationHud";
import { RoutePlaybackController } from "@/components/RoutePlaybackController";
import {
  DEBUG_NAVIGATION,
  calibrateSvgToWorld,
  findNearestRoutableNode,
  findPoiCandidates,
  findShortestPath,
  getRouteSvgPoints,
  parseNavigationSvg,
  svgToWorld,
  worldToSvg,
  type NavigationGraph,
  type NavigationNode,
  type ShortestPathResult,
  type SvgWorldTransform,
} from "@/lib/navigation-graph";
import {
  createPlaybackSnapshot,
  createRouteMetrics,
  getRouteGuidance,
  type RoutePlaybackSnapshot,
} from "@/lib/route-guidance";
import {
  createSelectedObject,
  type SelectedObject,
} from "@/lib/object-metadata";

type ViewerApi = {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusObject: (object: THREE.Object3D) => void;
  focusPoint: (point: THREE.Vector3) => void;
  focusRoute: (points: THREE.Vector3[]) => void;
  visitorPov: (point: THREE.Vector3, direction: THREE.Vector3) => void;
};

type CameraMode = "map" | "pov";

type RouteState = {
  result: ShortestPathResult | null;
  destinationNodeId: string | null;
  resolution: "semantic POI" | "nearest valid node" | null;
  message: string;
};

const CameraController = forwardRef<
  ViewerApi,
  { bounds: SceneBounds | null; viewMode: CameraMode }
>(function CameraController({ bounds, viewMode }, ref) {
    const { camera, invalidate, size: viewportSize } = useThree();
    const controlsRef = useRef<OrbitControlsImpl>(null);

    const getFitDistance = useCallback(
      (box: THREE.Box3, viewDirection: THREE.Vector3, margin: number) => {
        if (!(camera instanceof THREE.PerspectiveCamera)) return 1;
        const center = box.getCenter(new THREE.Vector3());
        const direction = viewDirection.clone().normalize();
        const forward = direction.clone().multiplyScalar(-1);
        const right = forward.clone().cross(camera.up).normalize();
        const viewUp = right.clone().cross(forward).normalize();
        const tanVertical = Math.tan(
          THREE.MathUtils.degToRad(camera.fov * 0.5),
        );
        const aspect = viewportSize.width / Math.max(viewportSize.height, 1);
        const tanHorizontal = tanVertical * aspect;
        let requiredDistance = 0;

        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const relative = new THREE.Vector3(x, y, z).sub(center);
              const outwardDepth = relative.dot(direction);
              const horizontal = Math.abs(relative.dot(right));
              const vertical = Math.abs(relative.dot(viewUp));
              requiredDistance = Math.max(
                requiredDistance,
                outwardDepth + horizontal / tanHorizontal,
                outwardDepth + vertical / tanVertical,
              );
            }
          }
        }
        return Math.max(requiredDistance * margin, 0.01);
      },
      [camera, viewportSize.height, viewportSize.width],
    );

    const fitView = useCallback(() => {
      if (
        !bounds ||
        !(camera instanceof THREE.PerspectiveCamera) ||
        !controlsRef.current
      ) {
        return;
      }
      const direction = new THREE.Vector3(0, 1, 0.55).normalize();
      const distance = getFitDistance(bounds.box, direction, 1.1);
      camera.position.copy(bounds.center).add(direction.multiplyScalar(distance));
      camera.near = Math.max(bounds.radius / 10000, 0.001);
      camera.far = Math.max(bounds.radius * 30, 1000);
      camera.updateProjectionMatrix();
      controlsRef.current.target.copy(bounds.center);
      controlsRef.current.minDistance = Math.max(bounds.radius * 0.015, 0.01);
      controlsRef.current.maxDistance = Math.max(bounds.radius * 12, 100);
      controlsRef.current.update();
      invalidate();
    }, [bounds, camera, getFitDistance, invalidate]);

    const zoomBy = useCallback(
      (factor: number) => {
        if (!controlsRef.current) return;
        const target = controlsRef.current.target;
        const offset = camera.position.clone().sub(target);
        const nextDistance = THREE.MathUtils.clamp(
          offset.length() * factor,
          controlsRef.current.minDistance,
          controlsRef.current.maxDistance,
        );
        camera.position
          .copy(target)
          .add(offset.normalize().multiplyScalar(nextDistance));
        controlsRef.current.update();
        invalidate();
      },
      [camera, invalidate],
    );

    const focusObject = useCallback(
      (object: THREE.Object3D) => {
        if (
          !controlsRef.current ||
          !(camera instanceof THREE.PerspectiveCamera)
        ) {
          return;
        }
        object.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const direction = camera.position
          .clone()
          .sub(controlsRef.current.target)
          .normalize();
        const minFocusDistance = bounds ? bounds.radius * 0.025 : 1;
        const distance = Math.max(
          getFitDistance(box, direction, 1.5),
          minFocusDistance,
        );
        controlsRef.current.target.copy(center);
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        controlsRef.current.update();
        invalidate();
      },
      [bounds, camera, getFitDistance, invalidate],
    );

    const focusPoint = useCallback(
      (point: THREE.Vector3) => {
        if (!controlsRef.current || !(camera instanceof THREE.PerspectiveCamera)) {
          return;
        }
        const direction = new THREE.Vector3(0, 1, 0.62).normalize();
        const distance = Math.max(bounds ? bounds.radius * 0.1 : 12, 8);
        controlsRef.current.target.copy(point);
        camera.position.copy(point).add(direction.multiplyScalar(distance));
        controlsRef.current.update();
        invalidate();
      },
      [bounds, camera, invalidate],
    );

    const focusRoute = useCallback(
      (points: THREE.Vector3[]) => {
        if (
          !points.length ||
          !controlsRef.current ||
          !(camera instanceof THREE.PerspectiveCamera)
        ) {
          return;
        }
        const box = new THREE.Box3().setFromPoints(points);
        box.expandByVector(new THREE.Vector3(2, 2.5, 2));
        const center = box.getCenter(new THREE.Vector3());
        const direction = new THREE.Vector3(0, 1, 0.68).normalize();
        const minimumDistance = bounds ? bounds.radius * 0.04 : 8;
        const distance = Math.max(
          getFitDistance(box, direction, 1.28),
          minimumDistance,
        );
        controlsRef.current.target.copy(center);
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        controlsRef.current.update();
        invalidate();
      },
      [bounds, camera, getFitDistance, invalidate],
    );

    const visitorPov = useCallback(
      (point: THREE.Vector3, direction: THREE.Vector3) => {
        if (!controlsRef.current || !(camera instanceof THREE.PerspectiveCamera)) {
          return;
        }
        const forward = direction.clone();
        forward.y = 0;
        if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
        forward.normalize();
        const eye = point.clone();
        eye.y = Math.max(point.y + 1.53, 1.65);
        const target = eye.clone().add(forward.multiplyScalar(8));
        camera.position.copy(eye);
        camera.near = 0.05;
        camera.updateProjectionMatrix();
        controlsRef.current.target.copy(target);
        controlsRef.current.update();
        camera.lookAt(target);
        invalidate();
      },
      [camera, invalidate],
    );

    useEffect(() => {
      fitView();
    }, [fitView]);

    useImperativeHandle(
      ref,
      () => ({
        resetView: fitView,
        zoomIn: () => zoomBy(0.78),
        zoomOut: () => zoomBy(1.28),
        focusObject,
        focusPoint,
        focusRoute,
        visitorPov,
      }),
      [fitView, focusObject, focusPoint, focusRoute, visitorPov, zoomBy],
    );

    return (
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={viewMode === "map"}
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableRotate
        enableZoom
        screenSpacePanning
        panSpeed={1.15}
        rotateSpeed={0.5}
        zoomSpeed={0.9}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        touches={{
          ONE: THREE.TOUCH.PAN,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
      />
    );
  },
);

function LoadingOverlay() {
  const { progress, active } = useProgress();
  if (!active && progress >= 100) return null;
  return (
    <div className="loading-overlay" aria-live="polite">
      <div className="loader-mark">
        <Box size={22} strokeWidth={1.6} />
      </div>
      <div className="loader-copy">
        <span>MEMUAT GROUND FLOOR</span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div className="loader-track">
        <div style={{ width: progress + "%" }} />
      </div>
    </div>
  );
}

function Coordinate({ label, value }: { label: string; value: number }) {
  return (
    <div className="coordinate">
      <span>{label}</span>
      <strong>{value.toFixed(2)}</strong>
    </div>
  );
}

function nodeLabel(node: NavigationNode | undefined) {
  if (!node) return "Belum tersedia";
  return node.semanticName
    ? node.semanticName + " / " + node.id
    : node.id;
}

export function AirportWayfinding() {
  const viewerApi = useRef<ViewerApi>(null);
  const [bounds, setBounds] = useState<SceneBounds | null>(null);
  const [objects, setObjects] = useState<SceneObjectRecord[]>([]);
  const [selected, setSelected] = useState<SelectedObject | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [graph, setGraph] = useState<NavigationGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [debugNavigation, setDebugNavigation] = useState(DEBUG_NAVIGATION);
  const [startNodeId, setStartNodeId] = useState<string | null>(null);
  const [selectingStart, setSelectingStart] = useState(false);
  const [viewMode, setViewMode] = useState<CameraMode>("map");
  const [routeState, setRouteState] = useState<RouteState>({
    result: null,
    destinationNodeId: null,
    resolution: null,
    message: "Pilih posisi awal terlebih dahulu.",
  });
  const [routePaused, setRoutePaused] = useState(false);
  const [routeProgress, setRouteProgress] =
    useState<RoutePlaybackSnapshot | null>(null);
  const [routeRestartToken, setRouteRestartToken] = useState(0);
  const [routeRecenterToken, setRouteRecenterToken] = useState(0);
  const handleReady = useCallback(
    (nextBounds: SceneBounds, nextObjects: SceneObjectRecord[]) => {
      setBounds(nextBounds);
      setObjects(nextObjects);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/navigation/navigation-graph-ground-floor.svg", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Navigation SVG gagal dimuat: " + response.status);
        }
        return response.text();
      })
      .then((svgText) => {
        setGraph(parseNavigationSvg(svgText));
        setGraphError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGraphError(
          error instanceof Error ? error.message : "Navigation SVG gagal diproses.",
        );
      });
    return () => controller.abort();
  }, []);

  const selectableBuildings = useMemo(
    () => objects.filter((record) => record.selectable),
    [objects],
  );

  const navigationTransform = useMemo<SvgWorldTransform | null>(() => {
    if (!graph || !bounds || !selectableBuildings.length) return null;
    const anchors = selectableBuildings.map((record) => {
      record.object.updateWorldMatrix(true, false);
      const center = new THREE.Box3()
        .setFromObject(record.object)
        .getCenter(new THREE.Vector3());
      return { name: record.name, worldX: center.x, worldZ: center.z };
    });
    return calibrateSvgToWorld(graph, anchors, {
      centerX: bounds.center.x,
      centerZ: bounds.center.z,
      sizeX: bounds.size.x,
      sizeZ: bounds.size.z,
      floorY: bounds.box.min.y,
    });
  }, [bounds, graph, selectableBuildings]);

  const routeWorldPoints = useMemo(() => {
    if (!graph || !navigationTransform || !routeState.result) return [];
    return getRouteSvgPoints(graph, routeState.result).map((point) =>
      svgToWorld(point, navigationTransform),
    );
  }, [graph, navigationTransform, routeState.result]);

  const routeMetrics = useMemo(
    () => createRouteMetrics(routeWorldPoints),
    [routeWorldPoints],
  );
  const routeSessionActive = Boolean(routeState.result && routeMetrics);
  const visibleRouteProgress = useMemo(
    () =>
      routeProgress ??
      (routeMetrics ? createPlaybackSnapshot(routeMetrics, 0) : null),
    [routeMetrics, routeProgress],
  );
  const routeGuidance = useMemo(
    () =>
      routeMetrics && visibleRouteProgress
        ? getRouteGuidance(routeMetrics, visibleRouteProgress.distance)
        : null,
    [routeMetrics, visibleRouteProgress],
  );

  const selectedRecord = useMemo(
    () => objects.find((record) => record.uuid === selected?.uuid) ?? null,
    [objects, selected?.uuid],
  );

  const calculateRoute = useCallback(
    (record: SceneObjectRecord) => {
      if (!startNodeId) {
        setRouteProgress(null);
        setRouteState({
          result: null,
          destinationNodeId: null,
          resolution: null,
          message: "Pilih posisi awal terlebih dahulu.",
        });
        return;
      }
      if (!graph || !navigationTransform) return;
      const semanticCandidates = findPoiCandidates(graph, record.name).filter(
        (node) => (graph.adjacency.get(node.id)?.length ?? 0) > 0,
      );
      let candidates = semanticCandidates;
      let resolution: RouteState["resolution"] = "semantic POI";

      if (!candidates.length) {
        record.object.updateWorldMatrix(true, false);
        const center = new THREE.Box3()
          .setFromObject(record.object)
          .getCenter(new THREE.Vector3());
        const nearest = findNearestRoutableNode(
          graph,
          worldToSvg(center.x, center.z, navigationTransform),
        );
        candidates = nearest ? [nearest] : [];
        resolution = "nearest valid node";
      }

      const routes = candidates
        .map((candidate) => ({
          destination: candidate,
          result: findShortestPath(graph, startNodeId, candidate.id),
        }))
        .filter(
          (
            item,
          ): item is { destination: NavigationNode; result: ShortestPathResult } =>
            Boolean(item.result),
        )
        .sort((a, b) => a.result.totalWeight - b.result.totalWeight);
      const best = routes[0];

      if (!best) {
        setRouteProgress(null);
        setRoutePaused(false);
        setRouteState({
          result: null,
          destinationNodeId: candidates[0]?.id ?? null,
          resolution,
          message: "Tidak ada koneksi graph asli dari titik awal ke tujuan ini.",
        });
        return;
      }

      setRouteState({
        result: best.result,
        destinationNodeId: best.destination.id,
        resolution,
        message: "Rute mengikuti edge asli NAVIGATION_GRAPH (2).svg.",
      });
      setRouteProgress(null);
      setRoutePaused(false);
      setViewMode("pov");
      setRouteRestartToken((value) => value + 1);
    },
    [graph, navigationTransform, startNodeId],
  );

  const handleSelect = useCallback((selection: SelectedObject) => {
    setSelected(selection);
    setRouteProgress(null);
    setRoutePaused(false);
    setRouteState({
      result: null,
      destinationNodeId: null,
      resolution: null,
      message: startNodeId
        ? "Tekan Route Here untuk menghitung rute."
        : "Pilih posisi awal terlebih dahulu.",
    });
  }, [startNodeId]);

  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
    if (!normalizedQuery) return [];
    return selectableBuildings
      .filter((item) =>
        item.name.toLocaleLowerCase("id-ID").includes(normalizedQuery),
      )
      .slice(0, 8);
  }, [query, selectableBuildings]);

  const chooseSearchResult = (record: SceneObjectRecord) => {
    setSelected(createSelectedObject(record.object));
    setRouteProgress(null);
    setRoutePaused(false);
    setRouteState({
      result: null,
      destinationNodeId: null,
      resolution: null,
      message: startNodeId
        ? "Tekan Route Here untuk menghitung rute."
        : "Pilih posisi awal terlebih dahulu.",
    });
    setQuery(record.name);
    setSearchFocused(false);
    viewerApi.current?.focusObject(record.object);
  };

  const beginStartSelection = useCallback(() => {
    setSelectingStart(true);
    setViewMode("map");
    setRouteProgress(null);
    setRoutePaused(false);
    setRouteState({
      result: null,
      destinationNodeId: null,
      resolution: null,
      message: "Klik node atau POI yang tampil pada map.",
    });
  }, []);

  const selectStartNode = useCallback(
    (nodeId: string) => {
      if (!graph || !navigationTransform) return;
      const node = graph.nodeById.get(nodeId);
      if (!node || !(graph.adjacency.get(nodeId)?.length)) return;
      setStartNodeId(nodeId);
      setSelectingStart(false);
      setViewMode("map");
      setRouteProgress(null);
      setRoutePaused(false);
      setRouteState({
        result: null,
        destinationNodeId: null,
        resolution: null,
        message: selectedRecord
          ? "Titik awal tersimpan. Tekan Route Here."
          : "Titik awal tersimpan. Pilih building tujuan.",
      });
      const [x, y, z] = svgToWorld(node, navigationTransform);
      viewerApi.current?.focusPoint(new THREE.Vector3(x, y, z));
    },
    [graph, navigationTransform, selectedRecord],
  );

  const showVisitorPov = useCallback(() => {
    if (routeSessionActive) {
      setViewMode("pov");
      setRouteRecenterToken((value) => value + 1);
      return;
    }
    if (!graph || !navigationTransform || !startNodeId) return;
    const start = graph.nodeById.get(startNodeId);
    if (!start) return;
    const routeNextId = routeState.result?.nodeIds[1];
    const adjacencyNextId = graph.adjacency.get(startNodeId)?.[0]?.nodeId;
    const next = graph.nodeById.get(routeNextId ?? adjacencyNextId ?? "");
    if (!next) return;
    const startWorld = new THREE.Vector3(...svgToWorld(start, navigationTransform));
    const nextWorld = new THREE.Vector3(...svgToWorld(next, navigationTransform));
    setViewMode("pov");
    viewerApi.current?.visitorPov(
      startWorld,
      nextWorld.clone().sub(startWorld),
    );
  }, [
    graph,
    navigationTransform,
    routeSessionActive,
    routeState.result,
    startNodeId,
  ]);

  const showMapView = useCallback(() => {
    setViewMode("map");
    window.requestAnimationFrame(() => {
      if (routeMetrics) {
        viewerApi.current?.focusRoute(routeMetrics.points);
      } else {
        viewerApi.current?.resetView();
      }
    });
  }, [routeMetrics]);

  const toggleRoutePause = useCallback(() => {
    setRoutePaused((value) => !value);
  }, []);

  const recenterActiveRoute = useCallback(() => {
    if (!routeSessionActive) return;
    setViewMode("pov");
    setRouteRecenterToken((value) => value + 1);
  }, [routeSessionActive]);

  const restartActiveRoute = useCallback(() => {
    if (!routeMetrics) return;
    setRoutePaused(false);
    setRouteProgress(createPlaybackSnapshot(routeMetrics, 0));
    setViewMode("pov");
    setRouteRestartToken((value) => value + 1);
  }, [routeMetrics]);

  const endActiveRoute = useCallback(() => {
    setRouteProgress(null);
    setRoutePaused(false);
    setViewMode("map");
    setRouteState({
      result: null,
      destinationNodeId: null,
      resolution: null,
      message: startNodeId
        ? "Pilih building tujuan lalu tekan Route Here."
        : "Pilih posisi awal terlebih dahulu.",
    });
    window.requestAnimationFrame(() => viewerApi.current?.resetView());
  }, [startNodeId]);

  const handlePlaybackComplete = useCallback(() => {
    setRoutePaused(true);
  }, []);

  const resetRoute = useCallback(() => {
    setStartNodeId(null);
    setSelectingStart(false);
    setViewMode("map");
    setRouteProgress(null);
    setRoutePaused(false);
    setRouteState({
      result: null,
      destinationNodeId: null,
      resolution: null,
      message: "Pilih posisi awal terlebih dahulu.",
    });
    window.requestAnimationFrame(() => viewerApi.current?.resetView());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (
        event.key.toLocaleLowerCase("id-ID") === "r" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        showMapView();
      }
      if (
        event.key.toLocaleLowerCase("id-ID") === "d" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        setDebugNavigation((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMapView]);

  useEffect(() => {
    if (!graph || !bounds || !navigationTransform) return;
    const report = {
      glbBoundingBox: {
        min: bounds.box.min.toArray(),
        max: bounds.box.max.toArray(),
        center: bounds.center.toArray(),
        size: bounds.size.toArray(),
      },
      navigationViewBox: "0 0 22973 3300",
      graphCounts: graph.counts,
      runtimeColorCoverage: bounds.colorCoverage,
      unmatchedEdges: graph.unmatchedEdges.map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceId,
        startDistance: edge.startDistance,
        endDistance: edge.endDistance,
      })),
      svgToWorld: navigationTransform,
    };
    console.info("[Terminal 1 wayfinding audit]", report);
    (
      window as Window & { __TERMINAL_WAYFINDING_AUDIT__?: unknown }
    ).__TERMINAL_WAYFINDING_AUDIT__ = report;
  }, [bounds, graph, navigationTransform]);

  useEffect(() => {
    if (!routeMetrics || !routeState.result) return;
    const routeBounds = new THREE.Box3().setFromPoints(routeMetrics.points);
    const routeReport = {
      pointCount: routeMetrics.points.length,
      edgeCount: routeState.result.edgeIds.length,
      totalDistance: routeMetrics.totalDistance,
      first: routeMetrics.points[0]?.toArray(),
      last: routeMetrics.points.at(-1)?.toArray(),
      bounds: {
        min: routeBounds.min.toArray(),
        max: routeBounds.max.toArray(),
      },
      nodeIds: routeState.result.nodeIds,
      edgeIds: routeState.result.edgeIds,
    };
    console.info("[Terminal 1 active route audit]", routeReport);
    (
      window as Window & { __TERMINAL_ACTIVE_ROUTE_AUDIT__?: unknown }
    ).__TERMINAL_ACTIVE_ROUTE_AUDIT__ = routeReport;
  }, [routeMetrics, routeState.result]);

  const startNode = startNodeId ? graph?.nodeById.get(startNodeId) : undefined;
  const destinationNode = routeState.destinationNodeId
    ? graph?.nodeById.get(routeState.destinationNodeId)
    : undefined;
  const estimatedMeters = routeMetrics?.totalDistance ?? null;
  const destinationName =
    selected?.name ?? destinationNode?.semanticName ?? destinationNode?.id ?? "Tujuan";

  return (
    <main
      className="viewer-shell"
      data-view-mode={viewMode}
      data-start-node={startNodeId ?? ""}
      data-destination-node={routeState.destinationNodeId ?? ""}
      data-route-active={routeSessionActive ? "true" : "false"}
      data-route-paused={routePaused ? "true" : "false"}
    >
      <div className="canvas-stage">
        <Canvas
          dpr={[1, 1.75]}
          frameloop="demand"
          camera={{ fov: 36, near: 0.01, far: 100000, position: [0, 10, 10] }}
          gl={{
            antialias: true,
            alpha: true,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1;
          }}
          onPointerMissed={() => {
            if (!selectingStart) setSelected(null);
          }}
        >
          <ambientLight intensity={0.72} color="#FFFFFF" />
          <hemisphereLight
            intensity={1.05}
            color="#FFFFFF"
            groundColor="#8B949B"
          />
          <directionalLight
            position={[12, 20, 10]}
            intensity={1.85}
            color="#FFFDF7"
          />
          <directionalLight
            position={[-10, 8, -12]}
            intensity={0.52}
            color="#D9E8FF"
          />
          <Suspense fallback={null}>
            <SceneModel
              selectedUuid={selected?.uuid ?? null}
              onSelect={handleSelect}
              onReady={handleReady}
            />
            {graph && navigationTransform && (
              <NavigationLayer
                graph={graph}
                transform={navigationTransform}
                route={routeState.result}
                debug={debugNavigation}
                selectingStart={selectingStart}
                startNodeId={startNodeId}
                destinationNodeId={routeState.destinationNodeId}
                visitorPosition={visibleRouteProgress?.position ?? null}
                onSelectStart={selectStartNode}
              />
            )}
          </Suspense>
          <CameraController
            ref={viewerApi}
            bounds={bounds}
            viewMode={viewMode}
          />
          <RoutePlaybackController
            metrics={routeMetrics}
            active={routeSessionActive}
            paused={routePaused}
            viewMode={viewMode}
            restartToken={routeRestartToken}
            recenterToken={routeRecenterToken}
            onProgress={setRouteProgress}
            onComplete={handlePlaybackComplete}
          />
        </Canvas>
      </div>

      <LoadingOverlay />

      {routeSessionActive &&
        routeMetrics &&
        visibleRouteProgress &&
        routeGuidance &&
        routeState.result && (
          <RouteNavigationHud
            destinationName={destinationName}
            edgeCount={routeState.result.edgeIds.length}
            totalDistance={routeMetrics.totalDistance}
            progress={visibleRouteProgress}
            guidance={routeGuidance}
            paused={routePaused}
            onOverview={showMapView}
            onTogglePause={toggleRoutePause}
            onRecenter={recenterActiveRoute}
            onRestart={restartActiveRoute}
            onEnd={endActiveRoute}
          />
        )}

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-icon" aria-hidden="true">
            <LocateFixed size={20} strokeWidth={1.8} />
          </div>
          <div>
            <p>TERMINAL 01 / GROUND FLOOR</p>
            <h1>Indoor Wayfinding</h1>
          </div>
        </div>

        <div className="model-status">
          <span className="status-pulse" />
          <span>MAP TERBARU AKTIF</span>
          <strong>
            {objects.length || "-"} OBJEK / {selectableBuildings.length} BUILDING
          </strong>
        </div>

        <div className="camera-actions" aria-label="Kontrol kamera">
          <button
            type="button"
            className={
              "action-button debug-toggle" +
              (debugNavigation ? " is-active" : "")
            }
            onClick={() => setDebugNavigation((value) => !value)}
            title="Debug navigation (D)"
            aria-label="Toggle debug navigation"
          >
            <Bug size={16} />
          </button>
          <button
            type="button"
            className="action-button action-button-wide"
            onClick={showMapView}
            disabled={!bounds}
            title="Reset tampilan (R)"
          >
            <RotateCcw size={16} />
            <span>Reset view</span>
          </button>
          <button
            type="button"
            className="action-button"
            onClick={() => viewerApi.current?.zoomOut()}
            disabled={!bounds}
            aria-label="Zoom out"
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            className="action-button"
            onClick={() => viewerApi.current?.zoomIn()}
            disabled={!bounds}
            aria-label="Zoom in"
          >
            <Plus size={17} />
          </button>
        </div>
      </header>

      <aside className="search-panel">
        <div className="section-kicker">
          <Crosshair size={13} />
          BUILDING TO ROUTE
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            placeholder="Cari T1-GF-* atau TI-GF-*"
            aria-label="Cari building berdasarkan object.name"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSearchFocused(true);
              }}
              aria-label="Hapus pencarian"
            >
              <X size={15} />
            </button>
          )}
        </label>

        {searchFocused && query && (
          <div className="search-results">
            {searchResults.length ? (
              searchResults.map((record) => (
                <button
                  key={record.uuid}
                  type="button"
                  onMouseDown={() => chooseSearchResult(record)}
                >
                  <span
                    className="result-dot building-dot"
                    style={{ background: record.metadata.color }}
                  />
                  <span>
                    <strong>{record.name}</strong>
                    <small>{record.metadata.category}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <p className="empty-result">Building tidak ditemukan.</p>
            )}
          </div>
        )}

        <div
          className={
            "start-node-card" + (selectingStart ? " is-picking" : "")
          }
        >
          <Flag size={15} />
          <span>
            <small>TITIK AWAL</small>
            <strong>{nodeLabel(startNode)}</strong>
          </span>
        </div>

        <div className="wayfinding-actions" aria-label="Kontrol wayfinding">
          <button
            type="button"
            className={selectingStart ? "is-active" : ""}
            onClick={beginStartSelection}
            disabled={!graph || !navigationTransform}
          >
            <MapPin size={14} /> Set Start
          </button>
          <button type="button" onClick={showVisitorPov} disabled={!startNodeId}>
            <Navigation size={14} /> Visitor POV
          </button>
          <button type="button" onClick={showMapView} disabled={viewMode === "map"}>
            <LocateFixed size={14} /> Map View
          </button>
          <button
            type="button"
            onClick={resetRoute}
            disabled={!startNodeId && !routeState.destinationNodeId}
          >
            <RotateCcw size={14} /> Reset Route
          </button>
        </div>
        {!startNodeId && !selectingStart && (
          <p className="start-required-message">
            Pilih posisi awal terlebih dahulu.
          </p>
        )}
        {selectingStart && (
          <p className="start-selection-hint">
            Pilih salah satu node atau POI yang tampil pada map.
          </p>
        )}

        <div className="gesture-guide">
          <div>
            <MousePointer2 size={15} />
            <span>DRAG</span>
            <strong>Geser peta</strong>
          </div>
          <div>
            <Plus size={15} />
            <span>SCROLL / PINCH</span>
            <strong>Zoom peta</strong>
          </div>
          <div>
            <MousePointer2 size={15} className="right-click-icon" />
            <span>DRAG KANAN</span>
            <strong>Putar kamera</strong>
          </div>
        </div>
        {graphError && <p className="graph-error">{graphError}</p>}
      </aside>

      <aside
        className={"object-panel " + (selected ? "is-visible" : "")}
        aria-live="polite"
      >
        {selected ? (
          <>
            <div className="object-panel-head">
              <div
                className="selected-marker building-selected-marker"
                style={{ background: selected.color }}
              />
              <div>
                <span>BUILDING TERPILIH</span>
                <h2>{selected.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Tutup detail building"
              >
                <X size={17} />
              </button>
            </div>

            <dl className="object-details">
              <div>
                <dt>object.name</dt>
                <dd className="object-name-value">{selected.name}</dd>
              </div>
              <div>
                <dt>Kategori</dt>
                <dd>{selected.category}</dd>
              </div>
              <div>
                <dt>Informasi lokasi</dt>
                <dd>{selected.location}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="status-value">
                  <span />
                  {selected.status}
                </dd>
              </div>
            </dl>

            <div className="position-block">
              <span>POSISI DUNIA</span>
              <div className="coordinates">
                <Coordinate label="X" value={selected.position[0]} />
                <Coordinate label="Y" value={selected.position[1]} />
                <Coordinate label="Z" value={selected.position[2]} />
              </div>
            </div>

            <div className="route-block">
              <div className="route-block-title">
                <Route size={15} />
                <span>RUTE DIJKSTRA</span>
              </div>
              <div className="route-row">
                <small>Tujuan</small>
                <strong>{nodeLabel(destinationNode)}</strong>
              </div>
              <div className="route-row">
                <small>Resolusi</small>
                <strong>{routeState.resolution ?? "-"}</strong>
              </div>
              <div className="route-row">
                <small>Edge / jarak</small>
                <strong>
                  {routeState.result
                    ? routeState.result.edgeIds.length +
                      " edge / " +
                      (estimatedMeters?.toFixed(1) ?? "-") +
                      " m"
                    : "-"}
                </strong>
              </div>
              <p className="route-message">{routeState.message}</p>
              <div className="route-actions">
                <button
                  type="button"
                  onClick={() => selectedRecord && calculateRoute(selectedRecord)}
                  disabled={!startNodeId}
                >
                  <Route size={14} /> Route Here
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-selection">
            <Info size={19} />
            <div>
              <strong>Pilih building</strong>
              <span>Klik mesh T1-GF-* atau TI-GF-* untuk membuat rute.</span>
            </div>
          </div>
        )}
      </aside>

      {debugNavigation && graph && navigationTransform && (
        <aside className="debug-navigation-panel" aria-live="polite">
          <div className="debug-panel-title">
            <Bug size={15} />
            <strong>DEBUG NAVIGATION</strong>
          </div>
          <dl>
            <div>
              <dt>viewBox</dt>
              <dd>0 0 22973 3300</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{graph.counts.nodes}</dd>
            </div>
            <div>
              <dt>Edge</dt>
              <dd>{graph.counts.edges}</dd>
            </div>
            <div>
              <dt>POI orange</dt>
              <dd>{graph.counts.pois}</dd>
            </div>
            <div>
              <dt>Unmatched</dt>
              <dd>{graph.counts.unmatchedEdges}</dd>
            </div>
            <div>
              <dt>Material color</dt>
              <dd>
                {bounds?.colorCoverage.styledMaterialSlots ?? 0} / {" "}
                {bounds?.colorCoverage.materialSlots ?? 0}
              </dd>
            </div>
            <div>
              <dt>Axis</dt>
              <dd>X -&gt; X / Y -&gt; Z</dd>
            </div>
            <div>
              <dt>scale</dt>
              <dd>
                {navigationTransform.scaleX.toFixed(8)} / {" "}
                {navigationTransform.scaleZ.toFixed(8)}
              </dd>
            </div>
            <div>
              <dt>offset</dt>
              <dd>
                {navigationTransform.offsetX.toFixed(4)} / {" "}
                {navigationTransform.offsetZ.toFixed(4)}
              </dd>
            </div>
          </dl>
          <details>
            <summary>Unmatched edge ({graph.unmatchedEdges.length})</summary>
            <ol className="unmatched-list">
              {graph.unmatchedEdges.map((edge) => (
                <li key={edge.id}>
                  {edge.id} / {edge.sourceId}
                </li>
              ))}
            </ol>
          </details>
        </aside>
      )}

      <div className="legend-bar" aria-label="Legenda navigasi">
        <span className="legend-title">NAVIGASI</span>
        <span className="legend-item">
          <i className="legend-route" /> Rute aktif
        </span>
        <span className="legend-item">
          <i className="legend-poi" /> POI orange
        </span>
        <span className="legend-item">
          <i className="legend-node" /> Node biasa
        </span>
        <span className="legend-item">
          <i className="legend-unmatched" /> Edge gagal match
        </span>
      </div>

      <div className="coordinate-readout" aria-hidden="true">
        <span>GLB / WORLD SPACE</span>
        <strong>XZ MAP / Y-UP</strong>
      </div>
    </main>
  );
}
