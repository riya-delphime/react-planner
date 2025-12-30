-- Migration: Add planning_date and create engineer_assignment_roster_view
-- Purpose: Merge roster data with AI scenario allocations for Engineer Assignment Chart

-- Step 1: Add planning_date column to ai_allocation_scenarios table
ALTER TABLE ai_allocation_scenarios
ADD COLUMN IF NOT EXISTS planning_date DATE DEFAULT '2022-04-30';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_planning_date
ON ai_allocation_scenarios(planning_date);

-- Step 2: Create or replace the engineer assignment roster view
-- This view merges roster data from emp_roster with AI scenario allocations
-- For May 2022: Shows assignments where they exist, roster codes otherwise
CREATE OR REPLACE VIEW engineer_assignment_roster_view AS
WITH scenario_allocations AS (
  -- Extract allocations from api_response JSON for each scenario
  SELECT
    ais.id as scenario_id,
    ais.scenario_name,
    ais.planning_date,
    ais.status,
    alloc->>'emp_id' as emp_id,
    (alloc->>'date')::date as date,
    COALESCE(alloc->>'tail_num', alloc->>'tailNumber') as tail_number,
    alloc->>'role' as role,
    alloc->>'name' as emp_name_from_alloc
  FROM ai_allocation_scenarios ais,
  LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(ais.api_response->'allocations') = 'array'
      THEN ais.api_response->'allocations'
      ELSE '[]'::jsonb
    END
  ) as alloc
  WHERE ais.status = 'completed'
  AND alloc->>'emp_id' IS NOT NULL
  AND alloc->>'date' IS NOT NULL
),
roster_base AS (
  -- Get roster data for all employees
  SELECT
    er.id as emp_id,
    er.name as emp_name,
    er.date,
    er.task as roster_code,
    er.team
  FROM emp_roster er
  -- Include all roster data (no date filter - let the application filter as needed)
)
-- Merge roster with allocations for each scenario
SELECT
  sa.scenario_id,
  sa.scenario_name,
  sa.planning_date,
  COALESCE(r.emp_id, sa.emp_id) as emp_id,
  COALESCE(res.name, r.emp_name, sa.emp_name_from_alloc) as emp_name,
  COALESCE(res.team, r.team) as team,
  COALESCE(res.title, 'ENGR') as title,
  res.core,
  res.support,
  COALESCE(r.date, sa.date) as date,
  sa.tail_number as assignment,
  r.roster_code,
  -- Display value: assignment if exists, otherwise roster
  COALESCE(sa.tail_number, r.roster_code) as display_value,
  -- Type: 'assignment' or 'roster'
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN r.roster_code IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM roster_base r
FULL OUTER JOIN scenario_allocations sa
  ON r.emp_id = sa.emp_id AND r.date = sa.date
LEFT JOIN resources res
  ON COALESCE(r.emp_id, sa.emp_id) = res.id
WHERE COALESCE(r.emp_id, sa.emp_id) IS NOT NULL
  AND COALESCE(r.date, sa.date) IS NOT NULL
ORDER BY scenario_id, emp_name, date;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_emp_roster_date_id
ON emp_roster(date, id);

CREATE INDEX IF NOT EXISTS idx_resources_id
ON resources(id);

-- Add comment to explain the view
COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view of roster data and AI scenario allocations for Engineer Assignment Chart.
Shows assignments (tail numbers) where they exist, roster codes otherwise.
Focused on May 2022 for AI scenario planning.';
