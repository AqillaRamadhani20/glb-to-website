import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SVG_PATH = "NAVIGATION_GRAPH (2).svg";
const GLB_PATH = "BUILDINGS 3D TERBARU.glb";
const VIEWBOX = { minX: 0, minY: 0, width: 22973, height: 3300 };
// Valid endpoint distances end at 16.81 SVG units; the next gap is 46.51.
const MATCH_TOLERANCE = 20;

function attrs(source) {
  return Object.fromEntries(
    [...source.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

function groupMarkup(svg, id) {
  const match = svg.match(new RegExp('<g id="' + id + '">([\\s\\S]*?)<\\/g>'));
  if (!match) throw new Error("Missing SVG group: " + id);
  return match[1];
}

function elements(markup) {
  return [...markup.matchAll(/<(circle|line|path)\b([^>]*?)\/>/g)].map((match) => ({
    tag: match[1],
    attributes: attrs(match[2]),
  }));
}

function tokenizePath(pathData) {
  return pathData.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? [];
}

function parsePath(pathData, curveSteps = 12) {
  const tokens = tokenizePath(pathData);
  const points = [];
  let index = 0;
  let command = "";
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };

  const isCommand = (value) => /^[A-Za-z]$/.test(value);
  const number = () => Number(tokens[index++]);
  const add = (point) => {
    current = point;
    points.push(point);
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;

    if (upper === "M") {
      const x = number();
      const y = number();
      add({
        x: relative ? current.x + x : x,
        y: relative ? current.y + y : y,
      });
      subpathStart = { ...current };
      command = relative ? "l" : "L";
    } else if (upper === "L") {
      const x = number();
      const y = number();
      add({
        x: relative ? current.x + x : x,
        y: relative ? current.y + y : y,
      });
    } else if (upper === "H") {
      const x = number();
      add({ x: relative ? current.x + x : x, y: current.y });
    } else if (upper === "V") {
      const y = number();
      add({ x: current.x, y: relative ? current.y + y : y });
    } else if (upper === "C") {
      const origin = { ...current };
      const values = [number(), number(), number(), number(), number(), number()];
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
      add({ ...subpathStart });
      command = "";
    } else {
      throw new Error("Unsupported SVG path command: " + command);
    }
  }

  return points;
}

function pathCenter(pathData) {
  const points = parsePath(pathData, 24);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function quantile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction));
  return ordered[index];
}

const [svg, glbBuffer] = await Promise.all([readFile(SVG_PATH, "utf8"), readFile(GLB_PATH)]);
const rootMatch = svg.match(/<svg\b([^>]*)>/);
if (!rootMatch) throw new Error("SVG root not found");
const rootAttributes = attrs(rootMatch[1]);

const poiElements = elements(groupMarkup(svg, "POI_ORANGE"));
const ordinaryElements = elements(groupMarkup(svg, "PATH_RED"));
const edgeElements = elements(groupMarkup(svg, "EDGES"));

const poiNodes = poiElements.map((element) => {
  const position =
    element.tag === "circle"
      ? { x: Number(element.attributes.cx), y: Number(element.attributes.cy) }
      : pathCenter(element.attributes.d);
  return {
    id: element.attributes.id,
    sourceId: element.attributes.id,
    kind: "poi",
    semanticName: element.attributes.id.split("__")[1] ?? null,
    ...position,
  };
});

const ordinaryNodes = ordinaryElements.map((element, index) => ({
  id: "NODE_GF_" + String(index + 1).padStart(3, "0"),
  sourceId: element.attributes.id,
  kind: "node",
  semanticName: null,
  x: Number(element.attributes.cx),
  y: Number(element.attributes.cy),
}));
const nodes = [...poiNodes, ...ordinaryNodes];

const edgeGeometry = edgeElements.map((element, index) => {
  const points =
    element.tag === "line"
      ? [
          { x: Number(element.attributes.x1), y: Number(element.attributes.y1) },
          { x: Number(element.attributes.x2), y: Number(element.attributes.y2) },
        ]
      : parsePath(element.attributes.d);
  return {
    id: "EDGE_GF_" + String(index + 1).padStart(3, "0"),
    sourceId: element.attributes.id,
    points,
    start: points[0],
    end: points.at(-1),
  };
});

