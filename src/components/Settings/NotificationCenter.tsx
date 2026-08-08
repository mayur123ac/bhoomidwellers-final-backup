"use client";

// NotificationCenter — which system emails this user receives.
//
// ── Nothing about the notifications is written here ─────────────────────────
// No list of types, no group names, no labels. The catalogue arrives with the
// GET response and this component renders whatever it contains, in the order it
// arrives. Adding a notification is an entry in lib/notificationCatalogue.ts and
// nothing else — this file does not change.
//
// That constraint is the reason for a few shapes below that would otherwise look
// over-general: the search index is built at runtime from the response rather
// than being a static map, and group state is keyed by whatever ids arrive.
//
// ── Edits are local until Save ──────────────────────────────────────────────
// Toggling changes `draft` only. `saved` holds the server's last known answer,
// and the difference between them is both the unsaved-changes indicator and the
// batch that gets posted:
//
//   toggle          draft[key] flips, nothing is sent
//   dirty count     keys where draft ≠ saved
//   Save            POST just those keys, not all fifty
//   success         saved := server's response, draft := same
//
// Sending only the difference is not merely an optimisation. The server stores
// preferences sparsely — a key with no row follows the catalogue default — so
// posting every key would write an explicit row for each one and permanently
// pin this user to today's defaults.
//
// ── Optimistic, with a real rollback ────────────────────────────────────────
// The switch moves the instant it is pressed, because a toggle that waits for a
// round trip feels broken. If the save then fails, `draft` is left exactly as it
// was — the user's edits are still on screen, still marked unsaved, and Save can
// be pressed again. It is deliberately NOT reverted to `saved`: silently
// discarding forty deliberate changes because one request timed out is worse
// than leaving them pending.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  InfoBanner,
  Skeleton,
  StatusBadge,
  T,
  Toggle,
  api,
  useToast,
} from "@/components/Settings/ui";

/* ── Small helpers ────────────────────────────────────────────────────────── */

/**
 * Tailwind's focus ring colour, which is a CSS custom property.
 *
 * React's CSSProperties has no index signature for `--*`, so the object is
 * asserted once here rather than at each of the four call sites. Asserting the
 * whole object is narrower than the `as any` this replaces: the assertion
 * covers a two-key literal instead of switching off checking for the property.
 */
function focusRing(): React.CSSProperties {
  return { "--tw-ring-color": T.accentRing } as React.CSSProperties;
}

/** The message from a thrown value, without assuming it is an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ── Server shapes ────────────────────────────────────────────────────────── */

interface NotificationDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  status: "live" | "planned";
  keywords?: string[];
  short?: string;
}

interface NotificationGroup {
  id: string;
  label: string;
  description: string;
  notifications: NotificationDefinition[];
}

interface CentreResponse {
  groups: NotificationGroup[];
  preferences: Record<string, boolean>;
  summary: string[];
  delivery: { addresses: string[]; notes: string[]; disabled: boolean };
  deliveryConfigured: boolean;
}

/* ── Search ───────────────────────────────────────────────────────────────── */

/**
 * Everything a notification can be found by, flattened once per load.
 *
 * The key is included because "billing.payment_failed" is what appears in the
 * audit log and in this file's documentation, so it is what someone debugging a
 * missing email will paste into the box.
 */
function searchIndex(definition: NotificationDefinition): string {
  return [
    definition.label,
    definition.description,
    definition.key,
    // Dots are word separators to a person typing: searching "payment failed"
    // should match `billing.payment_failed`.
    definition.key.replace(/[._]/g, " "),
    ...(definition.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Every term must match, in any field and in any order.
 *
 * AND rather than OR: "failed login" should find the failed-login switch, not
 * everything containing either word, which on this catalogue is most of it.
 */
function matches(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

/* ── Row ──────────────────────────────────────────────────────────────────── */

function NotificationRow({
  definition,
  checked,
  dirty,
  onChange,
}: {
  definition: NotificationDefinition;
  checked: boolean;
  dirty: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 border-b py-3.5 last:border-b-0"
      style={{ borderColor: T.border }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium" style={{ color: T.text }}>
            {definition.label}
          </p>

          {definition.status === "planned" && (
            // Honest about what is not wired up yet. The switch still saves —
            // the preference is real and will be honoured the moment the
            // feature emits — but presenting it as live would be a lie the user
            // discovers by waiting for an email that cannot arrive.
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: T.neutralSoft, color: T.neutralText }}
              title="This notification is not sent yet in this deployment. Your choice is saved and will apply as soon as it is."
            >
              Not sent yet
            </span>
          )}

          {dirty && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: T.warningSoft, color: T.warningText }}
            >
              Unsaved
            </span>
          )}
        </div>

        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: T.muted }}>
          {definition.description}
        </p>
      </div>

      <Toggle checked={checked} onChange={onChange} label={definition.label} />
    </div>
  );
}

