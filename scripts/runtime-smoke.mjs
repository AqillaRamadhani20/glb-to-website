import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browserPath =
  process.env.BROWSER_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});

const runtimeErrors = [];

function attachErrorCapture(page) {
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
}

async function waitForViewer(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  try {
    await page.waitForFunction(
      () => document.body.textContent?.includes("949 OBJEK / 96 BUILDING"),
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    console.error("Viewer text at timeout:", await page.locator("body").innerText());
    console.error("Captured runtime errors:", runtimeErrors);
    throw error;
  }
  await page.locator("canvas").waitFor({ state: "visible" });
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
attachErrorCapture(desktop);
await waitForViewer(desktop);

const audit = await desktop.evaluate(() => window.__TERMINAL_WAYFINDING_AUDIT__);
assert.ok(audit, "Runtime audit must be exposed");
assert.deepEqual(audit.navigationViewBox, {
  minX: 0,
  minY: 0,
  width: 22973,
  height: 3405,
});
assert.equal(audit.graphCounts.nodes, 510);
assert.equal(audit.graphCounts.edges, 507);
assert.equal(audit.graphCounts.pois, 244);
assert.equal(audit.graphCounts.conditionalEdges, 51);
assert.equal(audit.unmatchedEdges.length, 6);
assert.equal(
  audit.svgToWorld.source,
  "semantic-ransac",
  "SVG/GLB alignment must use the data-derived global semantic transform",
);
assert.ok(
  audit.svgToWorld.calibrationAnchorCount >= 12,
  "Global calibration needs a stable semantic-anchor consensus",
);
assert.ok(
  audit.svgToWorld.rmseX < 1.5 && audit.svgToWorld.rmseZ < 1.5,
  "Accepted anchors must remain spatially coherent in the final global transform",
);
assert.equal(audit.runtimeColorCoverage.renderMeshes, 1014);
assert.equal(audit.runtimeColorCoverage.styledMaterialSlots, 1014);
assert.equal(audit.buildingStartCoverage.totalBuildings, 96);
assert.equal(audit.buildingStartCoverage.startableBuildings, 96);
assert.deepEqual(audit.buildingStartCoverage.unmappedBuildings, []);
assert.equal(
  audit.runtimeHiddenObjectNames.length,
  22,
  "Only the known duplicate commercial obstruction meshes must be hidden at runtime",
);
assert.ok(audit.runtimeHiddenObjectNames.includes("tembok_pilar_37"));
assert.ok(audit.runtimeHiddenObjectNames.includes("tembok_pilar_358"));
assert.equal(
  audit.runtimeColorCoverage.styledMaterialSlots,
  audit.runtimeColorCoverage.materialSlots,
  "Every material slot, including floors, must receive a runtime color",
);
for (const category of [
  "building",
  "wall",
  "pillar",
  "glass",
  "door-glass",
  "door-frame",
  "escalator",
  "departure",
  "arrival",
  "red-area",
  "visitor",
  "fountain",
  "lost-found",
]) {
  assert.ok(
    audit.runtimeColorCoverage.categories[category] > 0,
    `Missing runtime color category: ${category}`,
  );
}

const canvasBox = await desktop.locator("canvas").boundingBox();
assert.ok(
  canvasBox && canvasBox.width === 1440 && canvasBox.height === 900,
  "Canvas must fill the viewport",
);
assert.equal(await desktop.locator(".viewer-shell").getAttribute("data-view-mode"), "map");
assert.match(
  await desktop.locator(".start-required-message").textContent(),
  /Pilih posisi awal terlebih dahulu/,
);

const search = desktop.getByRole("textbox", {
  name: "Cari building berdasarkan object.name",
});
await search.fill("T1-GF-79");
await desktop.getByRole("button", { name: /T1-GF-79/ }).first().click();
await desktop.getByRole("heading", { name: "T1-GF-79", exact: true }).waitFor();
await desktop.getByRole("button", { name: "Start Here" }).click();
await desktop.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-start-node"),
);
const desktopStartNode = await desktop
  .locator(".viewer-shell")
  .getAttribute("data-start-node");
assert.match(
  await desktop.locator(".start-node-card strong").textContent(),
  /(T1-GF-79|NODE_GF_)/,
  "Building start must resolve to an original navigation node",
);
await desktop.getByText("YOU ARE HERE", { exact: true }).waitFor();

await search.fill("T1-GF-85");
const result = desktop.getByRole("button", { name: /T1-GF-85/ }).first();
await result.waitFor({ state: "visible" });
await result.click();

await desktop.getByRole("heading", { name: "T1-GF-85", exact: true }).waitFor();
assert.equal(await desktop.locator(".object-name-value").textContent(), "T1-GF-85");
assert.equal(await desktop.locator(".coordinates .coordinate").count(), 3);
assert.match(await desktop.locator(".route-message").textContent(), /Route Here/);
await desktop.getByRole("button", { name: "Route Here" }).click();
await desktop.waitForFunction(
  () =>
    document.querySelector(".route-message")?.textContent?.includes("edge asli") &&
    document.querySelector(".viewer-shell")?.getAttribute("data-destination-node") &&
    document.querySelector(".viewer-shell")?.getAttribute("data-route-active") ===
      "true" &&
    document.querySelector(".viewer-shell")?.getAttribute("data-view-mode") === "pov",
);
assert.match(await desktop.locator(".route-message").textContent(), /edge asli/);
assert.doesNotMatch(await desktop.locator(".route-block").innerText(), /Edge \/ jarak\s+-/);
await desktop.getByText("DESTINATION", { exact: true }).waitFor();
await desktop.locator(".navigation-guidance-card").waitFor();
await desktop.locator(".navigation-session-panel").waitFor();
const activeRouteAudit = await desktop.evaluate(
  () => window.__TERMINAL_ACTIVE_ROUTE_AUDIT__,
);
assert.ok(activeRouteAudit, "Active route audit must be exposed");
assert.ok(activeRouteAudit.edgeCount > 0);
assert.ok(activeRouteAudit.pointCount >= activeRouteAudit.edgeCount + 1);
assert.match(
  await desktop.locator(".navigation-guidance-card").innerText(),
  /(Lurus|Belok kiri|Belok kanan|Tujuan di depan)/,
);

await desktop.waitForTimeout(900);
const movingProgress = Number(
  await desktop.locator(".navigation-session-panel").getAttribute("data-route-progress"),
);
assert.ok(movingProgress > 0, "Visitor POV route progress must advance");

await desktop.getByRole("button", { name: "Pause route" }).click();
await desktop.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-route-paused") === "true",
);
const pausedProgress = Number(
  await desktop.locator(".navigation-session-panel").getAttribute("data-route-progress"),
);
await desktop.waitForTimeout(450);
assert.equal(
  Number(
    await desktop.locator(".navigation-session-panel").getAttribute("data-route-progress"),
  ),
  pausedProgress,
  "Pause must stop route progress",
);

