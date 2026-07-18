// app/api/inventory/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── Auto-create table ────────────────────────────────────────────────────────
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS project_units (
      id                  SERIAL PRIMARY KEY,
      project_name        TEXT NOT NULL DEFAULT 'Colossal Mas',
      building            TEXT,
      tower               TEXT,
      wing                TEXT,
      floor               TEXT NOT NULL,
      unit_number         TEXT NOT NULL,
      property_type       TEXT,                          -- 1BHK, 2BHK, 3BHK, Shop, Office, etc.
      carpet_area         NUMERIC,                       -- sq.ft.
      builtup_area        NUMERIC,                       -- sq.ft.
      super_builtup_area  NUMERIC,                       -- sq.ft. (optional)
      base_price          NUMERIC DEFAULT 0,             -- list price in ₹
      price_per_sqft      NUMERIC,                       -- ₹ per sq.ft.
      facing              TEXT,                           -- East, West, North, South, etc.
      view_type           TEXT,                           -- Garden, Road, Sea, etc.
      balcony_count       INTEGER DEFAULT 0,
      parking_type        TEXT,                           -- Covered, Open, None
      parking_number      TEXT,

      -- Status management
      status              TEXT NOT NULL DEFAULT 'Available'
                          CHECK (status IN ('Available', 'Reserved', 'Booked', 'Sold', 'Cancelled', 'Blocked')),
      booking_id          INTEGER REFERENCES booking_applications(id) ON DELETE SET NULL,
      reserved_by         TEXT,                          -- user name who reserved
      reserved_at         TIMESTAMPTZ,                   -- when reservation started
      reservation_expires_at TIMESTAMPTZ,                -- auto-expire time

      -- Metadata
      remarks             TEXT,
      is_active           BOOLEAN DEFAULT true,          -- soft delete
      created_by          TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),

      -- Prevent duplicate units
      UNIQUE (project_name, tower, wing, floor, unit_number)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS unit_status_history (
      id              SERIAL PRIMARY KEY,
      unit_id         INTEGER NOT NULL REFERENCES project_units(id) ON DELETE CASCADE,
      old_status      TEXT,
      new_status      TEXT NOT NULL,
      changed_by      TEXT NOT NULL,
      change_reason   TEXT,                             -- e.g., 'Booking BK-2026-07-18-00012', 'Admin override', 'Reservation expired'
      booking_id      INTEGER REFERENCES booking_applications(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_project_units_status ON project_units(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_project_units_booking ON project_units(booking_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_project_units_lookup ON project_units(project_name, tower, wing, floor, unit_number);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_unit_status_history_unit ON unit_status_history(unit_id);`);

  // FK link from booking → unit. Existing bookings keep unit_id = NULL (legacy
  // data); flat_number/floor_number/property_type on booking_applications stay
  // as denormalized copies for backward compatibility and PDF generation.
  await query(`
    ALTER TABLE booking_applications
      ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES project_units(id);
  `);
}

// ─── GET — list units ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
    const offset = Number(searchParams.get("offset") ?? 0);

    const rows = await query(
      `SELECT * FROM project_units WHERE is_active = true ORDER BY tower, wing, floor, unit_number LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