/* ── Group ────────────────────────────────────────────────────────────────── */

function GroupCard({
  group,
  visible,
  draft,
  saved,
  expanded,
  onToggleExpanded,
  onChange,
  onBulk,
}: {
  group: NotificationGroup;
  /** The subset surviving the search filter. Never empty — the parent drops empty groups. */
  visible: NotificationDefinition[];
  draft: Record<string, boolean>;
  saved: Record<string, boolean>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (key: string, next: boolean) => void;
  onBulk: (keys: string[], next: boolean) => void;
}) {
  const visibleKeys = visible.map((n) => n.key);
  const onCount = visibleKeys.filter((key) => draft[key]).length;

  const bodyId = `notif-group-${group.id}`;

  return (
    <section
      className="mb-4 rounded-xl border"
      style={{ background: T.surface, borderColor: T.border }}
    >
      <header className="border-b px-4 py-3.5 sm:px-6" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* The whole heading is the expand control, so the hit area is the
              width of the card rather than a chevron. */}
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded"
            style={focusRing()}
          >
            <span
              aria-hidden
              className="text-xs transition-transform duration-200"
              style={{
                color: T.muted,
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold" style={{ color: T.text }}>
                {group.label}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: T.muted }}>
                {group.description}
              </span>
            </span>
          </button>

          <div className="flex flex-shrink-0 items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
              style={{ background: T.neutralSoft, color: T.neutralText }}
              // Screen readers get the meaning; sighted users get the shorthand.
              aria-label={`${onCount} of ${visibleKeys.length} enabled`}
            >
              {onCount}/{visibleKeys.length}
            </span>

            <button
              type="button"
              onClick={() => onBulk(visibleKeys, true)}
              disabled={onCount === visibleKeys.length}
              className="min-h-[36px] rounded-md border px-2.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2"
              style={{ borderColor: T.border, color: T.teal, ...focusRing() }}
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => onBulk(visibleKeys, false)}
              disabled={onCount === 0}
              className="min-h-[36px] rounded-md border px-2.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2"
              style={{ borderColor: T.border, color: T.muted, ...focusRing() }}
            >
              Disable all
            </button>
          </div>
        </div>
      </header>

      {/* Unmounted rather than hidden when collapsed: with seven groups this is
          fifty rows of DOM, and the search filter already rebuilds the list on
          every keystroke. */}
      {expanded && (
        <div id={bodyId} className="px-4 py-2 sm:px-6">
          {visible.map((definition) => (
            <NotificationRow
              key={definition.key}
              definition={definition}
              checked={Boolean(draft[definition.key])}
              dirty={draft[definition.key] !== saved[definition.key]}
              onChange={(next) => onChange(definition.key, next)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────────── */

function PreviewCard({
  summary,
  delivery,
  deliveryConfigured,
}: {
  summary: string[];
  delivery: CentreResponse["delivery"];
  deliveryConfigured: boolean;
}) {
  return (
    <Card title="Notification preview" description="What this adds up to, as you change it.">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold" style={{ color: T.text }}>
            You will receive
          </p>

          {summary.length === 0 ? (
            <p className="text-sm" style={{ color: T.muted }}>
              Nothing. Every notification is switched off.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {summary.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm" style={{ color: T.text }}>
                  <span aria-hidden style={{ color: T.teal }}>
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold" style={{ color: T.text }}>
            Emails will be delivered to
          </p>

          {delivery.addresses.length === 0 ? (
            <p className="text-sm" style={{ color: T.muted }}>
              No delivery address is switched on, so nothing will be sent wherever these switches
              are set. Change that in Delivery above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {delivery.addresses.map((address) => (
                <li
                  key={address}
                  className="flex items-start gap-2 break-all text-sm"
                  style={{ color: T.text }}
                >
                  <span aria-hidden style={{ color: T.success }}>
                    ✓
                  </span>
                  <span>{address}</span>
                </li>
              ))}
            </ul>
          )}

          {delivery.notes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {delivery.notes.map((note) => (
                <li key={note} className="text-xs leading-relaxed" style={{ color: T.warningText }}>
                  {note}
                </li>
              ))}
            </ul>
          )}

          {!deliveryConfigured && (
            <p className="mt-3 text-xs leading-relaxed" style={{ color: T.muted }}>
              No mail transport is configured on this deployment, so these preferences are stored
              but nothing is being sent yet.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── The screen ───────────────────────────────────────────────────────────── */

export default function NotificationCenter({
  deliveryVersion = 0,
}: {
  /**
   * Bumped by the parent when the delivery configuration changes elsewhere on
   * the page, to refresh the "Emails will be delivered to" half of the preview.
   *
   * A counter rather than a callback ref or an event: the parent knows when it
   * changed and this component knows how to reload, and a number in the
   * dependency array is the whole protocol. Unsaved switch edits survive the
   * refresh — only `delivery` is taken from the response, because discarding
   * someone's pending toggles because they verified an email address would be
   * an unpleasant surprise.
   */
  deliveryVersion?: number;
} = {}) {
  const toast = useToast();

  const [data, setData] = useState<CentreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** The server's last known answer. */
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  /** What is on screen, including unsaved edits. */
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    api<CentreResponse & { success: boolean }>("/api/settings/notification-preferences")
      .then((response) => {
        setData(response);
        setSaved(response.preferences);
        setDraft(response.preferences);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(messageOf(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Delivery-only refresh. Skipped on the first render (`deliveryVersion` starts
  // at 0) so this does not fire a second request immediately after `load`.
  useEffect(() => {
    if (deliveryVersion === 0) return;

    let cancelled = false;

    api<CentreResponse>("/api/settings/notification-preferences")
      .then((response) => {
        if (cancelled) return;
        setData((current) =>
          current ? { ...current, delivery: response.delivery } : current
        );
      })
      .catch(() => {
        // Silent. This is a background freshening of one panel, and a toast for
        // it would interrupt whatever the user is actually doing; the stale
        // addresses shown are the last ones the server confirmed.
      });

    return () => {
      cancelled = true;
    };
  }, [deliveryVersion]);

  /* ── Derived ── */

  const dirtyKeys = useMemo(
    () => Object.keys(draft).filter((key) => draft[key] !== saved[key]),
    [draft, saved]
  );

  // Memoised rather than `data?.groups ?? []` inline: the `?? []` allocates a
  // fresh array on every render, which as a dependency would invalidate the
  // search index and both derived lists on every keystroke — rebuilding the
  // whole catalogue index to answer one character of a filter.
  const groups = useMemo(() => data?.groups ?? [], [data]);

  // Rebuilt only when the catalogue changes, not on every keystroke.
  const index = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of groups) {
      for (const definition of group.notifications) map[definition.key] = searchIndex(definition);
    }
    return map;
  }, [groups]);

  const terms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  );

  const filtered = useMemo(() => {
    if (terms.length === 0) {
      return groups.map((group) => ({ group, visible: group.notifications }));
    }

    return groups
      .map((group) => ({
        group,
        // A group whose NAME matches shows all of its contents — searching
        // "billing" should reveal the Billing section, not only the two entries
        // that happen to repeat the word.
        visible: matches(group.label.toLowerCase(), terms)
          ? group.notifications
          : group.notifications.filter((definition) =>
              matches(index[definition.key] ?? "", terms)
            ),
      }))
      .filter((entry) => entry.visible.length > 0);
  }, [groups, index, terms]);

  const matchCount = filtered.reduce((total, entry) => total + entry.visible.length, 0);

  /**
   * The preview, recomputed locally as switches move.
   *
   * The server sends an authoritative `summary` and replaces this after every
   * save; between saves this is the one that has to keep up with the draft.
   * De-duplicated on the short label the same way the server does, so the two
   * never differ in their answer, only in their freshness.
   */
  const summary = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const group of groups) {
      for (const definition of group.notifications) {
        if (!draft[definition.key]) continue;
        const label = definition.short ?? definition.label;
        if (seen.has(label)) continue;
        seen.add(label);
        out.push(label);
      }
    }
    return out;
  }, [groups, draft]);

  /* ── Editing ── */

  const change = useCallback((key: string, next: boolean) => {
    setDraft((current) => ({ ...current, [key]: next }));
  }, []);

  const bulk = useCallback((keys: string[], next: boolean) => {
    setDraft((current) => {
      const updated = { ...current };
      for (const key of keys) updated[key] = next;
      return updated;
    });
  }, []);

  // Bulk actions apply to what is VISIBLE, not to the whole group. With a search
  // active the user is looking at a filtered list, and "Enable all" changing
  // rows scrolled out of existence by their own query would be a genuinely
  // surprising amount of collateral damage.
  const enableEverything = useCallback(
    (next: boolean) => {
      bulk(
        filtered.flatMap((entry) => entry.visible.map((definition) => definition.key)),
        next
      );
    },
    [bulk, filtered]
  );

  const discard = useCallback(() => setDraft(saved), [saved]);

  const save = useCallback(async () => {
    if (dirtyKeys.length === 0) return;

    const changes: Record<string, boolean> = {};
    for (const key of dirtyKeys) changes[key] = draft[key];

    setSaving(true);
    try {
      const response = await api<CentreResponse & { message: string }>(
        "/api/settings/notification-preferences",
        { method: "PATCH", json: { changes } }
      );

      // The server's answer wins for both halves. If it resolved anything
      // differently from the optimistic guess, this is where the screen finds
      // out — rather than showing a state no backend agrees with.
      setSaved(response.preferences);
      setDraft(response.preferences);
      setData((current) =>
        current
          ? {
              ...current,
              preferences: response.preferences,
              summary: response.summary,
              delivery: response.delivery,
            }
          : current
      );

      toast("success", response.message);
    } catch (err: unknown) {
      // `draft` is untouched on purpose — see the header. The edits stay on
      // screen and Save can be pressed again.
      toast("error", messageOf(err));
    } finally {
      setSaving(false);
    }
  }, [dirtyKeys, draft, toast]);

  /* ── Keyboard ── */

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+S saves. On a screen whose entire purpose is a form, the
      // browser's "save this page" is never what someone means by it.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
      }

      // "/" focuses search, unless the user is already typing somewhere.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  /* ── Leaving with unsaved changes ── */

  useEffect(() => {
    if (dirtyKeys.length === 0) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required by older browsers; modern ones show their own wording.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyKeys.length]);

  /* ── Render ── */

  if (loading) {
    return (
      <>
        <Card>
          <Skeleton rows={3} />
        </Card>
        <Card>
          <Skeleton rows={6} />
        </Card>
        <Card>
          <Skeleton rows={6} />
        </Card>
      </>
    );
  }

  if (loadError || !data) {
    return (
      <Card>
        <p className="text-sm" style={{ color: T.danger }}>
          Could not load notification preferences. {loadError}
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  const allVisibleKeys = filtered.flatMap((entry) => entry.visible.map((d) => d.key));
  const allOn = allVisibleKeys.length > 0 && allVisibleKeys.every((key) => draft[key]);
  const allOff = allVisibleKeys.every((key) => !draft[key]);

  return (
    <>
      {!data.deliveryConfigured && (
        <InfoBanner tone="warning">
          These preferences are saved and enforced, but this deployment has no mail transport
          configured — so no email is leaving the server yet. Set <code>SMTP_HOST</code>,{" "}
          <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>MAIL_FROM_EMAIL</code> in{" "}
          <code>.env.local</code>. Settings → Email Senders shows the current state and can send a
          test message.
        </InfoBanner>
      )}

      {/* ── Search and global bulk actions ── */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: T.muted }}
            >
              ⌕
            </span>
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search notifications — try “password”"
              aria-label="Search notifications"
              className="min-h-[44px] w-full rounded-lg border pl-9 pr-3 text-sm focus:outline-none focus:ring-2"
              style={{
                background: T.surface,
                borderColor: T.border,
                color: T.text,
                ...focusRing(),
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => enableEverything(true)} disabled={allOn}>
              Enable all
            </Button>
            <Button variant="secondary" onClick={() => enableEverything(false)} disabled={allOff}>
              Disable all
            </Button>
          </div>
        </div>

        {/* aria-live so the result count reaches a screen reader, which cannot
            see the list shrink. */}
        <p className="mt-3 text-xs" style={{ color: T.muted }} aria-live="polite">
          {terms.length === 0
            ? `${allVisibleKeys.length} notifications across ${filtered.length} groups. Press / to search, Ctrl+S to save.`
            : matchCount === 0
              ? `No notifications match “${search.trim()}”.`
              : `${matchCount} ${matchCount === 1 ? "match" : "matches"} for “${search.trim()}”. Enable all and Disable all apply to these matches only.`}
        </p>
      </Card>

      {/* ── Groups ── */}
      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm" style={{ color: T.muted }}>
            Nothing matches that search. Clear the box to see every notification.
          </p>
        </Card>
      ) : (
        filtered.map(({ group, visible }) => (
          <GroupCard
            key={group.id}
            group={group}
            visible={visible}
            draft={draft}
            saved={saved}
            // A search result that stayed collapsed would hide the thing that
            // was just searched for, so an active query forces every surviving
            // group open regardless of how it was left.
            expanded={terms.length > 0 || !collapsed[group.id]}
            onToggleExpanded={() =>
              setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))
            }
            onChange={change}
            onBulk={bulk}
          />
        ))
      )}

      <PreviewCard
        summary={summary}
        delivery={data.delivery}
        deliveryConfigured={data.deliveryConfigured}
      />

      {/* ── Sticky save bar ──
          Rendered only when there is something to save, so it does not sit on
          top of the last card for the entire time someone is reading. */}
      {dirtyKeys.length > 0 && (
        <div
          className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:mx-0 sm:rounded-xl sm:border sm:px-6"
          style={{
            background: T.surface,
            borderColor: T.border,
            boxShadow: "0 -4px 16px rgba(0,0,0,0.08)",
          }}
          role="region"
          aria-label="Unsaved changes"
        >
          <div className="flex items-center gap-2">
            <StatusBadge status="pending">
              {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "change" : "changes"}
            </StatusBadge>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
