// Bump these immutable asset revisions whenever a new Blender/SVG export is
// placed in public. The query string avoids a browser reusing an older map
// during the configured public-asset cache lifetime.
export const GROUND_FLOOR_MODEL_URL =
  "/models/buildings-ground-floor.glb?v=f163edd3";

export const GROUND_FLOOR_NAVIGATION_URL =
  "/navigation/navigation-graph-ground-floor.svg?v=b34e7066";
