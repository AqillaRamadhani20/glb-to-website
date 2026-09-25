"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneScene } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import {
  createSelectedObject,
  getObjectMetadata,
  getRuntimeMaterialStyle,
  type ObjectMetadata,
  type SelectedObject,
} from "@/lib/object-metadata";
import { GROUND_FLOOR_MODEL_URL } from "@/lib/assets";

// These meshes are duplicate wall/pillar geometry directly above the
// commercial frontage (T1-GF-41 through T1-GF-48) in the supplied export.
// The source GLB is left untouched; only their runtime visibility is disabled
// so the website matches the approved latest map composition.
const HIDDEN_COMMERCIAL_OVERHEAD_OBJECT =
  /^tembok_pilar_(?:31[0-9]|63[1-9]|640|37|358)$/i;

export type SceneObjectRecord = {
  uuid: string;
  name: string;
  object: THREE.Object3D;
  metadata: ObjectMetadata;
  nodeIndex: number;
  selectable: boolean;
};

export type SceneBounds = {
  box: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
  colorCoverage: {
    renderMeshes: number;
    materialSlots: number;
    styledMaterialSlots: number;
    categories: Record<string, number>;
  };
  runtimeHiddenObjectNames: string[];
};

type SceneModelProps = {
  selectedUuid: string | null;
  onSelect: (selection: SelectedObject) => void;
  onReady: (bounds: SceneBounds, objects: SceneObjectRecord[]) => void;
};

type ColorMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  roughness?: number;
  metalness?: number;
};

type GltfAssociation = {
  nodes?: number;
};

type GltfNodeDefinition = {
  name?: string;
  mesh?: number;
};

function tagSourceHierarchy(
  source: THREE.Object3D,
  runtime: THREE.Object3D,
  associations: Map<THREE.Object3D, GltfAssociation>,
  nodeDefinitions: GltfNodeDefinition[],
  inheritedName?: string,
  inheritedUuid?: string,
) {
  const association = associations.get(source);
  let logicalName = inheritedName;
  let logicalUuid = inheritedUuid;

  if (association?.nodes !== undefined) {
    const nodeIndex = association.nodes;
    logicalName = nodeDefinitions[nodeIndex]?.name || source.name;
    logicalUuid = runtime.uuid;
    runtime.name = logicalName;
    runtime.userData.gltfNodeIndex = nodeIndex;
  }

  if (logicalName && logicalUuid) {
    runtime.userData.sourceObjectName = logicalName;
    runtime.userData.logicalObjectUuid = logicalUuid;
  }

  source.children.forEach((sourceChild, index) => {
    const runtimeChild = runtime.children[index];
    if (!runtimeChild) return;
    tagSourceHierarchy(
      sourceChild,
      runtimeChild,
      associations,
      nodeDefinitions,
      logicalName,
      logicalUuid,
    );
  });
}

export function isSelectableBuildingName(objectName: string) {
  return /^(T1|TI)-GF-/i.test(objectName);
}

function prepareRuntimeMaterial(material: THREE.Material, objectName: string) {
  const runtimeMaterial = material as ColorMaterial;
  const style = getRuntimeMaterialStyle(objectName, material.name);

  if (runtimeMaterial.color instanceof THREE.Color) {
    runtimeMaterial.color.set(style.color);
    runtimeMaterial.userData.baseColor = runtimeMaterial.color.getHex();
  }
  runtimeMaterial.opacity = style.opacity;
  runtimeMaterial.transparent = style.transparent;
  runtimeMaterial.depthWrite = !style.transparent;
  if (typeof runtimeMaterial.roughness === "number") {
    runtimeMaterial.roughness = style.roughness;
  }
  if (typeof runtimeMaterial.metalness === "number") {
    runtimeMaterial.metalness = style.metalness;
  }
  runtimeMaterial.userData.runtimeColorKey = style.key;
  runtimeMaterial.userData.runtimeColor = style.color;

  if (runtimeMaterial.emissive instanceof THREE.Color) {
    runtimeMaterial.userData.baseEmissive = runtimeMaterial.emissive.getHex();
    runtimeMaterial.userData.baseEmissiveIntensity = runtimeMaterial.emissiveIntensity ?? 1;
  }

  runtimeMaterial.needsUpdate = true;
}

function updateSelectionMaterial(material: THREE.Material, selected: boolean) {
  const runtimeMaterial = material as ColorMaterial;
  const baseColor = runtimeMaterial.userData.baseColor;

  if (selected) {
    if (runtimeMaterial.emissive instanceof THREE.Color) {
      runtimeMaterial.emissive.set("#FF7A45");
      runtimeMaterial.emissiveIntensity = 0.38;
    } else if (
      runtimeMaterial.color instanceof THREE.Color &&
      typeof baseColor === "number"
    ) {
      runtimeMaterial.color
        .setHex(baseColor)
        .lerp(new THREE.Color("#FF7A45"), 0.42);
    }
  } else {
    if (runtimeMaterial.emissive instanceof THREE.Color) {
      runtimeMaterial.emissive.setHex(
        runtimeMaterial.userData.baseEmissive ?? 0x000000,
      );
      runtimeMaterial.emissiveIntensity =
        runtimeMaterial.userData.baseEmissiveIntensity ?? 1;
    }
    if (
      runtimeMaterial.color instanceof THREE.Color &&
      typeof baseColor === "number"
    ) {
      runtimeMaterial.color.setHex(baseColor);
    }
  }
}

