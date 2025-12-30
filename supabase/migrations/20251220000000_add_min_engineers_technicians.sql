/*
  # Add Min Engineers and Min Technicians columns

  1. Changes
    - Add min_engineers column (integer, default 1, min 1)
    - Add min_technicians column (integer, default 0)
    - These replace the min_team_size field for more granular control

  2. Migration Strategy
    - Add new columns with defaults
    - Migrate existing data: split min_team_size into engineers (30%) and technicians (70%)
    - Add CHECK constraint for min_engineers >= 1
*/

-- Add new columns to visit_planning_canonical
ALTER TABLE visit_planning_canonical
  ADD COLUMN IF NOT EXISTS min_engineers integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_technicians integer DEFAULT 0;

-- Migrate existing data: derive values from min_team_size
UPDATE visit_planning_canonical
SET
  min_engineers = GREATEST(1, FLOOR(min_team_size * 0.3)::integer),
  min_technicians = GREATEST(0, min_team_size - GREATEST(1, FLOOR(min_team_size * 0.3)::integer))
WHERE min_engineers IS NULL OR min_engineers = 1;

-- Add CHECK constraint for min_engineers >= 1
ALTER TABLE visit_planning_canonical
  DROP CONSTRAINT IF EXISTS min_engineers_at_least_one;

ALTER TABLE visit_planning_canonical
  ADD CONSTRAINT min_engineers_at_least_one CHECK (min_engineers >= 1);

-- Note: If visit_planning_new is a separate table, run the same for it:
-- ALTER TABLE visit_planning_new
--   ADD COLUMN IF NOT EXISTS min_engineers integer DEFAULT 1,
--   ADD COLUMN IF NOT EXISTS min_technicians integer DEFAULT 0;
--
-- UPDATE visit_planning_new
-- SET
--   min_engineers = GREATEST(1, FLOOR(min_team_size * 0.3)::integer),
--   min_technicians = GREATEST(0, min_team_size - GREATEST(1, FLOOR(min_team_size * 0.3)::integer))
-- WHERE min_engineers IS NULL OR min_engineers = 1;
--
-- ALTER TABLE visit_planning_new
--   ADD CONSTRAINT min_engineers_at_least_one CHECK (min_engineers >= 1);