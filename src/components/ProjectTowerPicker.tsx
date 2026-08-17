"use client";
// ProjectTowerPicker.tsx — pick a project and tower instead of typing their names.
//
// WHY: project_name / tower were free text on every unit, which is how "Malad",
// "Malad East", "Malad Project" and "Malad Tower" all became separate projects in
// live data. The migration cleaned up what existed; this stops NEW fragmentation
// at the point of entry.
//
// It still emits the NAME strings, not ids. inventory_units keeps its
// project_name/tower columns (they are what lib/inventorySync.ts matches bookings
// on), and the API resolves the FK from the name via lib/inventoryHierarchy.ts.
// So this component is a UX guardrail, not load-bearing plumbing — a caller that
// types a brand-new name still works.
import React, { useCallback, useEffect, useMemo, useState } from "react";

interface Project { id: number; name: string; }
interface Tower { id: number; name: string; project_id: number; }

interface Props {
  t: any;
  projectName: string;
  towerName: string;
  onChange: (patch: { project_name?: string; tower?: string; wing?: string }) => void;
  /** Rendered under the fields, e.g. a validation message. */
  hint?: string | null;
  /**
   * Opt-in wing field. Off by default so AddUnitModal — which has its own wing
   * input further down its form — is not given a second one.
   *
   * Wing is NOT relational: there is no inventory_wings table, only a free-text
   * column on the unit (see the 2026-08-04 parity migration). The options below
   * are therefore the wings that this tower's existing stock USES, discovered
   * from the building aggregate, not a list of configured wings.
   */
  withWing?: boolean;
  wingName?: string;
}

const NEW = "__new__";

/** A wing as seen in existing stock: which project key and tower it belongs to. */
interface WingRow { key: string; tower: string; wing: string; }

