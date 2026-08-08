"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  InfoBanner,
  PageHeader,
  Radio,
  Select,
  Skeleton,
  T,
  api,
  useToast,
} from "@/components/Settings/ui";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { adoptServerTheme } from "@/lib/theme";

const LANGUAGE_LABELS: Record<string, string> = {
  "en-US": "English (US)",
  "hi-IN": "हिन्दी / Hindi",
  "mr-IN": "मराठी / Marathi",
};

export default function PreferencesPage() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The theme is NOT local state here. It comes from the shared module, so this
  // radio group, the header toggle above it, every dashboard and any other open
  // tab all read one value — which is what "work together" means. Selecting an
  // option writes through the same path the header button uses.
  const { theme, setTheme: applyTheme } = useCrmTheme();

  const [language, setLanguage] = useState("en-US");
  const [widgets, setWidgets] = useState<string[]>([]);
  const [widgetsOpen, setWidgetsOpen] = useState(false);

  const load = useCallback(() => {
    api<any>("/api/settings/preferences")
      .then((r) => {
        setData(r);
        setLanguage(r.user.language);
        setWidgets(r.user.dashboardWidgets ?? []);
        // The stored theme is adopted rather than assigned to local state, so a
        // preference saved on another device shows up here — and `persist:
        // false` stops it being written straight back to the server it came
        // from on every page load.
        adoptServerTheme(r.user.theme);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const result = await api<any>("/api/settings/preferences", { method: "PATCH", json: payload });
      setWidgets(result.user.dashboardWidgets ?? []);
      setLanguage(result.user.language);
      // Theme is deliberately not touched here. This save path handles language
      // and widgets; the theme has its own instant write and re-adopting the
      // server's copy would fight a change made a moment ago.
      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadData = async () => {
    setExporting(true);
    try {
      // Reuses the Activity Logs CSV export rather than adding a second export
      // pipeline — it is the same data, filtered to this user by the API.
      const response = await fetch("/api/settings/activity-logs?format=csv&from=1970-01-01");
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-crm-data.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "Export downloaded.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Preferences" />
        <Card>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Preferences" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load your preferences.
          </p>
        </Card>
      </>
    );
  }

  const catalogue = data.catalogue;

  return (
    <>
      <PageHeader title="Preferences" subtitle="How the CRM looks and behaves for you." />

      <Card
        title="UI Preferences"
        footer={
          <Button onClick={() => save({ language })} loading={saving}>
            Save
          </Button>
        }
      >
        {/* Language remains stored-only — there is no translation catalogue —
            so it keeps a banner. The theme no longer needs one: it applies. */}
        <InfoBanner tone="warning">
          Language is stored but not applied — no translation catalogue exists yet, so the
          interface stays in English whichever option is selected.
        </InfoBanner>

        <Field
          label="Theme"
          hint="Applies immediately, everywhere in the CRM, and is remembered the next time you sign in — on any device."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {/* No Save button for the theme. A colour scheme you can see the
                result of is confirmed by looking at it, and a control that
                repaints the page and THEN asks you to confirm is asking a
                question you have already answered.

                The write goes through the shared theme module, so the header
                toggle in this very page updates on the same tick. */}
            <Radio
              name="theme"
              value="light"
              checked={theme === "light"}
              onChange={() => applyTheme("light")}
              label="Light mode"
              description="Bright surfaces. Best in a well-lit room."
            />
            <Radio
              name="theme"
              value="dark"
              checked={theme === "dark"}
              onChange={() => applyTheme("dark")}
              label="Dark mode"
              description="Dark surfaces. Easier on the eyes at night."
            />
          </div>
        </Field>

        <Field label="Language" htmlFor="language">
          <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {catalogue.languages.map((code: string) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code] ?? code}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card title="Dashboard Layout" description="Choose which widgets appear on your dashboard.">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => setWidgetsOpen((v) => !v)}
            aria-expanded={widgetsOpen}
          >
            {widgetsOpen ? "Hide widgets" : "Customize visible widgets"}
          </Button>
          <Button variant="ghost" onClick={() => save({ resetDashboard: true })} loading={saving}>
            Reset dashboard to defaults
          </Button>
        </div>

        {widgetsOpen && (
          <div className="mt-5 border-t pt-4" style={{ borderColor: T.border }}>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {catalogue.widgets.map((widget: { id: string; label: string }) => (
                <Checkbox
                  key={widget.id}
                  id={`widget-${widget.id}`}
                  label={widget.label}
                  checked={widgets.includes(widget.id)}
                  onChange={(checked) =>
                    setWidgets((current) =>
                      checked
                        ? [...current, widget.id]
                        : current.filter((id) => id !== widget.id)
                    )
                  }
                />
              ))}
            </div>
            <div className="mt-4">
              <Button onClick={() => save({ dashboardWidgets: widgets })} loading={saving}>
                Save widget selection
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Data & Privacy"
        description="Your activity record, exported as CSV."
      >
        <Button variant="secondary" onClick={downloadData} loading={exporting}>
          Download my data
        </Button>
      </Card>
    </>
  );
}
