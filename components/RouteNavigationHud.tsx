"use client";

import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Flag,
  LocateFixed,
  Map,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import {
  VISITOR_SPEED_METERS_PER_SECOND,
  type RouteGuidance,
  type RoutePlaybackSnapshot,
} from "@/lib/route-guidance";

type RouteNavigationHudProps = {
  destinationName: string;
  edgeCount: number;
  totalDistance: number;
  progress: RoutePlaybackSnapshot;
  guidance: RouteGuidance;
  paused: boolean;
  onOverview: () => void;
  onTogglePause: () => void;
  onRecenter: () => void;
  onRestart: () => void;
  onEnd: () => void;
};

function formatDistance(distance: number) {
  if (distance < 10) return Math.max(0, Math.round(distance)) + " m";
  return Math.round(distance / 5) * 5 + " m";
}

function GuidanceIcon({ kind }: { kind: RouteGuidance["kind"] }) {
  if (kind === "left") return <CornerUpLeft size={28} strokeWidth={2.4} />;
  if (kind === "right") return <CornerUpRight size={28} strokeWidth={2.4} />;
  if (kind === "arrive") return <Flag size={26} strokeWidth={2.4} />;
  return <ArrowUp size={28} strokeWidth={2.4} />;
}

export function RouteNavigationHud({
  destinationName,
  edgeCount,
  totalDistance,
  progress,
  guidance,
  paused,
  onOverview,
  onTogglePause,
  onRecenter,
  onRestart,
  onEnd,
}: RouteNavigationHudProps) {
  const remaining = Math.max(totalDistance - progress.distance, 0);
  const remainingMinutes = Math.max(
    1,
    Math.ceil(remaining / VISITOR_SPEED_METERS_PER_SECOND / 60),
  );
  const progressPercent = Math.round(progress.progress * 100);
  const currentSegment = Math.min(
    edgeCount,
    Math.max(1, Math.floor(progress.progress * Math.max(edgeCount, 1)) + 1),
  );

  return (
    <>
      <section className="navigation-guidance-card" aria-live="polite">
        <div className={"guidance-icon is-" + guidance.kind}>
          <GuidanceIcon kind={guidance.kind} />
        </div>
        <div>
          <span>ARAH BERIKUTNYA</span>
          <strong>{guidance.label}</strong>
          <b>{formatDistance(guidance.distance)}</b>
        </div>
      </section>

      <section
        className="navigation-session-panel"
        data-route-progress={progressPercent}
      >
        <div className="navigation-session-heading">
          <div>
            <span>MENUJU</span>
            <h2>{destinationName}</h2>
          </div>
          <div className="navigation-floor-chip">GROUND FLOOR</div>
        </div>

        <div className="navigation-trip-summary">
          <strong>
            {formatDistance(remaining)} / sekitar {remainingMinutes} menit
          </strong>
          <span>Terminal 1 / Indoor route</span>
        </div>

        <div className="navigation-progress-copy">
          <span>
            Segmen {currentSegment} dari {Math.max(edgeCount, 1)}
          </span>
          <strong>{progressPercent}%</strong>
        </div>
        <div
          className="navigation-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
        >
          <div style={{ width: progressPercent + "%" }} />
          <i style={{ left: progressPercent + "%" }} />
        </div>

        <div className="navigation-session-actions">
          <button type="button" onClick={onOverview} aria-label="Route overview">
            <Map size={15} /> Overview
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            className={paused ? "is-paused" : ""}
            aria-label={paused ? "Resume route" : "Pause route"}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" onClick={onRecenter} aria-label="Recenter route">
            <Crosshair size={15} /> Recenter
          </button>
          <button type="button" onClick={onRestart} aria-label="Restart route">
            <RotateCcw size={15} /> Restart
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="is-danger"
            aria-label="End route"
          >
            <Square size={14} /> End Route
          </button>
        </div>

        {paused && (
          <div className="navigation-paused-banner">
            <LocateFixed size={13} /> Navigasi dijeda
          </div>
        )}
      </section>
    </>
  );
}
