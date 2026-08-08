"use client";
// ManualCallingSettingsCard.tsx — the "Click-to-Call" section of Settings.
//
// Follows the same rule as BolnaSettingsCard: the API token travels in exactly
// one direction, from this form to the server. The token field starts EMPTY even
// when a token is stored, with the mask beside it as static text. GET
// /api/settings/manual-calling does not return the token, so this component
// could not prefill it even if it tried.
//
// An admin editing only the Exophone therefore leaves the token field blank and
// the server keeps what it has.

import { useCallback, useEffect, useState } from "react";
import { FaPhoneAlt, FaCheckCircle, FaExclamationTriangle, FaTrash } from "react-icons/fa";
import { refreshCallingConfig } from "@/hooks/useCallingConfig";

interface Summary {
  configured: boolean;
  enabled: boolean;
  provider: string;
  apiTokenMask: string;
  apiKey: string;
  accountSid: string;
  callerId: string;
  subdomain: string;
  lastVerifyError: string | null;
  updatedAt: string | null;
  encryptionReady: boolean;
}

const ACCENT = "#9E217B";

export default function ManualCallingSettingsCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    provider: "exotel",
    apiKey: "",
    accountSid: "",
    callerId: "",
    subdomain: "api.exotel.com",
    apiToken: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/manual-calling", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        const s: Summary = json.settings;
        setSummary(s);
        // Note the absence of apiToken — there is nothing to prefill it with.
        setForm((f) => ({
          ...f,
          provider: s.provider || "exotel",
          apiKey: s.apiKey || "",
          accountSid: s.accountSid || "",
          callerId: s.callerId || "",
          subdomain: s.subdomain || "api.exotel.com",
        }));
      }
    } catch {
      setNote({ kind: "error", text: "Could not load the calling settings." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setNote(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/settings/manual-calling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // apiToken omitted entirely when blank, so the server keeps the stored one.
        body: JSON.stringify({
          ...form,
          apiToken: form.apiToken.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setFieldErrors(json.fieldErrors ?? {});
        setNote({ kind: "error", text: json.message || "Check the highlighted fields." });
        return;
      }
      setSummary(json.settings);
      setForm((f) => ({ ...f, apiToken: "" })); // never retain the token in state
      setNote({ kind: "ok", text: "Click-to-call settings saved." });
      // So the call buttons pick up the new mode without a page reload.
      refreshCallingConfig();
    } catch {
      setNote({ kind: "error", text: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/manual-calling", { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setSummary(json.settings);
        setForm({
          provider: "exotel",
          apiKey: "",
          accountSid: "",
          callerId: "",
          subdomain: "api.exotel.com",
          apiToken: "",
        });
        setNote({
          kind: "ok",
          text: "Credentials removed. Manual Call now opens the device dialler.",
        });
        refreshCallingConfig();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 text-gray-500 text-sm">Loading…</div>;
  }

  const input =
    "w-full bg-[#0f0f0f] border border-[#333] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#9E217B] transition-colors placeholder:text-gray-600";

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
      <div className="flex items-center gap-3 mb-1">
        <FaPhoneAlt style={{ color: ACCENT }} />
        <h3 className="font-bold text-white">Click-to-Call</h3>
        {summary?.configured ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green-400">
            <FaCheckCircle /> Configured
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-gray-500">Using device dialler</span>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-5 leading-relaxed">
        With credentials, the <strong className="text-gray-300">Manual Call</strong> button rings
        your own phone first and connects you to the contact. Without them it still works — it opens
        your device&apos;s dialler instead. This is separate from the AI agent calling above.
      </p>

      {!summary?.encryptionReady && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
          <span>
            SECRETS_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored.
            Storing them unencrypted is not an option this app offers.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" error={fieldErrors.provider}>
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className={input}
          >
            {/* Only providers the server can actually dial are listed. */}
            <option value="exotel">Exotel</option>
          </select>
        </Field>

        <Field label="API host" error={fieldErrors.subdomain}>
          <input
            value={form.subdomain}
            onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
            placeholder="api.exotel.com"
            className={input}
          />
        </Field>

        <Field label="API Key" error={fieldErrors.apiKey}>
          <input
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="Exotel API key"
            className={input}
          />
        </Field>

        <Field label="Account SID" error={fieldErrors.accountSid}>
          <input
            value={form.accountSid}
            onChange={(e) => setForm({ ...form, accountSid: e.target.value })}
            className={input}
          />
        </Field>

        <Field label="Caller ID (Exophone)" error={fieldErrors.callerId}>
          <input
            value={form.callerId}
            onChange={(e) => setForm({ ...form, callerId: e.target.value })}
            placeholder="+918035739222"
            className={input}
          />
        </Field>

        <Field
          label="API Token"
          error={fieldErrors.apiToken}
          hint={
            summary?.apiTokenMask
              ? `Stored: ${summary.apiTokenMask} — leave blank to keep it`
              : "Stored encrypted; never shown again"
          }
        >
          <input
            type="password"
            value={form.apiToken}
            onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
            placeholder={summary?.apiTokenMask ? "Unchanged" : "Paste API token…"}
            autoComplete="new-password"
            className={input}
          />
        </Field>
      </div>

      {summary?.lastVerifyError && (
        <p className="mt-3 text-xs text-red-400">{summary.lastVerifyError}</p>
      )}

      {note && (
        <p className={`mt-4 text-xs ${note.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
          {note.text}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={save}
          disabled={saving || !summary?.encryptionReady}
          className="px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: ACCENT }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {summary?.configured && (
          <button
            onClick={clear}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border border-[#333] text-gray-400 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50"
          >
            <FaTrash className="text-xs" /> Remove credentials
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-gray-400">{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-[11px] text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-gray-600">{hint}</p>
      ) : null}
    </div>
  );
}
