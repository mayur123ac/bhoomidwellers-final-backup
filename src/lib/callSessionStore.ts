// callSessionStore.ts — persist pending call sessions across app restarts.
//
// When the CRM creates a call session and opens the dialer, the user may
// background or kill the app. On relaunch the session must be recoverable
// so the recording workflow can still complete.

const STORAGE_KEY = "bd:pendingCallSession";

export interface PendingCallSession {
  callSessionId: number;
  phoneNumber: string;
  callStartedAt: number; // epoch ms
  leadId?: number | null;
  callerLeadId?: number | null;
}

export function savePendingSession(session: PendingCallSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full or unavailable — non-fatal
  }
}

export function loadPendingSession(): PendingCallSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Sanity: discard sessions older than 1 hour (stale)
    if (Date.now() - parsed.callStartedAt > 3_600_000) {
      clearPendingSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
