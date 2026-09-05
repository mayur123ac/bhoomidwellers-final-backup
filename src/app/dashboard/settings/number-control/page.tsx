"use client";

// settings/number-control/page.tsx — Phone Number Access Control
//
// Admin-only page. Two scopes, four role toggles each.
// Raw phone never reaches an unauthorized browser — this page controls a
// server-side policy, not a UI mask. The API enforces the policy on every
// request regardless of what the client shows here.
//
// Scope semantics:
//   CP_ENQUIRY     — the phone field on the channel_partners master record,
//                    as seen in the standalone "CP Enquiry" view (no walkin lead).
//   CP_LINKED_LEAD — the CP phone fields (cp_phone, partner_phone) on
//                    walkin_enquiries rows that are linked to a channel partner.
//
// Admin is always allowed. Admin toggles are intentionally absent.

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPhoneAlt, FaShieldAlt, FaEyeSlash, FaEye } from "react-icons/fa";
import {
  Button,
  Card,
  InfoBanner,
  PageHeader,
  Skeleton,
  T,
  ToggleRow,
  useToast,
  api,
} from "@/components/Settings/ui";

// ── Types ────────────────────────────────────────────────────────────────────

type PhoneRole = "receptionist" | "sales_manager" | "site_head" | "sourcing_manager";
type PhoneScope = "CP_ENQUIRY" | "CP_LINKED_LEAD" | "LEAD_PHONE";
type ScopePolicies = Record<PhoneRole, boolean>;
type PolicyMap = Partial<Record<PhoneScope, ScopePolicies>>;

const ROLES: { key: PhoneRole; label: string; description: string }[] = [
  {
    key: "receptionist",
    label: "Receptionist",
    description: "Can view all CP records across the organization.",
  },
  {
    key: "sales_manager",
    label: "Sales Manager",
    description: "Can view CPs assigned to them via Sales Manager ownership.",
  },
  {
    key: "site_head",
    label: "Site Head",
    description: "Can view all CP records and linked enquiries.",
  },
  {
    key: "sourcing_manager",
    label: "Sourcing Manager",
    description: "Can only view their own assigned channel partners.",
  },
];

const SCOPES: { key: PhoneScope; label: string; description: string; ownershipNote?: string }[] = [
  {
    key: "CP_ENQUIRY",
    label: "Active CP Info",
    description:
      "Controls visibility of the phone number on the Channel Partner master record — shown in the standalone \u201cCP Enquiry\u201d tab where there is no linked lead. Applies to channel_partners.phone.",
  },
  {
    key: "CP_LINKED_LEAD",
    label: "CP's Walk-in Enquiries",
    description:
      "Controls visibility of the CP phone numbers on enquiries that are linked to a channel partner. Applies to both cp_phone (captured at intake) and partner_phone (from the CP record).",
  },
  {
    key: "LEAD_PHONE",
    label: "Lead / Customer Phone",
    description:
      "Controls visibility of the customer phone number on Leads. The assigned employee always has access to their own Lead\u2019s phone \u2014 this cannot be disabled.",
    ownershipNote:
      "Assigned employees always have access to the phone numbers of Leads assigned to them. This is enforced server-side and cannot be disabled by this toggle.",
  },
];

const EMPTY_SCOPE_POLICY: ScopePolicies = {
  receptionist: true,
  sales_manager: true,
  site_head: true,
  sourcing_manager: true,
};

const DEFAULT_POLICY: PolicyMap = {
  CP_ENQUIRY: { ...EMPTY_SCOPE_POLICY },
  CP_LINKED_LEAD: { ...EMPTY_SCOPE_POLICY },
  LEAD_PHONE: { ...EMPTY_SCOPE_POLICY },
};

// ── Preview ──────────────────────────────────────────────────────────────────