function nearest(point) {
  let best = null;
  for (const node of nodes) {
    const candidateDistance = distance(point, node);
    if (!best || candidateDistance < best.distance) {
      best = { node, distance: candidateDistance };
    }
  }
  return best;
}

const endpointDistances = [];
const matchedEdges = edgeGeometry.map((edge) => {
  const startMatch = nearest(edge.start);
  const endMatch = nearest(edge.end);
  endpointDistances.push(startMatch.distance, endMatch.distance);
  return {
    ...edge,
    from: startMatch.distance <= MATCH_TOLERANCE ? startMatch.node.id : null,
    to: endMatch.distance <= MATCH_TOLERANCE ? endMatch.node.id : null,
    startDistance: startMatch.distance,
    endDistance: endMatch.distance,
  };
});
const unmatchedEdges = matchedEdges.filter((edge) => !edge.from || !edge.to);

const adjacency = new Map(nodes.map((node) => [node.id, []]));
for (const edge of matchedEdges) {
  if (!edge.from || !edge.to || edge.from === edge.to) continue;
  adjacency.get(edge.from).push(edge.to);
  adjacency.get(edge.to).push(edge.from);
}

const visited = new Set();
const components = [];
for (const node of nodes) {
  if (visited.has(node.id)) continue;
  const stack = [node.id];
  const members = [];
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    members.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  components.push(members);
}
components.sort((a, b) => b.length - a.length);
const componentSizes = components.map((component) => component.length);
const largestComponentIds = new Set(components[0] ?? []);

const glbArrayBuffer = glbBuffer.buffer.slice(
  glbBuffer.byteOffset,
  glbBuffer.byteOffset + glbBuffer.byteLength,
);
const gltf = await new GLTFLoader().parseAsync(glbArrayBuffer, "");
gltf.scene.updateWorldMatrix(true, true);
const glbBounds = new THREE.Box3().setFromObject(gltf.scene);
const glbSize = glbBounds.getSize(new THREE.Vector3());
const glbCenter = glbBounds.getCenter(new THREE.Vector3());
const buildingCenters = new Map();
for (const object of gltf.scene.children) {
  if (!/^(T1|TI)-GF-/i.test(object.name)) continue;
  const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  buildingCenters.set(object.name, { x: center.x, z: center.z });
}

const poiBySemantic = new Map();
for (const node of poiNodes) {
  if (!node.semanticName || !buildingCenters.has(node.semanticName)) continue;
  const collection = poiBySemantic.get(node.semanticName) ?? [];
  collection.push(node);
  poiBySemantic.set(node.semanticName, collection);
}
const anchors = [...poiBySemantic].map(([name, collection]) => ({
  name,
  svgX: collection.reduce((sum, node) => sum + node.x, 0) / collection.length,
  svgY: collection.reduce((sum, node) => sum + node.y, 0) / collection.length,
  worldX: buildingCenters.get(name).x,
  worldZ: buildingCenters.get(name).z,
  poiCount: collection.length,
}));

function fitLinear(inputKey, outputKey) {
  const meanInput = anchors.reduce((sum, anchor) => sum + anchor[inputKey], 0) / anchors.length;
  const meanOutput = anchors.reduce((sum, anchor) => sum + anchor[outputKey], 0) / anchors.length;
  const slope =
    anchors.reduce(
      (sum, anchor) =>
        sum + (anchor[inputKey] - meanInput) * (anchor[outputKey] - meanOutput),
      0,
    ) /
    anchors.reduce((sum, anchor) => sum + (anchor[inputKey] - meanInput) ** 2, 0);
  const offset = meanOutput - slope * meanInput;
  const residuals = anchors.map(
    (anchor) => anchor[outputKey] - (slope * anchor[inputKey] + offset),
  );
  return {
    slope,
    offset,
    rmse: Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length),
    maxAbsResidual: Math.max(...residuals.map(Math.abs)),
  };
}

