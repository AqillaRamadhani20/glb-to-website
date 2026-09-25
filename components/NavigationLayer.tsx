"use client";

import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  getRouteSvgPoints,
  svgToWorld,
  type NavigationEdge,
  type NavigationGraph,
  type NavigationNode,
  type ShortestPathResult,
  type SvgWorldTransform,
} from "@/lib/navigation-graph";

type NavigationLayerProps = {
  graph: NavigationGraph;
  transform: SvgWorldTransform;
  route: ShortestPathResult | null;
  debug: boolean;
  selectingStart: boolean;
  startNodeId: string | null;
  destinationNodeId: string | null;
  visitorPosition: [number, number, number] | null;
  onSelectStart: (nodeId: string) => void;
};

function RouteSegmentBand({
  points,
  width,
  elevation,
  color,
  renderOrder,
}: {
  points: [number, number, number][];
  width: number;
  elevation: number;
  color: string;
  renderOrder: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const segments = useMemo(
    () =>
      points
        .slice(1)
        .map((point, index) => ({
          start: new THREE.Vector3(...points[index]),
          end: new THREE.Vector3(...point),
        }))
        .filter(
          ({ start, end }) =>
            Math.hypot(end.x - start.x, end.z - start.z) > 0.0001,
        ),
    [points],
  );

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const midpoint = new THREE.Vector3();
    segments.forEach(({ start, end }, index) => {
      const deltaX = end.x - start.x;
      const deltaZ = end.z - start.z;
      const length = Math.hypot(deltaX, deltaZ);
      midpoint.copy(start).lerp(end, 0.5);
      midpoint.y += elevation;
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.atan2(deltaX, deltaZ),
      );
      scale.set(width, 0.035, length + 0.12);
      matrix.compose(midpoint, quaternion, scale);
      meshRef.current?.setMatrixAt(index, matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [elevation, segments, width]);

  if (!segments.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, segments.length]}
      frustumCulled={false}
      renderOrder={renderOrder}
      raycast={() => undefined}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.98}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function RouteRibbon({
  points,
}: {
  points: [number, number, number][];
}) {
  if (points.length < 2) return null;
  return (
    <group name="ACTIVE_ROUTE_FLOOR_RIBBON">
      <RouteSegmentBand
        points={points}
        width={0.65}
        elevation={0.065}
        color="#F7FBFF"
        renderOrder={28}
      />
      <RouteSegmentBand
        points={points}
        width={0.55}
        elevation={0.095}
        color="#06A9E5"
        renderOrder={29}
      />
    </group>
  );
}

function distanceToRoute(
  position: THREE.Vector3,
  routePoints: [number, number, number][],
) {
  let closest = Number.POSITIVE_INFINITY;
  const closestPoint = new THREE.Vector3();
  const segment = new THREE.Line3();
  for (let index = 1; index < routePoints.length; index += 1) {
    segment.start.fromArray(routePoints[index - 1]);
    segment.end.fromArray(routePoints[index]);
    segment.closestPointToPoint(position, true, closestPoint);
    closest = Math.min(closest, closestPoint.distanceTo(position));
  }
  return closest;
}

function edgeSegmentPositions(
  edges: NavigationEdge[],
  transform: SvgWorldTransform,
) {
  const positions: number[] = [];
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      positions.push(
        ...svgToWorld(edge.points[index - 1], transform),
        ...svgToWorld(edge.points[index], transform),
      );
    }
  }
  return new Float32Array(positions);
}

