"use client";

// components/superadmin/OrganizationDetailView.tsx — one tenant, and the people
// inside it.
//
// ── Why a view and not the drawer ───────────────────────────────────────────
// Phase 2 showed an organization in a 440px right-hand drawer, which was right
// when the content was six read-only facts. It is not right for a table of
// users with nine columns and a per-row actions menu: at that width the table
// either overflows or the controls fall off the end, and the brief is explicit
// that critical controls must not overflow horizontally.
//
// So the organization opens as a full-width view inside the panel — the same
// place the tab content renders, with a Back control — and the drawer is gone.
// The user table gets the width it needs on desktop and becomes a card list
// below `lg`, matching every other list in the panel.
//
// ── What this screen may and may not show ───────────────────────────────────
// It shows who belongs to the tenant and the state of their access. It does NOT
// show their password, in any form: the API sends a `passwordStatus` string and
// nothing else, and the column below renders dots. There is no reveal control,
// no "copy password", and no request this screen can make that would return one
// — see the header of the org-users route for how that is enforced in SQL.

import { useCallback, useEffect, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";
import { Panel, SearchField, StatusPill, StatTile, MonoId, EmptyState, fmtDate, fmtRelative } from "./ui";
import { Btn, ConfirmDialog, ErrorNote, Field, Modal } from "./dialogs";

export interface OrgUser {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  status: "active" | "inactive";
  passwordStatus: "set" | "not_set";
  loginStatus: "online" | "offline";
  activeSessions: number;
  currentLoginAt: string | null;
  device: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

interface Payload {
  organization: { id: string; name: string; status: string };
  counts: { total: number; active: number; loggedIn: number };
  users: OrgUser[];
}

/** The five password rules lib/passwords.ts enforces, mirrored for live feedback. */
const RULES: { key: string; label: string; test: (p: string) => boolean }[] = [
  { key: "length", label: "8+ characters", test: p => p.length >= 8 },
  { key: "upper", label: "uppercase", test: p => /[A-Z]/.test(p) },
  { key: "lower", label: "lowercase", test: p => /[a-z]/.test(p) },
  { key: "number", label: "number", test: p => /[0-9]/.test(p) },
  { key: "special", label: "symbol", test: p => /[^A-Za-z0-9]/.test(p) },
];

type Dialog =
  | { kind: "password"; user: OrgUser }
  | { kind: "email"; user: OrgUser }
  | { kind: "logout"; user: OrgUser }
  | { kind: "status"; user: OrgUser; next: boolean }
  | { kind: "details"; user: OrgUser }
  | { kind: "suspendOrg"; next: "suspended" | "active" }
  | null;

export default function OrganizationDetailView({
  t, organizationId, fallbackName, onBack, onOrgChanged,
}: {
  t: SuperAdminTheme;
  organizationId: string;
  /** Shown while the detail request is in flight, so the header is never blank. */
  fallbackName: string;
  onBack: () => void;
  /** Lets the Organizations list refresh after a suspend/reactivate. */
  onOrgChanged: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [toast, setToast] = useState("");
  const [openMenu, setOpenMenu] = useState<number | null>(null);

  // Form state for the two credential dialogs. Held here rather than inside the
  // dialogs so it is cleared centrally the moment a dialog closes — a typed
  // password must not survive in a closed component's state.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [u, m] = await Promise.all([
        fetch(`/api/platform/organizations/${organizationId}/users`).then(r => r.json()),
        fetch(`/api/platform/organizations/${organizationId}`).then(r => r.json()),
      ]);
      if (!u?.success) throw new Error(u?.message || "Could not load the organization.");
      setData(u.data as Payload);
      setMeta(m?.success ? m.data : null);
    } catch (e: any) {
      setError(e?.message || "Could not load the organization.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Close the row menu on any outside click. Without this a second menu opens
  // behind the first on a long table.
  useEffect(() => {
    if (openMenu == null) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenu]);

  /** Clears every dialog field, including any typed password. */
  function resetDialog() {
    setDialog(null);
    setDialogError("");
    setNewPassword("");
    setConfirmPassword("");
    setNewEmail("");
  }

  /** Cancel / backdrop / Escape. Refuses while a write is in flight. */
  function closeDialog() {
    if (busy) return;
    resetDialog();
  }

  /** One call shape for every user action; the server discriminates on `action`. */
  async function userAction(userId: number, body: Record<string, unknown>, done: (msg: string) => void) {
    setBusy(true);
    setDialogError("");
    try {
      const res = await fetch(`/api/platform/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not complete that action.");
      done(json.message || "Done.");
      await load();
    } catch (e: any) {
      setDialogError(e?.message || "Could not complete that action.");
    } finally {
      setBusy(false);
    }
  }

  async function setOrgStatus(next: "suspended" | "active") {
    setBusy(true);
    setDialogError("");
    try {
      const res = await fetch(`/api/platform/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not change the status.");
      setDialog(null);
      setToast(json.message);
      await load();
      onOrgChanged();
    } catch (e: any) {
      setDialogError(e?.message || "Could not change the status.");
    } finally {
      setBusy(false);
    }
  }

  const org = data?.organization;
  const orgName = org?.name ?? fallbackName;
  const orgStatus = org?.status ?? "active";

  const users = (data?.users ?? []).filter(u => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${u.id} ${u.name} ${u.email ?? ""} ${u.role ?? ""}`.toLowerCase().includes(needle);
  });

  const rulesPassed = RULES.filter(r => r.test(newPassword));
  const passwordOk = rulesPassed.length === RULES.length && newPassword === confirmPassword;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());

  /* ── Cells shared by the table and the card list ──────────────────────────*/

  /**
   * The password cell.
   *
   * Dots and a label — and that is all the browser has ever been sent. This is
   * not a masked input over a real value: there is no real value in this
   * component, this file, or the response that fed it.
   */
  const passwordCell = (u: OrgUser) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="tracking-[0.18em] text-[13px]" style={{ color: t.textMuted }} aria-hidden="true">
        ••••••••
      </span>
      <span className="text-[10px]" style={{ color: u.passwordStatus === "set" ? t.positive : t.warning }}>
        {u.passwordStatus === "set" ? "Password Set" : "No password"}
      </span>
    </span>
  );

  const loginCell = (u: OrgUser) => (
    <div className="min-w-0">
      <StatusPill status={u.loginStatus === "online" ? "online" : "offline"} t={t} />
      {u.loginStatus === "online" && u.currentLoginAt && (
        <p className="text-[10px] mt-1 truncate" style={{ color: t.textMuted }}>
          since {new Date(u.currentLoginAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          {u.activeSessions > 1 ? ` · ${u.activeSessions} devices` : ""}
        </p>
      )}
    </div>
  );

  const actionsMenu = (u: OrgUser) => (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)}
        aria-haspopup="menu"
        aria-expanded={openMenu === u.id}
        className="px-2.5 py-1 rounded-lg text-[12px] font-medium whitespace-nowrap"
        style={{ color: t.text, background: t.raised }}
      >
        Actions
      </button>
      {openMenu === u.id && (
        <div
          role="menu"
          className="absolute right-0 top-8 w-52 rounded-2xl p-1.5 z-40"
          style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: "0 12px 32px rgba(0,0,0,0.22)" }}
        >
          {[
            { label: "View Details", run: () => setDialog({ kind: "details", user: u }) },
            { label: "Change Email", run: () => { setNewEmail(u.email ?? ""); setDialog({ kind: "email", user: u }); } },
            { label: "Change Password", run: () => setDialog({ kind: "password", user: u }) },
          ].map(item => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => { setOpenMenu(null); setDialogError(""); item.run(); }}
              className="w-full text-left px-3 py-2 rounded-xl text-[12.5px] font-medium transition-colors"
              style={{ color: t.text }}
              onMouseEnter={e => { e.currentTarget.style.background = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              {item.label}
            </button>
          ))}
          <div className="my-1 h-px" style={{ background: t.border }} />
          <button
            role="menuitem"
            onClick={() => { setOpenMenu(null); setDialogError(""); setDialog({ kind: "status", user: u, next: u.status !== "active" }); }}
            className="w-full text-left px-3 py-2 rounded-xl text-[12.5px] font-medium"
            style={{ color: u.status === "active" ? t.warning : t.positive }}
            onMouseEnter={e => { e.currentTarget.style.background = t.hover; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            {u.status === "active" ? "Deactivate Account" : "Reactivate Account"}
          </button>
        </div>
      )}
    </div>
  );

  /**
   * Log Out is a first-class button beside the menu, not an item inside it.
   *
   * The brief asks for it to be ALWAYS available — including while the user is
   * active — because that is precisely when an operator needs it. It is shown
   * for offline users too, greyed but usable: "offline" here means no live
   * heartbeat, which is not the same as no valid cookie, and revoking a session
   * nobody is currently using is exactly what you want after a laptop goes
   * missing.
   */
  const logoutButton = (u: OrgUser) => (
    <button
      onClick={e => { e.stopPropagation(); setDialogError(""); setDialog({ kind: "logout", user: u }); }}
      className="px-2.5 py-1 rounded-lg text-[12px] font-medium whitespace-nowrap"
      style={
        u.loginStatus === "online"
          ? { color: t.danger, background: tint(t.danger, 0.12) }
          : { color: t.textMuted, background: t.raised }
      }
      title={
        u.loginStatus === "online"
          ? "End this user's active sessions"
          : "No live session — this still revokes any cookie they hold"
      }
    >
      Log Out
    </button>
  );

  return (
    <div className="space-y-5">
      {/* ── Back + organization header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium mb-2.5"
            style={{ color: t.textMuted }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            All organizations
          </button>
          <h2 className="text-[20px] sm:text-[23px] font-semibold tracking-tight leading-tight" style={{ color: t.text }}>
            {orgName}
          </h2>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusPill status={orgStatus} t={t} />
            <MonoId value={organizationId} t={t} short={false} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={load}
            className="px-3.5 py-2 rounded-full text-[13px] font-medium"
            style={{ color: t.text, background: t.raised }}
          >
            Refresh
          </button>
          {orgStatus === "suspended" ? (
            <Btn t={t} tone="primary" onClick={() => { setDialogError(""); setDialog({ kind: "suspendOrg", next: "active" }); }}>
              Reactivate
            </Btn>
          ) : (
            <Btn t={t} tone="danger" onClick={() => { setDialogError(""); setDialog({ kind: "suspendOrg", next: "suspended" }); }}>
              Suspend
            </Btn>
          )}
        </div>
      </div>

      {toast && (
        <div
          className="rounded-2xl px-4 py-3 text-[13px]"
          style={{ color: t.positive, background: tint(t.positive, 0.1), border: `1px solid ${tint(t.positive, 0.28)}` }}
        >
          {toast}
        </div>
      )}

      {error ? (
        <Panel t={t}>
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] font-medium" style={{ color: t.danger }}>{error}</p>
            <button onClick={load} className="mt-4 px-4 py-2 rounded-full text-[13px] font-medium" style={{ background: t.accent, color: "#fff" }}>
              Try again
            </button>
          </div>
        </Panel>
      ) : loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-[104px] rounded-2xl" style={{ background: t.surface }} />)}
          </div>
          <div className="h-64 rounded-2xl" style={{ background: t.surface }} />
        </div>
      ) : (
        <>
          {/* ── Security overview ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatTile t={t} label="Total Users" value={data?.counts.total ?? 0} />
            <StatTile t={t} label="Active Users" value={data?.counts.active ?? 0} hint="Accounts that can sign in" />
            <StatTile
              t={t}
              label="Currently Logged In"
              value={data?.counts.loggedIn ?? 0}
              hint="Live sessions, not last-login"
            />
            <div
              className="rounded-2xl px-4 py-4 sm:px-5 sm:py-5"
              style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: t.textMuted }}>
                Organization Status
              </p>
              <div className="mt-2.5"><StatusPill status={orgStatus} t={t} /></div>
              <p className="text-[11px] mt-2" style={{ color: t.textMuted }}>
                Created {fmtDate(meta?.created_at ?? null)}
              </p>
            </div>
          </div>

          {/* Tenant volume, from the existing organization detail endpoint. */}
          {meta && (
            <Panel t={t}>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: t.border }}>
                {[
                  ["Leads", meta.leads],
                  ["Bookings", meta.bookings],
                  ["Projects", meta.projects],
                  ["Last Activity", fmtRelative(meta.last_activity ?? null)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="px-4 py-3.5" style={{ borderColor: t.border }}>
                    <p className="text-[11px]" style={{ color: t.textMuted }}>{label}</p>
                    <p className="text-[15px] font-semibold mt-0.5 tabular-nums" style={{ color: t.text }}>{value}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* ── Users ── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between pt-1">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: t.text }}>
                Organization Users
              </h3>
              <p className="text-[12px] mt-0.5" style={{ color: t.textMuted }}>
                Everyone belonging to this organization, and the state of their access.
              </p>
            </div>
            <SearchField t={t} value={q} onChange={setQ} placeholder="Search ID, name, email or role" />
          </div>

          {users.length === 0 ? (
            <Panel t={t}>
              <EmptyState
                t={t}
                title={data?.users.length === 0 ? "No users in this organization" : "No users match"}
                sub={data?.users.length === 0 ? "Its first Admin was created with the tenant." : "Try a different search."}
              />
            </Panel>
          ) : (
            <>
              {/* ── Table: xl and up. The nine columns need real width. ── */}
              <Panel t={t} className="hidden xl:block">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: t.raised }}>
                        {["ID", "Name", "Role", "Email", "Password", "Login", "Last Login", "Last Activity", ""].map((h, i) => (
                          <th
                            key={h || i}
                            className="text-left text-[11px] font-medium uppercase tracking-[0.06em] px-3 py-2.5 whitespace-nowrap"
                            style={{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, i) => (
                        <tr key={u.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}>
                          <td className="px-3 py-3">
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md" style={{ color: t.textMuted, background: t.raised }}>
                              #{u.id}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-[13px] font-medium" style={{ color: t.text }}>{u.name}</span>
                            {u.status !== "active" && (
                              <span className="ml-2 text-[10px] font-semibold" style={{ color: t.warning }}>DEACTIVATED</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: t.text }}>{u.role ?? "—"}</td>
                          <td className="px-3 py-3 text-[12px]" style={{ color: t.textMuted }}>{u.email ?? "—"}</td>
                          <td className="px-3 py-3">{passwordCell(u)}</td>
                          <td className="px-3 py-3">{loginCell(u)}</td>
                          <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: t.textMuted }}>{fmtRelative(u.lastLoginAt)}</td>
                          <td className="px-3 py-3 text-[12px] whitespace-nowrap" style={{ color: t.textMuted }}>{fmtRelative(u.lastActivityAt)}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {logoutButton(u)}
                              {actionsMenu(u)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* ── Cards: below xl. Every control is a full-size target. ── */}
              <div className="xl:hidden space-y-2.5">
                {users.map(u => (
                  <div
                    key={u.id}
                    className="rounded-2xl px-4 py-3.5"
                    style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md" style={{ color: t.textMuted, background: t.raised }}>
                            #{u.id}
                          </span>
                          <span className="text-[14px] font-medium truncate" style={{ color: t.text }}>{u.name}</span>
                        </div>
                        <p className="text-[11px] mt-1 truncate" style={{ color: t.textMuted }}>{u.email ?? "—"}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: t.text }}>{u.role ?? "—"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {loginCell(u)}
                        {u.status !== "active" && <StatusPill status="inactive" t={t} />}
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between gap-3 mt-2.5 pt-2.5 flex-wrap"
                      style={{ borderTop: `1px solid ${t.border}` }}
                    >
                      {passwordCell(u)}
                      <span className="text-[11px]" style={{ color: t.textMuted }}>
                        Last login {fmtRelative(u.lastLoginAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-3">
                      {logoutButton(u)}
                      {actionsMenu(u)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ Change password ══ */}
      <Modal
        open={dialog?.kind === "password"}
        t={t}
        busy={busy}
        title="Change Password"
        subtitle={dialog?.kind === "password" ? `For ${dialog.user.name}` : undefined}
        onClose={closeDialog}
        footer={
          <>
            <Btn t={t} tone="quiet" onClick={closeDialog} disabled={busy}>Cancel</Btn>
            <Btn
              t={t}
              tone="primary"
              disabled={!passwordOk || busy}
              onClick={() =>
                dialog?.kind === "password" &&
                userAction(
                  dialog.user.id,
                  { action: "changePassword", newPassword, confirmPassword },
                  msg => { setToast(msg); resetDialog(); }
                )
              }
            >
              {busy ? "Saving…" : "Change Password"}
            </Btn>
          </>
        }
      >
        <div className="space-y-4">
          {/* Stated plainly, because the operator will look for a reveal control
              and there deliberately is not one. */}
          <div
            className="rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
            style={{ color: t.textMuted, background: t.raised }}
          >
            The current password is never displayed or retrieved — it is stored as a
            one-way hash. Setting a new one signs this user out of every device;
            they will need the new password to sign back in.
          </div>

          <Field
            t={t}
            label="New Password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
          />
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {RULES.map(r => {
              const on = r.test(newPassword);
              return (
                <span
                  key={r.key}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={on ? { color: t.positive, background: tint(t.positive, 0.12) } : { color: t.textMuted, background: t.raised }}
                >
                  {r.label}
                </span>
              );
            })}
          </div>

          <Field
            t={t}
            label="Confirm Password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={confirmPassword && confirmPassword !== newPassword ? "Passwords do not match." : undefined}
          />

          {dialogError && <ErrorNote t={t}>{dialogError}</ErrorNote>}
        </div>
      </Modal>

      {/* ══ Change email ══ */}
      <Modal
        open={dialog?.kind === "email"}
        t={t}
        busy={busy}
        title="Change Email"
        subtitle={dialog?.kind === "email" ? `For ${dialog.user.name}` : undefined}
        onClose={closeDialog}
        footer={
          <>
            <Btn t={t} tone="quiet" onClick={closeDialog} disabled={busy}>Cancel</Btn>
            <Btn
              t={t}
              tone="primary"
              disabled={!emailOk || busy}
              onClick={() =>
                dialog?.kind === "email" &&
                userAction(
                  dialog.user.id,
                  { action: "changeEmail", newEmail: newEmail.trim() },
                  msg => { setToast(msg); resetDialog(); }
                )
              }
            >
              {busy ? "Saving…" : "Change Email"}
            </Btn>
          </>
        }
      >
        <div className="space-y-4">
          <div
            className="rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
            style={{ color: t.textMuted, background: t.raised }}
          >
            The email address is a sign-in identifier, so it must be unique across
            every organization. Changing it does not change the password.
          </div>
          <Field
            t={t}
            label="New Email"
            type="email"
            autoComplete="off"
            value={newEmail}
            onChange={setNewEmail}
            error={newEmail && !emailOk ? "That is not a valid email address." : undefined}
            hint={dialog?.kind === "email" ? `Currently ${dialog.user.email ?? "not set"}` : undefined}
          />
          {dialogError && <ErrorNote t={t}>{dialogError}</ErrorNote>}
        </div>
      </Modal>

      {/* ══ Force logout ══ */}
      <ConfirmDialog
        open={dialog?.kind === "logout"}
        t={t}
        busy={busy}
        error={dialogError}
        title="Log out this user from the CRM?"
        confirmLabel="Log Out User"
        onCancel={closeDialog}
        onConfirm={() =>
          dialog?.kind === "logout" &&
          userAction(dialog.user.id, { action: "forceLogout" }, msg => { setToast(msg); setDialog(null); })
        }
        body={
          dialog?.kind === "logout" ? (
            <>
              This will terminate <strong style={{ color: t.text }}>{dialog.user.name}</strong>&apos;s active
              session. Their sign-in is revoked on the server, so the session already open in their browser
              stops working immediately — they will have to sign in again. Their password is unchanged.
            </>
          ) : null
        }
      />

      {/* ══ Activate / deactivate ══ */}
      <ConfirmDialog
        open={dialog?.kind === "status"}
        t={t}
        busy={busy}
        error={dialogError}
        tone={dialog?.kind === "status" && dialog.next ? "primary" : "danger"}
        title={dialog?.kind === "status" && dialog.next ? "Reactivate this account?" : "Deactivate this account?"}
        confirmLabel={dialog?.kind === "status" && dialog.next ? "Reactivate" : "Deactivate"}
        onCancel={closeDialog}
        onConfirm={() =>
          dialog?.kind === "status" &&
          userAction(dialog.user.id, { action: "setStatus", isActive: dialog.next }, msg => { setToast(msg); setDialog(null); })
        }
        body={
          dialog?.kind === "status" ? (
            dialog.next ? (
              <>
                <strong style={{ color: t.text }}>{dialog.user.name}</strong> will be able to sign in again.
              </>
            ) : (
              <>
                <strong style={{ color: t.text }}>{dialog.user.name}</strong> will be signed out and blocked
                from signing in. Their records, leads and history are kept — this is the CRM&apos;s own
                deactivation, not a deletion.
              </>
            )
          ) : null
        }
      />

      {/* ══ Suspend / reactivate organization ══ */}
      <ConfirmDialog
        open={dialog?.kind === "suspendOrg"}
        t={t}
        busy={busy}
        error={dialogError}
        tone={dialog?.kind === "suspendOrg" && dialog.next === "active" ? "primary" : "danger"}
        title={
          dialog?.kind === "suspendOrg" && dialog.next === "active"
            ? "Reactivate this organization?"
            : "Suspend this organization?"
        }
        confirmLabel={
          dialog?.kind === "suspendOrg" && dialog.next === "active" ? "Reactivate" : "Suspend Organization"
        }
        onCancel={closeDialog}
        onConfirm={() => dialog?.kind === "suspendOrg" && setOrgStatus(dialog.next)}
        body={
          dialog?.kind === "suspendOrg" ? (
            dialog.next === "active" ? (
              <>
                <strong style={{ color: t.text }}>{orgName}</strong> will be able to sign in again. Everyone
                signs in fresh — sessions from before the suspension are not restored.
              </>
            ) : (
              <>
                All <strong style={{ color: t.text }}>{data?.counts.total ?? 0}</strong> users of{" "}
                <strong style={{ color: t.text }}>{orgName}</strong> will be signed out immediately and will
                not be able to sign in until the organization is reactivated. No data is deleted.
              </>
            )
          ) : null
        }
      />

      {/* ══ User details ══ */}
      <Modal
        open={dialog?.kind === "details"}
        t={t}
        title="User Details"
        subtitle={dialog?.kind === "details" ? dialog.user.name : undefined}
        onClose={closeDialog}
        footer={<Btn t={t} tone="quiet" onClick={closeDialog}>Close</Btn>}
      >
        {dialog?.kind === "details" && (
          <div style={{ borderTop: `1px solid ${t.border}` }}>
            {[
              ["User ID", `#${dialog.user.id}`],
              ["Name", dialog.user.name],
              ["Role", dialog.user.role ?? "—"],
              ["Email", dialog.user.email ?? "—"],
              ["Account", dialog.user.status === "active" ? "Active" : "Deactivated"],
              ["Password", dialog.user.passwordStatus === "set" ? "•••••••• (Password Set)" : "Not set"],
              ["Login status", dialog.user.loginStatus === "online" ? "Active / Logged in" : "Offline"],
              ["Active sessions", String(dialog.user.activeSessions)],
              ["Current login", dialog.user.currentLoginAt ? new Date(dialog.user.currentLoginAt).toLocaleString("en-IN") : "—"],
              ["Device", dialog.user.device ?? "—"],
              ["Last login", dialog.user.lastLoginAt ? new Date(dialog.user.lastLoginAt).toLocaleString("en-IN") : "—"],
              ["Last activity", fmtRelative(dialog.user.lastActivityAt)],
              ["Created", fmtDate(dialog.user.createdAt)],
              ["Organization", orgName],
              ["Organization ID", organizationId],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${t.border}` }}>
                <span className="text-[12px] flex-shrink-0" style={{ color: t.textMuted }}>{label}</span>
                <span
                  className={`text-[13px] font-medium text-right break-all ${label === "Organization ID" ? "font-mono text-[11px]" : ""}`}
                  style={{ color: t.text }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
