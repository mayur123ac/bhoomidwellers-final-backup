// Unit coverage for the pure logic behind the Super Admin master controls.
//
// Everything tested here is a decision that is easy to get subtly wrong and
// expensive to be wrong about: whether a session is still valid, whether a
// password may be shown, and what an announcement is allowed to contain. The
// database-touching halves (the org-scoped SQL, the revocation UPDATEs) are
// verified separately against a real Postgres in the acceptance run; these are
// the branches that decide things before any query is issued.

import { describe, expect, it } from "vitest";
import {
  sessionIsRevoked,
  sessionPredatesPasswordChange,
  sessionRevocationNow,
} from "./passwordReset";
import { passwordStatusOf } from "./userSecurity";
import { isUpdateType, normaliseFeatures, validateUpdateBody } from "./crmUpdates";

/** A session cookie payload issued `secondsAgo` seconds ago. */
const sessionIssued = (secondsAgo: number) => ({
  iat: Math.floor(Date.now() / 1000) - secondsAgo,
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const minutesAhead = (n: number) => new Date(Date.now() + n * 60_000);

describe("sessionIsRevoked", () => {
  it("accepts a session when neither stamp is set", () => {
    expect(
      sessionIsRevoked(sessionIssued(60), { passwordChangedAt: null, sessionsRevokedAt: null })
    ).toBe(false);
  });

  it("refuses a session issued before a force logout", () => {
    // The core force-logout guarantee: the cookie in the user's browser was
    // minted an hour ago, the operator revoked a minute ago, so the cookie dies.
    expect(
      sessionIsRevoked(sessionIssued(3600), {
        passwordChangedAt: null,
        sessionsRevokedAt: minutesAgo(1),
      })
    ).toBe(true);
  });

  it("accepts a session issued after a force logout", () => {
    // The user signed back in. The stamp is older than their new session, so it
    // must not keep locking them out — otherwise revocation would be permanent.
    expect(
      sessionIsRevoked(sessionIssued(30), {
        passwordChangedAt: null,
        sessionsRevokedAt: minutesAgo(10),
      })
    ).toBe(false);
  });

  it("refuses a session issued before a password change", () => {
    expect(
      sessionIsRevoked(sessionIssued(3600), {
        passwordChangedAt: minutesAgo(5),
        sessionsRevokedAt: null,
      })
    ).toBe(true);
  });

  it("takes the later of the two stamps", () => {
    // Revoked long ago, password changed recently: the session sits between
    // them and must still be refused. A helper that only consulted whichever
    // column happened to be non-null first would let this through.
    expect(
      sessionIsRevoked(sessionIssued(120), {
        passwordChangedAt: minutesAgo(1),
        sessionsRevokedAt: minutesAgo(600),
      })
    ).toBe(true);

    // And the mirror image.
    expect(
      sessionIsRevoked(sessionIssued(120), {
        passwordChangedAt: minutesAgo(600),
        sessionsRevokedAt: minutesAgo(1),
      })
    ).toBe(true);
  });

  it("treats a session with no `iat` as stale", () => {
    // A payload with no issue time cannot be shown to be current. Fail closed.
    expect(sessionIsRevoked({}, { sessionsRevokedAt: minutesAgo(5) })).toBe(true);
  });

  it("floors a sub-second stamp, so a legacy row cannot lock an account out of itself", () => {
    // The comparison is second-granular because `iat` is. This is the behaviour
    // for stamps already in the table from before sessionRevocationNow() existed
    // — SQL now() wrote milliseconds, and without flooring, the token minted by
    // the very next re-login would count as older than the change.
    //
    // New stamps do not rely on this: sessionRevocationNow() advances to the
    // next second boundary precisely so the same-second case is unambiguous and
    // fails closed. See its own describe block below.
    const now = Date.now();
    const stamp = new Date(Math.floor(now / 1000) * 1000 + 400); // x.400s
    const session = { iat: Math.floor(now / 1000) };
    expect(sessionPredatesPasswordChange(session, stamp)).toBe(false);
    expect(sessionIsRevoked(session, { sessionsRevokedAt: stamp })).toBe(false);
  });

  it("refuses a session against a future stamp", () => {
    expect(sessionIsRevoked(sessionIssued(0), { sessionsRevokedAt: minutesAhead(5) })).toBe(true);
  });
});

describe("passwordStatusOf", () => {
  it("reports only whether a credential exists", () => {
    expect(passwordStatusOf(true)).toBe("set");
    expect(passwordStatusOf(false)).toBe("not_set");
  });

  it("never returns anything derived from a stored value", () => {
    // The signature takes a boolean, so there is no shape of call that could
    // pass a hash in and get part of it back. This asserts the contract that
    // makes that true rather than the arithmetic.
    const values = [passwordStatusOf(true), passwordStatusOf(false)];
    expect(new Set(values)).toEqual(new Set(["set", "not_set"]));
  });
});

describe("validateUpdateBody", () => {
  const valid = {
    version: "v2.1.4",
    title: "UI/UX Upgrade Released",
    type: "Feature",
    description: "Some **bold** text.",
    audienceType: "all_users",
  };

  it("accepts a complete announcement", () => {
    expect(validateUpdateBody(valid)).toBeNull();
  });

  it("requires a version", () => {
    expect(validateUpdateBody({ ...valid, version: "  " })).toMatch(/version is required/i);
  });

  it("requires a title", () => {
    expect(validateUpdateBody({ ...valid, title: "" })).toMatch(/title is required/i);
  });

  it("rejects a type the feed cannot style", () => {
    expect(validateUpdateBody({ ...valid, type: "Emergency" })).toMatch(/not a valid update type/i);
  });

  it("accepts every offered type", () => {
    for (const type of ["Update", "Important", "Feature", "Improvement", "Fix", "Maintenance"]) {
      expect(validateUpdateBody({ ...valid, type })).toBeNull();
    }
  });

  it("rejects an audience the feed query does not understand", () => {
    // Otherwise a client could publish an announcement that is live and yet
    // reaches nobody, which looks like a broken publish rather than a bad value.
    expect(validateUpdateBody({ ...valid, audienceType: "role:admin" })).toMatch(/not available yet/i);
  });

  it("bounds the fields to their column widths", () => {
    expect(validateUpdateBody({ ...valid, version: "v".repeat(51) })).toMatch(/too long/i);
    expect(validateUpdateBody({ ...valid, title: "t".repeat(256) })).toMatch(/too long/i);
    expect(validateUpdateBody({ ...valid, description: "d".repeat(20001) })).toMatch(/too long/i);
  });
});

describe("isUpdateType", () => {
  it("is case-sensitive, matching the stored values", () => {
    expect(isUpdateType("Feature")).toBe(true);
    expect(isUpdateType("feature")).toBe(false);
    expect(isUpdateType(null)).toBe(false);
    expect(isUpdateType(undefined)).toBe(false);
  });
});

describe("normaliseFeatures", () => {
  it("passes an array through", () => {
    expect(normaliseFeatures(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses a JSON string, which is how jsonb sometimes arrives", () => {
    expect(normaliseFeatures('["a","b"]')).toEqual(["a", "b"]);
  });

  it("degrades to an empty list rather than throwing inside a render", () => {
    expect(normaliseFeatures("not json")).toEqual([]);
    expect(normaliseFeatures('{"a":1}')).toEqual([]);
    expect(normaliseFeatures(null)).toEqual([]);
    expect(normaliseFeatures(undefined)).toEqual([]);
    expect(normaliseFeatures(42)).toEqual([]);
  });

  it("drops empty entries so a trailing newline is not a blank bullet", () => {
    expect(normaliseFeatures(["a", "", "b"])).toEqual(["a", "b"]);
  });
});

describe("sessionRevocationNow", () => {
  it("lands on a whole second, in the future", () => {
    const before = Date.now();
    const stamp = sessionRevocationNow().getTime();
    expect(stamp % 1000).toBe(0);
    expect(stamp).toBeGreaterThan(before);
    expect(stamp - before).toBeLessThanOrEqual(1000);
  });

  it("revokes a session issued in the same second as the click", () => {
    // The flaw this exists to close. `iat` is whole seconds, so a sign-in at
    // 12:00:03.100 and a revocation at 12:00:03.900 both reduce to 12:00:03 and
    // `iat < revokedAt` would be false — the force logout would silently do
    // nothing to the session it was aimed at.
    const stamp = sessionRevocationNow();
    const sessionFromThisSecond = { iat: Math.floor(Date.now() / 1000) };
    expect(sessionIsRevoked(sessionFromThisSecond, { sessionsRevokedAt: stamp })).toBe(true);
  });

  it("honours a sign-in from the next second onward", () => {
    // The other half: revocation must not be a permanent lockout.
    const stamp = sessionRevocationNow();
    const reLogin = { iat: Math.floor(stamp.getTime() / 1000) };
    expect(sessionIsRevoked(reLogin, { sessionsRevokedAt: stamp })).toBe(false);

    const later = { iat: Math.floor(stamp.getTime() / 1000) + 30 };
    expect(sessionIsRevoked(later, { sessionsRevokedAt: stamp })).toBe(false);
  });

  it("is comparable with iat, which SQL now() is not", () => {
    // Both values come from the application clock. The regression this guards:
    // the database clock on this project's Neon branch ran 4.9s AHEAD of the
    // app host, so a `now()` stamp sat in the app's future and refused every
    // session issued for the next five seconds — including the one the user got
    // by signing back in.
    const stamp = sessionRevocationNow();
    const skewedDatabaseStamp = new Date(Date.now() + 4_900);
    const reLogin = { iat: Math.floor(Date.now() / 1000) + 1 };

    expect(sessionIsRevoked(reLogin, { sessionsRevokedAt: stamp })).toBe(false);
    expect(sessionIsRevoked(reLogin, { sessionsRevokedAt: skewedDatabaseStamp })).toBe(true);
  });
});
