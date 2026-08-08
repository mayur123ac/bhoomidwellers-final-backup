"use client";

// Workspace Settings.
//
// This is where the old /dashboard/settings page's admin controls now live —
// lead number sorting, Sales Manager bulk upload, Bolna voice calling, and the
// system-update broadcaster. Each still calls the same API it always did; only
// the surrounding chrome changed.

import { useCallback, useEffect, useState } from "react";
import { getStoredCrmUser } from "@/lib/authSession";
import BolnaSettingsCard from "@/components/BolnaSettingsCard";
import ManualCallingSettingsCard from "@/components/ManualCallingSettingsCard";
import AdminUpdatesManager from "@/components/Settings/AdminUpdatesManager";
import {
  Button,
  Card,
  EmptyState,
  Field,
  InfoBanner,
  PageHeader,
  Select,
  Skeleton,
  T,
  TextInput,
  Toggle,
  api,
  useToast,
} from "@/components/Settings/ui";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: T.border }}>
      <p className="text-xs" style={{ color: T.muted }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: T.text }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/** A toggle backed by its own endpoint, with its own save button. */
function EndpointToggle({
  title,
  description,
  detail,
  endpoint,
  onLabel,
  offLabel,
  savedMessage,
}: {
  title: string;
  description: string;
  detail: React.ReactNode;
  endpoint: string;
  onLabel: string;
  offLabel: string;
  savedMessage?: string;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>(endpoint)
      .then((r) => setEnabled(r.enabled === true))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [endpoint]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api<{ message: string }>(endpoint, {
        method: "POST",
        json: { enabled },
      });
      toast("success", savedMessage ?? result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={title}
      description={description}
      footer={
        <>
          <span
            className="mr-auto rounded-full border px-3 py-1 text-xs font-semibold"
            style={{
              borderColor: enabled ? T.teal : T.border,
              color: enabled ? T.teal : T.muted,
              background: enabled ? T.accentSoft : "transparent",
            }}
          >
            {enabled ? onLabel : offLabel}
          </span>
          <Button onClick={save} loading={saving} disabled={!loaded}>
            Save setting
          </Button>
        </>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 text-sm leading-relaxed" style={{ color: T.muted }}>
          {detail}
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label={title} disabled={!loaded} />
      </div>
    </Card>
  );
}

export default function WorkspaceSettingsPage() {
  const toast = useToast();
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    industry: "Real Estate",
    currency: "INR",
    primaryColor: "#9E217B",
    secondaryColor: "#5B1247",
    lockDashboard: false,
    forceTheme: "",
  });

  useEffect(() => setUser(getStoredCrmUser()), []);

  const load = useCallback(() => {
    api<any>("/api/settings/workspace")
      .then((r) => {
        setData(r);
        setForm({
          name: r.workspace.name ?? "",
          industry: r.workspace.industry ?? "Real Estate",
          currency: r.workspace.currency ?? "INR",
          primaryColor: r.workspace.primaryColor ?? "#9E217B",
          secondaryColor: r.workspace.secondaryColor ?? "#5B1247",
          lockDashboard: Boolean(r.workspace.lockDashboard),
          forceTheme: r.workspace.forceTheme ?? "",
        });
        setForbidden(false);
      })
      .catch((err) => {
        if (err.status === 403 || err.status === 401) setForbidden(true);
        else toast("error", err.message);
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api<any>("/api/settings/workspace", {
        method: "PATCH",
        json: { ...form, forceTheme: form.forceTheme || null },
      });
      toast("success", result.message);
      load();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <>
        <PageHeader title="Workspace Settings" />
        <Card>
          <EmptyState title="Admins only" description="Your role cannot change workspace settings." />
        </Card>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Workspace Settings" />
        <Card>
          <Skeleton rows={5} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workspace Settings"
        subtitle="Organisation-wide configuration. Changes here affect everyone."
      />

      <Card
        title="General"
        footer={
          <Button onClick={save} loading={saving}>
            Save workspace settings
          </Button>
        }
      >
        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label="Workspace Name" htmlFor="ws-name" required>
            <TextInput
              id="ws-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>

          <Field
            label="Workspace URL"
            htmlFor="ws-slug"
            hint="Fixed — this CRM runs as a single workspace, with no per-workspace routing."
          >
            <TextInput id="ws-slug" value={data?.workspace.slug ?? ""} readOnly disabled />
          </Field>

          <Field label="Industry" htmlFor="ws-industry">
            <Select
              id="ws-industry"
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
            >
              {data?.catalogue?.industries?.map((i: string) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency" htmlFor="ws-currency">
            <Select
              id="ws-currency"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            >
              {data?.catalogue?.currencies?.map((c: string) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card
        title="Branding"
        description="Stored for the theming work; the CRM's colours are not yet driven by these."
      >
        <InfoBanner tone="warning">
          These values are saved but not yet applied — the dashboards use hard-coded colours. They
          are here so the theming work has somewhere to read from.
        </InfoBanner>

        <div className="grid gap-x-5 sm:grid-cols-2">
          {(
            [
              ["Primary colour", "primaryColor"],
              ["Secondary colour", "secondaryColor"],
            ] as const
          ).map(([label, key]) => (
            <Field key={key} label={label} htmlFor={`ws-${key}`}>
              <div className="flex items-center gap-3">
                <input
                  id={`ws-${key}`}
                  type="color"
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="h-11 w-14 cursor-pointer rounded border"
                  style={{ borderColor: T.border }}
                />
                <TextInput
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="flex-1"
                  aria-label={`${label} hex value`}
                />
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Workspace Data">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total leads" value={data?.stats.leads ?? 0} />
          <StatTile label="Total bookings" value={data?.stats.bookings ?? 0} />
          <StatTile label="Active users" value={data?.stats.users ?? 0} />
          <StatTile label="Channel partners" value={data?.stats.channelPartners ?? 0} />
        </div>
      </Card>

      {/* ── Controls carried over from the previous Settings page ── */}

      <EndpointToggle
        title="Lead Number Sorting"
        description="Controls how Lead Numbers are assigned across the entire CRM."
        endpoint="/api/settings/lead-sorting"
        onLabel="ON — Backdated-priority mode"
        offLabel="OFF — Default mode"
        savedMessage="Saved and lead numbers recalculated."
        detail={
          <>
            <strong style={{ color: T.text }}>OFF</strong> — Leads are numbered by Enquiry Date
            (current behaviour).
            <br />
            <strong style={{ color: T.text }}>ON</strong> — Backdated Entry takes highest priority.
            Leads with a Backdated Entry date are sorted by that date; others use Date Created.
            <br />
            <span className="mt-1 block text-xs">
              Saving re-numbers every lead immediately.
            </span>
          </>
        }
      />

      <EndpointToggle
        title="Sales Manager Bulk Upload"
        description="Controls whether Sales Managers can bulk-import leads from an Excel sheet."
        endpoint="/api/settings/sm-upload"
        onLabel="ON — Sales Managers can upload"
        offLabel="OFF — Disabled"
        detail={
          <>
            <strong style={{ color: T.text }}>OFF</strong> — Only Admins and Site Heads can bulk
            upload.
            <br />
            <strong style={{ color: T.text }}>ON</strong> — Sales Managers see a Bulk Import button
            that self-assigns imported leads.
          </>
        }
      />

      {/* BolnaSettingsCard is the original dark-themed component, moved here
          unchanged. Restyling its 460 lines to the light palette is cosmetic
          work with real regression risk against a live voice integration, so it
          keeps its own surface for now rather than being half-converted. */}
      <section
        className="mb-6 overflow-hidden rounded-xl border"
        style={{ borderColor: T.border, background: "#0a0a0a" }}
      >
        <div className="p-4">
          <BolnaSettingsCard />
        </div>
      </section>

      {/* Click-to-call sits on the same dark surface as its sibling above for
          the same reason — it shares that card's visual language, and the two
          are read together as "how calls get placed". */}
      <section
        className="mb-6 overflow-hidden rounded-xl border"
        style={{ borderColor: T.border, background: "#0a0a0a" }}
      >
        <div className="p-4">
          <ManualCallingSettingsCard />
        </div>
      </section>

      {user && <AdminUpdatesManager user={user} />}
    </>
  );
}
