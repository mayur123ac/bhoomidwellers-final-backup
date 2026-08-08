"use client";
// BolnaSettingsCard.tsx — the "Calling Integration" section of Settings.
//
// ── The one rule this component follows ─────────────────────────────────────
//
// The API key travels in exactly one direction: from this form to the server.
// It is never fetched, never rendered back, never written to localStorage, and
// never held in state after a successful save.
//
// That is why the key input starts EMPTY even when a key is stored, with the
// mask shown as static text beside it. The obvious alternative — fetch the key
// and prefill the field — would put a live credential into the page's HTML,
// into the React tree, and into anything that scrapes the DOM. GET
// /api/settings/bolna does not return it, so this component could not prefill
// even if it tried; the two halves are built to agree.
//
// The consequence is deliberate: an admin editing only the phone number leaves
// the key field blank, and the server keeps what it already has.

import React, { useCallback, useEffect, useState } from "react";
import { FaPhoneAlt, FaCheckCircle, FaExclamationTriangle, FaCopy, FaTrash } from "react-icons/fa";

interface BolnaSettings {
  configured: boolean;
  enabled: boolean;
  apiKeyMask: string;
  agentId: string;
  phoneNumber: string;
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  updatedAt: string | null;
  encryptionReady: boolean;
  webCallEnabled: boolean;
  webhookUrl: string | null;
}

type FieldErrors = Partial<Record<"apiKey" | "agentId" | "phoneNumber", string>>;

const ACCENT = "#9E217B";