const directX = fitLinear("svgX", "worldX");
const directZ = fitLinear("svgY", "worldZ");
const swappedX = fitLinear("svgY", "worldX");
const swappedZ = fitLinear("svgX", "worldZ");
const directCombinedRmse = Math.hypot(directX.rmse, directZ.rmse);
const swappedCombinedRmse = Math.hypot(swappedX.rmse, swappedZ.rmse);

const svgIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateSvgIds = [...new Set(svgIds.filter((id, index) => svgIds.indexOf(id) !== index))];

const report = {
  glb: {
    path: GLB_PATH,
    bytes: glbBuffer.byteLength,
    sha256: createHash("sha256").update(glbBuffer).digest("hex"),
    logicalNodes: gltf.parser.json.nodes?.length ?? 0,
    meshes: gltf.parser.json.meshes?.length ?? 0,
    primitives: (gltf.parser.json.meshes ?? []).reduce(
      (total, mesh) => total + (mesh.primitives?.length ?? 0),
      0,
    ),
    materials: gltf.parser.json.materials?.length ?? 0,
    cameras: gltf.parser.json.cameras?.length ?? 0,
    buildingCount: buildingCenters.size,
    bounds: {
      min: glbBounds.min.toArray(),
      max: glbBounds.max.toArray(),
      center: glbCenter.toArray(),
      size: glbSize.toArray(),
    },
    inferredPlane: "XZ",
    upAxis: "Y",
  },
  navigation: {
    path: SVG_PATH,
    width: Number(rootAttributes.width),
    height: Number(rootAttributes.height),
    viewBox: rootAttributes.viewBox,
    groups: ["POI_ORANGE", "PATH_RED", "EDGES"],
    nodeCount: nodes.length,
    ordinaryNodeCount: ordinaryNodes.length,
    poiCount: poiNodes.length,
    edgeCount: matchedEdges.length,
    lineEdgeCount: edgeElements.filter((element) => element.tag === "line").length,
    pathEdgeCount: edgeElements.filter((element) => element.tag === "path").length,
    duplicateSourceIds: duplicateSvgIds,
  },
  endpointMatching: {
    toleranceSvgUnits: MATCH_TOLERANCE,
    unmatchedEdgeCount: unmatchedEdges.length,
    unmatchedEdges: unmatchedEdges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      from: edge.from,
      to: edge.to,
      startDistance: edge.startDistance,
      endDistance: edge.endDistance,
    })),
    distanceQuantiles: {
      min: Math.min(...endpointDistances),
      p50: quantile(endpointDistances, 0.5),
      p90: quantile(endpointDistances, 0.9),
      p95: quantile(endpointDistances, 0.95),
      p99: quantile(endpointDistances, 0.99),
      max: Math.max(...endpointDistances),
    },
    unmatchedByTolerance: Object.fromEntries(
      [10, 12, 14, 16, 20, 30].map((tolerance) => [
        tolerance,
        matchedEdges.filter(
          (edge) => edge.startDistance > tolerance || edge.endDistance > tolerance,
        ).length,
      ]),
    ),
    connectedComponents: componentSizes.length,
    largestComponentSize: componentSizes[0] ?? 0,
    largestComponentSemanticPois: poiNodes
      .filter((node) => largestComponentIds.has(node.id) && node.semanticName)
      .map((node) => node.semanticName),
    isolatedNodeCount: componentSizes.filter((size) => size === 1).length,
  },
  alignment: {
    matchedSemanticBuildings: anchors.length,
    directAxis: {
      svgXToWorldX: directX,
      svgYToWorldZ: directZ,
      combinedRmse: directCombinedRmse,
    },
    swappedAxis: {
      svgYToWorldX: swappedX,
      svgXToWorldZ: swappedZ,
      combinedRmse: swappedCombinedRmse,
    },
    orientation:
      directCombinedRmse < swappedCombinedRmse
        ? "svg +X -> world +X; svg +Y -> world +Z"
        : "axis swap required",
  },
};

console.log(JSON.stringify(report, null, 2));
