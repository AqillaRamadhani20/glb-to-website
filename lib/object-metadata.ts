import * as THREE from "three";

export type CategoryKey =
  | "building"
  | "wall"
  | "pillar"
  | "glass"
  | "door-glass"
  | "door-frame"
  | "escalator"
  | "departure"
  | "arrival"
  | "red-area"
  | "visitor"
  | "fountain"
  | "lost-found";

export type ObjectMetadata = {
  key: CategoryKey;
  category: string;
  location: string;
  status: string;
  color: string;
};

export type RuntimeMaterialStyle = {
  key: CategoryKey;
  color: string;
  opacity: number;
  transparent: boolean;
  roughness: number;
  metalness: number;
};

export type SelectedObject = ObjectMetadata & {
  uuid: string;
  name: string;
  position: [number, number, number];
};

const BASE_LOCATION = "Terminal 1 - Ground Floor";

export const COLOR_PALETTE: Record<CategoryKey, string> = {
  building: "#D8C7A7",
  wall: "#B8BEC4",
  pillar: "#E8E6DE",
  glass: "#9ED9E5",
  "door-glass": "#AEE6EC",
  "door-frame": "#34434A",
  escalator: "#C98B55",
  departure: "#4FA66A",
  arrival: "#4D82C4",
  "red-area": "#C95A56",
  visitor: "#E7D495",
  fountain: "#5AA9E6",
  "lost-found": "#8B78B8",
};

function categoryForObject(objectName: string): CategoryKey {
  const name = objectName.trim().toLocaleLowerCase("id-ID");
  if (/^t[i1]-gf-/.test(name)) return "building";
  if (name.startsWith("area_merah")) return "red-area";
  if (name.startsWith("area_visitor")) return "visitor";
  if (name.startsWith("air-mancur") || name.startsWith("fountain__")) {
    return "fountain";
  }
  if (/lost[ _-]*(n|and)?[ _-]*found/.test(name)) return "lost-found";
  if (name.startsWith("eskalator") || name.startsWith("esc_vis__")) {
    return "escalator";
  }
  if (name.startsWith("door__")) return "door-frame";
  if (name.startsWith("dinding-kaca") || name.startsWith("glass__")) {
    return "glass";
  }
  if (name.startsWith("tembok_pilar") || name.includes("pilar")) {
    return "pillar";
  }
  if (name.startsWith("keberangkatan")) return "departure";
  if (name.startsWith("kedatangan")) return "arrival";
  if (
    /^(rectangle|vector|curve)/.test(name) ||
    name.includes("wall") ||
    name.includes("dinding") ||
    name.includes("tembok")
  ) {
    return "wall";
  }
  return "building";
}

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  building: "Building / unit terminal",
  wall: "Wall / struktur umum",
  pillar: "Pilar terminal",
  glass: "Kaca arsitektural",
  "door-glass": "Kaca pintu",
  "door-frame": "Frame pintu",
  escalator: "Sirkulasi vertikal",
  departure: "Area keberangkatan",
  arrival: "Area kedatangan",
  "red-area": "Area merah",
  visitor: "Lantai area visitor",
  fountain: "Air mancur",
  "lost-found": "Lost & Found",
};

export function getObjectMetadata(objectName: string): ObjectMetadata {
  const key = categoryForObject(objectName);
  return {
    key,
    category: CATEGORY_LABELS[key],
    location: BASE_LOCATION,
    status: "Terdata",
    color: COLOR_PALETTE[key],
  };
}

export function getRuntimeMaterialStyle(
  objectName: string,
  materialName: string,
): RuntimeMaterialStyle {
  const normalizedObject = objectName.trim().toLocaleLowerCase("id-ID");
  const normalizedMaterial = materialName.trim().toLocaleLowerCase("id-ID");
  let key = categoryForObject(objectName);

  if (normalizedObject.startsWith("door__")) {
    key = normalizedMaterial.includes("glass") ? "door-glass" : "door-frame";
  } else if (
    normalizedObject.startsWith("glass__") &&
    normalizedMaterial.includes("frame")
  ) {
    key = "door-frame";
  }

  const isTransparent = key === "glass" || key === "door-glass";
  return {
    key,
    color: COLOR_PALETTE[key],
    opacity: key === "glass" ? 0.42 : key === "door-glass" ? 0.5 : 1,
    transparent: isTransparent,
    roughness: isTransparent ? 0.16 : key === "door-frame" ? 0.34 : 0.76,
    metalness: key === "door-frame" ? 0.34 : 0,
  };
}

export function createSelectedObject(object: THREE.Object3D): SelectedObject {
  const worldPosition = new THREE.Vector3();
  const sourceObjectName = object.userData.sourceObjectName || object.name;
  object.getWorldPosition(worldPosition);

  return {
    uuid: object.uuid,
    name: sourceObjectName,
    position: [worldPosition.x, worldPosition.y, worldPosition.z],
    ...getObjectMetadata(sourceObjectName),
  };
}