export default function BolnaSettingsCard() {
  const [settings, setSettings] = useState<BolnaSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state. apiKey is write-only and is cleared the moment a save succeeds.
  const [apiKey, setApiKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [enabled, setEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/bolna", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setSettings(json.settings);
        setAgentId(json.settings.agentId || "");
        setPhoneNumber(json.settings.phoneNumber || "");
        setEnabled(json.settings.enabled !== false);
      }
    } catch {
      // A failed load leaves the card in its "not configured" shape, which is
      // the right thing to show when the panel cannot reach its own backend.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    setWarnings([]);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/settings/bolna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Only sent when the admin actually typed one. A blank field means
          // "keep the stored key", which is what makes editing the other two
          // fields possible without re-entering a secret nobody can read back.
          apiKey: apiKey.trim() || undefined,
          agentId: agentId.trim(),
          phoneNumber: phoneNumber.trim(),
          enabled,
        }),
      });
      const json = await res.json();

      if (json.success) {
        // Cleared immediately: the credential has no reason to outlive the request.
        setApiKey("");
        setSettings(json.settings);
        setSuccessMsg(json.message || "Saved.");
        setWarnings(json.warnings || []);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setFieldErrors(json.fieldErrors || {});
        setFormError(json.message || "Could not save.");
        setWarnings(json.warnings || []);
      }
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Remove the stored Bolna credentials? Calling will stop working until new ones are saved.")) {
      return;
    }
    setSaving(true);
    try {
      await fetch("/api/settings/bolna", { method: "DELETE" });
      setApiKey("");
      setAgentId("");
      setPhoneNumber("");
      setSuccessMsg("Bolna credentials removed.");
      await load();
    } catch {
      setFormError("Could not remove the credentials.");
    } finally {
      setSaving(false);
    }
  };

  const copyWebhook = () => {
    if (!settings?.webhookUrl) return;
    navigator.clipboard.writeText(settings.webhookUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  };

  const inputClass = (field: keyof FieldErrors) =>
    `w-full bg-[#222] border rounded-lg p-3 text-sm outline-none transition-colors text-white ${
      fieldErrors[field] ? "border-red-500/70 focus:border-red-500" : "border-[#333] focus:border-[#9E217B]"
    }`;

  if (loading) {
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
        <div className="h-5 w-48 bg-[#222] rounded animate-pulse" />
      </div>
    );
  }

  const hasStoredKey = Boolean(settings?.apiKeyMask);

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <FaPhoneAlt style={{ color: ACCENT }} /> Calling Integration
          <span className="text-[10px] font-semibold text-gray-500 border border-[#333] rounded px-2 py-0.5">
            Bolna
          </span>
        </h2>

        <StatusBadge settings={settings} />
      </div>

      <p className="text-xs text-gray-400 mb-5">
        Connect a Bolna voice agent so the CRM can place AI phone calls to leads and attach the
        transcript and summary back to the lead record.
      </p>

      {/* Encryption is a precondition, not a detail — without it the save is
          refused server-side, so saying so up front avoids a confusing 503. */}
      {settings && !settings.encryptionReady && (
        <Callout tone="error" icon={<FaExclamationTriangle />}>
          <strong>Secrets cannot be encrypted yet.</strong> Set{" "}
          <code className="bg-black/40 px-1 rounded">SECRETS_ENCRYPTION_KEY</code> in{" "}
          <code className="bg-black/40 px-1 rounded">.env.local</code> and restart the server. Generate
          one with:
          <pre className="mt-2 text-[10px] bg-black/40 p-2 rounded overflow-x-auto">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </pre>
          The API key will not be stored until this is set — this app does not keep credentials in
          plain text.
        </Callout>
      )}

      <div className="space-y-4">
        {/* ── API key ── */}
        <div>
          <label className="block text-xs mb-1.5 font-medium text-gray-400">
            Bolna API Key
            {hasStoredKey && (
              <span className="ml-2 font-mono text-[11px] text-green-400">
                stored: {settings!.apiKeyMask}
              </span>
            )}
          </label>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasStoredKey ? "Leave blank to keep the stored key" : "bn-…"}
            className={inputClass("apiKey")}
          />
          {fieldErrors.apiKey ? (
            <FieldError>{fieldErrors.apiKey}</FieldError>
          ) : (
            <p className="text-[11px] text-gray-500 mt-1.5">
              From the Bolna dashboard under Developers → API Keys. Stored encrypted on the server and
              never sent back to the browser.
            </p>
          )}
        </div>

        {/* ── Agent ID ── */}
        <div>
          <label className="block text-xs mb-1.5 font-medium text-gray-400">Bolna Agent ID</label>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="123e4567-e89b-12d3-a456-426655440000"
            className={`${inputClass("agentId")} font-mono`}
          />
          {fieldErrors.agentId ? (
            <FieldError>{fieldErrors.agentId}</FieldError>
          ) : (
            <p className="text-[11px] text-gray-500 mt-1.5">
              The UUID of the voice agent that will handle these calls.
            </p>
          )}
        </div>

        {/* ── Phone number ── */}
        <div>
          <label className="block text-xs mb-1.5 font-medium text-gray-400">Bolna Phone Number</label>
          <input
            type="tel"
            autoComplete="off"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+918035739222"
            className={`${inputClass("phoneNumber")} font-mono`}
          />
          {fieldErrors.phoneNumber ? (
            <FieldError>{fieldErrors.phoneNumber}</FieldError>
          ) : (
            <p className="text-[11px] text-gray-500 mt-1.5">
              The caller ID for outbound calls, in international format. Must be a number on this Bolna
              account.
            </p>
          )}
        </div>

        {/* ── Enabled ── */}
        <div className="flex items-center justify-between bg-[#151515] border border-[#2a2a2a] rounded-lg p-4">
          <div>
            <p className="text-sm font-semibold">Enable calling</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Turn off to stop all calls without deleting the credentials.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Enable calling"
            onClick={() => setEnabled((v) => !v)}
            className={`relative flex-shrink-0 w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#1a1a1a] ${
              enabled ? "bg-[#9E217B]" : "bg-[#333]"
            }`}
            style={enabled ? undefined : {}}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300 ${
                enabled ? "translate-x-7" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      {formError && (
        <Callout tone="error" icon={<FaExclamationTriangle />}>
          {formError}
        </Callout>
      )}

      {warnings.length > 0 && (
        <Callout tone="warn" icon={<FaExclamationTriangle />}>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      {successMsg && !formError && (
        <Callout tone="success" icon={<FaCheckCircle />}>
          {successMsg}
        </Callout>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={handleSave}
          disabled={saving || !settings?.encryptionReady}
          className={`px-6 py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            saved ? "bg-green-600 text-white" : "bg-[#9E217B] hover:bg-[#b8268f] text-white"
          }`}
        >
          {saved ? "✓ Verified & Saved" : saving ? "Verifying with Bolna…" : "Save & Verify"}
        </button>

        {settings?.configured && (
          <button
            onClick={handleDisconnect}
            disabled={saving}
            className="px-4 py-3 rounded-lg text-sm font-semibold text-gray-400 border border-[#333] hover:border-red-500/50 hover:text-red-400 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <FaTrash className="text-[11px]" /> Disconnect
          </button>
        )}

        {settings?.lastVerifiedAt && !saving && (
          <span className="text-[11px] text-gray-500">
            Last verified {new Date(settings.lastVerifiedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* ── Webhook URL ──
          Placed after the save button because it is a setup step that only
          matters once credentials exist, and because it has to be pasted into a
          different application entirely. */}
      {settings?.configured && (
        <div className="mt-6 pt-5 border-t border-[#2a2a2a]">
          <p className="text-xs font-semibold text-gray-300 mb-1">Webhook URL</p>
          <p className="text-[11px] text-gray-500 mb-2">
            Paste this into your agent&apos;s <strong>Extractions</strong> tab in the Bolna dashboard,
            under &quot;Push all execution data to webhook&quot;. Without it, transcripts and summaries
            will not reach the CRM.
          </p>

          {settings.webhookUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#222] border border-[#333] rounded-lg p-2.5 text-[11px] font-mono text-gray-300 overflow-x-auto whitespace-nowrap">
                {settings.webhookUrl}
              </code>
              <button
                onClick={copyWebhook}
                className="px-3 py-2.5 rounded-lg border border-[#333] text-gray-400 hover:text-white hover:border-[#555] transition-colors"
                title="Copy webhook URL"
              >
                {copied ? <FaCheckCircle className="text-green-400" /> : <FaCopy />}
              </button>
            </div>
          ) : (
            <Callout tone="warn" icon={<FaExclamationTriangle />}>
              The server does not know its own public URL, so the webhook address cannot be shown. Set{" "}
              <code className="bg-black/40 px-1 rounded">BOLNA_PUBLIC_BASE_URL</code> in{" "}
              <code className="bg-black/40 px-1 rounded">.env.local</code> to the CRM&apos;s public
              origin.
            </Callout>
          )}

          {!settings.webCallEnabled && (
            <p className="text-[11px] text-gray-500 mt-3">
              <strong className="text-gray-400">Browser calling is off.</strong> Bolna&apos;s Web Call
              SDK is in beta and enabled per account — email support@bolna.dev, then set{" "}
              <code className="bg-black/40 px-1 rounded">BOLNA_WEB_CALL_ENABLED=true</code>. Outbound
              phone calls work without it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── presentational helpers ───────────────────────────────────────────────────

function StatusBadge({ settings }: { settings: BolnaSettings | null }) {
  if (!settings?.configured) {
    return (
      <span className="text-[11px] font-bold px-3 py-1 rounded-full border text-gray-400 border-gray-700 bg-[#222] whitespace-nowrap">
        Not configured
      </span>
    );
  }
  if (!settings.enabled) {
    return (
      <span className="text-[11px] font-bold px-3 py-1 rounded-full border text-amber-400 border-amber-500/40 bg-amber-500/10 whitespace-nowrap">
        Disabled
      </span>
    );
  }
  if (settings.lastVerifyError) {
    return (
      <span className="text-[11px] font-bold px-3 py-1 rounded-full border text-red-400 border-red-500/40 bg-red-500/10 whitespace-nowrap">
        Needs attention
      </span>
    );
  }
  return (
    <span className="text-[11px] font-bold px-3 py-1 rounded-full border text-green-400 border-green-500/40 bg-green-500/10 whitespace-nowrap">
      Connected
    </span>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-red-400 mt-1.5 leading-relaxed">{children}</p>;
}

function Callout({
  tone,
  icon,
  children,
}: {
  tone: "error" | "warn" | "success";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    error: "bg-red-900/25 border-red-500/40 text-red-300",
    warn: "bg-amber-900/20 border-amber-500/40 text-amber-300",
    success: "bg-green-900/25 border-green-500/40 text-green-300",
  } as const;

  return (
    <div className={`mt-4 border rounded-lg p-3 text-[11px] leading-relaxed ${tones[tone]}`}>
      <div className="flex gap-2">
        <span className="mt-0.5 flex-shrink-0">{icon}</span>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
