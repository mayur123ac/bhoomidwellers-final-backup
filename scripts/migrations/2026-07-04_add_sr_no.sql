-- Migration: Add sr_no (Business Lead Number) to walkin_enquiries
-- Date: 2026-07-04
-- Purpose: Introduce a sequential business lead number (sr_no) that is independent of the primary key (id).

-- 1. Add the column (allowing NULLs temporarily so we can backfill)
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sr_no INTEGER;

-- 2. Create an auto-increment sequence for the new column
CREATE SEQUENCE IF NOT EXISTS walkin_enquiries_sr_no_seq;

-- 3. Backfill existing records with sequential numbers (ordered by the time they were created)
WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) as new_sr_no
    FROM walkin_enquiries
)
UPDATE walkin_enquiries w
SET sr_no = n.new_sr_no
FROM numbered n
WHERE w.id = n.id
AND w.sr_no IS NULL; -- Only backfill if it doesn't already have a value

-- 4. Make the column NOT NULL after backfilling
ALTER TABLE walkin_enquiries ALTER COLUMN sr_no SET NOT NULL;

-- 5. Set the default value for future inserts to use the sequence
ALTER TABLE walkin_enquiries ALTER COLUMN sr_no SET DEFAULT nextval('walkin_enquiries_sr_no_seq');

-- 6. Bind the sequence to the column so it's dropped if the column is dropped
ALTER SEQUENCE walkin_enquiries_sr_no_seq OWNED BY walkin_enquiries.sr_no;

-- 7. Sync the sequence to the current maximum sr_no so new inserts don't fail with duplicate/overlapping IDs
SELECT setval('walkin_enquiries_sr_no_seq', COALESCE((SELECT MAX(sr_no) FROM walkin_enquiries), 1));
