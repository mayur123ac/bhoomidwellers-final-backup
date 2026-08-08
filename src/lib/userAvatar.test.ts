// userAvatar.test.ts — the store behind every header avatar.
//
// The distinction these pin down is the one that is easy to break by "tidying"
// the module: an empty string means "no picture, and we know it", an absent key
// means "we have not asked". Collapse the two and either a removed picture gets
// re-fetched on every mount forever, or a fresh session never fetches at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptServerAvatar,
  clearAvatar,
  getAvatarUrl,
  hasResolvedAvatar,
  setAvatarUrl,
  subscribeToAvatar,
} from "./userAvatar";

beforeEach(() => {
  localStorage.clear();
});

describe("resolved vs unknown", () => {
  it("starts unresolved, so a new session goes and asks", () => {
    expect(hasResolvedAvatar()).toBe(false);
    expect(getAvatarUrl()).toBeNull();
  });

  it("treats 'no picture' as a resolved answer, not as unknown", () => {
    // The removal case. Without this, useUserAvatar's backfill would refetch on
    // every mount for a user who simply has no photo.
    setAvatarUrl(null);
    expect(hasResolvedAvatar()).toBe(true);
    expect(getAvatarUrl()).toBeNull();
  });

  it("keeps a URL and reports it as resolved", () => {
    setAvatarUrl("/api/r2-proxy?key=avatars%2Fuser_1.png");
    expect(hasResolvedAvatar()).toBe(true);
    expect(getAvatarUrl()).toBe("/api/r2-proxy?key=avatars%2Fuser_1.png");
  });

  it("goes back to unknown on sign-out, so the next user asks for their own", () => {
    setAvatarUrl("/api/r2-proxy?key=avatars%2Fuser_1.png");
    clearAvatar();
    expect(hasResolvedAvatar()).toBe(false);
    expect(getAvatarUrl()).toBeNull();
  });
});

describe("adoptServerAvatar", () => {
  it("accepts a URL", () => {
    expect(adoptServerAvatar("/uploads/avatars/user_2.jpg")).toBe("/uploads/avatars/user_2.jpg");
    expect(getAvatarUrl()).toBe("/uploads/avatars/user_2.jpg");
  });

  it("reads null, undefined and empty strings as a resolved 'no picture'", () => {
    // serializeSettingsUser sends null for a user with no avatar; the login
    // route sends the same. Both must resolve rather than leave it unknown.
    for (const value of [null, undefined, "", "   "]) {
      localStorage.clear();
      expect(adoptServerAvatar(value)).toBeNull();
      expect(hasResolvedAvatar()).toBe(true);
    }
  });
});

describe("subscribers", () => {
  it("notifies on set, adopt and clear — this is what moves the header", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAvatar(listener);

    setAvatarUrl("/a.png");
    adoptServerAvatar("/b.png");
    clearAvatar();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    setAvatarUrl("/c.png");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("wakes on another tab's write", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAvatar(listener);

    // `storage` is the only signal from another tab — the browser does not fire
    // it in the tab that wrote, which is why the in-page event exists too.
    window.dispatchEvent(new StorageEvent("storage", { key: "crm_avatar" }));
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent("storage", { key: "crm_theme" }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