export default function ProjectTowerPicker({ t, projectName, towerName, onChange, hint, withWing = false, wingName = "" }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [wings, setWings] = useState<WingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // "Typing a new one" is an explicit mode, not an accident. Without it the only
  // way to add the first project would be to have one already.
  const [newProject, setNewProject] = useState(false);
  const [newTower, setNewTower] = useState(false);
  const [newWing, setNewWing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [pRes, tRes, bRes] = await Promise.all([
        fetch("/api/inventory/projects", { credentials: "include" }),
        fetch("/api/inventory/towers", { credentials: "include" }),
        // Only for the wing options, so a failure here is not fatal.
        withWing
          ? fetch("/api/inventory?view=buildings", { credentials: "include" })
          : Promise.resolve(null),
      ]);
      const pJson = await pRes.json();
      const tJson = await tRes.json();
      if (!pJson?.success) throw new Error(pJson?.message || "Could not load projects");
      setProjects(pJson.data || []);
      setTowers(tJson?.success ? tJson.data || [] : []);

      if (bRes) {
        const bJson = await bRes.json().catch(() => null);
        if (bJson?.success) {
          setWings(
            (bJson.data || []).flatMap((b: any) =>
              (b.wings || []).map((w: any) => ({
                key: String(b.key), tower: String(w.tower ?? "").trim(), wing: String(w.wing ?? "").trim(),
              })),
            ).filter((w: WingRow) => w.wing),
          );
        }
      }
    } catch (e: any) {
      // Falling back to free text rather than blocking: an inventory screen that
      // cannot load its dropdowns must still be able to add a unit.
      setLoadError(e?.message || "Could not load projects");
      setNewProject(true);
      setNewTower(true);
      setNewWing(true);
    } finally {
      setLoading(false);
    }
  }, [withWing]);

  useEffect(() => { load(); }, [load]);

  // An existing value that matches no known project means this form was opened
  // with a legacy name — show the text box so it is not silently blanked.
  useEffect(() => {
    if (loading || loadError) return;
    if (projectName && !projects.some(p => p.name.trim().toLowerCase() === projectName.trim().toLowerCase())) {
      setNewProject(true);
    }
  }, [loading, loadError, projectName, projects]);

  const selectedProject = useMemo(
    () => projects.find(p => p.name.trim().toLowerCase() === projectName.trim().toLowerCase()) || null,
    [projects, projectName],
  );

  const towersForProject = useMemo(
    () => (selectedProject ? towers.filter(tw => tw.project_id === selectedProject.id) : []),
    [towers, selectedProject],
  );

  useEffect(() => {
    if (loading || loadError || newTower) return;
    if (towerName && selectedProject &&
        !towersForProject.some(tw => tw.name.trim().toLowerCase() === towerName.trim().toLowerCase())) {
      setNewTower(true);
    }
  }, [loading, loadError, towerName, selectedProject, towersForProject, newTower]);

  // Wings belonging to the SELECTED tower only — never another tower's. Keyed on
  // the same LOWER(TRIM(project_name)) the aggregate groups on.
  const wingsForTower = useMemo(() => {
    const pKey = projectName.trim().toLowerCase();
    const tKey = towerName.trim().toLowerCase();
    if (!pKey || !tKey) return [];
    return [...new Set(
      wings.filter(w => w.key === pKey && w.tower.trim().toLowerCase() === tKey).map(w => w.wing),
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [wings, projectName, towerName]);

  // Changing tower must not leave a wing from the previous tower selected —
  // "Tower B, Wing A" where Wing A only exists in Tower A would generate stock
  // into a wing the user never meant to create.
  useEffect(() => {
    if (!withWing || loading || loadError || newWing) return;
    if (!wingName) return;
    if (wingsForTower.length === 0) return;   // unknown tower: leave free text alone
    if (!wingsForTower.some(w => w.trim().toLowerCase() === wingName.trim().toLowerCase())) {
      onChange({ wing: "" });
    }
  }, [withWing, loading, loadError, newWing, wingName, wingsForTower, onChange]);

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  return (
    <>
      <div>
        <div className="flex items-center justify-between">
          <label className={labelCls}>Project Name *</label>
          {!loading && !loadError && projects.length > 0 && (
            <button
              type="button"
              onClick={() => { setNewProject(v => !v); onChange({ project_name: "", tower: "", wing: "" }); setNewTower(false); setNewWing(false); }}
              className="text-[10px] font-semibold text-[#00AEEF] hover:underline mb-1"
            >
              {newProject ? "Pick existing" : "+ New project"}
            </button>
          )}
        </div>

        {loading ? (
          <div className={`${inputCls} opacity-60`}>Loading…</div>
        ) : newProject ? (
          <input
            value={projectName}
            onChange={e => onChange({ project_name: e.target.value })}
            className={inputCls}
            placeholder="e.g. Bhoomi Heights"
          />
        ) : (
          <select
            value={selectedProject ? selectedProject.name : ""}
            onChange={e => {
              if (e.target.value === NEW) { setNewProject(true); onChange({ project_name: "", tower: "", wing: "" }); return; }
              // Changing project invalidates the tower — a tower belongs to one
              // project — and the wing with it, since a wing belongs to a tower.
              onChange({ project_name: e.target.value, tower: "", wing: "" });
              setNewTower(false);
              setNewWing(false);
            }}
            className={selectCls}
          >
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            <option value={NEW}>+ New project…</option>
          </select>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className={labelCls}>Tower *</label>
          {!loading && !loadError && selectedProject && towersForProject.length > 0 && (
            <button
              type="button"
              onClick={() => { setNewTower(v => !v); onChange({ tower: "", wing: "" }); setNewWing(false); }}
              className="text-[10px] font-semibold text-[#00AEEF] hover:underline mb-1"
            >
              {newTower ? "Pick existing" : "+ New tower"}
            </button>
          )}
        </div>

        {loading ? (
          <div className={`${inputCls} opacity-60`}>Loading…</div>
        ) : newTower || newProject || !selectedProject || towersForProject.length === 0 ? (
          <input
            value={towerName}
            onChange={e => onChange({ tower: e.target.value })}
            className={inputCls}
            placeholder="e.g. A"
          />
        ) : (
          <select
            value={towerName}
            onChange={e => {
              if (e.target.value === NEW) { setNewTower(true); onChange({ tower: "", wing: "" }); setNewWing(false); return; }
              onChange({ tower: e.target.value, wing: "" });
              setNewWing(false);
            }}
            className={selectCls}
          >
            <option value="">Select a tower…</option>
            {towersForProject.map(tw => <option key={tw.id} value={tw.name}>{tw.name}</option>)}
            <option value={NEW}>+ New tower…</option>
          </select>
        )}
      </div>

      {withWing && (
        <div>
          <div className="flex items-center justify-between">
            <label className={labelCls}>Wing</label>
            {!loading && !loadError && wingsForTower.length > 0 && (
              <button
                type="button"
                onClick={() => { setNewWing(v => !v); onChange({ wing: "" }); }}
                className="text-[10px] font-semibold text-[#00AEEF] hover:underline mb-1"
              >
                {newWing ? "Pick existing" : "+ New wing"}
              </button>
            )}
          </div>

          {loading ? (
            <div className={`${inputCls} opacity-60`}>Loading…</div>
          ) : newWing || !towerName.trim() || wingsForTower.length === 0 ? (
            // A tower with no wings yet is the common case, so free text is the
            // default there rather than an empty dropdown.
            <input
              value={wingName}
              onChange={e => onChange({ wing: e.target.value })}
              className={inputCls}
              placeholder={towerName.trim() ? "Optional — e.g. B" : "Select a tower first"}
              disabled={!towerName.trim()}
            />
          ) : (
            <select
              value={wingName}
              onChange={e => {
                if (e.target.value === NEW) { setNewWing(true); onChange({ wing: "" }); return; }
                onChange({ wing: e.target.value });
              }}
              className={selectCls}
            >
              <option value="">No wing</option>
              {wingsForTower.map(w => <option key={w} value={w}>{w}</option>)}
              <option value={NEW}>+ New wing…</option>
            </select>
          )}
        </div>
      )}

      {(loadError || hint) && (
        <p className={`text-[10px] col-span-full ${loadError ? "text-amber-500" : t.textFaint}`}>
          {loadError ? `${loadError} — falling back to free text.` : hint}
        </p>
      )}
    </>
  );
}
