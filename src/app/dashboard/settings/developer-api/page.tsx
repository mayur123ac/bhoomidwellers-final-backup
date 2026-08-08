"use client";

// Developer API — key management, usage statistics, and a live test console.
//
// The section this replaces was a PlannedSection whose blocker was that an
// issued key would not authenticate anything. That is now false: lib/apiKeys.ts
// authenticates these keys against the /api/v1/* surface. The docs card below is
// generated from the same scope catalogue the server enforces, so it cannot
// drift into describing endpoints that do not exist.
//
// ── The one-time reveal ─────────────────────────────────────────────────────
// The server stores only a SHA-256 of each key, so the plaintext exists in this
// component's state and nowhere else, once. The reveal modal therefore refuses
// to close on backdrop click or Escape — losing it costs a rotation, and an
// accidental dismissal is a genuinely bad outcome rather than a minor one.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  api,
  useToast,
} from "@/components/Settings/ui";

/* ── Types mirroring the API responses ────────────────────────────────────── */

interface ScopeDef {
  value: string;
  label: string;
  description: string;
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_min: number | null;
  ip_whitelist: string[];
  created_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  rotated_to_id: number | null;
  created_by_name: string | null;
  revoked_by_name: string | null;
  calls_24h: number;
}

interface UsageData {
  windowDays: number;
  totals: { requests: number; errors: number; avgMs: number | null };
  daily: { day: string; requests: number; errors: number }[];
  endpoints: { endpoint: string; requests: number; errors: number; avgMs: number | null }[];
  byKey: { id: number; name: string; prefix: string; requests: number }[];
}

/** GET /api/settings/api-keys */
interface KeyListResponse {
  data: ApiKey[];
  scopes: ScopeDef[];
  defaults: { rateLimitPerMin: number; maxRateLimitPerMin: number };
}

/** GET /api/settings/api-keys/usage */
interface UsageResponse {
  data: UsageData;
}

