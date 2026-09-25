import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const sourcePath = process.argv[2] ?? "GLB TERBARU!.glb";
const publicPath = process.argv[3] ?? "public/models/buildings-ground-floor.glb";
const [sourceBuffer, publicBuffer] = await Promise.all([
  readFile(sourcePath),
  readFile(publicPath),
]);

const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sourceHash = digest(sourceBuffer);
const publicHash = digest(publicBuffer);
const arrayBuffer = sourceBuffer.buffer.slice(
  sourceBuffer.byteOffset,
  sourceBuffer.byteOffset + sourceBuffer.byteLength,
);
const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
const box = new THREE.Box3().setFromObject(gltf.scene);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const json = gltf.parser.json;

let renderMeshes = 0;
let triangles = 0;
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  renderMeshes += 1;
  const geometry = object.geometry;
  triangles += geometry.index
    ? geometry.index.count / 3
    : (geometry.attributes.position?.count ?? 0) / 3;
});

const names = (json.nodes ?? []).map((node) => node.name).filter(Boolean);
const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
const publicArrayBuffer = publicBuffer.buffer.slice(
  publicBuffer.byteOffset,
  publicBuffer.byteOffset + publicBuffer.byteLength,
);
const publicGltf = await new GLTFLoader().parseAsync(publicArrayBuffer, "");
const publicNames = (publicGltf.parser.json.nodes ?? [])
  .map((node) => node.name)
  .filter(Boolean);
const publicNameSet = new Set(publicNames);
const sourceNameSet = new Set(names);
const addedNames = names.filter((name) => !publicNameSet.has(name));
const removedNames = publicNames.filter((name) => !sourceNameSet.has(name));
const buildingPattern = /^(T1|TI)-GF-/i;
const primitiveCount = (json.meshes ?? []).reduce(
  (total, mesh) => total + (mesh.primitives?.length ?? 0),
  0,
);

console.log(
  JSON.stringify(
    {
      sourcePath,
      publicPath,
      sourceBytes: sourceBuffer.byteLength,
      sourceSha256: sourceHash,
      publicSha256: publicHash,
      byteIdentical: sourceHash === publicHash,
      logicalNodes: json.nodes?.length ?? 0,
      namedNodes: names.length,
      duplicateNames,
      buildingNames: names.filter((name) => buildingPattern.test(name)),
      buildingCount: names.filter((name) => buildingPattern.test(name)).length,
      addedNames,
      removedNames,
      gltfMeshes: json.meshes?.length ?? 0,
      primitives: primitiveCount,
      runtimeRenderMeshes: renderMeshes,
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      cameras: json.cameras?.length ?? 0,
      triangles: Math.round(triangles),
      bounds: {
        min: box.min.toArray(),
        max: box.max.toArray(),
        center: center.toArray(),
        size: size.toArray(),
      },
    },
    null,
    2,
  ),
);
