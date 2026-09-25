// The latest SVG uses smaller 6-unit nodes. Endpoint audit shows the last
// legitimate gap at 10.01 SVG units, followed by a clear jump to 50 units.
export const EDGE_MATCH_TOLERANCE_SVG = 20;

export const DEBUG_NAVIGATION =
  process.env.NEXT_PUBLIC_DEBUG_NAVIGATION === "true";

export type SvgPoint = {
  x: number;
  y: number;
};

export type SvgViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
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
  conditional: boolean;
  conditionObjectName: string | null;
};

export type GraphArc = {
  nodeId: string;
  edgeId: string;
  weight: number;
};

export type NavigationGraph = {
  viewBox: SvgViewBox;
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  conditionalEdges: NavigationEdge[];
  nodeById: Map<string, NavigationNode>;
  edgeById: Map<string, NavigationEdge>;
  adjacency: Map<string, GraphArc[]>;
  unmatchedEdges: NavigationEdge[];
  unmatchedConditionalEdges: NavigationEdge[];
  counts: {
    nodes: number;
    ordinaryNodes: number;
    pois: number;
    edges: number;
    conditionalEdges: number;
    unmatchedEdges: number;
    unmatchedConditionalEdges: number;
  };
};

export type ShortestPathResult = {
  nodeIds: string[];
  edgeIds: string[];
  totalWeight: number;
};

