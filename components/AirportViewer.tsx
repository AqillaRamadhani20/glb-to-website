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
  ChevronRight,
  Crosshair,
  Info,
  LocateFixed,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import * as THREE from "three";
import {
  SceneModel,
  type SceneBounds,
  type SceneObjectRecord,
} from "@/components/SceneModel";
import type { SelectedObject } from "@/lib/object-metadata";

type ViewerApi = {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusObject: (object: THREE.Object3D) => void;
};

const CameraController = forwardRef<ViewerApi, { bounds: SceneBounds | null }>(
  function CameraController({ bounds }, ref) {
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
        const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
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
      if (!bounds || !(camera instanceof THREE.PerspectiveCamera) || !controlsRef.current) return;

      const direction = new THREE.Vector3(1, 0.9, 1).normalize();
      const distance = getFitDistance(bounds.box, direction, 1.12);

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
        const currentDistance = offset.length();
        const nextDistance = THREE.MathUtils.clamp(
          currentDistance * factor,
          controlsRef.current.minDistance,
          controlsRef.current.maxDistance,
        );

        camera.position.copy(target).add(offset.normalize().multiplyScalar(nextDistance));
        controlsRef.current.update();
        invalidate();
      },
      [camera, invalidate],
    );

    const focusObject = useCallback(
      (object: THREE.Object3D) => {
        if (!controlsRef.current || !(camera instanceof THREE.PerspectiveCamera)) return;

        object.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const direction = camera.position.clone().sub(controlsRef.current.target).normalize();
        const minFocusDistance = bounds ? bounds.radius * 0.035 : 1;
        const distance = Math.max(getFitDistance(box, direction, 1.32), minFocusDistance);

        controlsRef.current.target.copy(center);
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        controlsRef.current.update();
        invalidate();
      },
      [bounds, camera, getFitDistance, invalidate],
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
      }),
      [fitView, focusObject, zoomBy],
    );

    return (
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableRotate
        enableZoom
        screenSpacePanning
        panSpeed={1.1}
        rotateSpeed={0.55}
        zoomSpeed={0.85}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
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
        <span>MEMUAT MODEL TERMINAL</span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div className="loader-track">
        <div style={{ width: `${progress}%` }} />
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

const legend = [
  ["#39B77A", "Keberangkatan"],
  ["#3B82F6", "Kedatangan"],
  ["#F59E0B", "Eskalator"],
  ["#A9DDF5", "Kaca"],
  ["#C9714D", "Tenant"],
  ["#1AA89C", "Fasilitas"],
  ["#E9E7E1", "Struktur"],
] as const;

export function AirportViewer() {
  const viewerApi = useRef<ViewerApi>(null);
  const [bounds, setBounds] = useState<SceneBounds | null>(null);
  const [objects, setObjects] = useState<SceneObjectRecord[]>([]);
  const [selected, setSelected] = useState<SelectedObject | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const handleReady = useCallback((nextBounds: SceneBounds, nextObjects: SceneObjectRecord[]) => {
    setBounds(nextBounds);
    setObjects(nextObjects);
  }, []);

  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
    if (!normalizedQuery) return [];
    return objects
      .filter((item) => item.name.toLocaleLowerCase("id-ID").includes(normalizedQuery))
      .slice(0, 8);
  }, [objects, query]);

  const chooseSearchResult = (record: SceneObjectRecord) => {
    const position = new THREE.Vector3();
    record.object.getWorldPosition(position);
    setSelected({
      uuid: record.uuid,
      name: record.name,
      position: [position.x, position.y, position.z],
      ...record.metadata,
    });
    setQuery(record.name);
    setSearchFocused(false);
    viewerApi.current?.focusObject(record.object);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key.toLocaleLowerCase("id-ID") === "r" && !(event.target instanceof HTMLInputElement)) {
        viewerApi.current?.resetView();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="viewer-shell">
      <div className="canvas-stage">
        <Canvas
          dpr={[1, 1.75]}
          frameloop="demand"
          camera={{ fov: 36, near: 0.01, far: 100000, position: [6, 6, 6] }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1;
          }}
          onPointerMissed={() => setSelected(null)}
        >
          <ambientLight intensity={0.7} color="#FFFFFF" />
          <hemisphereLight intensity={1.2} color="#FFFFFF" groundColor="#87919A" />
          <directionalLight position={[12, 20, 10]} intensity={2.1} color="#FFFDF7" />
          <directionalLight position={[-10, 8, -12]} intensity={0.65} color="#D9E8FF" />
          <Suspense fallback={null}>
            <SceneModel
              selectedUuid={selected?.uuid ?? null}
              onSelect={setSelected}
              onReady={handleReady}
            />
          </Suspense>
          <CameraController ref={viewerApi} bounds={bounds} />
        </Canvas>
      </div>

      <LoadingOverlay />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-icon" aria-hidden="true">
            <LocateFixed size={20} strokeWidth={1.8} />
          </div>
          <div>
            <p>TERMINAL 01</p>
            <h1>Spatial Navigator</h1>
          </div>
        </div>

        <div className="model-status">
          <span className="status-pulse" />
          <span>MODEL AKTIF</span>
          <strong>{objects.length || "—"} OBJEK</strong>
        </div>

        <div className="camera-actions" aria-label="Kontrol kamera">
          <button
            type="button"
            className="action-button action-button-wide"
            onClick={() => viewerApi.current?.resetView()}
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
          WAYFINDING
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            placeholder="Cari nama objek…"
            aria-label="Cari objek berdasarkan nama"
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
            {searchResults.length > 0 ? (
              searchResults.map((record) => (
                <button key={record.uuid} type="button" onMouseDown={() => chooseSearchResult(record)}>
                  <span className="result-dot" style={{ background: record.metadata.color ?? "#95A0AA" }} />
                  <span>
                    <strong>{record.name}</strong>
                    <small>{record.metadata.category}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <p className="empty-result">Nama objek tidak ditemukan.</p>
            )}
          </div>
        )}

        <div className="gesture-guide">
          <div>
            <MousePointer2 size={15} />
            <span>KLIK + GESER KIRI</span>
            <strong>Geser peta</strong>
          </div>
          <div>
            <MousePointer2 size={15} className="right-click-icon" />
            <span>KLIK + GESER KANAN</span>
            <strong>Putar kamera</strong>
          </div>
          <div>
            <Plus size={15} />
            <span>SCROLL / PINCH</span>
            <strong>Perbesar & perkecil</strong>
          </div>
        </div>
      </aside>

      <aside className={`object-panel ${selected ? "is-visible" : ""}`} aria-live="polite">
        {selected ? (
          <>
            <div className="object-panel-head">
              <div className="selected-marker" style={{ background: selected.color ?? "#8D98A2" }} />
              <div>
                <span>OBJEK TERPILIH</span>
                <h2>{selected.name}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Tutup detail objek">
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
          </>
        ) : (
          <div className="empty-selection">
            <Info size={19} />
            <div>
              <strong>Pilih sebuah objek</strong>
              <span>Klik mesh pada model untuk membuka data spasialnya.</span>
            </div>
          </div>
        )}
      </aside>

      <div className="legend-bar" aria-label="Legenda warna objek">
        <span className="legend-title">LEGENDA</span>
        {legend.map(([color, label]) => (
          <span className="legend-item" key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      <div className="coordinate-readout" aria-hidden="true">
        <span>GLB / WORLD SPACE</span>
        <strong>Y–UP</strong>
      </div>
    </main>
  );
}