/** POST/PATCH/DELETE on a key. `plaintextKey` is present only on create and rotate. */
interface MutationResponse {
  success: boolean;
  message: string;
  plaintextKey?: string;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Message text from a caught value. Mirrors lib/apiKeys.ts's helper of the same
 * name, duplicated rather than imported because that module pulls in node:crypto
 * and `pg` — importing it here would drag both into the client bundle.
 */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeDays(value: string | null): string {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** active | expired | revoked — derived here so the badge and the filters agree. */
function keyState(k: ApiKey): "active" | "expired" | "revoked" {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

export default function DeveloperApiPage() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [scopes, setScopes] = useState<ScopeDef[]>([]);
  const [defaults, setDefaults] = useState({ rateLimitPerMin: 120, maxRateLimitPerMin: 1000 });
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageDays, setUsageDays] = useState(7);
  const [showRevoked, setShowRevoked] = useState(false);

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<{ key: string; name: string } | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await api<KeyListResponse>("/api/settings/api-keys");
      setKeys(res.data ?? []);
      setScopes(res.scopes ?? []);
      if (res.defaults) setDefaults(res.defaults);
    } catch (err) {
      toast("error", errorText(err));
    }
  }, [toast]);

  const loadUsage = useCallback(
    async (days: number) => {
      try {
        const res = await api<UsageResponse>(`/api/settings/api-keys/usage?days=${days}`);
        setUsage(res.data);
      } catch (err) {
        // Usage is supplementary — a failure here must not blank the key list,
        // which is the part of this page that matters operationally.
        console.error("[developer-api] usage load failed", errorText(err));
      }
    },
    []
  );

  useEffect(() => {
    Promise.all([loadKeys(), loadUsage(usageDays)]).finally(() => setLoading(false));
    // usageDays intentionally excluded — its own effect below handles changes,
    // and including it here would re-run the key fetch for a chart filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKeys]);

  useEffect(() => {
    if (!loading) loadUsage(usageDays);
  }, [usageDays, loading, loadUsage]);

  const visibleKeys = useMemo(
    () => keys.filter((k) => showRevoked || keyState(k) !== "revoked"),
    [keys, showRevoked]
  );

  const revokedCount = useMemo(
    () => keys.filter((k) => keyState(k) === "revoked").length,
    [keys]
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Developer API" subtitle="API keys, scopes and usage." />
        <Card>
          <Skeleton rows={6} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Developer API"
        subtitle="Issue keys for the /api/v1 surface, set their scopes and limits, and watch what they do."
        action={<Button onClick={() => setCreateOpen(true)}>Create API key</Button>}
      />

      <UsageCard usage={usage} days={usageDays} onDaysChange={setUsageDays} />

      <Card
        title="API keys"
        description="A key's secret is shown once, when it is created or rotated. It is stored only as a hash, so it cannot be shown again."
      >
        {visibleKeys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Create one to let an external tool read from this CRM."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr style={{ color: T.muted }} className="text-left">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Key</th>
                  <th className="pb-3 pr-4 font-medium">Scopes</th>
                  <th className="pb-3 pr-4 font-medium">Last used</th>
                  <th className="pb-3 pr-4 font-medium">24h</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleKeys.map((k) => {
                  const state = keyState(k);
                  return (
                    <tr key={k.id} className="border-t" style={{ borderColor: T.border }}>
                      <td className="py-3 pr-4">
                        <div className="font-medium" style={{ color: T.text }}>{k.name}</div>
                        <div className="text-xs" style={{ color: T.muted }}>
                          by {k.created_by_name ?? "unknown"} · {formatDate(k.created_at)}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <code
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{ background: T.neutralSoft, color: T.text }}
                        >
                          {k.key_prefix}…
                        </code>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span
                              key={s}
                              className="rounded px-1.5 py-0.5 text-[11px]"
                              style={{ background: T.accentSoft, color: T.text }}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-4" style={{ color: T.muted }}>
                        {k.last_used_at ? (
                          <>
                            <div style={{ color: T.text }}>{relativeDays(k.last_used_at)}</div>
                            <div className="text-xs">{k.last_used_ip ?? ""}</div>
                          </>
                        ) : (
                          "never"
                        )}
                      </td>
                      <td className="py-3 pr-4" style={{ color: T.text }}>{k.calls_24h}</td>
                      <td className="py-3 pr-4">
                        {state === "active" && <StatusBadge status="active">Active</StatusBadge>}
                        {state === "expired" && <StatusBadge status="pending">Expired</StatusBadge>}
                        {state === "revoked" && (
                          <StatusBadge status="danger">
                            {k.revoked_reason === "rotated" ? "Rotated" : "Revoked"}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {state !== "revoked" ? (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" onClick={() => setEditing(k)}>Edit</Button>
                            <Button variant="ghost" onClick={() => setRotating(k)}>Rotate</Button>
                            <Button variant="ghost" onClick={() => setRevoking(k)}>
                              <span style={{ color: T.danger }}>Revoke</span>
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: T.muted }}>
                            {formatDate(k.revoked_at)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {revokedCount > 0 && (
          <div className="mt-4">
            <Checkbox
              id="show-revoked"
              checked={showRevoked}
              onChange={setShowRevoked}
              label={`Show revoked keys (${revokedCount})`}
            />
          </div>
        )}
      </Card>

      <TestConsole />

      <DocsCard scopes={scopes} />

      {createOpen && (
        <KeyFormModal
          mode="create"
          scopes={scopes}
          defaults={defaults}
          onClose={() => setCreateOpen(false)}
          onDone={async (plaintext, name) => {
            setCreateOpen(false);
            if (plaintext) setRevealed({ key: plaintext, name });
            await loadKeys();
          }}
        />
      )}

      {editing && (
        <KeyFormModal
          mode="edit"
          existing={editing}
          scopes={scopes}
          defaults={defaults}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            toast("success", "Key updated.");
            await loadKeys();
          }}
        />
      )}

      {rotating && (
        <RotateModal
          apiKey={rotating}
          onClose={() => setRotating(null)}
          onDone={async (plaintext, name) => {
            setRotating(null);
            setRevealed({ key: plaintext, name });
            await loadKeys();
          }}
        />
      )}

      {revoking && (
        <RevokeModal
          apiKey={revoking}
          onClose={() => setRevoking(null)}
          onDone={async () => {
            setRevoking(null);
            toast("success", "Key revoked.");
            await loadKeys();
          }}
        />
      )}

      {revealed && (
        <RevealModal
          name={revealed.name}
          plaintext={revealed.key}
          onClose={() => setRevealed(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Usage
   ══════════════════════════════════════════════════════════════════════════ */

function UsageCard({
  usage,
  days,
  onDaysChange,
}: {
  usage: UsageData | null;
  days: number;
  onDaysChange: (n: number) => void;
}) {
  // Peak defines the bar scale. Guarded to ≥1 so a period with no traffic does
  // not divide by zero and render NaN-height bars.
  const peak = Math.max(1, ...(usage?.daily ?? []).map((d) => d.requests));

  const errorRate =
    usage && usage.totals.requests > 0
      ? Math.round((usage.totals.errors / usage.totals.requests) * 1000) / 10
      : 0;

  return (
    <Card
      title="Usage"
      description="Requests recorded against the /api/v1 surface."
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="text-sm" style={{ color: T.muted }} htmlFor="usage-window">
          Window
        </label>
        <div className="w-40">
          <Select
            id="usage-window"
            value={String(days)}
            onChange={(e) => onDaysChange(Number(e.target.value))}
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Requests" value={usage ? usage.totals.requests.toLocaleString() : "—"} />
        <Stat
          label="Errors"
          value={usage ? `${usage.totals.errors.toLocaleString()} (${errorRate}%)` : "—"}
          tone={errorRate > 5 ? "danger" : "default"}
        />
        <Stat
          label="Mean latency"
          value={usage?.totals.avgMs != null ? `${usage.totals.avgMs} ms` : "—"}
        />
      </div>

      {usage && usage.daily.length > 0 ? (
        <>
          <div
            className="flex h-28 items-end gap-1"
            role="img"
            aria-label={`Daily request volume over the last ${days} days, peaking at ${peak} requests.`}
          >
            {usage.daily.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${d.day}: ${d.requests} requests, ${d.errors} errors`}>
                {d.errors > 0 && (
                  <div
                    style={{
                      height: `${(d.errors / peak) * 100}%`,
                      background: T.danger,
                      minHeight: 2,
                    }}
                    className="rounded-t"
                  />
                )}
                <div
                  style={{
                    height: `${((d.requests - d.errors) / peak) * 100}%`,
                    background: T.teal,
                    minHeight: 2,
                  }}
                  className={d.errors > 0 ? "" : "rounded-t"}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs" style={{ color: T.muted }}>
            Teal is successful requests, red is 4xx/5xx. Hover a bar for the day&apos;s figures.
          </p>

          {usage.endpoints.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: T.muted }} className="text-left">
                    <th className="pb-2 pr-4 font-medium">Endpoint</th>
                    <th className="pb-2 pr-4 font-medium text-right">Requests</th>
                    <th className="pb-2 pr-4 font-medium text-right">Errors</th>
                    <th className="pb-2 font-medium text-right">Mean</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.endpoints.map((e) => (
                    <tr key={e.endpoint} className="border-t" style={{ borderColor: T.border }}>
                      <td className="py-2 pr-4">
                        <code className="text-xs" style={{ color: T.text }}>{e.endpoint}</code>
                      </td>
                      <td className="py-2 pr-4 text-right" style={{ color: T.text }}>
                        {e.requests.toLocaleString()}
                      </td>
                      <td
                        className="py-2 pr-4 text-right"
                        style={{ color: e.errors > 0 ? T.danger : T.muted }}
                      >
                        {e.errors}
                      </td>
                      <td className="py-2 text-right" style={{ color: T.muted }}>
                        {e.avgMs != null ? `${e.avgMs} ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="No requests yet"
          description="Once a key calls /api/v1, its traffic appears here."
        />
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: T.border }}>
      <div className="text-xs" style={{ color: T.muted }}>{label}</div>
      <div
        className="mt-1 text-xl font-semibold"
        style={{ color: tone === "danger" ? T.danger : T.text }}
      >
        {value}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Create / edit
   ══════════════════════════════════════════════════════════════════════════ */

function KeyFormModal({
  mode,
  existing,
  scopes,
  defaults,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  existing?: ApiKey;
  scopes: ScopeDef[];
  defaults: { rateLimitPerMin: number; maxRateLimitPerMin: number };
  onClose: () => void;
  onDone: (plaintext: string | null, name: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [selected, setSelected] = useState<string[]>(existing?.scopes ?? []);
  const [rateLimit, setRateLimit] = useState(
    existing?.rate_limit_per_min != null ? String(existing.rate_limit_per_min) : ""
  );
  const [ipList, setIpList] = useState((existing?.ip_whitelist ?? []).join("\n"));
  const [expiresAt, setExpiresAt] = useState(
    existing?.expires_at ? existing.expires_at.slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleScope = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Give the key a name.";
    if (selected.length === 0) next.scopes = "Select at least one scope.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload = {
      name: name.trim(),
      scopes: selected,
      rateLimitPerMin: rateLimit.trim() === "" ? null : Number(rateLimit),
      ipWhitelist: ipList.split("\n").map((s) => s.trim()).filter(Boolean),
      expiresAt: expiresAt || null,
    };

    setSaving(true);
    try {
      if (mode === "create") {
        const res = await api<MutationResponse>("/api/settings/api-keys", { method: "POST", json: payload });
        await onDone(res.plaintextKey ?? null, payload.name);
      } else {
        await api<MutationResponse>(`/api/settings/api-keys/${existing!.id}`, {
          method: "PATCH",
          json: payload,
        });
        await onDone(null, payload.name);
      }
    } catch (err) {
      toast("error", errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "Create API key" : `Edit “${existing!.name}”`}
      description={
        mode === "create"
          ? "The secret is shown once, immediately after creation."
          : "Editing changes what this key may do. Its secret is unchanged."
      }
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>
            {mode === "create" ? "Create key" : "Save changes"}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="key-name" required error={errors.name}
        hint="What this key is for, so it can be recognised later — e.g. “Website availability feed”.">
        <TextInput
          id="key-name"
          value={name}
          maxLength={120}
          hasError={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
          placeholder="Website availability feed"
        />
      </Field>

      <Field label="Scopes" required error={errors.scopes}
        hint="A key can do only what its scopes allow. Grant the narrowest set that works.">
        <div className="space-y-2">
          {scopes.map((s) => (
            <div key={s.value} className="flex items-start gap-3">
              <Checkbox
                id={`scope-${s.value.replace(":", "-")}`}
                checked={selected.includes(s.value)}
                onChange={() => toggleScope(s.value)}
                label={s.label}
              />
              <span className="pt-0.5 text-xs" style={{ color: T.muted }}>
                {s.description}
              </span>
            </div>
          ))}
        </div>
      </Field>

      <Field
        label="Rate limit"
        htmlFor="key-rate"
        hint={`Requests per minute. Leave blank for the default of ${defaults.rateLimitPerMin}. Maximum ${defaults.maxRateLimitPerMin}.`}
      >
        <TextInput
          id="key-rate"
          type="number"
          min={1}
          max={defaults.maxRateLimitPerMin}
          value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)}
          placeholder={String(defaults.rateLimitPerMin)}
        />
      </Field>

      <Field
        label="IP allow-list"
        htmlFor="key-ips"
        hint="One address or CIDR range per line. Leave blank to allow any address. IPv6 must be an exact address — ranges are not matched."
      >
        <textarea
          id="key-ips"
          value={ipList}
          onChange={(e) => setIpList(e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full rounded-lg border px-3 py-2.5 font-mono text-sm outline-none transition-colors focus:ring-2"
          // The cast covers `--tw-ring-color`, a CSS custom property that
          // React.CSSProperties has no index signature for. Same technique as
          // inputStyle() in components/Settings/ui.tsx.
          style={
            {
              borderColor: T.border,
              color: T.text,
              background: T.surface,
              "--tw-ring-color": T.accentRing,
            } as React.CSSProperties
          }
          placeholder={"203.0.113.7\n198.51.100.0/24"}
        />
      </Field>

      <Field label="Expires" htmlFor="key-expiry" hint="Leave blank for a key that never expires.">
        <TextInput
          id="key-expiry"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Reveal
   ══════════════════════════════════════════════════════════════════════════ */

function RevealModal({
  name,
  plaintext,
  onClose,
}: {
  name: string;
  plaintext: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast("success", "Key copied to clipboard.");
    } catch {
      // Clipboard access fails on insecure origins and when the user has denied
      // permission. The key is on screen and selectable, so this is recoverable
      // — but saying so beats a silent no-op.
      toast("error", "Could not copy automatically. Select the key and copy it manually.");
    }
  };

  return (
    <Modal
      open
      // Deliberately inert: dismissing this by accident loses the only copy of
      // the secret. Closing requires ticking the acknowledgement below.
      onClose={() => {}}
      title="Copy your API key now"
      description={`This is the only time the secret for “${name}” is shown. It is stored as a hash and cannot be retrieved again.`}
      width="max-w-2xl"
      footer={
        <Button onClick={onClose} disabled={!acknowledged}>
          Done
        </Button>
      }
    >
      <InfoBanner tone="warning">
        If you lose this key you cannot recover it — you will have to rotate the key and update
        whatever uses it.
      </InfoBanner>

      <div
        className="mb-4 flex items-center gap-3 rounded-lg border p-3"
        style={{ borderColor: T.border, background: T.neutralSoft }}
      >
        <code
          className="flex-1 break-all font-mono text-sm"
          style={{ color: T.text }}
          // Selectable so manual copy works when the clipboard API is blocked.
          tabIndex={0}
        >
          {plaintext}
        </code>
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <Checkbox
        id="reveal-acknowledged"
        checked={acknowledged}
        onChange={setAcknowledged}
        label="I have copied this key and stored it somewhere safe."
      />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Rotate / revoke
   ══════════════════════════════════════════════════════════════════════════ */

function RotateModal({
  apiKey,
  onClose,
  onDone,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onDone: (plaintext: string, name: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [grace, setGrace] = useState("0");
  const [busy, setBusy] = useState(false);

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await api<MutationResponse>(`/api/settings/api-keys/${apiKey.id}/rotate`, {
        method: "POST",
        json: { graceMinutes: Number(grace) },
      });
      if (!res.plaintextKey) {
        // Should not happen — the rotate route always returns the new secret.
        // If it ever does, say so rather than opening an empty reveal modal that
        // looks like the key is blank.
        throw new Error("Rotation succeeded but no new key was returned. Check the key list.");
      }
      await onDone(res.plaintextKey, apiKey.name);
    } catch (err) {
      toast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rotate “${apiKey.name}”`}
      description="A new secret is issued and the current one stops working."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={rotate} loading={busy}>Rotate key</Button>
        </>
      }
    >
      <p className="mb-4 text-sm" style={{ color: T.muted }}>
        The replacement keeps this key&apos;s scopes, rate limit, IP allow-list and expiry. Anything
        still calling with the old secret will start failing — its traffic stays visible in Usage,
        so you can tell whether something was missed.
      </p>

      <Field
        label="Grace period"
        htmlFor="rotate-grace"
        hint="How long the old key keeps working. Choose none if the key may have leaked."
      >
        <Select id="rotate-grace" value={grace} onChange={(e) => setGrace(e.target.value)}>
          <option value="0">None — old key stops immediately</option>
          <option value="15">15 minutes</option>
          <option value="60">1 hour</option>
          <option value="720">12 hours</option>
          <option value="1440">24 hours</option>
        </Select>
      </Field>
    </Modal>
  );
}

function RevokeModal({
  apiKey,
  onClose,
  onDone,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  // Typing the name is required because revocation is immediate and
  // irreversible, and the button sits in a row of similar-looking actions.
  const confirmed = confirmText.trim() === apiKey.name;

  const revoke = async () => {
    setBusy(true);
    try {
      await api<MutationResponse>(
        `/api/settings/api-keys/${apiKey.id}?reason=${encodeURIComponent(reason)}`,
        { method: "DELETE" }
      );
      await onDone();
    } catch (err) {
      toast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Revoke “${apiKey.name}”`}
      description="Every request using this key starts failing immediately. This cannot be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={revoke} loading={busy} disabled={!confirmed}>
            Revoke key
          </Button>
        </>
      }
    >
      {apiKey.calls_24h > 0 && (
        <InfoBanner tone="warning">
          This key made {apiKey.calls_24h.toLocaleString()} request
          {apiKey.calls_24h === 1 ? "" : "s"} in the last 24 hours. Something is actively using it.
        </InfoBanner>
      )}

      <Field label="Reason" htmlFor="revoke-reason" hint="Recorded in the audit log. Optional.">
        <TextInput
          id="revoke-reason"
          value={reason}
          maxLength={255}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Leaked in a support ticket"
        />
      </Field>

      <Field
        label={`Type “${apiKey.name}” to confirm`}
        htmlFor="revoke-confirm"
        required
      >
        <TextInput
          id="revoke-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
      </Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Test console
   ══════════════════════════════════════════════════════════════════════════ */

function TestConsole() {
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("/api/v1/ping");
  const [result, setResult] = useState<{ status: number; body: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const started = performance.now();
    try {
      // Sent from the browser, so it exercises the real route, the real auth
      // path and the real rate limiter — not a server-side simulation of them.
      // It also means the call is recorded in Usage like any other, which is
      // the honest behaviour: a test request IS a request.
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        cache: "no-store",
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — show it raw */
      }
      setResult({ status: res.status, body: pretty, ms: Math.round(performance.now() - started) });
    } catch (err) {
      setResult({ status: 0, body: `Request failed: ${errorText(err)}`, ms: Math.round(performance.now() - started) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Test an endpoint"
      description="Paste a key and call the live API. Requests made here count towards usage and rate limits, because they are real requests."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="API key" htmlFor="test-key" hint="Not stored — used only for this request.">
          <TextInput
            id="test-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="bk_live_…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>

        <Field label="Endpoint" htmlFor="test-endpoint">
          <Select id="test-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}>
            <option value="/api/v1/ping">GET /api/v1/ping</option>
            <option value="/api/v1/leads?limit=3">GET /api/v1/leads</option>
            <option value="/api/v1/bookings?limit=3">GET /api/v1/bookings</option>
            <option value="/api/v1/inventory/units?limit=3">GET /api/v1/inventory/units</option>
            <option value="/api/v1/employees?limit=3">GET /api/v1/employees</option>
            <option value="/api/v1/followups?leadId=1">GET /api/v1/followups</option>
          </Select>
        </Field>
      </div>

      <div className="mt-2">
        <Button onClick={run} loading={busy} disabled={!key.trim()}>
          Send request
        </Button>
      </div>

      {result && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-3">
            <StatusBadge
              status={result.status >= 200 && result.status < 300 ? "success" : "danger"}
            >
              {result.status === 0 ? "Network error" : `HTTP ${result.status}`}
            </StatusBadge>
            <span className="text-xs" style={{ color: T.muted }}>{result.ms} ms</span>
          </div>
          <pre
            className="max-h-80 overflow-auto rounded-lg border p-3 text-xs"
            style={{ borderColor: T.border, background: T.neutralSoft, color: T.text }}
          >
            {result.body}
          </pre>
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Docs
   ══════════════════════════════════════════════════════════════════════════ */

const ENDPOINT_DOCS: { method: string; path: string; scope: string; params: string }[] = [
  { method: "GET", path: "/api/v1/ping", scope: "— (any valid key)", params: "none" },
  { method: "GET", path: "/api/v1/leads", scope: "leads:read", params: "status, search, since, limit, offset" },
  { method: "GET", path: "/api/v1/bookings", scope: "bookings:read", params: "status, project, since, limit, offset" },
  { method: "GET", path: "/api/v1/inventory/units", scope: "inventory:read", params: "status, project, tower, limit, offset" },
  { method: "GET", path: "/api/v1/followups", scope: "followups:read", params: "leadId (required), limit, offset" },
  { method: "GET", path: "/api/v1/employees", scope: "employees:read", params: "role, includeInactive, limit, offset" },
];

function DocsCard({ scopes }: { scopes: ScopeDef[] }) {
  return (
    <Card title="API reference" description="Everything a key can reach.">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: T.text }}>Authentication</h3>
      <p className="mb-3 text-sm" style={{ color: T.muted }}>
        Send the key as a bearer token. An <code>X-API-Key</code> header is also accepted, for tools
        that cannot set <code>Authorization</code>.
      </p>
      <pre
        className="mb-6 overflow-x-auto rounded-lg border p-3 text-xs"
        style={{ borderColor: T.border, background: T.neutralSoft, color: T.text }}
      >
{`curl -H "Authorization: Bearer bk_live_…" \\
     "https://your-crm-host/api/v1/leads?limit=10"`}
      </pre>

      <h3 className="mb-2 text-sm font-semibold" style={{ color: T.text }}>Endpoints</h3>
      <div className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr style={{ color: T.muted }} className="text-left">
              <th className="pb-2 pr-4 font-medium">Endpoint</th>
              <th className="pb-2 pr-4 font-medium">Scope</th>
              <th className="pb-2 font-medium">Query parameters</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINT_DOCS.map((e) => (
              <tr key={e.path} className="border-t" style={{ borderColor: T.border }}>
                <td className="py-2 pr-4">
                  <code className="text-xs" style={{ color: T.text }}>
                    {e.method} {e.path}
                  </code>
                </td>
                <td className="py-2 pr-4">
                  <code className="text-xs" style={{ color: T.muted }}>{e.scope}</code>
                </td>
                <td className="py-2 text-xs" style={{ color: T.muted }}>{e.params}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 text-sm font-semibold" style={{ color: T.text }}>Scopes</h3>
      <ul className="mb-6 space-y-1 text-sm" style={{ color: T.muted }}>
        {scopes.map((s) => (
          <li key={s.value}>
            <code style={{ color: T.text }}>{s.value}</code> — {s.description}
          </li>
        ))}
      </ul>

      <h3 className="mb-2 text-sm font-semibold" style={{ color: T.text }}>Responses</h3>
      <p className="mb-3 text-sm" style={{ color: T.muted }}>
        Success returns <code>{"{ data, meta }"}</code>. Failure returns{" "}
        <code>{"{ error: { code, message } }"}</code> with a matching HTTP status. Error codes:{" "}
        <code>MISSING_KEY</code>, <code>MALFORMED_KEY</code>, <code>UNKNOWN_KEY</code>,{" "}
        <code>REVOKED</code>, <code>EXPIRED</code>, <code>IP_NOT_ALLOWED</code>,{" "}
        <code>INSUFFICIENT_SCOPE</code>, <code>RATE_LIMITED</code>, <code>MISSING_PARAMETER</code>,{" "}
        <code>INTERNAL_ERROR</code>.
      </p>
      <p className="text-sm" style={{ color: T.muted }}>
        A <code>429</code> carries a <code>Retry-After</code> header in seconds. Every response
        carries <code>X-RateLimit-Limit</code>.
      </p>
    </Card>
  );
}
