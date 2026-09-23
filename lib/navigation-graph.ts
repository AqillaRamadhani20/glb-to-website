export const NAVIGATION_VIEWBOX = {
  minX: 0,
  minY: 0,
  width: 22973,
  height: 3300,
} as const;

// SVG nodes use a 9.5-unit radius. Valid edge endpoints top out at 16.81 units,
// followed by a clear gap to 46.51 units, so 20 is a conservative hard cutoff.
export const EDGE_MATCH_TOLERANCE_SVG = 20;

export const DEBUG_NAVIGATION =
  process.env.NEXT_PUBLIC_DEBUG_NAVIGATION === "true";

export type SvgPoint = {
  x: number;
  y: number;
};

export type NavigationNode = SvgPoint & {
  id: string;
  sourceId: string;
  kind: "node" | "poi";
  semanticName: string | null;
  fill: string;
};

export type NavigationEdge = {
  id: string;
  sourceId: string;
  points: SvgPoint[];
  start: SvgPoint;
  end: SvgPoint;
  from: string | null;
  to: string | null;
  startDistance: number;
  endDistance: number;
  matched: boolean;
};

export type GraphArc = {
  nodeId: string;
  edgeId: string;
  weight: number;
};

export type NavigationGraph = {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  nodeById: Map<string, NavigationNode>;
  edgeById: Map<string, NavigationEdge>;
  adjacency: Map<string, GraphArc[]>;
  unmatchedEdges: NavigationEdge[];
  counts: {
    nodes: number;
    ordinaryNodes: number;
    pois: number;
    edges: number;
    unmatchedEdges: number;
  };
};

export type ShortestPathResult = {
  nodeIds: string[];
  edgeIds: string[];
  totalWeight: number;
};

export type BuildingAnchor = {
  name: string;
  worldX: number;
  worldZ: number;
};

export type BoundsCalibrationInput = {
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
  floorY: number;
};

export type SvgWorldTransform = {
  scaleX: number;
  scaleZ: number;
  offsetX: number;
  offsetZ: number;
  elevationY: number;
  axis: "svg+x->world+x;svg+y->world+z";
  source: "semantic-least-squares" | "bounds-fallback";
  calibrationAnchorCount: number;
  rejectedAnchorNames: string[];
  rmseX: number;
  rmseZ: number;
};

function tokenizePath(pathData: string) {
  return (
    pathData.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? []
  );
}

export function sampleSvgPath(pathData: string, curveSteps = 12): SvgPoint[] {
  const tokens = tokenizePath(pathData);
  const points: SvgPoint[] = [];
  let index = 0;
  let command = "";
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };

  const isCommand = (value: string) => /^[A-Za-z]$/.test(value);
  const readNumber = () => Number(tokens[index++]);
  const addPoint = (point: SvgPoint) => {
    current = point;
    points.push(point);
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;

    if (upper === "M") {
      const x = readNumber();
      const y = readNumber();
      addPoint({
        x: relative ? current.x + x : x,
        y: relative ? current.y + y : y,
      });
      subpathStart = { ...current };
      command = relative ? "l" : "L";
    } else if (upper === "L") {
      const x = readNumber();
      const y = readNumber();
      addPoint({
        x: relative ? current.x + x : x,
        y: relative ? current.y + y : y,
      });
    } else if (upper === "H") {
      const x = readNumber();
      addPoint({ x: relative ? current.x + x : x, y: current.y });
    } else if (upper === "V") {
      const y = readNumber();
      addPoint({ x: current.x, y: relative ? current.y + y : y });
    } else if (upper === "C") {
      const origin = { ...current };
      const values = [
        readNumber(),
        readNumber(),
        readNumber(),
        readNumber(),
        readNumber(),
        readNumber(),
      ];
      const controlA = {
        x: relative ? origin.x + values[0] : values[0],
        y: relative ? origin.y + values[1] : values[1],
      };
      const controlB = {
        x: relative ? origin.x + values[2] : values[2],
        y: relative ? origin.y + values[3] : values[3],
      };
      const end = {
        x: relative ? origin.x + values[4] : values[4],
        y: relative ? origin.y + values[5] : values[5],
      };

      for (let step = 1; step <= curveSteps; step += 1) {
        const t = step / curveSteps;
        const mt = 1 - t;
        points.push({
          x:
            mt ** 3 * origin.x +
            3 * mt ** 2 * t * controlA.x +
            3 * mt * t ** 2 * controlB.x +
            t ** 3 * end.x,
          y:
            mt ** 3 * origin.y +
            3 * mt ** 2 * t * controlA.y +
            3 * mt * t ** 2 * controlB.y +
            t ** 3 * end.y,
        });
      }
      current = end;
    } else if (upper === "Z") {
      addPoint({ ...subpathStart });
      command = "";
    } else {
      throw new Error("Unsupported SVG path command: " + command);
    }
  }

  if (points.length < 2) {
    throw new Error("SVG path did not produce enough points: " + pathData);
  }
  return points;
}

