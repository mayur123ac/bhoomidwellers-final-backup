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
    console.log("[BD-CALL] SESSION_SAVED", session);
  } catch (e) {
    console.error("[BD-CALL] SESSION_SAVE_FAILED", e);
  }
}

export function loadPendingSession(): PendingCallSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.log("[BD-CALL] LOAD_PENDING: nothing in localStorage");
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.callStartedAt > 3_600_000) {
      console.log("[BD-CALL] LOAD_PENDING: expired, discarding");
      clearPendingSession();
      return null;
    }
    console.log("[BD-CALL] LOAD_PENDING: found", parsed);
    return parsed;
  } catch (e) {
    console.error("[BD-CALL] LOAD_PENDING: parse error", e);
    return null;
  }
}

export function clearPendingSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
