// lib/crmUpdates.ts — System Updates: the CRM-wide announcement feed.
//
// ── One canonical record, many readers ──────────────────────────────────────
// There is exactly ONE row per announcement in `crm_updates`. It is not copied
// per role, per organization or per user, and it deliberately has no
// organization_id: a System Update is a platform announcement from Super Admin
// to the whole product, so scoping it to a tenant would be modelling it as
// something it is not.
//
// Read state is the only per-user thing, and it lives in its own table:
//
//   crm_updates        the announcement            (one row, shared)
//   crm_update_reads   (user_id, update_id, read_at)  (one row per reader)
//
// Both tables predate this module's publication lifecycle. `is_read` is NOT a
// column on the update and must never become one — "read" is a fact about a
// person, and a boolean on the shared row would mean the first person to open an
// announcement marked it read for everybody.
//
// ── Publication lifecycle ───────────────────────────────────────────────────
// `status` is 'draft' or 'published'. Only published rows reach CRM users; the
// draft is visible to Super Admin alone. Unpublishing flips the status back and
// keeps the row, its history and everyone's read marks — the brief asks
// explicitly that a published announcement is never destroyed to retract it.
//
// ── The pre-existing columns ────────────────────────────────────────────────
// `category` is the update TYPE (Update / Important / Feature / Improvement /
// Fix / Maintenance), `features` is the optional bullet list, `is_important`
// drives the red "Important" flag, and `created_by` is a display-name string.
// All four are original columns, still written and still read by the existing
// System Updates modal, so nothing about how that modal renders had to change.
// `created_by_user_id` and `published_by` are the real foreign keys added
// alongside, because a display name stops being an answer after a rename.

import { query } from "./db";

/** The audience values the column accepts today. */
export const AUDIENCE_ALL = "all_users";

/**
 * The six types the Super Admin form offers.
 *
 * Exported so the API validates against the same list the UI renders — a type
 * that exists in one and not the other is how a dropdown starts producing rows
 * the feed cannot style.
 */
export const UPDATE_TYPES = [
  "Update",
  "Important",
  "Feature",
  "Improvement",
  "Fix",
  "Maintenance",
] as const;

export type UpdateType = (typeof UPDATE_TYPES)[number];
export type UpdateStatus = "draft" | "published";

export function isUpdateType(value: unknown): value is UpdateType {
  return UPDATE_TYPES.includes(String(value) as UpdateType);
}

export interface CrmUpdate {
  id: number;
  version: string;
  title: string;
  description: string | null;
  category: string | null;
  features: string[] | any;
  is_important: boolean;
  created_by: string | null;
  created_at: Date;
  status: UpdateStatus;
  audience_type: string;
  created_by_user_id: number | null;
  published_by: number | null;
  published_at: Date | null;
  updated_at: Date | null;
}

/** The admin list adds the publisher's name, resolved through the FK. */
export interface CrmUpdateAdminRow extends CrmUpdate {
  created_by_name: string | null;
  published_by_name: string | null;
  read_count: number;
}

/**
 * `features` is a JSONB column and arrives as a parsed array, a JSON string, or
 * null depending on how it was written. Normalised in one place so no caller
 * has to guess, and so a malformed value degrades to an empty list rather than
 * throwing inside a render.
 */
