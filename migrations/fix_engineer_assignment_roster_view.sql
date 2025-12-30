-- Fix: Recreate engineer_assignment_roster_view to properly merge ALL roster dates with assignments
-- The issue: Previous view only showed dates with assignments, missing roster-only dates

DROP VIEW IF EXISTS engineer_assignment_roster_view;

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
all_scenarios AS (
  -- Get all completed scenarios
  SELECT DISTINCT
    id as scenario_id,
    scenario_name,
    planning_date
  FROM ai_allocation_scenarios
  WHERE status = 'completed'
),
all_employees AS (
  -- Get all employees from resources
  SELECT
    id as emp_id,
    name as emp_name,
    team,
    title,
    core,
    support
  FROM resources
  WHERE title = 'ENGR'  -- Only engineers
),
all_roster_dates AS (
  -- Get all unique dates from roster
  SELECT DISTINCT date
  FROM emp_roster
  ORDER BY date
),
-- Cross join to create all possible combinations of scenario + employee + date
base_grid AS (
  SELECT
    s.scenario_id,
    s.scenario_name,
    s.planning_date,
    e.emp_id,
    e.emp_name,
    e.team,
    e.title,
    e.core,
    e.support,
    d.date
  FROM all_scenarios s
  CROSS JOIN all_employees e
  CROSS JOIN all_roster_dates d
)
-- Now merge with actual roster and allocation data
SELECT
  bg.scenario_id,
  bg.scenario_name,
  bg.planning_date,
  bg.emp_id,
  bg.emp_name,
  bg.team,
  bg.title,
  bg.core,
  bg.support,
  bg.date,
  sa.tail_number as assignment,
  er.task as roster_code,
  -- Display value: assignment if exists, otherwise roster
  COALESCE(sa.tail_number, er.task) as display_value,
  -- Type: 'assignment' or 'roster' or NULL
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN er.task IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM base_grid bg
LEFT JOIN scenario_allocations sa
  ON bg.scenario_id = sa.scenario_id
  AND bg.emp_id = sa.emp_id
  AND bg.date = sa.date
LEFT JOIN emp_roster er
  ON bg.emp_id = er.id
  AND bg.date = er.date
WHERE COALESCE(sa.tail_number, er.task) IS NOT NULL  -- Only include rows with data
ORDER BY bg.scenario_id, bg.emp_name, bg.date;

-- Add comment
COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view of roster data and AI scenario allocations for Engineer Assignment Chart.
Shows assignments (tail numbers) where they exist, roster codes otherwise.
Includes ALL dates and ALL employees with either assignment or roster data.';