export function SceneModel({ selectedUuid, onSelect, onReady }: SceneModelProps) {
  const gltf = useGLTF(GROUND_FLOOR_MODEL_URL);
  const [hovered, setHovered] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; button: number } | null>(null);

  const model = useMemo(() => {
    const runtimeScene = cloneScene(gltf.scene);
    const parser = gltf.parser as typeof gltf.parser & {
      associations: Map<THREE.Object3D, GltfAssociation>;
      json: { nodes?: GltfNodeDefinition[] };
    };
    const nodeDefinitions = parser.json.nodes ?? [];

    tagSourceHierarchy(
      gltf.scene,
      runtimeScene,
      parser.associations,
      nodeDefinitions,
    );

    runtimeScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const sourceObjectName = object.userData.sourceObjectName || object.name;
      if (HIDDEN_COMMERCIAL_OVERHEAD_OBJECT.test(sourceObjectName)) {
        object.visible = false;
        object.userData.runtimeVisibilityReason = "commercial-overhead-obstruction";
      }
      const metadata = getObjectMetadata(sourceObjectName);
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const runtimeMaterials = sourceMaterials.map((sourceMaterial) => {
        const runtimeMaterial = sourceMaterial.clone();
        prepareRuntimeMaterial(runtimeMaterial, sourceObjectName);
        return runtimeMaterial;
      });

      object.material = Array.isArray(object.material) ? runtimeMaterials : runtimeMaterials[0];
      object.userData.runtimeCategory = metadata.key;
    });

    return runtimeScene;
  }, [gltf.scene]);

  useLayoutEffect(() => {
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    const objects: SceneObjectRecord[] = [];
    const colorCoverage: SceneBounds["colorCoverage"] = {
      renderMeshes: 0,
      materialSlots: 0,
      styledMaterialSlots: 0,
      categories: {},
    };
    const runtimeHiddenObjectNames: string[] = [];
    const nodeDefinitions = (
      gltf.parser as typeof gltf.parser & { json: { nodes?: GltfNodeDefinition[] } }
    ).json.nodes ?? [];

    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (
          object.userData.runtimeVisibilityReason ===
          "commercial-overhead-obstruction"
        ) {
          runtimeHiddenObjectNames.push(
            object.userData.sourceObjectName || object.name,
          );
        }
        colorCoverage.renderMeshes += 1;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          colorCoverage.materialSlots += 1;
          const colorKey = material.userData.runtimeColorKey;
          if (typeof colorKey !== "string") continue;
          colorCoverage.styledMaterialSlots += 1;
          colorCoverage.categories[colorKey] =
            (colorCoverage.categories[colorKey] ?? 0) + 1;
        }
      }
      const nodeIndex = object.userData.gltfNodeIndex;
      if (typeof nodeIndex !== "number" || nodeDefinitions[nodeIndex]?.mesh === undefined) return;
      const sourceObjectName = object.userData.sourceObjectName || object.name;
      objects.push({
        uuid: object.uuid,
        name: sourceObjectName,
        object,
        metadata: getObjectMetadata(sourceObjectName),
        nodeIndex,
        selectable: isSelectableBuildingName(sourceObjectName),
      });
    });

    objects.sort((a, b) => a.nodeIndex - b.nodeIndex);
    onReady(
      {
        box,
        center,
        size,
        radius,
        colorCoverage,
        runtimeHiddenObjectNames,
      },
      objects,
    );
  }, [gltf.parser, model, onReady]);

  useLayoutEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) =>
        updateSelectionMaterial(material, object.userData.logicalObjectUuid === selectedUuid),
      );
    });
  }, [model, selectedUuid]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.button !== 0 || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;

    event.stopPropagation();
    if (event.object instanceof THREE.Mesh) {
      let logicalObject: THREE.Object3D | null = event.object;
      while (
        logicalObject &&
        typeof logicalObject.userData.gltfNodeIndex !== "number" &&
        logicalObject !== model
      ) {
        logicalObject = logicalObject.parent;
      }
      const selectedObject = logicalObject || event.object;
      const sourceName =
        selectedObject.userData.sourceObjectName || selectedObject.name;
      if (isSelectableBuildingName(sourceName)) {
        onSelect(createSelectedObject(selectedObject));
      }
    }
  };

  return (
    <primitive
      object={model}
      dispose={null}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        pointerStart.current = {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
        };
      }}
      onPointerUp={handlePointerUp}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        let logicalObject: THREE.Object3D | null = event.object;
        while (
          logicalObject &&
          typeof logicalObject.userData.gltfNodeIndex !== "number" &&
          logicalObject !== model
        ) {
          logicalObject = logicalObject.parent;
        }
        const sourceName =
          logicalObject?.userData.sourceObjectName || logicalObject?.name || "";
        if (isSelectableBuildingName(sourceName)) {
          event.stopPropagation();
          setHovered(true);
        }
      }}
      onPointerOut={() => setHovered(false)}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
    />
  );
}

useGLTF.preload(GROUND_FLOOR_MODEL_URL);
