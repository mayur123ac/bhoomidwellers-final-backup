// Shared teardown order for the suites that run against a real Postgres database.
//
// Three suites share one scratch database and each rebuilds its own fixture in
// `beforeEach`, so each one has to clear what the previous left behind — not
// just the tables it personally writes. Keeping the order in one place is the
// point: every time it was written out per-file it drifted, and the failure it
// produces is a foreign key violation during SEEDING, which reads like a broken
// test rather than a wrong delete order.
//
// The order is child-before-parent. Two edges are easy to miss and caused real
// failures:
//
//   inventory_units.booking_id -> booking_applications
//     so inventory_units must go BEFORE booking_applications, even though
//     "bookings then inventory" is the more natural reading order.
//   inventory_cost_sheets.price_rule_id -> inventory_price_rules
//     a cost sheet outliving its unit pins a price rule; clearing the pricing
//     tables first avoids reproducing the exact knot the building-delete hit.
//
// organizations is last: almost everything references it ON DELETE RESTRICT.
export const DB_WIPE_ORDER = [
  "site_visits",
  "follow_ups",
  "inventory_offers",
  "inventory_cost_sheets",
  "inventory_price_rules",
  "inventory_discount_bands",
  "inventory_unit_history",
  "inventory_units",
  "inventory_towers",
  "inventory_projects",
  "booking_loan_details",
  "booking_financials",
  "booking_registration_details",
  "booking_applications",
  "walkin_enquiries",
  "users",
  "organizations",
] as const;

/** Clear every shared table, in dependency order. Caller owns the transaction. */
export async function wipeAll(client: { query: (sql: string) => Promise<unknown> }) {
  for (const table of DB_WIPE_ORDER) await client.query(`DELETE FROM ${table}`);
}
