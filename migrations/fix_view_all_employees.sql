-- Fix: Recreate view to include ALL employees with roster data for each scenario
-- Not just employees who have assignments

DROP VIEW IF EXISTS engineer_assignment_roster_view;

CREATE OR REPLACE VIEW engineer_assignment_roster_view AS
WITH all_scenarios AS (
  -- Get all completed scenarios
  SELECT
    id as scenario_id,
    scenario_name,
    planning_date
  FROM ai_allocation_scenarios
  WHERE status = 'completed'
),
scenario_allocations AS (
  -- Extract allocations from api_response JSON for each scenario
  SELECT
    ais.id as scenario_id,
    ais.scenario_name,
    ais.planning_date,
    alloc->>'emp_id' as emp_id,
    (alloc->>'date')::date as date,
    COALESCE(alloc->>'tail_num', alloc->>'tailNumber') as tail_number
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
-- Cross join ALL scenarios with ALL roster entries to get complete grid
all_roster_per_scenario AS (
  SELECT
    s.scenario_id,
    s.scenario_name,
    s.planning_date,
    er.id as emp_id,
    er.name as emp_name,
    er.team,
    er.date,
    er.task as roster_code
  FROM all_scenarios s
  CROSS JOIN emp_roster er
)
-- Now merge: roster data with assignments
SELECT
  ar.scenario_id,
  ar.scenario_name,
  ar.planning_date,
  ar.emp_id,
  COALESCE(res.name, ar.emp_name) as emp_name,
  COALESCE(res.team, ar.team) as team,
  COALESCE(res.title, 'ENGR') as title,
  res.core,
  res.support,
  ar.date,
  sa.tail_number as assignment,
  ar.roster_code,
  -- Display value: assignment if exists, otherwise roster
  COALESCE(sa.tail_number, ar.roster_code) as display_value,
  -- Type: 'assignment' or 'roster'
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN ar.roster_code IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM all_roster_per_scenario ar
LEFT JOIN scenario_allocations sa
  ON ar.scenario_id = sa.scenario_id
  AND ar.emp_id = sa.emp_id
  AND ar.date = sa.date
LEFT JOIN resources res
  ON ar.emp_id = res.id
ORDER BY ar.scenario_id, ar.emp_name, ar.date;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_emp_roster_id_date ON emp_roster(id, date);
CREATE INDEX IF NOT EXISTS idx_resources_id ON resources(id);

COMMENT ON VIEW engineer_assignment_roster_view IS
'Complete merged view: ALL employees from roster × ALL scenarios, merged with assignments.
For each scenario and each employee-date, shows assignment if exists, otherwise roster code.
Contains all dates from emp_roster for every completed scenario.';
