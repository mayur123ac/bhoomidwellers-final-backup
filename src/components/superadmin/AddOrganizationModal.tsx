"use client";

// components/superadmin/AddOrganizationModal.tsx
//
// Creating a tenant is the first *write* in the Super Admin panel, and the only
// one that mints an account able to sign in. The form is deliberately short —
// five fields — because everything else about an organization can be edited by
// its own Admin afterwards, and a long provisioning form is a long list of
// things to get wrong at the one moment there is nobody in the tenant to fix it.
//
// Client-side validation here is a courtesy, not a control: the API re-validates
// every field, derives the slug and the organization id server-side, and forces
// the role. See app/api/platform/organizations/route.ts.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";

/** The five rules lib/passwords.ts enforces, mirrored for live feedback. */
const RULES: { key: string; label: string; test: (p: string) => boolean }[] = [
  { key: "length", label: "8+ characters", test: p => p.length >= 8 },
  { key: "upper", label: "uppercase", test: p => /[A-Z]/.test(p) },
  { key: "lower", label: "lowercase", test: p => /[a-z]/.test(p) },
  { key: "number", label: "number", test: p => /[0-9]/.test(p) },
  { key: "special", label: "symbol", test: p => /[^A-Za-z0-9]/.test(p) },
];

function Field({
  label, value, onChange, t, type = "text", placeholder, autoComplete, error, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; t: SuperAdminTheme;
  type?: string; placeholder?: string; autoComplete?: string; error?: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium mb-1.5" style={{ color: t.textMuted }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-colors"
        style={{
          background: t.raised,
          color: t.text,
          border: `1px solid ${error ? t.danger : "transparent"}`,
        }}
        onFocus={e => { if (!error) e.currentTarget.style.borderColor = t.borderStrong; }}
        onBlur={e => { if (!error) e.currentTarget.style.borderColor = "transparent"; }}
      />
      {error
        ? <span className="block text-[11px] mt-1" style={{ color: t.danger }}>{error}</span>
        : hint ? <span className="block text-[11px] mt-1" style={{ color: t.textMuted }}>{hint}</span> : null}
    </label>
  );
}

export interface CreatedOrg {
  id: string;
  name: string;
  adminEmail: string;
}

export default function AddOrganizationModal({
  open, t, onClose, onCreated,
}: {
  open: boolean;
  t: SuperAdminTheme;
  onClose: () => void;
  /** Called after a successful create so the list can refresh. */
  onCreated: (org: CreatedOrg) => void;
}) {
  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset on every open so a previous attempt's values — including a typed
  // password — never persist into the next one.
  useEffect(() => {
    if (open) {
      setOrgName(""); setAdminName(""); setAdminEmail("");
      setPassword(""); setConfirm(""); setServerError(""); setTouched(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim());
  const rulesPassed = RULES.filter(r => r.test(password));
  const passwordOk = rulesPassed.length === RULES.length;
  const confirmOk = confirm.length > 0 && confirm === password;
  const canSubmit =
    orgName.trim().length > 0 && adminName.trim().length > 0 &&
    emailOk && passwordOk && confirmOk && !submitting;

  const errFor = (cond: boolean, msg: string) => (touched && !cond ? msg : undefined);

  async function submit() {
    setTouched(true);
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError("");
    try {
      const res = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No organization_id and no role are sent. The server generates the
        // first and forces the second; sending them would only create the
        // impression that the client gets a say.
        body: JSON.stringify({
          organizationName: orgName.trim(),
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          password,
          confirmPassword: confirm,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not create the organization.");
      onCreated({ id: json.data.id, name: json.data.name, adminEmail: json.data.adminEmail });
      onClose();
    } catch (e: any) {
      setServerError(e?.message || "Could not create the organization.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !submitting && onClose()}
            className="fixed inset-0 z-[140]"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Add organization"
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.985 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            // Bottom sheet on phones, centred dialog from `sm` up — the same
            // pattern the organization detail panel uses.
            className={[
              "fixed z-[150] flex flex-col overflow-hidden",
              "inset-x-0 bottom-0 max-h-[92vh] rounded-t-[26px]",
              "sm:inset-0 sm:m-auto sm:h-fit sm:w-[min(480px,calc(100vw-2rem))] sm:max-h-[88vh] sm:rounded-[26px]",
            ].join(" ")}
            style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.28)" }}
          >
            <div className="flex-shrink-0 px-5 pt-3 pb-4" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="sm:hidden flex justify-center pb-3">
                <span className="w-10 h-1 rounded-full" style={{ background: t.borderStrong }} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: t.text }}>
                    Add Organization
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: t.textMuted }}>
                    Creates a new tenant and its first Admin.
                  </p>
                </div>
                <button
                  onClick={() => !submitting && onClose()}
                  aria-label="Close"
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: t.raised, color: t.textMuted }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <Field
                t={t} label="Organization Name" value={orgName} onChange={setOrgName}
                placeholder="Acme Developers LLP" autoComplete="off"
                error={errFor(orgName.trim().length > 0, "Organization name is required.")}
                hint="A URL slug and organization ID are generated automatically."
              />

              <div className="pt-1" style={{ borderTop: `1px solid ${t.border}` }}>
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] pt-4 pb-2" style={{ color: t.textMuted }}>
                  First Admin
                </p>
                <div className="space-y-4">
                  <Field
                    t={t} label="Admin Name" value={adminName} onChange={setAdminName}
                    placeholder="Full name" autoComplete="off"
                    error={errFor(adminName.trim().length > 0, "Admin name is required.")}
                  />
                  <Field
                    t={t} label="Admin Email" value={adminEmail} onChange={setAdminEmail}
                    type="email" placeholder="admin@example.com" autoComplete="off"
                    error={errFor(emailOk, adminEmail.trim() ? "That is not a valid email address." : "Admin email is required.")}
                  />
                  <div>
                    <Field
                      t={t} label="Admin Password" value={password} onChange={setPassword}
                      type="password" autoComplete="new-password"
                      error={errFor(passwordOk, "Password does not meet all requirements.")}
                    />
                    {/* Live rule feedback, so requirements are visible while typing
                        rather than revealed by a rejection after submit. */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {RULES.map(r => {
                        const on = r.test(password);
                        return (
                          <span
                            key={r.key}
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                            style={on
                              ? { color: t.positive, background: tint(t.positive, 0.12) }
                              : { color: t.textMuted, background: t.raised }}
                          >
                            {r.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <Field
                    t={t} label="Confirm Password" value={confirm} onChange={setConfirm}
                    type="password" autoComplete="new-password"
                    error={errFor(confirmOk, confirm ? "Passwords do not match." : "Please confirm the password.")}
                  />
                </div>
              </div>

              {serverError && (
                <div
                  className="rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
                  style={{ color: t.danger, background: tint(t.danger, 0.1), border: `1px solid ${tint(t.danger, 0.3)}` }}
                >
                  {serverError}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${t.border}` }}>
              <button
                onClick={() => !submitting && onClose()}
                disabled={submitting}
                className="px-4 py-2 rounded-full text-[13px] font-medium disabled:opacity-50"
                style={{ color: t.text, background: t.raised }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="px-4 py-2 rounded-full text-[13px] font-semibold transition-opacity"
                style={{
                  background: t.accent,
                  color: "#fff",
                  opacity: canSubmit ? 1 : 0.45,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {submitting ? "Creating…" : "Create Organization"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