await desktop.getByRole("button", { name: "Route overview" }).click();
await desktop.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-view-mode") === "map",
);
await desktop.getByRole("button", { name: "Recenter route" }).click();
await desktop.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-view-mode") === "pov",
);
await desktop.getByRole("button", { name: "Restart route" }).click();
await desktop.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-route-paused") === "false",
);
await desktop.waitForTimeout(400);
assert.ok(
  Number(
    await desktop.locator(".navigation-session-panel").getAttribute("data-route-progress"),
  ) <= 2,
  "Restart must return progress to the beginning",
);
await desktop.waitForTimeout(1600);
await desktop.screenshot({ path: "runtime-audit/desktop-active-route-pov.png" });

await desktop.getByRole("button", { name: "Pause route" }).click();
await desktop.getByRole("button", { name: "Route overview" }).click();

await desktop.getByRole("button", { name: "Toggle debug navigation" }).click();
await desktop.locator(".debug-navigation-panel").waitFor();
const debugText = await desktop.locator(".debug-navigation-panel").innerText();
assert.match(debugText, /510/);
assert.match(debugText, /507/);
assert.match(debugText, /244/);
assert.match(debugText, /51 nonaktif/);
assert.match(debugText, /6/);
assert.match(debugText, /96 \/ 96/);
assert.match(debugText, /1014 \/ 1014/);
await desktop.getByRole("button", { name: "Toggle debug navigation" }).click();

await desktop.getByRole("button", { name: "Zoom in" }).click();
await desktop.getByRole("button", { name: "Zoom out" }).click();
await desktop.getByRole("button", { name: /Reset view/ }).click();