function PhonePreview({ masked }: { masked: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-mono"
      style={{ borderColor: T.border, background: T.surfaceAlt, color: T.text }}
    >
      {masked ? (
        <>
          <FaEyeSlash className="h-3.5 w-3.5 flex-shrink-0" style={{ color: T.muted }} />
          <span style={{ color: T.muted }}>98••••3210</span>
        </>
      ) : (
        <>
          <FaEye className="h-3.5 w-3.5 flex-shrink-0" style={{ color: T.teal }} />
          <span>9876543210</span>
        </>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NumberControlPage() {
  const toast = useToast();

  // Local copy of policies — the user edits this before saving.
  const [policies, setPolicies] = useState<PolicyMap>(DEFAULT_POLICY);
  // What was last successfully saved — used to detect unsaved changes.
  const savedRef = useRef<PolicyMap>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load current policies on mount.
  useEffect(() => {
    api<{ policies: PolicyMap }>("/api/settings/phone-access-policies")
      .then((r) => {
        setPolicies(r.policies);
        savedRef.current = r.policies;
      })
      .catch((err) => {
        toast("error", `Failed to load policies: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const toggleRole = useCallback(
    (scope: PhoneScope, role: PhoneRole, next: boolean) => {
      setPolicies((prev) => ({
        ...prev,
        [scope]: { ...(prev[scope] ?? EMPTY_SCOPE_POLICY), [role]: next },
      }));
    },
    []
  );

  // Diff against saved state to build the minimal update batch.
  const save = async () => {
    const updates: { scope: PhoneScope; role: PhoneRole; can_view_full_phone: boolean }[] = [];
    for (const scope of ["CP_ENQUIRY", "CP_LINKED_LEAD", "LEAD_PHONE"] as PhoneScope[]) {
      for (const role of ["receptionist", "sales_manager", "site_head", "sourcing_manager"] as PhoneRole[]) {
        const current = policies[scope]?.[role] ?? true;
        const saved = savedRef.current[scope]?.[role] ?? true;
        if (current !== saved) {
          updates.push({ scope, role, can_view_full_phone: current });
        }
      }
    }
    if (updates.length === 0) {
      toast("info", "No changes to save.");
      return;
    }

    setSaving(true);
    try {
      const result = await api<{ policies: PolicyMap; message: string }>(
        "/api/settings/phone-access-policies",
        { method: "PUT", json: { policies: updates } }
      );
      setPolicies(result.policies);
      savedRef.current = result.policies;
      toast("success", "Phone access policies updated. Active sessions will refresh automatically.");
    } catch (err: unknown) {
      toast("error", `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  // Count how many roles currently have access blocked per scope, for the summary.
  const blockedCount = (scope: PhoneScope) =>
    ROLES.filter((r) => !(policies[scope]?.[r.key] ?? true)).length;

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Number Control"
          subtitle="Control which roles can see full CP phone numbers."
        />
        <div className="mb-6"><Skeleton rows={3} /></div>
        <div className="mb-6"><Skeleton rows={6} /></div>
        <Skeleton rows={6} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Number Control"
        subtitle="Control which roles can view full Channel Partner phone numbers. Admin always has full access."
        action={
          <Button onClick={save} loading={saving}>
            Save Changes
          </Button>
        }
      />

      <InfoBanner>
        <strong>Server-side enforcement.</strong> Phone numbers are masked on the server before
        they leave the API. Masked numbers appear as{" "}
        <code className="rounded px-1 font-mono text-xs" style={{ background: T.accentSoft }}>
          98••••3210
        </code>{" "}
        — the first 2 and last 4 digits remain visible. Disabling a role takes effect immediately
        for new requests; active sessions refresh automatically within seconds.
      </InfoBanner>

      {SCOPES.map((scope) => {
        const blocked = blockedCount(scope.key);
        return (
          <Card
            key={scope.key}
            title={scope.label}
            description={scope.description}
            footer={
              <div className="flex w-full items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs" style={{ color: T.muted }}>
                  <FaShieldAlt className="h-3 w-3 flex-shrink-0" />
                  {blocked === 0 ? (
                    <span>All roles can see full numbers in this scope.</span>
                  ) : (
                    <span>
                      {blocked} role{blocked === 1 ? "" : "s"} will see masked numbers in this scope.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium" style={{ color: T.muted }}>
                    Preview:
                  </span>
                  <PhonePreview masked={blocked > 0} />
                </div>
              </div>
            }
          >
            {/* Admin row — always enabled, no toggle. */}
            <div
              className="flex items-start justify-between gap-4 border-b py-3.5"
              style={{ borderColor: T.border }}
            >
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: T.text }}>
                  Admin
                </p>
                <p className="mt-0.5 text-xs" style={{ color: T.muted }}>
                  Full access to all phone numbers. Not configurable.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <FaPhoneAlt className="h-3 w-3" style={{ color: T.success }} />
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{ background: T.successSoft, color: T.successText }}
                >
                  Always on
                </span>
              </div>
            </div>

            {/* Per-role toggles. */}
            {ROLES.map((role) => (
              <ToggleRow
                key={role.key}
                label={role.label}
                description={role.description}
                checked={policies[scope.key]?.[role.key] ?? true}
                onChange={(next) => toggleRole(scope.key, role.key, next)}
                disabled={saving}
              />
            ))}

            {/* Ownership rule callout — LEAD_PHONE only. */}
            {scope.ownershipNote && (
              <div
                className="mt-4 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm"
                style={{ borderColor: T.teal, background: T.accentSoft, color: T.text }}
              >
                <FaShieldAlt
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: T.teal }}
                />
                <span style={{ color: T.muted }}>{scope.ownershipNote}</span>
              </div>
            )}
          </Card>
        );
      })}

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
