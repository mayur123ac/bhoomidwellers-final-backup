"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 2000;
const FULL_REFRESH_MS = 5 * 60_000;   // presigned URLs live 10 min
const MAX_BACKOFF_MS = 30_000;

type HttpError = Error & { status?: number };
const fail = (res: Response, json: any): HttpError =>
    Object.assign(new Error(json?.message || `HTTP ${res.status}`), { status: res.status });

export function useCpChat(cpId: number | string) {
    const [messages, setMessages] = useState<any[]>([]);
    const [about, setAbout] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const cursor = useRef<string | null>(null);
    const fingerprint = useRef<string | null>(null);
    const lastFull = useRef(0);

    const merge = useCallback((incoming: any[]) => {
        if (!incoming?.length) return;
        setMessages((prev) => {
            const map = new Map(prev.map((m) => [m.id, m]));
            for (const m of incoming) map.set(m.id, m);   // edits replace, new ones append
            return [...map.values()].sort((a, b) => a.ts - b.ts);
        });
    }, []);

    const loadFull = useCallback(async (signal?: AbortSignal) => {
        const res = await fetch(`/api/channel-partners/${cpId}/chat`, { cache: "no-store", signal });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw fail(res, json);
        setMessages(json.data.messages);
        setAbout(json.data.about);
        cursor.current = json.data.cursor;
        fingerprint.current = json.data.fingerprint;
        lastFull.current = Date.now();
    }, [cpId]);

    useEffect(() => {
        cursor.current = null;
        fingerprint.current = null;
        setMessages([]);
        setLoading(true);

        let stopped = false;
        let running = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let delay = POLL_MS;
        const ctrl = new AbortController();

        const tick = async () => {
            if (stopped || running) return;
            if (document.hidden) { timer = setTimeout(tick, POLL_MS); return; }   // pause in background tabs
            running = true;
            try {
                if (!cursor.current || Date.now() - lastFull.current > FULL_REFRESH_MS) {
                    await loadFull(ctrl.signal);
                } else {
                    const res = await fetch(
                        `/api/channel-partners/${cpId}/chat?since=${encodeURIComponent(cursor.current)}`,
                        { cache: "no-store", signal: ctrl.signal }
                    );
                    const json = await res.json().catch(() => null);
                    if (!res.ok || !json?.success) throw fail(res, json);
                    if (json.data.fingerprint !== fingerprint.current) {
                        await loadFull(ctrl.signal);          // a visit/booking/etc. changed
                    } else {
                        merge(json.data.messages);
                        cursor.current = json.data.cursor;
                    }
                }
                setError(null);
                delay = POLL_MS;
            } catch (e: any) {
                if (e?.name === "AbortError") return;
                setError(e.message);
                if ([401, 403, 404].includes(e.status)) { stopped = true; return; }  // no point retrying
                delay = Math.min(delay * 2, MAX_BACKOFF_MS);
            } finally {
                running = false;
                setLoading(false);
            }
            if (!stopped) timer = setTimeout(tick, delay);
        };

        const onVisible = () => {
            if (!document.hidden && !running) { clearTimeout(timer); tick(); }
        };

        tick();
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            clearTimeout(timer);
            ctrl.abort();
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [cpId, loadFull, merge]);

    /** Send text and/or files; the response is merged in immediately, no waiting for the next poll. */
    const send = useCallback(async (text: string, files: File[] = []) => {
        const init: RequestInit = files.length
            ? (() => {
                const fd = new FormData();
                if (text) fd.append("text", text);
                files.forEach((f) => fd.append("files", f));
                return { method: "POST", body: fd };
            })()
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            };
        const res = await fetch(`/api/channel-partners/${cpId}/chat`, init);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw fail(res, json);
        merge(json.data);
        return json.data;
    }, [cpId, merge]);

    return { messages, about, loading, error, send };
}