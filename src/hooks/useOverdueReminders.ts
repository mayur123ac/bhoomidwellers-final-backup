"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { OverdueReminder } from "@/components/ReminderDuePopup";

/**
 * On mount (login / page open), fetch any overdue or recently-notified
 * reminders assigned to the current user. Also exposes `pushReminder`
 * so SSE handlers can add newly-due reminders in real time.
 *
 * Returns:
 *   overdueReminders — the list to show in the full-screen popup
 *   dismissAll       — close the popup (user clicked Later / X)
 *   markComplete     — PATCH the reminder and remove from list
 *   pushReminder     — add an SSE-pushed reminder to the queue
 */
export function useOverdueReminders() {
  const [reminders, setReminders] = useState<OverdueReminder[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const fetched = useRef(false);

  // ── On mount: fetch overdue reminders ──────────────────────────────────
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    (async () => {
      try {
        const res = await fetch("/api/reminders?assigned_to=me&status=pending,notified");
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) return;

        const now = Date.now();
        const overdue = json.data.filter((r: any) => new Date(r.remindAt).getTime() <= now);
        if (overdue.length > 0) {
          setReminders(overdue);
          setDismissed(false);
        }
      } catch { /* network error on login, ignore */ }
    })();
  }, []);

  // ── Mark one reminder complete ─────────────────────────────────────────
  const markComplete = useCallback((id: number) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    }).catch(() => {});
  }, []);

  // ── Dismiss the popup (keeps reminders in DB, just hides UI) ───────────
  const dismissAll = useCallback(() => {
    setDismissed(true);
  }, []);

  // ── Push a newly-due reminder from SSE ────────────────────────────────
  const pushReminder = useCallback((r: OverdueReminder) => {
    setReminders(prev => {
      if (prev.some(existing => existing.id === r.id)) return prev;
      return [...prev, r];
    });
    setDismissed(false); // re-show popup when a new one arrives via SSE
  }, []);

  const visible = !dismissed && reminders.length > 0;

  return { overdueReminders: reminders, visible, dismissAll, markComplete, pushReminder };
}
