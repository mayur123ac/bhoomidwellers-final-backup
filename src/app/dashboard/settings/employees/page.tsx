"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  PasswordStrengthIndicator,
  Select,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  Toggle,
  api,
  checkRules,
  useToast,
} from "@/components/Settings/ui";

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/* ── Add / edit modal ───────────────────────────────────────────────────────*/

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "",
  department: "",
  reportingManagerId: "",
  sendInvite: true,
  tempPassword: "",
  password: "",
};

function EmployeeModal({
  open,
  employee,
  catalogue,
  inviteEmailConfigured,
  onClose,
  onSaved,
}: {
  open: boolean;
  employee: any | null;
  catalogue: any;
  inviteEmailConfigured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(employee);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [addAnother, setAddAnother] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setIssued(null);
    if (employee) {
      const { firstName, lastName } = splitName(employee.name);
      setForm({
        ...EMPTY_FORM,
        firstName,
        lastName,
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        role: employee.role ?? "",
        department: employee.department ?? "",
        reportingManagerId: employee.reportingManagerId ? String(employee.reportingManagerId) : "",
      });
    } else {
      // Invite is defaulted OFF when no mail transport exists — leaving it ON
      // would create an account whose invite silently never arrives.
      setForm({ ...EMPTY_FORM, sendInvite: inviteEmailConfigured });
    }
  }, [open, employee, inviteEmailConfigured]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const result = await api<any>("/api/settings/employees", {
          method: "PATCH",
          json: {
            id: employee.id,
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            phone: form.phone,
            role: form.role,
            department: form.department,
            reportingManagerId: form.reportingManagerId || null,
            ...(form.password ? { password: form.password } : {}),
          },
        });
        toast("success", result.message);
        onSaved();
        onClose();
      } else {
        const result = await api<any>("/api/settings/employees", {
          method: "POST",
          json: {
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            phone: form.phone,
            role: form.role,
            department: form.department,
            reportingManagerId: form.reportingManagerId || null,
            sendInvite: form.sendInvite,
            tempPassword: form.tempPassword,
          },
        });

        onSaved();
        toast(result.inviteDelivered || !form.sendInvite ? "success" : "warning", result.message);

        if (result.temporaryPassword) {
          // Shown once. It is a hash in the database from here on, so if the
          // admin closes this without copying it, it cannot be recovered.
          setIssued(result.temporaryPassword);
        } else if (addAnother) {
          setForm({ ...EMPTY_FORM, sendInvite: inviteEmailConfigured });
        } else {
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const passwordOk = form.sendInvite || Object.values(checkRules(form.tempPassword)).every(Boolean);
  const canSubmit =
    form.firstName.trim() && form.email.trim() && form.role && (editing || passwordOk);

  if (issued) {
    return (
      <Modal
        open={open}
        onClose={() => {
          setIssued(null);
          if (addAnother) {
            setForm({ ...EMPTY_FORM, sendInvite: inviteEmailConfigured });
          } else {
            onClose();
          }
        }}
        title="Temporary password"
        footer={
          <Button
            onClick={() => {
              setIssued(null);
              if (addAnother) {
                setForm({ ...EMPTY_FORM, sendInvite: inviteEmailConfigured });
              } else {
                onClose();
              }
            }}
          >
            Done
          </Button>
        }
      >
        <InfoBanner tone="warning">
          Copy this now — it is stored as a hash and cannot be shown again.
        </InfoBanner>
        <div
          className="flex items-center justify-between gap-3 rounded-lg border p-4"
          style={{ borderColor: T.border, background: T.sidebar }}
        >
          <code className="font-mono text-base" style={{ color: T.text }}>
            {issued}
          </code>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(issued);
              toast("success", "Copied to clipboard.");
            }}
          >
            Copy
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${employee?.name}` : "Add New Employee"}
      width="max-w-2xl"
      footer={
        <>
          {!editing && (
            <label className="mr-auto flex items-center gap-2 text-sm" style={{ color: T.muted }}>
              <input
                type="checkbox"
                checked={addAnother}
                onChange={(e) => setAddAnother(e.target.checked)}
                style={{ accentColor: T.teal }}
              />
              Add another after saving
            </label>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save Changes" : addAnother ? "Save & Add Another" : "Save & Close"}
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: T.danger, background: T.dangerSoft, color: T.danger }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-x-5 sm:grid-cols-2">
        <Field label="First Name" htmlFor="emp-first" required>
          <TextInput
            id="emp-first"
            value={form.firstName}
            maxLength={50}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          />
        </Field>
        <Field label="Last Name" htmlFor="emp-last">
          <TextInput
            id="emp-last"
            value={form.lastName}
            maxLength={50}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          />
        </Field>
      </div>

      <div className="grid gap-x-5 sm:grid-cols-2">
        <Field label="Email" htmlFor="emp-email" required>
          <TextInput
            id="emp-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </Field>
        <Field label="Phone" htmlFor="emp-phone">
          <TextInput
            id="emp-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
          />
        </Field>
      </div>

      <div className="grid gap-x-5 sm:grid-cols-2">
        <Field
          label="Role"
          htmlFor="emp-role"
          required
          hint="Role decides which panels this person can reach."
        >
          <Select
            id="emp-role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          >
            <option value="">Select a role…</option>
            {catalogue?.roles?.map((role: string) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Department" htmlFor="emp-dept">
          <Select
            id="emp-dept"
            value={form.department}
            onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
          >
            <option value="">None</option>
            {catalogue?.departments?.map((dept: string) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Reporting Manager" htmlFor="emp-manager">
        <Select
          id="emp-manager"
          value={form.reportingManagerId}
          onChange={(e) => setForm((f) => ({ ...f, reportingManagerId: e.target.value }))}
        >
          <option value="">None</option>
          {catalogue?.managers
            ?.filter((m: any) => !employee || m.id !== employee.id)
            .map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.role}
              </option>
            ))}
        </Select>
      </Field>

      {editing ? (
        <Field
          label="Reset password"
          htmlFor="emp-password"
          hint="Leave blank to keep the current password."
        >
          <TextInput
            id="emp-password"
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
          />
          {form.password && <PasswordStrengthIndicator password={form.password} />}
        </Field>
      ) : (
        <div className="mt-2 border-t pt-4" style={{ borderColor: T.border }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium" style={{ color: T.text }}>
                Invite via email
              </p>
              <p className="mt-0.5 text-xs" style={{ color: T.muted }}>
                {inviteEmailConfigured
                  ? "Sends a setup link that expires in 7 days."
                  : "Unavailable — this server has no email transport configured."}
              </p>
            </div>
            <Toggle
              checked={form.sendInvite}
              onChange={(v) => setForm((f) => ({ ...f, sendInvite: v }))}
              label="Invite via email"
              disabled={!inviteEmailConfigured}
            />
          </div>

          {!form.sendInvite && (
            <div className="mt-4">
              <Field label="Temporary password" htmlFor="emp-temp" required>
                <TextInput
                  id="emp-temp"
                  type="text"
                  value={form.tempPassword}
                  onChange={(e) => setForm((f) => ({ ...f, tempPassword: e.target.value }))}
                  autoComplete="off"
                />
                <PasswordStrengthIndicator password={form.tempPassword} />
              </Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Remove modal ───────────────────────────────────────────────────────────*/

function RemoveModal({
  employee,
  onClose,
  onRemoved,
}: {
  employee: any | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [disposition, setDisposition] = useState("reassign");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisposition("reassign");
    setError(null);
  }, [employee]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/api/settings/employees", {
        method: "DELETE",
        json: { id: employee.id, leadDisposition: disposition },
      });
      toast("success", result.message);
      onRemoved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(employee)}
      onClose={onClose}
      title={`Remove ${employee?.name} from team?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            Confirm removal
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: T.danger, background: T.dangerSoft, color: T.danger }}
        >
          {error}
        </div>
      )}

      <InfoBanner>
        Their access is revoked and they disappear from the directory, but their records — leads,
        bookings, commissions, history — are kept.
      </InfoBanner>

      <Field label="What should happen to their leads?" htmlFor="disposition">
        <Select id="disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
          <option value="reassign">Reassign to me</option>
          <option value="unassign">Unassign from team</option>
          <option value="keep">Keep assigned to them</option>
        </Select>
      </Field>
    </Modal>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────*/

