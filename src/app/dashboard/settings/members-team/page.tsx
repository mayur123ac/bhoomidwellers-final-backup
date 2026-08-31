"use client";

// dashboard/settings/members-team/page.tsx
//
// Members & Team — per-employee permission management.
//
// Admin view
// ──────────
// Shows every active employee in the organisation with a row of permission
// toggles. Toggling saves immediately (optimistic update, reverted on failure).
// Clicking an employee's name links to Employee Management for editing role,
// department, reporting manager, etc. — this page is the permission layer only.
//
// Employee view
// ─────────────
// Shows the signed-in user's own permissions and a "Change My Password" button
// if `can_change_password` is true. The button opens a two-step OTP modal:
// Step 1 — request a code sent to their configured email address(es).
// Step 2 — enter the code and the desired new password.
// On success the session cookie is cleared and the user is sent to the login
// screen (the password just changed, all sessions are revoked).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession } from "@/lib/authSession";
import {
  Button,
  Card,
  EmptyState,
  Field,
  InfoBanner,
  Modal,
  OTPInput,
  PageHeader,
  PasswordStrengthIndicator,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  ToggleRow,
  api,
  checkRules,
  useToast,
} from "@/components/Settings/ui";

/* ── Types ────────────────────────────────────────────────────────────────── */

interface MemberPermissions {
  can_change_password: boolean;
}

interface Member {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  department: string | null;
  avatarUrl: string | null;
  permissions: MemberPermissions;
}

/* ── OTP self-password-change modal ───────────────────────────────────────── */

function SelfPasswordChangeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();

  const [step, setStep] = useState<"request" | "confirm">("request");
  const [otp, setOtp] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("request");
      setOtp("");
      setNewPwd("");
      setConfirmPwd("");
      setError(null);
    }
  }, [open]);

  const rulesMet = Object.values(checkRules(newPwd)).every(Boolean);
  const matches = newPwd.length > 0 && newPwd === confirmPwd;

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>(
        "/api/settings/self-password-change/request-otp",
        { method: "POST" }
      );
      toast("success", res.message);
      setStep("confirm");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string; reauthRequired?: boolean }>(
        "/api/settings/self-password-change/confirm",
        { method: "POST", json: { otp, newPassword: newPwd } }
      );
      toast("success", res.message);
      clearCrmSession();
      setTimeout(() => router.replace("/"), 1200);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === "request" ? "Change Password" : "Enter Verification Code"}
      description={
        step === "request"
          ? "A verification code will be sent to your configured email address(es)."
          : "Enter the code from your email and choose a new password."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === "request" ? (
            <Button onClick={requestOtp} loading={busy}>
              Send Code
            </Button>
          ) : (
            <Button
              onClick={confirm}
              loading={busy}
              disabled={otp.length !== 6 || !rulesMet || !matches}
            >
              Change Password
            </Button>
          )}
        </>
      }
    >
      {step === "request" && (
        <InfoBanner tone="info">
          You will be signed out after the password is changed and will need to
          sign in again with the new password.
        </InfoBanner>
      )}

      {step === "confirm" && (
        <>
          <Field label="Verification code" required>
            <OTPInput
              value={otp}
              onChange={setOtp}
              error={Boolean(error)}
            />
            {error && (
              <p className="mt-1 text-xs" style={{ color: T.danger }}>
                {error}
              </p>
            )}
          </Field>

          <Field label="New Password" htmlFor="self-new-password" required>
            <TextInput
              id="self-new-password"
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              autoComplete="new-password"
            />
            <PasswordStrengthIndicator password={newPwd} />
          </Field>

          <Field
            label="Confirm Password"
            htmlFor="self-confirm-password"
            required
            error={confirmPwd && !matches ? "Passwords do not match." : null}
          >
            <TextInput
              id="self-confirm-password"
              type="password"
              value={confirmPwd}
              hasError={Boolean(confirmPwd) && !matches}
              onChange={(e) => setConfirmPwd(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <button
            type="button"
            onClick={() => {
              setStep("request");
              setOtp("");
              setError(null);
            }}
            className="mt-1 text-xs underline"
            style={{ color: T.teal }}
          >
            Resend code
          </button>

        </>
      )}
    </Modal>
  );
}

/* ── Admin: single employee permission row ────────────────────────────────── */

function MemberRow({
  member,
  onToggle,
  saving,
}: {
  member: Member;
  onToggle: (userId: number, key: keyof MemberPermissions, value: boolean) => void;
  saving: boolean;
}) {
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="flex flex-col gap-4 border-b py-5 last:border-b-0 sm:flex-row sm:items-start"
      style={{ borderColor: T.border }}
    >
      {/* Avatar + identity */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: T.teal }}
        >
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.avatarUrl}
              alt={member.name}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" style={{ color: T.text }}>
            {member.name}
          </p>
          <p className="truncate text-xs" style={{ color: T.muted }}>
            {member.role ?? "No role"}
            {member.department ? ` · ${member.department}` : ""}
          </p>
        </div>
      </div>

      {/* Permissions */}
      <div className="flex-shrink-0 sm:w-72">
        <ToggleRow
          label="Can change password"
          description="Allow self-service password changes via OTP or Account & Security."
          checked={member.permissions.can_change_password}
          onChange={(v) => onToggle(member.id, "can_change_password", v)}
          disabled={saving}
        />
      </div>
    </div>
  );
}

