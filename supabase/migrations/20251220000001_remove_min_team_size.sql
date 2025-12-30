/*
  # Remove min_team_size column from visit_planning_canonical

  1. Changes
    - Drop the min_team_size column from visit_planning_canonical table
    - This column is replaced by min_engineers and min_technicians for more granular control

  2. Notes
    - The min_engineers and min_technicians columns were added in migration 20251220000000
    - Existing data was migrated: min_engineers = 30% of min_team_size, min_technicians = 70%
    - min_engineers has a CHECK constraint ensuring it's >= 1
*/

-- Drop the min_team_size column from visit_planning_canonical
ALTER TABLE visit_planning_canonical
  DROP COLUMN IF EXISTS min_team_size;

-- Update visit_planning_combined view if it exists and references min_team_size
-- Note: If visit_planning_combined or visit_planning_new are views/tables in Supabase
-- that reference min_team_size, they need to be updated as well.

-- Note: visit_planning_combined view is managed separately and should not be modified here
-- The view already exists on the remote database with dependent views
-- Skip modifying it to avoid breaking fact_emp_work_daily and planning_kpi_cube

-- Update visit_planning_new table if it exists
DO $$
BEGIN
  -- Check if visit_planning_new table exists and has min_team_size column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'visit_planning_new'
    AND column_name = 'min_team_size'
  ) THEN
    -- Add min_engineers and min_technicians if they don't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'visit_planning_new'
      AND column_name = 'min_engineers'
    ) THEN
      ALTER TABLE visit_planning_new
        ADD COLUMN min_engineers integer DEFAULT 1,
        ADD COLUMN min_technicians integer DEFAULT 0;

      -- Migrate data
      UPDATE visit_planning_new
      SET
        min_engineers = GREATEST(1, FLOOR(min_team_size * 0.3)::integer),
        min_technicians = GREATEST(0, min_team_size - GREATEST(1, FLOOR(min_team_size * 0.3)::integer))
      WHERE min_engineers = 1 AND min_technicians = 0;
    END IF;

    -- Drop min_team_size column
    ALTER TABLE visit_planning_new
      DROP COLUMN IF EXISTS min_team_size;
  END IF;
END $$;