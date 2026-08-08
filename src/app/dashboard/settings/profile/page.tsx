"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Field,
  InfoBanner,
  Modal,
  OTPInput,
  PageHeader,
  SearchableSelect,
  Select,
  Skeleton,
  T,
  TextInput,
  api,
  useToast,
} from "@/components/Settings/ui";
import { adoptServerAvatar, setAvatarUrl } from "@/lib/userAvatar";

/* ── Timezone options ───────────────────────────────────────────────────────
   Built from Intl.supportedValuesOf, so the list is whatever the runtime can
   actually format — no bundled table to go stale as zones change. Labelled with
   the live UTC offset, which is what makes the list navigable. */

function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return name.replace("GMT", "UTC") || "UTC+00:00";
  } catch {
    return "";
  }
}

function useTimezones() {
  return useMemo(() => {
    let zones: string[] = [];
    try {
      zones = (Intl as any).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      zones = [];
    }
    // Older runtimes without supportedValuesOf still need a usable picker.
    if (zones.length === 0) {
      zones = [
        "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London",
        "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC",
      ];
    }
    return zones.map((zone) => ({
      value: zone,
      label: `${zone.replace(/_/g, " ")} (${offsetLabel(zone)})`,
    }));
  }, []);
}

/* ── Avatar upload ──────────────────────────────────────────────────────────*/

