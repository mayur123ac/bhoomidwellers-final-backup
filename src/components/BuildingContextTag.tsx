"use client";
// BuildingContextTag.tsx — "which building am I looking at?", answered the same
// way everywhere.
//
// WHY THIS EXISTS: project → tower → wing is the identity of a block of stock,
// but until now only the project reliably reached the screen. A user configuring
// "Colossal / Tower A / Wing B" saw a floor matrix headed "Colossal", which is
// also what "Colossal / Tower A / Wing C" showed — two different sets of flats,
// one label. Wing is the level most often dropped, so it is the one this
// component refuses to drop.
//
// Rendered identically by the generator (config matrix + preview) and by the
// inventory building view, so the thing you configured and the thing you end up
// looking at are labelled the same.
import React from "react";
import { FaBuilding } from "react-icons/fa";

export interface BuildingContext {
  project_name: string;
  tower?: string | null;
  /** Free text on the unit, not a relation — "" and null both mean "no wing". */
  wing?: string | null;
}

/** "Tower A • Wing B", "Tower A", or "" — the sub-line under the project name. */
export function buildingScopeLabel(ctx: BuildingContext): string {
  const tower = String(ctx.tower ?? "").trim();
  const wing = String(ctx.wing ?? "").trim();
  return [
    tower ? `Tower ${tower}` : "",
    wing ? `Wing ${wing}` : "",
  ].filter(Boolean).join("  •  ");
}

/** "Colossal • Tower A • Wing B" — one line, for titles and tooltips. */
export function buildingFullLabel(ctx: BuildingContext): string {
  const scope = buildingScopeLabel(ctx);
  const name = String(ctx.project_name ?? "").trim() || "(Unnamed project)";
  return scope ? `${name}  •  ${scope}` : name;
}

interface Props {
  ctx: BuildingContext;
  t: any;
  /** e.g. "15 floors • 105 units" — shown under the scope line. */
  meta?: string | null;
  /** Tighter treatment for use inside a modal step. */
  compact?: boolean;
  className?: string;
}

export default function BuildingContextTag({ ctx, t, meta, compact = false, className = "" }: Props) {
  const scope = buildingScopeLabel(ctx);
  const name = String(ctx.project_name ?? "").trim();

  // Nothing chosen yet — say so rather than rendering an empty box, so the
  // generator's matrix is never headed by a blank tag.
  if (!name && !scope) {
    return (
      <div className={`rounded-xl border border-dashed px-3 py-2 ${t.tableBorder} ${className}`}>
        <p className={`text-[11px] ${t.textFaint}`}>No building selected yet</p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border px-3 ${compact ? "py-2" : "py-2.5"} ${t.innerBlock} ${className}`}
      title={buildingFullLabel(ctx)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FaBuilding className="text-[#00AEEF] flex-shrink-0" />
        <div className="min-w-0">
          <p className={`${compact ? "text-xs" : "text-sm"} font-bold truncate ${t.text}`}>
            {name || "(Unnamed project)"}
          </p>
          {/* The scope line is the whole point — it is what distinguishes Wing B
              from Wing C. It stays on its own line so a long project name cannot
              push it out of view. */}
          {scope && (
            <p className={`text-[11px] font-semibold truncate text-[#00AEEF]`}>{scope}</p>
          )}
          {meta && <p className={`text-[10px] truncate ${t.textMuted}`}>{meta}</p>}
        </div>
      </div>
    </div>
  );
}