function pathCenter(pathData: string): SvgPoint {
  const points = sampleSvgPath(pathData, 24);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function euclidean(a: SvgPoint, b: SvgPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function svgElementPoint(element: Element): SvgPoint {
  if (element.tagName.toLowerCase() === "circle") {
    return {
      x: Number(element.getAttribute("cx")),
      y: Number(element.getAttribute("cy")),
    };
  }
  const pathData = element.getAttribute("d");
  if (!pathData) throw new Error("Node path has no d attribute");
  return pathCenter(pathData);
}

function svgEdgePoints(element: Element): SvgPoint[] {
  if (element.tagName.toLowerCase() === "line") {
    return [
      {
        x: Number(element.getAttribute("x1")),
        y: Number(element.getAttribute("y1")),
      },
      {
        x: Number(element.getAttribute("x2")),
        y: Number(element.getAttribute("y2")),
      },
    ];
  }
  const pathData = element.getAttribute("d");
  if (!pathData) throw new Error("Edge path has no d attribute");
  return sampleSvgPath(pathData);
}

function nearestNode(point: SvgPoint, nodes: NavigationNode[]) {
  let bestNode = nodes[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const candidateDistance = euclidean(point, node);
    if (candidateDistance < bestDistance) {
      bestNode = node;
      bestDistance = candidateDistance;
    }
  }
  return { node: bestNode, distance: bestDistance };
}

export function parseNavigationSvg(
  svgText: string,
  tolerance = EDGE_MATCH_TOLERANCE_SVG,
): NavigationGraph {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    throw new Error("NAVIGATION_GRAPH SVG is not valid XML");
  }

  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox");
  if (viewBox !== "0 0 22973 3300") {
    throw new Error("Unexpected navigation viewBox: " + viewBox);
  }

  const poiGroup = document.getElementById("POI_ORANGE");
  const ordinaryGroup = document.getElementById("PATH_RED");
  const edgeGroup = document.getElementById("EDGES");
  if (!poiGroup || !ordinaryGroup || !edgeGroup) {
    throw new Error("Navigation SVG is missing POI_ORANGE, PATH_RED, or EDGES");
  }

  const poiNodes: NavigationNode[] = Array.from(poiGroup.children).map(
    (element) => {
      const id = element.getAttribute("id");
      if (!id) throw new Error("POI node is missing id");
      return {
        id,
        sourceId: id,
        kind: "poi",
        semanticName: id.split("__")[1] ?? null,
        fill: element.getAttribute("fill") ?? "#F58231",
        ...svgElementPoint(element),
      };
    },
  );

  const ordinaryNodes: NavigationNode[] = Array.from(ordinaryGroup.children).map(
    (element, index) => {
      const sourceId = element.getAttribute("id");
      if (!sourceId) throw new Error("Ordinary node is missing source id");
      return {
        id: "NODE_GF_" + String(index + 1).padStart(3, "0"),
        sourceId,
        kind: "node",
        semanticName: null,
        fill: element.getAttribute("fill") ?? "#FF3B30",
        ...svgElementPoint(element),
      };
    },
  );

  const nodes = [...poiNodes, ...ordinaryNodes];
  const edges: NavigationEdge[] = Array.from(edgeGroup.children).map(
    (element, index) => {
      const sourceId = element.getAttribute("id");
      if (!sourceId) throw new Error("Edge is missing source id");
      const points = svgEdgePoints(element);
      const start = points[0];
      const end = points[points.length - 1];
      const startMatch = nearestNode(start, nodes);
      const endMatch = nearestNode(end, nodes);
      const from = startMatch.distance <= tolerance ? startMatch.node.id : null;
      const to = endMatch.distance <= tolerance ? endMatch.node.id : null;

      return {
        id: "EDGE_GF_" + String(index + 1).padStart(3, "0"),
        sourceId,
        points,
        start,
        end,
        from,
        to,
        startDistance: startMatch.distance,
        endDistance: endMatch.distance,
        matched: Boolean(from && to && from !== to),
      };
    },
  );

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const adjacency = new Map<string, GraphArc[]>(
    nodes.map((node) => [node.id, []]),
  );

  for (const edge of edges) {
    if (!edge.matched || !edge.from || !edge.to) continue;
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const weight = euclidean(fromNode, toNode);
    adjacency.get(edge.from)?.push({
      nodeId: edge.to,
      edgeId: edge.id,
      weight,
    });
    adjacency.get(edge.to)?.push({
      nodeId: edge.from,
      edgeId: edge.id,
      weight,
    });
  }

  const unmatchedEdges = edges.filter((edge) => !edge.matched);
  return {
    nodes,
    edges,
    nodeById,
    edgeById,
    adjacency,
    unmatchedEdges,
    counts: {
      nodes: nodes.length,
      ordinaryNodes: ordinaryNodes.length,
      pois: poiNodes.length,
      edges: edges.length,
      unmatchedEdges: unmatchedEdges.length,
    },
  };
}

export function findShortestPath(
  graph: NavigationGraph,
  startNodeId: string,
  destinationNodeId: string,
): ShortestPathResult | null {
  if (!graph.nodeById.has(startNodeId) || !graph.nodeById.has(destinationNodeId)) {
    return null;
  }
  if (startNodeId === destinationNodeId) {
    return { nodeIds: [startNodeId], edgeIds: [], totalWeight: 0 };
  }

  const distances = new Map<string, number>(
    graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]),
  );
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const unvisited = new Set(graph.nodes.map((node) => node.id));
  distances.set(startNodeId, 0);

  while (unvisited.size) {
    let currentId: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of unvisited) {
      const candidateDistance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance) {
        currentDistance = candidateDistance;
        currentId = nodeId;
      }
    }

    if (!currentId || !Number.isFinite(currentDistance)) break;
    unvisited.delete(currentId);
    if (currentId === destinationNodeId) break;

    for (const arc of graph.adjacency.get(currentId) ?? []) {
      if (!unvisited.has(arc.nodeId)) continue;
      const nextDistance = currentDistance + arc.weight;
      if (nextDistance < (distances.get(arc.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(arc.nodeId, nextDistance);
        previous.set(arc.nodeId, {
          nodeId: currentId,
          edgeId: arc.edgeId,
        });
      }
    }
  }

  const totalWeight = distances.get(destinationNodeId);
  if (totalWeight === undefined || !Number.isFinite(totalWeight)) return null;

  const nodeIds = [destinationNodeId];
  const edgeIds: string[] = [];
  let cursor = destinationNodeId;
  while (cursor !== startNodeId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edgeIds.push(step.edgeId);
    nodeIds.push(step.nodeId);
    cursor = step.nodeId;
  }

  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds, totalWeight };
}