export default function EmployeesPage() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const [filters, setFilters] = useState({ search: "", status: "all", role: "all", department: "all" });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams(filters as any).toString();
    api<any>(`/api/settings/employees?${params}`)
      .then((r) => {
        setData(r);
        setForbidden(false);
      })
      .catch((err) => {
        if (err.status === 403 || err.status === 401) setForbidden(true);
        else toast("error", err.message);
      })
      .finally(() => setLoading(false));
  }, [filters, toast]);

  useEffect(load, [load]);

  // Selections are cleared whenever the visible set changes, so a bulk action
  // cannot act on a row the admin can no longer see.
  useEffect(() => setSelected([]), [filters]);

  const employees: any[] = data?.employees ?? [];
  const allSelected = employees.length > 0 && selected.length === employees.length;

  const bulkStatus = async (activate: boolean) => {
    setBusy(true);
    try {
      const result = await api<any>("/api/settings/employees", {
        method: "PATCH",
        json: { action: "bulkStatus", ids: selected, isActive: activate },
      });
      toast("success", result.message);
      setSelected([]);
      load();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async (employee: any) => {
    setBusy(true);
    try {
      const result = await api<any>("/api/settings/employees", {
        method: "PATCH",
        json: { action: "resendInvite", id: employee.id },
      });
      toast(result.inviteDelivered ? "success" : "warning", result.message);
      load();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (employee: any, activate: boolean) => {
    setBusy(true);
    try {
      const result = await api<any>("/api/settings/employees", {
        method: "PATCH",
        json: { action: "setStatus", id: employee.id, isActive: activate },
      });
      toast("success", result.message);
      load();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  const exportSelected = () => {
    const rows = employees.filter((e) => selected.includes(e.id));
    const header = ["Name", "Email", "Phone", "Role", "Department", "Manager", "Status", "Last Active"];
    const body = rows.map((r) =>
      [r.name, r.email, r.phone, r.role, r.department, r.reportingManagerName, r.status, r.lastActiveAt]
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...body].join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "employees.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const pendingSelected = useMemo(
    () => employees.filter((e) => selected.includes(e.id) && e.status === "pending"),
    [employees, selected]
  );

  if (forbidden) {
    return (
      <>
        <PageHeader title="Employee Management" />
        <Card>
          <EmptyState
            title="Admins only"
            description="Your role cannot manage the employee directory."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Employee Management"
        subtitle="Add people, set their role and manage access."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            Add New Employee
          </Button>
        }
      />

      {data && !data.inviteEmailConfigured && (
        <InfoBanner tone="warning">
          Email invites are unavailable — this server has no SMTP transport configured. Add
          employees with a temporary password instead, and hand it over directly.
        </InfoBanner>
      )}

      <Card>
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="emp-search">
            <TextInput
              id="emp-search"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Name or email"
            />
          </Field>
          <Field label="Status" htmlFor="emp-status">
            <Select
              id="emp-status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="all">All {data ? `(${data.counts.all})` : ""}</option>
              <option value="active">Active {data ? `(${data.counts.active})` : ""}</option>
              <option value="pending">Pending {data ? `(${data.counts.pending})` : ""}</option>
              <option value="inactive">Inactive {data ? `(${data.counts.inactive})` : ""}</option>
            </Select>
          </Field>
          <Field label="Role" htmlFor="emp-role-filter">
            <Select
              id="emp-role-filter"
              value={filters.role}
              onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
            >
              <option value="all">All roles</option>
              {data?.catalogue?.roles?.map((role: string) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" htmlFor="emp-dept-filter">
            <Select
              id="emp-dept-filter"
              value={filters.department}
              onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
            >
              <option value="all">All departments</option>
              {data?.catalogue?.departments?.map((dept: string) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {selected.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-5 py-3"
          style={{ borderColor: T.teal, background: T.accentSoft }}
        >
          <span className="text-sm font-medium" style={{ color: T.text }}>
            {selected.length} selected
          </span>
          <Button variant="secondary" onClick={() => bulkStatus(false)} disabled={busy}>
            Deactivate
          </Button>
          <Button variant="secondary" onClick={() => bulkStatus(true)} disabled={busy}>
            Reactivate
          </Button>
          <Button
            variant="secondary"
            onClick={() => pendingSelected.forEach(resendInvite)}
            disabled={busy || pendingSelected.length === 0}
          >
            Resend invites ({pendingSelected.length})
          </Button>
          <Button variant="secondary" onClick={exportSelected}>
            Export selected
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      <Card>
        {loading ? (
          <Skeleton rows={6} />
        ) : employees.length === 0 ? (
          <EmptyState title="No employees match these filters" />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="text-left" style={{ color: T.muted }}>
                  <th className="border-b py-2.5 pr-3" style={{ borderColor: T.border }}>
                    <input
                      type="checkbox"
                      aria-label="Select all employees"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? employees.map((x) => x.id) : [])}
                      style={{ accentColor: T.teal }}
                    />
                  </th>
                  {["Name", "Email", "Role", "Department", "Manager", "Status", "Last Active", ""].map((h) => (
                    <th key={h} className="border-b py-2.5 pr-4 font-medium" style={{ borderColor: T.border }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  // The key belongs on the fragment: it, not the rows inside it,
                  // is what React counts as the list child.
                  <Fragment key={employee.id}>
                    <tr>
                      <td className="border-b py-3 pr-3" style={{ borderColor: T.border }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${employee.name}`}
                          checked={selected.includes(employee.id)}
                          onChange={(e) =>
                            setSelected((current) =>
                              e.target.checked
                                ? [...current, employee.id]
                                : current.filter((id) => id !== employee.id)
                            )
                          }
                          style={{ accentColor: T.teal }}
                        />
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border }}>
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === employee.id ? null : employee.id)}
                          className="flex items-center gap-2.5 text-left"
                        >
                          <span
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                            style={{ background: T.teal }}
                          >
                            {employee.avatarUrl ? (
                              <img src={employee.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              employee.initials
                            )}
                          </span>
                          <span className="font-medium" style={{ color: T.text }}>
                            {employee.name}
                          </span>
                        </button>
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                        {employee.email ?? "—"}
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.text }}>
                        {employee.role ?? "—"}
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                        {employee.department ?? "—"}
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                        {employee.reportingManagerName ?? "—"}
                      </td>
                      <td className="border-b py-3 pr-4" style={{ borderColor: T.border }}>
                        <StatusBadge status={employee.status}>
                          {employee.status === "active"
                            ? "Active"
                            : employee.status === "pending"
                            ? "Pending"
                            : "Inactive"}
                        </StatusBadge>
                      </td>
                      <td className="border-b py-3 pr-4 whitespace-nowrap" style={{ borderColor: T.border, color: T.muted }}>
                        {formatWhen(employee.lastActiveAt)}
                      </td>
                      <td className="border-b py-3 text-right whitespace-nowrap" style={{ borderColor: T.border }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(employee);
                            setModalOpen(true);
                          }}
                          aria-label={`Edit ${employee.name}`}
                          className="mr-1 h-11 w-11 rounded-lg st-hover-surface"
                          style={{ color: T.muted }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(employee)}
                          aria-label={`Remove ${employee.name}`}
                          className="h-11 w-11 rounded-lg hover:bg-red-50"
                          style={{ color: T.danger }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>

                    {expanded === employee.id && (
                      <tr key={`${employee.id}-detail`}>
                        <td colSpan={9} className="border-b p-0" style={{ borderColor: T.border }}>
                          <div className="px-4 py-4" style={{ background: T.sidebar }}>
                            <dl className="grid gap-4 sm:grid-cols-3">
                              <div>
                                <dt className="text-xs" style={{ color: T.muted }}>Phone</dt>
                                <dd className="text-sm" style={{ color: T.text }}>{employee.phone ?? "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-xs" style={{ color: T.muted }}>Joined</dt>
                                <dd className="text-sm" style={{ color: T.text }}>{formatWhen(employee.createdAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs" style={{ color: T.muted }}>Invite status</dt>
                                <dd className="text-sm" style={{ color: T.text }}>
                                  {employee.status === "pending"
                                    ? `Sent ${formatWhen(employee.inviteSentAt)}${employee.inviteExpired ? " (expired)" : ""}`
                                    : employee.firstLoginAt
                                    ? `First login ${formatWhen(employee.firstLoginAt)}`
                                    : "—"}
                                </dd>
                              </div>
                            </dl>

                            <div className="mt-4 flex flex-wrap gap-3">
                              {employee.status === "pending" && (
                                <Button variant="secondary" onClick={() => resendInvite(employee)} disabled={busy}>
                                  Resend invite
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                onClick={() => setStatus(employee, employee.status === "inactive")}
                                disabled={busy}
                              >
                                {employee.status === "inactive" ? "Reactivate" : "Deactivate"}
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <EmployeeModal
        open={modalOpen}
        employee={editing}
        catalogue={data?.catalogue}
        inviteEmailConfigured={Boolean(data?.inviteEmailConfigured)}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
      <RemoveModal employee={removing} onClose={() => setRemoving(null)} onRemoved={load} />
    </>
  );
}