function ProfilePictureUpload({
  avatarUrl,
  initials,
  onChanged,
}: {
  avatarUrl: string | null;
  initials: string;
  onChanged: (url: string | null) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const MAX_BYTES = 5 * 1024 * 1024;

  const pick = (file: File) => {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      toast("error", "Supports JPG, GIF, PNG or WebP only.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast("error", "Image must be under 5MB.");
      return;
    }
    setSourceFile(file);
    setZoom(1);
    setPreview(URL.createObjectURL(file));
  };

  /**
   * Crop to a centred square and downscale to 512px on a canvas before upload.
   *
   * The spec assumes Cloudflare Images doing this server-side via URL params;
   * this deployment has R2 (plain object storage) and no transform pipeline, so
   * the resize happens here instead. It also means a 5MB phone photo becomes a
   * ~100KB object rather than being stored at full size and scaled down by the
   * browser on every page load.
   */
  const renderCropped = useCallback(async (): Promise<Blob> => {
    const image = document.createElement("img");
    image.src = preview!;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not read that image."));
    });

    const SIZE = 512;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");

    // Source square is the largest centred square, shrunk by the zoom factor.
    const side = Math.min(image.width, image.height) / zoom;
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;

    ctx.drawImage(image, sx, sy, side, side, 0, 0, SIZE, SIZE);

    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image."))),
        "image/jpeg",
        0.9
      )
    );
  }, [preview, zoom]);

  const upload = async () => {
    if (!preview || !sourceFile) return;
    setBusy(true);
    try {
      const blob = await renderCropped();
      const form = new FormData();
      form.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));

      const result = await api<{ avatarUrl: string }>("/api/settings/avatar", {
        method: "POST",
        body: form,
      });

      onChanged(result.avatarUrl);
      toast("success", "Profile picture updated");
      setPreview(null);
      setSourceFile(null);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/settings/avatar", { method: "DELETE" });
      onChanged(null);
      toast("success", "Profile picture removed");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
      <div
        className="flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2"
        style={{
          borderColor: T.border,
          // Falls back to an initials tile on the Bhoomi accent gradient, the
          // same treatment the Admin header avatar uses.
          background:
            preview || avatarUrl
              ? T.surface
              : "linear-gradient(135deg,#9E217B 0%,#d946a8 100%)",
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-full w-full object-cover"
            style={{ transform: `scale(${zoom})` }}
          />
        ) : avatarUrl ? (
          <img src={avatarUrl} alt="Your profile picture" className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl font-bold text-white">{initials}</span>
        )}
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: T.text }}>
          Profile Picture
        </p>
        <p className="mt-0.5 text-xs" style={{ color: T.muted }}>
          Supports JPG, GIF, or PNG under 5MB
        </p>

        {preview ? (
          <div className="mt-4">
            <label htmlFor="avatar-zoom" className="mb-1 block text-xs" style={{ color: T.muted }}>
              Scale
            </label>
            <input
              id="avatar-zoom"
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full max-w-xs"
              style={{ accentColor: T.teal }}
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <Button onClick={upload} loading={busy}>
                Save picture
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPreview(null);
                  setSourceFile(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pick(file);
                e.target.value = "";
              }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload image
            </Button>
            {avatarUrl && (
              <Button variant="ghost" onClick={remove} loading={busy}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Email change modal ─────────────────────────────────────────────────────*/

function EmailChangeModal({
  open,
  currentEmail,
  onClose,
  onChanged,
}: {
  open: boolean;
  currentEmail: string | null;
  onClose: () => void;
  onChanged: (user: any) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Reset every time the modal opens, so a previous half-finished attempt does
  // not leak into the next one.
  useEffect(() => {
    if (open) {
      setStep("email");
      setNewEmail("");
      setOtp("");
      setError(null);
      setCooldown(0);
      setDevOtp(null);
    }
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/api/settings/email-change", {
        method: "POST",
        json: { newEmail },
      });
      setStep("otp");
      setCooldown(result.resendAfterSeconds ?? 60);
      setDevOtp(result.devOtp ?? null);
      toast(result.mailDelivered ? "info" : "warning", result.message);
    } catch (err: any) {
      setError(err.message);
      if (err.payload?.retryAfter) setCooldown(err.payload.retryAfter);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/api/settings/email-verify", {
        method: "POST",
        json: { otp },
      });
      onChanged(result.user);
      toast("success", "Email address changed");
      onClose();
    } catch (err: any) {
      setError(err.message);
      setOtp("");
      // The server ends the attempt on expiry or too many wrong guesses; the
      // modal has to go back to the start or the user is stuck on a dead code.
      if (err.payload?.restart) setStep("email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change email address"
      description={
        step === "email"
          ? "We'll send a 6-digit code to your current address to confirm it's you."
          : `Enter the code sent to ${currentEmail}.`
      }
      footer={
        step === "email" ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={sendOtp} loading={busy} disabled={!newEmail.trim()}>
              Send OTP
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={sendOtp}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </Button>
            <Button onClick={verify} loading={busy} disabled={otp.length !== 6}>
              Verify
            </Button>
          </>
        )
      }
    >
      {step === "email" ? (
        <Field
          label="New email address"
          htmlFor="new-email"
          required
          error={error}
          hint={`Your current address is ${currentEmail ?? "not set"}.`}
        >
          <TextInput
            id="new-email"
            type="email"
            value={newEmail}
            hasError={Boolean(error)}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@gmail.com"
            autoComplete="email"
          />
        </Field>
      ) : (
        <>
          <Field label="6-digit code" error={error}>
            <OTPInput value={otp} onChange={setOtp} disabled={busy} />
          </Field>

          {devOtp && (
            <InfoBanner tone="warning">
              This server has no email transport configured, so nothing was sent.
              Your code is <strong>{devOtp}</strong>. Set
              <code className="mx-1 rounded bg-black/5 px-1">SMTP_HOST</code>,
              <code className="mx-1 rounded bg-black/5 px-1">SMTP_USER</code>,
              <code className="mx-1 rounded bg-black/5 px-1">SMTP_PASSWORD</code> and
              <code className="mx-1 rounded bg-black/5 px-1">MAIL_FROM_EMAIL</code> in
              <code className="mx-1 rounded bg-black/5 px-1">.env.local</code> to deliver these by
              email.
            </InfoBanner>
          )}
        </>
      )}
    </Modal>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────*/

export default function ProfilePage() {
  const toast = useToast();
  const timezones = useTimezones();

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    whatsappNumber: "",
    timezone: "Asia/Kolkata",
    weekStartDay: 1,
  });

  const applyUser = useCallback((next: any) => {
    setUser(next);
    setForm({
      firstName: next.firstName ?? "",
      lastName: next.lastName ?? "",
      phone: next.phone ?? "",
      whatsappNumber: next.whatsappNumber ?? "",
      timezone: next.timezone ?? "Asia/Kolkata",
      weekStartDay: next.weekStartDay ?? 1,
    });
  }, []);

  useEffect(() => {
    api<{ user: any }>("/api/settings/profile")
      .then((r) => {
        applyUser(r.user);
        // The authoritative answer just arrived, so the shared store adopts it.
        // This is what reconciles a picture uploaded on another device: the
        // working copy in this browser is corrected the moment the real record
        // is read, without a dedicated sync endpoint.
        adoptServerAvatar(r.user.avatarUrl);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [applyUser, toast]);

  const dirty = useMemo(() => {
    if (!user) return false;
    return (
      form.firstName !== (user.firstName ?? "") ||
      form.lastName !== (user.lastName ?? "") ||
      form.phone !== (user.phone ?? "") ||
      form.whatsappNumber !== (user.whatsappNumber ?? "") ||
      form.timezone !== user.timezone ||
      form.weekStartDay !== user.weekStartDay
    );
  }, [form, user]);

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (form.firstName.length > 50) nextErrors.firstName = "Maximum 50 characters.";
    if (form.lastName.length > 50) nextErrors.lastName = "Maximum 50 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const result = await api<{ user: any; message: string }>("/api/settings/profile", {
        method: "PATCH",
        json: form,
      });
      applyUser(result.user);

      // The header and several dashboards read the cached user out of
      // localStorage; leaving it stale would show the old name until re-login.
      try {
        const cached = JSON.parse(localStorage.getItem("crm_user") ?? "{}");
        localStorage.setItem(
          "crm_user",
          JSON.stringify({ ...cached, name: result.user.name, email: result.user.email })
        );
      } catch {
        /* cache refresh is best-effort */
      }

      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Your personal details and time preferences." />
        <Card>
          <Skeleton rows={5} />
        </Card>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <PageHeader title="Profile" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load your profile. Try reloading the page.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" subtitle="Your personal details and time preferences." />

      <InfoBanner>Changes in this profile will apply to all of your workspaces.</InfoBanner>

      <Card title="Profile Picture">
        <ProfilePictureUpload
          avatarUrl={user.avatarUrl}
          initials={user.initials}
          onChanged={(url) => {
            setUser((u: any) => ({ ...u, avatarUrl: url }));
            // The header avatars do not read this page's state — they read the
            // shared store. Publishing here is what makes every one of them,
            // and every other open tab, update on this tick instead of at the
            // next full reload. Upload and removal both come through here, so
            // clearing the picture reverts them to the initial just as fast.
            setAvatarUrl(url);
          }}
        />
      </Card>

      <Card title="Personal Information">
        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label="First Name" htmlFor="firstName" required error={errors.firstName}>
            <TextInput
              id="firstName"
              value={form.firstName}
              maxLength={50}
              hasError={Boolean(errors.firstName)}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              autoComplete="given-name"
            />
          </Field>

          <Field label="Last Name" htmlFor="lastName" error={errors.lastName}>
            <TextInput
              id="lastName"
              value={form.lastName}
              maxLength={50}
              hasError={Boolean(errors.lastName)}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              autoComplete="family-name"
            />
          </Field>
        </div>

        <Field
          label="Primary Email Address"
          htmlFor="email"
          hint="Your email is also a sign-in identifier, so it changes through a verification step."
        >
          <div className="flex flex-wrap items-center gap-3">
            <TextInput
              id="email"
              value={user.email ?? "Not set"}
              readOnly
              disabled
              className="flex-1 min-w-[240px]"
            />
            <Button variant="secondary" onClick={() => setEmailModal(true)}>
              Change email
            </Button>
          </div>
        </Field>

        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <TextInput
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+91 98765 43210"
              autoComplete="tel"
            />
          </Field>

          <Field
            label="WhatsApp Number"
            htmlFor="whatsapp"
            hint="Used when logging WhatsApp messages to the CRM timeline. Country code, no + sign."
          >
            <TextInput
              id="whatsapp"
              type="tel"
              value={form.whatsappNumber}
              onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
              placeholder="919876543210"
            />
          </Field>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t pt-4" style={{ borderColor: T.border }}>
          <Button variant="secondary" onClick={() => applyUser(user)} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Save Changes
          </Button>
        </div>
      </Card>

      <Card
        title="Time Preferences"
        description="Used when displaying timestamps and for calendar and reporting date ranges."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => applyUser(user)}
              disabled={!dirty || saving}
            >
              Discard
            </Button>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Save Changes
            </Button>
          </>
        }
      >
        <Field label="Preferred Timezone" htmlFor="timezone">
          <SearchableSelect
            id="timezone"
            value={form.timezone}
            onChange={(tz) => setForm((f) => ({ ...f, timezone: tz }))}
            options={timezones}
            placeholder="Search timezones…"
          />
        </Field>

        <Field label="Start week on" htmlFor="weekStart">
          <Select
            id="weekStart"
            value={String(form.weekStartDay)}
            onChange={(e) => setForm((f) => ({ ...f, weekStartDay: Number(e.target.value) }))}
          >
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
            <option value="6">Saturday</option>
          </Select>
        </Field>
      </Card>

      <EmailChangeModal
        open={emailModal}
        currentEmail={user.email}
        onClose={() => setEmailModal(false)}
        onChanged={(next) => next && applyUser(next)}
      />
    </>
  );
}