export function getRouteSvgPoints(
  graph: NavigationGraph,
  route: ShortestPathResult,
): SvgPoint[] {
  const points: SvgPoint[] = [];
  route.edgeIds.forEach((edgeId, index) => {
    const edge = graph.edgeById.get(edgeId);
    if (!edge) return;
    const fromNodeId = route.nodeIds[index];
    const edgePoints =
      edge.from === fromNodeId ? edge.points : [...edge.points].reverse();
    if (points.length && edgePoints.length) edgePoints.shift();
    points.push(...edgePoints);
  });
  return points;
}

function fitAxis(
  anchors: Array<{ svg: number; world: number }>,
) {
  const meanSvg =
    anchors.reduce((sum, anchor) => sum + anchor.svg, 0) / anchors.length;
  const meanWorld =
    anchors.reduce((sum, anchor) => sum + anchor.world, 0) / anchors.length;
  const scale =
    anchors.reduce(
      (sum, anchor) =>
        sum + (anchor.svg - meanSvg) * (anchor.world - meanWorld),
      0,
    ) /
    anchors.reduce(
      (sum, anchor) => sum + (anchor.svg - meanSvg) ** 2,
      0,
    );
  const offset = meanWorld - scale * meanSvg;
  const rmse = Math.sqrt(
    anchors.reduce(
      (sum, anchor) =>
        sum + (anchor.world - (scale * anchor.svg + offset)) ** 2,
      0,
    ) / anchors.length,
  );
  return { scale, offset, rmse };
}