export type BuildingNodeResolution = {
  nodes: NavigationNode[];
  method: "semantic POI" | "nearest valid node";
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
  // The transform is always global: it is applied identically to every SVG
  // point. Semantic anchors only determine this one transform; they never
  // move individual nodes or edges.
  source: "semantic-ransac" | "source-bounds";
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

export function canonicalBuildingName(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(T1|TI)-([A-Z]+)-0*(\d+)(?:_\d+)?$/i);
  if (!match) return trimmed.toLocaleLowerCase("id-ID");
  return `${match[1].toUpperCase()}-${match[2].toUpperCase()}-${Number(match[3])}`;
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
  const viewBoxValues = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBoxValues.length !== 4 ||
    viewBoxValues.some((value) => !Number.isFinite(value)) ||
    viewBoxValues[2] <= 0 ||
    viewBoxValues[3] <= 0
  ) {
    throw new Error("Navigation SVG has an invalid viewBox");
  }
  const viewBox: SvgViewBox = {
    minX: viewBoxValues[0],
    minY: viewBoxValues[1],
    width: viewBoxValues[2],
    height: viewBoxValues[3],
  };

  const poiGroup = document.getElementById("POI_ORANGE");
  const ordinaryGroup = document.getElementById("PATH_RED");
  const edgeGroup = document.getElementById("EDGES");
  const conditionalEdgeGroup = document.getElementById("EDGES_CONDITIONAL");
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
  const parseEdges = (
    elements: Element[],
    conditional: boolean,
  ): NavigationEdge[] =>
    elements.map((element, index) => {
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
        id: conditional
          ? sourceId
          : "EDGE_GF_" + String(index + 1).padStart(3, "0"),
        sourceId,
        points,
        start,
        end,
        from,
        to,
        startDistance: startMatch.distance,
        endDistance: endMatch.distance,
        matched: Boolean(from && to && from !== to),
        conditional,
        conditionObjectName: conditional
          ? sourceId.split("__")[1] ?? null
          : null,
      };
    });
  const edges = parseEdges(Array.from(edgeGroup.children), false);
  const conditionalEdges = parseEdges(
    conditionalEdgeGroup ? Array.from(conditionalEdgeGroup.children) : [],
    true,
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
  const unmatchedConditionalEdges = conditionalEdges.filter(
    (edge) => !edge.matched,
  );
  return {
    viewBox,
    nodes,
    edges,
    conditionalEdges,
    nodeById,
    edgeById,
    adjacency,
    unmatchedEdges,
    unmatchedConditionalEdges,
    counts: {
      nodes: nodes.length,
      ordinaryNodes: ordinaryNodes.length,
      pois: poiNodes.length,
      edges: edges.length,
      conditionalEdges: conditionalEdges.length,
      unmatchedEdges: unmatchedEdges.length,
      unmatchedConditionalEdges: unmatchedConditionalEdges.length,
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

type CalibrationAnchor = {
  name: string;
  svgX: number;
  svgY: number;
  worldX: number;
  worldZ: number;
};

type CalibrationCandidate = {
  scaleX: number;
  scaleZ: number;
  offsetX: number;
  offsetZ: number;
};

const CALIBRATION_INLIER_TOLERANCE_WORLD = 3;
const MIN_SEMANTIC_CALIBRATION_ANCHORS = 12;

function averagePoint<T extends { x: number; y: number }>(points: T[]): SvgPoint {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function buildCalibrationAnchors(
  graph: NavigationGraph,
  buildings: BuildingAnchor[],
): CalibrationAnchor[] {
  const buildingsByName = new Map<string, BuildingAnchor[]>();
  for (const building of buildings) {
    const key = canonicalBuildingName(building.name);
    const items = buildingsByName.get(key) ?? [];
    items.push(building);
    buildingsByName.set(key, items);
  }

  const poisByName = new Map<string, NavigationNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "poi" || !node.semanticName) continue;
    const key = canonicalBuildingName(node.semanticName);
    const items = poisByName.get(key) ?? [];
    items.push(node);
    poisByName.set(key, items);
  }

  const anchors: CalibrationAnchor[] = [];
  for (const [name, poiNodes] of poisByName) {
    const matchingBuildings = buildingsByName.get(name);
    if (!matchingBuildings?.length) continue;
    const svg = averagePoint(poiNodes);
    anchors.push({
      name,
      svgX: svg.x,
      svgY: svg.y,
      worldX:
        matchingBuildings.reduce((sum, building) => sum + building.worldX, 0) /
        matchingBuildings.length,
      worldZ:
        matchingBuildings.reduce((sum, building) => sum + building.worldZ, 0) /
        matchingBuildings.length,
    });
  }
  return anchors;
}

function residualForCalibration(
  anchor: CalibrationAnchor,
  candidate: CalibrationCandidate,
) {
  return Math.hypot(
    anchor.worldX - (candidate.scaleX * anchor.svgX + candidate.offsetX),
    anchor.worldZ - (candidate.scaleZ * anchor.svgY + candidate.offsetZ),
  );
}

/**
 * Fits one affine SVG -> XZ transform from semantic POI/building pairs.
 * The source files can contain historical POI labels after tenant changes,
 * therefore a consensus fit is used instead of allowing those outliers to
 * distort the entire map. This is deliberately deterministic and global.
 */
function fitSemanticTransform(anchors: CalibrationAnchor[]) {
  let best:
    | { candidate: CalibrationCandidate; inliers: CalibrationAnchor[]; error: number }
    | null = null;

  for (let first = 0; first < anchors.length; first += 1) {
    for (let second = first + 1; second < anchors.length; second += 1) {
      const a = anchors[first];
      const b = anchors[second];
      const dx = b.svgX - a.svgX;
      const dy = b.svgY - a.svgY;
      if (Math.abs(dx) < 1 || Math.abs(dy) < 1) continue;

      const candidate = {
        scaleX: (b.worldX - a.worldX) / dx,
        scaleZ: (b.worldZ - a.worldZ) / dy,
        offsetX: 0,
        offsetZ: 0,
      };
      // This broad range accepts a global axis flip (negative scale), while
      // filtering degenerate pairs and accidental POI/building name matches.
      if (
        Math.abs(candidate.scaleX) < 0.003 ||
        Math.abs(candidate.scaleX) > 0.1 ||
        Math.abs(candidate.scaleZ) < 0.003 ||
        Math.abs(candidate.scaleZ) > 0.1
      ) {
        continue;
      }
      candidate.offsetX = a.worldX - candidate.scaleX * a.svgX;
      candidate.offsetZ = a.worldZ - candidate.scaleZ * a.svgY;

      const inliers = anchors.filter(
        (anchor) =>
          residualForCalibration(anchor, candidate) <=
          CALIBRATION_INLIER_TOLERANCE_WORLD,
      );
      const error = inliers.reduce(
        (sum, anchor) => sum + residualForCalibration(anchor, candidate) ** 2,
        0,
      );
      if (
        !best ||
        inliers.length > best.inliers.length ||
        (inliers.length === best.inliers.length && error < best.error)
      ) {
        best = { candidate, inliers, error };
      }
    }
  }

  if (!best || best.inliers.length < MIN_SEMANTIC_CALIBRATION_ANCHORS) {
    return null;
  }

  // Refit the winning consensus set using least squares, then filter/refit
  // once more so every accepted anchor is coherent with the final transform.
  let inliers = best.inliers;
  let xFit = fitAxis(inliers.map((anchor) => ({ svg: anchor.svgX, world: anchor.worldX })));
  let zFit = fitAxis(inliers.map((anchor) => ({ svg: anchor.svgY, world: anchor.worldZ })));
  let candidate: CalibrationCandidate = {
    scaleX: xFit.scale,
    scaleZ: zFit.scale,
    offsetX: xFit.offset,
    offsetZ: zFit.offset,
  };
  inliers = anchors.filter(
    (anchor) =>
      residualForCalibration(anchor, candidate) <= CALIBRATION_INLIER_TOLERANCE_WORLD,
  );
  if (inliers.length < MIN_SEMANTIC_CALIBRATION_ANCHORS) return null;
  xFit = fitAxis(inliers.map((anchor) => ({ svg: anchor.svgX, world: anchor.worldX })));
  zFit = fitAxis(inliers.map((anchor) => ({ svg: anchor.svgY, world: anchor.worldZ })));
  candidate = {
    scaleX: xFit.scale,
    scaleZ: zFit.scale,
    offsetX: xFit.offset,
    offsetZ: zFit.offset,
  };
  const finalInliers = anchors.filter(
    (anchor) =>
      residualForCalibration(anchor, candidate) <= CALIBRATION_INLIER_TOLERANCE_WORLD,
  );

  return { candidate, inliers: finalInliers, rmseX: xFit.rmse, rmseZ: zFit.rmse };
}

export function calibrateSvgToWorld(
  graph: NavigationGraph,
  buildings: BuildingAnchor[],
  bounds: BoundsCalibrationInput,
): SvgWorldTransform {
  const anchors = buildCalibrationAnchors(graph, buildings);
  const semanticFit = fitSemanticTransform(anchors);
  if (semanticFit) {
    const acceptedNames = new Set(semanticFit.inliers.map((anchor) => anchor.name));
    return {
      ...semanticFit.candidate,
      elevationY: bounds.floorY + 0.12,
      axis: "svg+x->world+x;svg+y->world+z",
      source: "semantic-ransac",
      calibrationAnchorCount: semanticFit.inliers.length,
      rejectedAnchorNames: anchors
        .filter((anchor) => !acceptedNames.has(anchor.name))
        .map((anchor) => anchor.name),
      rmseX: semanticFit.rmseX,
      rmseZ: semanticFit.rmseZ,
    };
  }

  const scaleX = bounds.sizeX / graph.viewBox.width;
  const scaleZ = bounds.sizeZ / graph.viewBox.height;
  return {
    scaleX,
    scaleZ,
    offsetX:
      bounds.centerX -
      scaleX * (graph.viewBox.minX + graph.viewBox.width / 2),
    offsetZ:
      bounds.centerZ -
      scaleZ * (graph.viewBox.minY + graph.viewBox.height / 2),
    elevationY: bounds.floorY + 0.12,
    axis: "svg+x->world+x;svg+y->world+z",
    source: "source-bounds",
    calibrationAnchorCount: 0,
    rejectedAnchorNames: [],
    rmseX: 0,
    rmseZ: 0,
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
  const canonicalObjectName = canonicalBuildingName(objectName);
  return graph.nodes.filter(
    (node) =>
      node.kind === "poi" &&
      Boolean(node.semanticName) &&
      canonicalBuildingName(node.semanticName!) === canonicalObjectName,
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

const MAX_SEMANTIC_POI_DISTANCE_SVG = 500;

export function resolveBuildingNavigationNodes(
  graph: NavigationGraph,
  objectName: string,
  buildingCenter: SvgPoint,
): BuildingNodeResolution {
  const semanticNodes = findPoiCandidates(graph, objectName)
    .filter((node) => (graph.adjacency.get(node.id)?.length ?? 0) > 0)
    .filter(
      (node) => euclidean(node, buildingCenter) <= MAX_SEMANTIC_POI_DISTANCE_SVG,
    )
    .sort(
      (left, right) =>
        euclidean(left, buildingCenter) - euclidean(right, buildingCenter),
    );

  if (semanticNodes.length) {
    return { nodes: semanticNodes, method: "semantic POI" };
  }

  const nearest = findNearestRoutableNode(graph, buildingCenter);
  return {
    nodes: nearest ? [nearest] : [],
    method: "nearest valid node",
  };
}

export function selectBestBuildingStartNode(
  graph: NavigationGraph,
  resolution: BuildingNodeResolution,
  buildingCenter: SvgPoint,
) {
  const reachableCount = (startNodeId: string) => {
    const visited = new Set<string>();
    const queue = [startNodeId];
    while (queue.length) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const arc of graph.adjacency.get(current) ?? []) {
        if (!visited.has(arc.nodeId)) queue.push(arc.nodeId);
      }
    }
    return visited.size;
  };

  return [...resolution.nodes]
    .map((node) => ({
      node,
      reachable: reachableCount(node.id),
      distance: euclidean(node, buildingCenter),
    }))
    .sort(
      (left, right) =>
        right.reachable - left.reachable || left.distance - right.distance,
    )[0]?.node ?? null;
}
