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
  onChange: (patch: { project_name?: string; tower?: string }) => void;
  /** Rendered under the fields, e.g. a validation message. */
  hint?: string | null;
}

const NEW = "__new__";

export default function ProjectTowerPicker({ t, projectName, towerName, onChange, hint }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // "Typing a new one" is an explicit mode, not an accident. Without it the only
  // way to add the first project would be to have one already.
  const [newProject, setNewProject] = useState(false);
  const [newTower, setNewTower] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/inventory/projects", { credentials: "include" }),
        fetch("/api/inventory/towers", { credentials: "include" }),
      ]);
      const pJson = await pRes.json();
      const tJson = await tRes.json();
      if (!pJson?.success) throw new Error(pJson?.message || "Could not load projects");
      setProjects(pJson.data || []);
      setTowers(tJson?.success ? tJson.data || [] : []);
    } catch (e: any) {
      // Falling back to free text rather than blocking: an inventory screen that
      // cannot load its dropdowns must still be able to add a unit.
      setLoadError(e?.message || "Could not load projects");
      setNewProject(true);
      setNewTower(true);
    } finally {
      setLoading(false);
    }
  }, []);

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
              onClick={() => { setNewProject(v => !v); onChange({ project_name: "", tower: "" }); setNewTower(false); }}
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
              if (e.target.value === NEW) { setNewProject(true); onChange({ project_name: "", tower: "" }); return; }
              // Changing project invalidates the tower — a tower belongs to one project.
              onChange({ project_name: e.target.value, tower: "" });
              setNewTower(false);
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
              onClick={() => { setNewTower(v => !v); onChange({ tower: "" }); }}
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
              if (e.target.value === NEW) { setNewTower(true); onChange({ tower: "" }); return; }
              onChange({ tower: e.target.value });
            }}
            className={selectCls}
          >
            <option value="">Select a tower…</option>
            {towersForProject.map(tw => <option key={tw.id} value={tw.name}>{tw.name}</option>)}
            <option value={NEW}>+ New tower…</option>
          </select>
        )}
      </div>

      {(loadError || hint) && (
        <p className={`text-[10px] col-span-full ${loadError ? "text-amber-500" : t.textFaint}`}>
          {loadError ? `${loadError} — falling back to free text.` : hint}
        </p>
      )}
    </>
  );
}
