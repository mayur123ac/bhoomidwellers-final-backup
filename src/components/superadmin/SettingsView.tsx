"use client";

// Platform settings. Structure only in Phase 1 — every control is inert and says
// so, rather than being a switch that appears to work and silently does nothing.

import type { SuperAdminTheme } from "./theme";
import { Panel, SectionHead, PlaceholderAction } from "./ui";
import AccountSecurity from "./AccountSecurity";

/** A setting row with an inert control. */
function SettingRow({
  title, description, control, t, first,
}: { title: string; description: string; control: React.ReactNode; t: SuperAdminTheme; first?: boolean }) {
  return (
    <div
      className="flex items-start justify-between gap-4 px-4 py-4"
      style={{ borderTop: first ? "none" : `1px solid ${t.border}` }}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium" style={{ color: t.text }}>{title}</p>
        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: t.textMuted }}>{description}</p>
      </div>
      <div className="flex-shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/** Visibly-off, non-interactive switch. */
function InertSwitch({ t, on = false }: { t: SuperAdminTheme; on?: boolean }) {
  return (
    <span
      title="Available once platform APIs are wired (Phase 2)"
      className="inline-flex items-center w-[42px] h-[25px] rounded-full p-0.5 cursor-not-allowed"
      style={{ background: on ? t.positive : t.raised, border: `1px solid ${t.border}`, opacity: 0.75 }}
    >
      <span
        className="w-[19px] h-[19px] rounded-full transition-transform"
        style={{ background: t.surface, transform: on ? "translateX(17px)" : "none", boxShadow: t.shadow }}
      />
    </span>
  );
}

export default function SettingsView({
  t, onSignedOut,
}: {
  t: SuperAdminTheme;
  /** Passed down so a password change can end the session it was made from. */
  onSignedOut: () => void;
}) {
  return (
    <div className="max-w-3xl space-y-8">
      {/* First, because it is the only section here that actually does
          something — the rest is Phase 1 structure. */}
      <AccountSecurity t={t} onSignedOut={onSignedOut} />
      <section>
        <SectionHead t={t} title="Platform" sub="Applies to every organization on the platform" />
        <Panel t={t}>
          <SettingRow
            first t={t}
            title="Allow new organization sign-ups"
            description="When off, only a Super Admin can create tenants."
            control={<InertSwitch t={t} on />}
          />
          <SettingRow
            t={t}
            title="Suspend on prolonged inactivity"
            description="Automatically mark an organization inactive after a period with no activity."
            control={<InertSwitch t={t} />}
          />
          <SettingRow
            t={t}
            title="Default organization status"
            description="The status applied to a newly created tenant."
            control={<PlaceholderAction t={t} label="Active" />}
          />
        </Panel>
      </section>

      <section>
        <SectionHead t={t} title="Access" sub="Who holds platform-level authority" />
        <Panel t={t}>
          <SettingRow
            first t={t}
            title="Super Admin accounts"
            description="Platform-level accounts, separate from any tenant Admin."
            control={<PlaceholderAction t={t} label="Manage" />}
          />
          <SettingRow
            t={t}
            title="Session policy"
            description="Idle timeout and re-authentication for platform sessions."
            control={<PlaceholderAction t={t} label="Configure" />}
          />
        </Panel>
      </section>

      <div
        className="rounded-2xl px-4 py-3.5"
        style={{ background: t.raised, border: `1px solid ${t.border}` }}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: t.textMuted }}>
          <strong style={{ color: t.text }}>Phase 1 — interface only.</strong>{" "}
          Nothing on this screen writes anywhere. No API routes, migrations, or schema
          changes were created, and no tenant or production data is read or modified.
        </p>
      </div>
    </div>
  );
}