export function calibrateSvgToWorld(
  graph: NavigationGraph,
  buildings: BuildingAnchor[],
  bounds: BoundsCalibrationInput,
): SvgWorldTransform {
  const buildingByName = new Map(
    buildings.map((building) => [building.name, building]),
  );
  const poiBySemantic = new Map<string, NavigationNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "poi" || !node.semanticName) continue;
    if (!buildingByName.has(node.semanticName)) continue;
    const collection = poiBySemantic.get(node.semanticName) ?? [];
    collection.push(node);
    poiBySemantic.set(node.semanticName, collection);
  }

  const rawAnchors = [...poiBySemantic].map(([name, nodes]) => {
    const building = buildingByName.get(name)!;
    return {
      name,
      svgX: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      svgY: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
      worldX: building.worldX,
      worldZ: building.worldZ,
    };
  });

  if (rawAnchors.length < 3) {
    const scaleX = bounds.sizeX / NAVIGATION_VIEWBOX.width;
    const scaleZ = bounds.sizeZ / NAVIGATION_VIEWBOX.height;
    return {
      scaleX,
      scaleZ,
      offsetX:
        bounds.centerX -
        scaleX * (NAVIGATION_VIEWBOX.minX + NAVIGATION_VIEWBOX.width / 2),
      offsetZ:
        bounds.centerZ -
        scaleZ * (NAVIGATION_VIEWBOX.minY + NAVIGATION_VIEWBOX.height / 2),
      elevationY: bounds.floorY + 0.12,
      axis: "svg+x->world+x;svg+y->world+z",
      source: "bounds-fallback",
      calibrationAnchorCount: rawAnchors.length,
      rejectedAnchorNames: [],
      rmseX: 0,
      rmseZ: 0,
    };
  }

  const initialX = fitAxis(
    rawAnchors.map((anchor) => ({ svg: anchor.svgX, world: anchor.worldX })),
  );
  const initialZ = fitAxis(
    rawAnchors.map((anchor) => ({ svg: anchor.svgY, world: anchor.worldZ })),
  );
  const residuals = rawAnchors.map((anchor) => ({
    name: anchor.name,
    value: Math.hypot(
      anchor.worldX - (initialX.scale * anchor.svgX + initialX.offset),
      anchor.worldZ - (initialZ.scale * anchor.svgY + initialZ.offset),
    ),
  }));
  const orderedResiduals = residuals.map((item) => item.value).sort((a, b) => a - b);
  const medianResidual =
    orderedResiduals[Math.floor(orderedResiduals.length / 2)] ?? 0;
  const rejectionThreshold = Math.max(2.5, medianResidual * 3);
  const acceptedNames = new Set(
    residuals
      .filter((item) => item.value <= rejectionThreshold)
      .map((item) => item.name),
  );
  const accepted = rawAnchors.filter((anchor) => acceptedNames.has(anchor.name));
  const fitX = fitAxis(
    accepted.map((anchor) => ({ svg: anchor.svgX, world: anchor.worldX })),
  );
  const fitZ = fitAxis(
    accepted.map((anchor) => ({ svg: anchor.svgY, world: anchor.worldZ })),
  );

  return {
    scaleX: fitX.scale,
    scaleZ: fitZ.scale,
    offsetX: fitX.offset,
    offsetZ: fitZ.offset,
    elevationY: bounds.floorY + 0.12,
    axis: "svg+x->world+x;svg+y->world+z",
    source: "semantic-least-squares",
    calibrationAnchorCount: accepted.length,
    rejectedAnchorNames: rawAnchors
      .filter((anchor) => !acceptedNames.has(anchor.name))
      .map((anchor) => anchor.name),
    rmseX: fitX.rmse,
    rmseZ: fitZ.rmse,
  };
}

export function svgToWorld(
  point: SvgPoint,
  transform: SvgWorldTransform,
): [number, number, number] {
  return [
    transform.scaleX * point.x + transform.offsetX,
    transform.elevationY,
    transform.scaleZ * point.y + transform.offsetZ,
  ];
}

export function worldToSvg(
  worldX: number,
  worldZ: number,
  transform: SvgWorldTransform,
): SvgPoint {
  return {
    x: (worldX - transform.offsetX) / transform.scaleX,
    y: (worldZ - transform.offsetZ) / transform.scaleZ,
  };
}

export function findPoiCandidates(
  graph: NavigationGraph,
  objectName: string,
): NavigationNode[] {
  return graph.nodes.filter(
    (node) => node.kind === "poi" && node.semanticName === objectName,
  );
}

export function findNearestRoutableNode(
  graph: NavigationGraph,
  point: SvgPoint,
): NavigationNode | null {
  let nearest: NavigationNode | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of graph.nodes) {
    if (!(graph.adjacency.get(node.id)?.length)) continue;
    const candidateDistance = euclidean(point, node);
    if (candidateDistance < nearestDistance) {
      nearest = node;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}