export function normaliseFeatures(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface UpdateInput {
  version: string;
  title: string;
  description?: string | null;
  /** The TYPE dropdown; stored in the pre-existing `category` column. */
  category?: string | null;
  features?: unknown;
  is_important?: boolean;
  audience_type?: string;
}

/**
 * Creates an announcement as a draft or straight to published.
 *
 * `publish: true` stamps `published_at` and `published_by` in the same INSERT,
 * so a published row can never exist without a record of who published it and
 * when. A draft leaves both NULL — that is what distinguishes "not yet sent"
 * from "sent at some unknown time".
 *
 * `actorId` and `actorName` come from the verified Super Admin session at the
 * call site; nothing about the author is read from the request body.
 */
export async function createCrmUpdate(
  data: UpdateInput & { publish: boolean },
  actor: { id: number; name: string }
): Promise<CrmUpdate> {
  const rows = await query<CrmUpdate>(
    `INSERT INTO crm_updates
       (version, title, description, category, features, is_important,
        created_by, created_by_user_id, audience_type, status,
        published_at, published_by, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        CASE WHEN $10::boolean THEN 'published' ELSE 'draft' END,
        CASE WHEN $10::boolean THEN now() ELSE NULL END,
        CASE WHEN $10::boolean THEN $8::int ELSE NULL END,
        now())
     RETURNING *`,
    [
      data.version,
      data.title,
      data.description || null,
      data.category || null,
      JSON.stringify(normaliseFeatures(data.features)),
      data.is_important ?? false,
      actor.name,
      actor.id,
      data.audience_type || AUDIENCE_ALL,
      data.publish,
    ]
  );
  return rows[0];
}

/**
 * Edits an announcement's content. Deliberately cannot change its status —
 * publishing and unpublishing are their own operations, so "save" can never
 * broadcast a draft by accident.
 */
export async function updateCrmUpdate(
  id: number,
  data: UpdateInput
): Promise<CrmUpdate | null> {
  const rows = await query<CrmUpdate>(
    `UPDATE crm_updates
        SET version = $2,
            title = $3,
            description = $4,
            category = $5,
            features = $6,
            is_important = $7,
            audience_type = COALESCE($8, audience_type),
            updated_at = now()
      WHERE id = $1
    RETURNING *`,
    [
      id,
      data.version,
      data.title,
      data.description || null,
      data.category || null,
      JSON.stringify(normaliseFeatures(data.features)),
      data.is_important ?? false,
      data.audience_type || null,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Publishes a draft.
 *
 * `published_at` is only set the FIRST time, via COALESCE: republishing
 * something that was unpublished restores it to the feed without rewriting its
 * original publication date, which is what the historical record means. The
 * publisher is re-stamped, because the person who put it back is the person
 * accountable for it being there now.
 *
 * Newly published means unread for everyone automatically — there is nothing to
 * reset. Unread is the ABSENCE of a crm_update_reads row, so an announcement
 * nobody has opened has no rows and is unread by construction.
 */
export async function publishCrmUpdate(
  id: number,
  actorId: number
): Promise<CrmUpdate | null> {
  const rows = await query<CrmUpdate>(
    `UPDATE crm_updates
        SET status = 'published',
            published_at = COALESCE(published_at, now()),
            published_by = $2,
            updated_at = now()
      WHERE id = $1
    RETURNING *`,
    [id, actorId]
  );
  return rows[0] ?? null;
}

/**
 * Removes an announcement from the live feed WITHOUT destroying it.
 *
 * The row stays, `published_at` stays, `published_by` stays, and every
 * crm_update_reads row stays — so republishing later does not resurrect it as
 * unread for people who already read it, and the audit trail still shows it was
 * once live. This is the reason the brief asks for unpublish rather than delete.
 */
export async function unpublishCrmUpdate(id: number): Promise<CrmUpdate | null> {
  const rows = await query<CrmUpdate>(
    `UPDATE crm_updates
        SET status = 'draft', updated_at = now()
      WHERE id = $1
    RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/** One announcement by id, in any status. Super Admin only — see the routes. */
export async function getCrmUpdateById(id: number): Promise<CrmUpdate | null> {
  const rows = await query<CrmUpdate>(`SELECT * FROM crm_updates WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * The Super Admin management list: every announcement, drafts included.
 *
 * `read_count` is a correlated count rather than a join, so a draft (which by
 * definition has no readers) still returns 0 instead of vanishing from the list.
 */
export async function listCrmUpdatesForAdmin(): Promise<CrmUpdateAdminRow[]> {
  return query<CrmUpdateAdminRow>(
    `SELECT u.*,
            cu.name AS created_by_name,
            pu.name AS published_by_name,
            (SELECT count(*)::int FROM crm_update_reads r WHERE r.update_id = u.id) AS read_count
       FROM crm_updates u
       LEFT JOIN users cu ON cu.id = u.created_by_user_id
       LEFT JOIN users pu ON pu.id = u.published_by
      ORDER BY COALESCE(u.published_at, u.updated_at, u.created_at) DESC, u.id DESC`
  );
}

/**
 * The user-facing feed: PUBLISHED announcements only, newest first, with this
 * one user's read state attached.
 *
 * ── Why the status filter is in SQL ─────────────────────────────────────────
 * A draft must not leave the database. Filtering in the route or the component
 * would mean the draft's title and body were serialised into a response that a
 * curious user could read in devtools — "not rendered" is not "not sent".
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * By `published_at`, not `created_at`: a draft written in June and published in
 * August belongs at the top of the August feed, which is when people first saw
 * it. COALESCE guards the theoretical row that is published with no stamp.
 *
 * ── Audience ────────────────────────────────────────────────────────────────
 * The audience predicate is already here even though only one value exists.
 * Adding a role-scoped audience later is then a change to this one clause plus
 * the form's dropdown, rather than a hunt for every place the feed is built.
 */
export async function getUpdatesWithReadStatus(
  userId: number,
  viewerRole?: string
): Promise<(CrmUpdate & { has_read: boolean })[]> {
  const role = (viewerRole ?? "").toString().trim().toLowerCase().replace(/_/g, " ");

  return query<CrmUpdate & { has_read: boolean }>(
    `SELECT u.*,
            (r.read_at IS NOT NULL) AS has_read
       FROM crm_updates u
       LEFT JOIN crm_update_reads r
         ON r.update_id = u.id AND r.user_id = $1
      WHERE u.status = 'published'
        AND (
          u.audience_type = '${AUDIENCE_ALL}'
          -- Forward compatibility: an audience of 'role:sales manager' targets
          -- exactly that role. No such row can exist today, because the API
          -- only accepts '${AUDIENCE_ALL}' — but the feed is written so that
          -- adding one does not accidentally broadcast it to everybody.
          OR u.audience_type = 'role:' || $2::text
        )
      ORDER BY COALESCE(u.published_at, u.created_at) DESC, u.id DESC`,
    [userId, role]
  );
}

/**
 * Marks one announcement read for ONE user.
 *
 * ON CONFLICT DO NOTHING because re-reading is not an event: the first read_at
 * is the interesting timestamp, and a second click should not rewrite it.
 *
 * The insert names both keys explicitly, so this cannot be made to mark an
 * announcement read for somebody else — the user id is a parameter the route
 * takes from the session, never from the request body.
 */
export async function markUpdateAsRead(userId: number, updateId: number): Promise<boolean> {
  await query(
    `INSERT INTO crm_update_reads (user_id, update_id)
     SELECT $1, $2
      WHERE EXISTS (SELECT 1 FROM crm_updates WHERE id = $2 AND status = 'published')
     ON CONFLICT (user_id, update_id) DO NOTHING`,
    [userId, updateId]
  );
  return true;
}

/**
 * Marks every currently published announcement read for ONE user.
 *
 * The SELECT is the set of published rows this user has not already read, so the
 * statement is idempotent and writes nothing on a second click. It affects
 * exactly one user_id — there is no variant of this that touches anyone else.
 */
export async function markAllUpdatesRead(userId: number): Promise<number> {
  const rows = await query<{ update_id: number }>(
    `INSERT INTO crm_update_reads (user_id, update_id)
     SELECT $1, u.id
       FROM crm_updates u
      WHERE u.status = 'published'
     ON CONFLICT (user_id, update_id) DO NOTHING
     RETURNING update_id`,
    [userId]
  );
  return rows.length;
}

/**
 * Validates the fields shared by create and edit.
 *
 * Lives here rather than in a route file for two reasons: the create route and
 * the edit route must not be able to disagree about what a valid announcement
 * is, and a Next.js App Router route module may only export HTTP verbs plus its
 * config — a helper exported from one fails the build's route-type check.
 *
 * Returns an error sentence, or null when the body is acceptable. The length
 * caps mirror the column widths (`version VARCHAR(50)`, `title VARCHAR(255)`),
 * so an over-long value is a 400 with an explanation rather than a 500 from the
 * driver.
 */
export function validateUpdateBody(body: any): string | null {
  const version = (body?.version ?? "").toString().trim();
  const title = (body?.title ?? "").toString().trim();
  const type = (body?.type ?? "").toString().trim();
  const description = (body?.description ?? "").toString();
  const audience = (body?.audienceType ?? AUDIENCE_ALL).toString();

  if (!version) return "A version is required.";
  if (version.length > 50) return "That version string is too long.";
  if (!title) return "A title is required.";
  if (title.length > 255) return "That title is too long.";
  if (!type) return "A type is required.";
  if (!isUpdateType(type)) return "That is not a valid update type.";
  if (description.length > 20_000) return "That description is too long.";
  // One audience exists today. Refusing anything else means a client cannot
  // invent a value the feed query does not understand, which would produce an
  // announcement that is published and yet reaches nobody.
  if (audience !== AUDIENCE_ALL) return "That audience is not available yet.";

  return null;
}
