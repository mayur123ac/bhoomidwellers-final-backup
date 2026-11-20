-- Backfill legacy walkin_enquiries rows that have NULL site_location_id
-- with their organization's configured default site location.
-- Safe: only touches rows where site_location_id IS NULL.
-- Idempotent: running twice is a no-op (WHERE ... IS NULL).

UPDATE walkin_enquiries w
SET    site_location_id = sl.id
FROM   site_locations sl
WHERE  sl.organization_id = w.organization_id
  AND  sl.is_default = true
  AND  w.site_location_id IS NULL;