function DebugSegments({
  edges,
  transform,
  color,
  opacity,
  renderOrder,
}: {
  edges: NavigationEdge[];
  transform: SvgWorldTransform;
  color: string;
  opacity: number;
  renderOrder: number;
}) {
  const geometry = useMemo(() => {
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(edgeSegmentPositions(edges, transform), 3),
    );
    return bufferGeometry;
  }, [edges, transform]);

  return (
    <lineSegments
      geometry={geometry}
      frustumCulled={false}
      renderOrder={renderOrder}
      raycast={() => undefined}
    >
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

function NodeInstances({
  nodes,
  transform,
  color,
  radius,
  renderOrder,
  onSelect,
  opacity = 0.96,
}: {
  nodes: NavigationNode[];
  transform: SvgWorldTransform;
  color: string;
  radius: number;
  renderOrder: number;
  onSelect?: (nodeId: string) => void;
  opacity?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    nodes.forEach((node, index) => {
      const [x, y, z] = svgToWorld(node, transform);
      matrix.makeTranslation(x, y + 0.015, z);
      meshRef.current?.setMatrixAt(index, matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [nodes, transform]);

  if (!nodes.length) return null;
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect || event.instanceId === undefined) return;
    const node = nodes[event.instanceId];
    if (!node) return;
    event.stopPropagation();
    onSelect(node.id);
  };
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, nodes.length]}
      frustumCulled={false}
      renderOrder={renderOrder}
      raycast={onSelect ? undefined : () => undefined}
      onClick={handleClick}
      onPointerOver={(event) => {
        if (!onSelect) return;
        event.stopPropagation();
        document.body.style.cursor = "crosshair";
      }}
      onPointerOut={() => {
        if (onSelect) document.body.style.cursor = "default";
      }}
    >
      <sphereGeometry args={[radius, 8, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function DebugLabels({
  nodes,
  transform,
}: {
  nodes: NavigationNode[];
  transform: SvgWorldTransform;
}) {
  return (
    <>
      {nodes.map((node) => {
        const [x, y, z] = svgToWorld(node, transform);
        return (
          <Html
            key={node.id}
            position={[x, y + 0.18, z]}
            center
            transform
            distanceFactor={22}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span
              className={
                node.kind === "poi"
                  ? "navigation-node-label is-poi"
                  : "navigation-node-label"
              }
            >
              {node.id}
            </span>
          </Html>
        );
      })}
    </>
  );
}

export function NavigationLayer({
  graph,
  transform,
  route,
  debug,
  selectingStart,
  startNodeId,
  destinationNodeId,
  visitorPosition,
  onSelectStart,
}: NavigationLayerProps) {
  const matchedEdges = useMemo(
    () => graph.edges.filter((edge) => edge.matched),
    [graph.edges],
  );
  const matchedConditionalEdges = useMemo(
    () => graph.conditionalEdges.filter((edge) => edge.matched),
    [graph.conditionalEdges],
  );
  const ordinaryNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "node"),
    [graph.nodes],
  );
  const poiNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "poi"),
    [graph.nodes],
  );
  const routableOrdinaryNodes = useMemo(
    () => ordinaryNodes.filter((node) => (graph.adjacency.get(node.id)?.length ?? 0) > 0),
    [graph.adjacency, ordinaryNodes],
  );
  const routablePoiNodes = useMemo(
    () => poiNodes.filter((node) => (graph.adjacency.get(node.id)?.length ?? 0) > 0),
    [graph.adjacency, poiNodes],
  );
  const routePoints = useMemo(() => {
    if (!route) return [];
    return getRouteSvgPoints(graph, route).map((point) =>
      svgToWorld(point, transform),
    );
  }, [graph, route, transform]);
  const routeSegmentPoints = useMemo(
    () =>
      routePoints.slice(1).flatMap((point, index) => [
        routePoints[index],
        point,
      ]),
    [routePoints],
  );
  const routePoiLabels = useMemo(() => {
    if (routePoints.length < 2) return [];
    const seen = new Set<string>();
    return poiNodes
      .filter((node) => Boolean(node.semanticName) && node.id !== destinationNodeId)
      .map((node) => ({
        node,
        position: new THREE.Vector3(...svgToWorld(node, transform)),
      }))
      .map((item) => ({
        ...item,
        distance: distanceToRoute(item.position, routePoints),
      }))
      .filter((item) => item.distance <= 10)
      .sort((a, b) => a.distance - b.distance)
      .filter((item) => {
        const key = item.node.semanticName!;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 18);
  }, [destinationNodeId, poiNodes, routePoints, transform]);

  const routeStart = startNodeId ? graph.nodeById.get(startNodeId) : null;
  const routeEnd = destinationNodeId
    ? graph.nodeById.get(destinationNodeId)
    : null;

  return (
    <group name="RUNTIME_NAVIGATION_OVERLAY">
      {debug && (
        <>
          <DebugSegments
            edges={matchedEdges}
            transform={transform}
            color="#158A94"
            opacity={0.58}
            renderOrder={10}
          />
          <DebugSegments
            edges={graph.unmatchedEdges}
            transform={transform}
            color="#FF2D86"
            opacity={1}
            renderOrder={11}
          />
          <DebugSegments
            edges={matchedConditionalEdges}
            transform={transform}
            color="#D946EF"
            opacity={0.9}
            renderOrder={11}
          />
          <DebugSegments
            edges={graph.unmatchedConditionalEdges}
            transform={transform}
            color="#FF1744"
            opacity={1}
            renderOrder={12}
          />
          <NodeInstances
            nodes={ordinaryNodes}
            transform={transform}
            color="#ED4B4B"
            radius={0.09}
            renderOrder={12}
          />
          <NodeInstances
            nodes={poiNodes}
            transform={transform}
            color="#F58231"
            radius={0.16}
            renderOrder={13}
          />
          <DebugLabels nodes={graph.nodes} transform={transform} />
        </>
      )}

      {selectingStart && (
        <>
          <NodeInstances
            nodes={routableOrdinaryNodes}
            transform={transform}
            color="#176BFF"
            radius={0.9}
            renderOrder={20}
            onSelect={onSelectStart}
          />
          <NodeInstances
            nodes={routablePoiNodes}
            transform={transform}
            color="#FF8A00"
            radius={1.1}
            renderOrder={21}
            onSelect={onSelectStart}
          />
          <NodeInstances
            nodes={routableOrdinaryNodes}
            transform={transform}
            color="#176BFF"
            radius={8}
            renderOrder={18}
            opacity={0.002}
            onSelect={onSelectStart}
          />
          <NodeInstances
            nodes={routablePoiNodes}
            transform={transform}
            color="#FF8A00"
            radius={9}
            renderOrder={19}
            opacity={0.002}
            onSelect={onSelectStart}
          />
        </>
      )}

      {routePoints.length >= 2 && (
        <>
          <RouteRibbon points={routePoints} />
          <Line
            points={routeSegmentPoints}
            segments
            color="#F7FBFF"
            lineWidth={6}
            transparent
            opacity={0.98}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
            renderOrder={30}
            raycast={() => undefined}
          />
          <Line
            points={routeSegmentPoints}
            segments
            color="#06A9E5"
            lineWidth={4}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
            renderOrder={31}
            raycast={() => undefined}
          />
        </>
      )}

      {routePoiLabels.map(({ node, position }) => (
        <Html
          key={"route-label-" + node.id}
          position={[position.x, position.y + 0.75, position.z]}
          center
          zIndexRange={[24, 0]}
          style={{ pointerEvents: "none" }}
        >
          <span className="route-poi-label">{node.semanticName}</span>
        </Html>
      ))}

      {routeStart && (
        <group position={visitorPosition ?? svgToWorld(routeStart, transform)}>
          <mesh renderOrder={31} raycast={() => undefined}>
            <sphereGeometry args={[0.28, 16, 16]} />
            <meshBasicMaterial
              color="#16A36A"
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <Html
            position={[0, 0.55, 0]}
            center
            zIndexRange={[40, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span className="navigation-marker-label start-marker-label">
              YOU ARE HERE
            </span>
          </Html>
        </group>
      )}
      {routeEnd && (
        <group position={svgToWorld(routeEnd, transform)}>
          <mesh renderOrder={31} raycast={() => undefined}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial
              color="#FF5A36"
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <Html
            position={[0, 0.55, 0]}
            center
            zIndexRange={[40, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span className="navigation-marker-label destination-marker-label">
              DESTINATION
            </span>
          </Html>
        </group>
      )}
    </group>
  );
}