/* ── Admin view ───────────────────────────────────────────────────────────── */

function AdminView() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    api<{ members: Member[] }>("/api/settings/permissions")
      .then((r) => setMembers(r.members))
      .catch((err) => toast("error", err.message));
  }, [toast]);

  useEffect(load, [load]);

  const handleToggle = async (
    userId: number,
    key: keyof MemberPermissions,
    value: boolean
  ) => {
    if (!members) return;
    // Optimistic update.
    setMembers((prev) =>
      prev!.map((m) =>
        m.id === userId
          ? { ...m, permissions: { ...m.permissions, [key]: value } }
          : m
      )
    );
    setSaving(true);
    try {
      await api("/api/settings/permissions", {
        method: "PUT",
        json: { targetUserId: userId, [key]: value },
      });
      toast("success", "Permission updated.");
    } catch (err: any) {
      // Revert.
      setMembers((prev) =>
        prev!.map((m) =>
          m.id === userId
            ? { ...m, permissions: { ...m.permissions, [key]: !value } }
            : m
        )
      );
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = members
    ? members.filter(
        (m) =>
          !search ||
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          (m.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (m.role ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <>
      <PageHeader
        title="Members & Team"
        subtitle="Per-employee permission overrides. Role and department changes are in Employee Management."
      />

      <Card>
        <div className="mb-4">
          <TextInput
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {!filtered ? (
          <Skeleton rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search ? "No employees match that search." : "No employees found."}
          />
        ) : (
          <div>
            {filtered.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                onToggle={handleToggle}
                saving={saving}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="About permissions"
        description="How per-employee overrides work alongside roles."
      >
        <div className="space-y-2 text-sm" style={{ color: T.muted }}>
          <p>
            <strong style={{ color: T.text }}>Can change password</strong> — Controls
            whether an employee can update their own password via the Account &
            Security page or the Change Password button below. When off, only an
            admin can reset their password through the Employee Management screen.
          </p>
          <p>
            Roles (Admin, Site Head, etc.) are set in{" "}
            <strong style={{ color: T.text }}>Employee Management</strong> and
            determine which parts of the CRM each person can reach. Permissions
            here are targeted overrides on top of the role baseline.
          </p>
        </div>
      </Card>
    </>
  );
}

/* ── Employee (self) view ─────────────────────────────────────────────────── */

function EmployeeView() {
  const toast = useToast();
  const [perms, setPerms] = useState<MemberPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordModal, setPasswordModal] = useState(false);

  useEffect(() => {
    api<{ own: boolean; permissions: MemberPermissions }>("/api/settings/permissions")
      .then((r) => setPerms(r.permissions))
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <>
      <PageHeader
        title="Members & Team"
        subtitle="Your account permissions and self-service actions."
      />

      <Card title="Your Permissions">
        {loading || !perms ? (
          <Skeleton rows={2} />
        ) : (
          <>
            <ToggleRow
              label="Can change password"
              description={
                perms.can_change_password
                  ? "You can change your password at any time."
                  : "Password changes are currently disabled for your account. Contact your administrator."
              }
              checked={perms.can_change_password}
              onChange={() => {}}
              disabled
            />

            {perms.can_change_password && (
              <div className="mt-4">
                <Button onClick={() => setPasswordModal(true)}>
                  Change My Password
                </Button>
                <p className="mt-1.5 text-xs" style={{ color: T.muted }}>
                  A verification code will be emailed to you. You will be signed
                  out after the change.
                </p>
              </div>
            )}

            {!perms.can_change_password && (
              <InfoBanner tone="warning">
                Password changes are disabled for your account. Ask your administrator
                to reset it for you via Employee Management.
              </InfoBanner>
            )}
          </>
        )}
      </Card>

      <SelfPasswordChangeModal
        open={passwordModal}
        onClose={() => setPasswordModal(false)}
      />
    </>
  );
}

/* ── Page shell — detects role and renders the right view ─────────────────── */

export default function MembersTeamPage() {
  const toast = useToast();
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use the permissions endpoint itself: admins get `own: false` (members
    // list), non-admins get `own: true`. We can tell which view to render from
    // the response shape without a separate /profile round trip.
    api<{ own: boolean; members?: unknown[]; permissions?: MemberPermissions }>(
      "/api/settings/permissions"
    )
      .then((r) => setRole(r.own ? "employee" : "admin"))
      .catch((err) => {
        toast("error", err.message);
        setRole("employee"); // fallback to limited view
      })
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) {
    return (
      <>
        <PageHeader title="Members & Team" />
        <Card>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }

  if (role === "admin") return <AdminView />;
  return <EmployeeView />;
}