const centerX = canvasBox.x + canvasBox.width * 0.56;
const centerY = canvasBox.y + canvasBox.height * 0.52;
await desktop.mouse.move(centerX, centerY);
await desktop.mouse.down({ button: "left" });
await desktop.mouse.move(centerX + 45, centerY + 24, { steps: 4 });
await desktop.mouse.up({ button: "left" });
await desktop.mouse.down({ button: "right" });
await desktop.mouse.move(centerX - 35, centerY + 18, { steps: 4 });
await desktop.mouse.up({ button: "right" });
await desktop.mouse.wheel(0, -220);
assert.equal(
  await desktop.locator(".object-name-value").textContent(),
  "T1-GF-85",
  "Dragging the camera must not change the selected object",
);

const performanceSummary = await desktop.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const resources = performance.getEntriesByType("resource");
  return {
    domInteractiveMs: Math.round(navigation?.domInteractive ?? 0),
    loadEventMs: Math.round(navigation?.loadEventEnd ?? 0),
    resourceCount: resources.length,
    transferredBytes: Math.round(
      resources.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
    ),
  };
});

await desktop.screenshot({ path: "runtime-audit/desktop-route-overview.png" });

await desktop.getByRole("button", { name: "End route" }).click();
await desktop.waitForFunction(
  () =>
    document.querySelector(".viewer-shell")?.getAttribute("data-route-active") ===
    "false",
);
await desktop.getByRole("button", { name: "Reset Route" }).click();
assert.equal(await desktop.locator(".viewer-shell").getAttribute("data-start-node"), "");
assert.match(
  await desktop.locator(".start-required-message").textContent(),
  /Pilih posisi awal terlebih dahulu/,
);

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
attachErrorCapture(mobile);
await waitForViewer(mobile);
await mobile.getByRole("button", { name: "Set Start" }).click();
await mobile.getByText("Pilih building, node, atau POI yang tampil pada map.").waitFor();
await mobile.screenshot({ path: "runtime-audit/mobile-start-picker.png" });
const mobileSearch = mobile.getByRole("textbox", {
  name: "Cari building berdasarkan object.name",
});
await mobileSearch.fill("T1-GF-79");
await mobile.getByRole("button", { name: /T1-GF-79/ }).first().click();
await mobile.waitForFunction(
  () => document.querySelector(".viewer-shell")?.getAttribute("data-start-node"),
);
const mobileStartNode = await mobile
  .locator(".viewer-shell")
  .getAttribute("data-start-node");
assert.match(
  await mobile.locator(".start-node-card strong").textContent(),
  /(T1-GF-79|NODE_GF_)/,
);
await mobileSearch.fill("T1-GF-85");
await mobile.getByRole("button", { name: /T1-GF-85/ }).first().click();
await mobile.getByRole("heading", { name: "T1-GF-85", exact: true }).waitFor();
assert.equal(await mobile.getByRole("button", { name: "Route Here" }).isDisabled(), false);
await mobile.getByRole("button", { name: "Route Here" }).click();
await mobile.waitForFunction(
  () =>
    document.querySelector(".viewer-shell")?.getAttribute("data-route-active") ===
      "true" &&
    document.querySelector(".viewer-shell")?.getAttribute("data-view-mode") === "pov",
);
await mobile.locator(".navigation-guidance-card").waitFor();
await mobile.locator(".navigation-session-panel").waitFor();
await mobile.waitForTimeout(2400);
await mobile.screenshot({ path: "runtime-audit/mobile-active-route-pov.png" });
await mobile.getByRole("button", { name: "Pause route" }).click();
await mobile.getByRole("button", { name: "Route overview" }).click();
await mobile.getByRole("button", { name: "End route" }).click();

assert.deepEqual(runtimeErrors, [], `Runtime console errors: ${runtimeErrors.join(" | ")}`);

console.log(
  JSON.stringify(
    {
      objectCount: 949,
      buildingCount: 96,
      graph: {
        nodes: 510,
        edges: 507,
        pois: 244,
        conditionalEdges: 51,
        unmatchedEdges: 6,
      },
      colorCoverage: audit.runtimeColorCoverage,
      runtimeHiddenObjectNames: audit.runtimeHiddenObjectNames,
      transform: audit.svgToWorld,
      activeRoute: activeRouteAudit,
      desktop: {
        canvas: canvasBox,
        start: desktopStartNode,
        destination: "T1-GF-85",
        viewModes: ["map", "pov", "map"],
      },
      mobile: {
        viewport: [390, 844],
        start: mobileStartNode,
        destination: "T1-GF-85",
        activeRouteHud: true,
      },
      performance: performanceSummary,
      runtimeErrors,
    },
    null,
    2,
  ),
);

await browser.close();
