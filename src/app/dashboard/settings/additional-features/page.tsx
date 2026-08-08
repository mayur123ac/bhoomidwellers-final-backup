"use client";

// Settings → Additional Features.
//
// Everything on this screen is either yours to change or clearly marked as not
// yours. The two are never mixed in the same control: calling providers and the
// company-wide lead numbering scheme are admin territory, so they appear as
// status rows with an explanation, not as a toggle that would 403 on click.
//
// Saves are per-card rather than one page-wide button. The three cards are
// unrelated, and a single Save that also writes the two you did not touch is
// how a stale tab overwrites someone else's change.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Radio,
  Skeleton,
  StatusBadge,
  T,
  ToggleRow,
  api,
  useToast,
} from "@/components/Settings/ui";
import { refreshFeaturePrefs } from "@/hooks/useFeaturePrefs";
import type { FeaturePrefs, FeatureToggleSpec } from "@/lib/featurePrefs";

interface Payload {
  prefs: FeaturePrefs;
  platform: {
    clickToCall: { available: boolean; provider: string | null };
    aiCalling: { available: boolean };
    leadNumberSorting: { enabled: boolean };
  };
  catalogue: {
    toggles: FeatureToggleSpec[];
    leadSortOptions: { id: string; label: string; description: string }[];
  };
}

export default function AdditionalFeaturesPage() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCard, setSavingCard] = useState<"sort" | "toggles" | null>(null);

  const [leadSort, setLeadSort] = useState("newest");
  const [toggles, setToggles] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    api<Payload>("/api/settings/feature-prefs")
      .then((r) => {
        setData(r);
        setLeadSort(r.prefs.leadSort);
        setToggles(r.prefs.toggles);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async (card: "sort" | "toggles", payload: Record<string, unknown>) => {
    setSavingCard(card);
    try {
      const result = await api<{ prefs: FeaturePrefs; message: string }>(
        "/api/settings/feature-prefs",
        { method: "PATCH", json: payload }
      );
      setLeadSort(result.prefs.leadSort);
      setToggles(result.prefs.toggles);
      setData((prev) => (prev ? { ...prev, prefs: result.prefs } : prev));
      // The sales dashboard caches these in a module-level store, and Settings
      // is a soft navigation away from it — without this, going back would show
      // the old ordering until a hard reload.
      refreshFeaturePrefs();
      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSavingCard(null);
    }
  };

  const sortDirty = useMemo(
    () => Boolean(data) && leadSort !== data!.prefs.leadSort,
    [data, leadSort]
  );
  const togglesDirty = useMemo(() => {
    if (!data) return false;
    return Object.entries(toggles).some(([id, value]) => data.prefs.toggles[id] !== value);
  }, [data, toggles]);

  if (loading) {
    return (
      <>
        <PageHeader title="Additional Features" />
        <Card>
          <Skeleton rows={5} />
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Additional Features" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load your feature settings.
          </p>
        </Card>
      </>
    );
  }

  const { platform, catalogue } = data;

  return (
    <>
      <PageHeader
        title="Additional Features"
        subtitle="Workflow options for your own account, and what the workspace has switched on."
      />

      {/* ── Lead sorting (yours) ───────────────────────────────────────────── */}
      <Card
        title="Lead sorting"
        description="The order your assigned leads open in. Applies to you only."
        footer={
          <Button
            onClick={() => save("sort", { leadSort })}
            loading={savingCard === "sort"}
            disabled={!sortDirty}
          >
            Save sorting
          </Button>
        }
      >
        <Field label="Default order">
          <div className="grid gap-3 sm:grid-cols-2">
            {catalogue.leadSortOptions.map((option) => (
              <Radio
                key={option.id}
                name="leadSort"
                value={option.id}
                checked={leadSort === option.id}
                onChange={() => setLeadSort(option.id)}
                label={option.label}
                description={option.description}
              />
            ))}
          </div>
        </Field>

        {/* The org-wide numbering scheme is a different setting with a similar
            name, and people conflate them. Saying so here is cheaper than
            explaining it again every time someone asks why their lead numbers
            did not change. */}
        <div
          className="mt-2 flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
          style={{ borderColor: T.border, background: T.sidebar }}
        >
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: T.text }}>
              Company lead numbering
            </p>
            <p className="mt-0.5 text-xs" style={{ color: T.muted }}>
              {platform.leadNumberSorting.enabled
                ? "Backdated-priority mode — lead numbers follow the enquiry date, not the order they were entered."
                : "Default mode — lead numbers follow the order leads were entered."}{" "}
              Set by an admin for the whole workspace; your sorting choice above does not change it.
            </p>
          </div>
          <StatusBadge status={platform.leadNumberSorting.enabled ? "active" : "inactive"}>
            {platform.leadNumberSorting.enabled ? "Backdated" : "Default"}
          </StatusBadge>
        </div>
      </Card>

      {/* ── Workflow toggles (yours) ───────────────────────────────────────── */}
      <Card
        title="Workflow"
        description="Small behaviours you can turn on or off for yourself."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => save("toggles", { reset: true })}
              loading={savingCard === "toggles"}
            >
              Reset to defaults
            </Button>
            <Button
              onClick={() => save("toggles", { toggles })}
              loading={savingCard === "toggles"}
              disabled={!togglesDirty}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div>
          {catalogue.toggles.map((spec) => (
            <ToggleRow
              key={spec.id}
              label={spec.label}
              description={spec.description}
              checked={toggles[spec.id] ?? spec.default}
              onChange={(next) => setToggles((prev) => ({ ...prev, [spec.id]: next }))}
            />
          ))}
        </div>
      </Card>

      {/* ── Calling (theirs) ───────────────────────────────────────────────── */}
      <Card
        title="Calling"
        description="Provider setup is managed by an admin. Shown here so you know what is available to you."
      >
        <div className="space-y-3">
          <PlatformRow
            title="Click-to-call"
            available={platform.clickToCall.available}
            detail={
              platform.clickToCall.available
                ? `Connected via ${platform.clickToCall.provider ?? "the configured provider"}. Dialling a lead from the CRM places the call through the company line.`
                : "Not connected. Phone numbers still open in your own dialler; the call is not recorded against the lead automatically."
            }
          />
          <PlatformRow
            title="AI voice calling"
            available={platform.aiCalling.available}
            detail={
              platform.aiCalling.available
                ? "Connected. Automated voice calls can be triggered on eligible leads."
                : "Not connected. No automated voice calls will be placed."
            }
          />
        </div>
      </Card>
    </>
  );
}

/** An org-wide capability the viewer cannot change — status only, never a control. */
function PlatformRow({
  title,
  available,
  detail,
}: {
  title: string;
  available: boolean;
  detail: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3.5"
      style={{
        borderColor: available ? T.success : T.border,
        background: available ? T.successSoft : T.sidebar,
      }}
    >
      <div className="flex-1">
        <p className="text-sm font-semibold" style={{ color: T.text }}>
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: T.muted }}>
          {detail}
        </p>
      </div>
      <StatusBadge status={available ? "active" : "inactive"}>
        {available ? "Available" : "Not set up"}
      </StatusBadge>
    </div>
  );
}
