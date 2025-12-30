-- Fix: Recreate view to properly include roster-only dates for each scenario
-- Problem: Previous view only showed dates with assignments
-- Solution: For each scenario, include ALL roster dates for employees in that scenario

DROP VIEW IF EXISTS engineer_assignment_roster_view;

CREATE OR REPLACE VIEW engineer_assignment_roster_view AS
WITH scenario_allocations AS (
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
scenario_employees AS (
  -- Get unique employees per scenario
  SELECT DISTINCT
    scenario_id,
    scenario_name,
    planning_date,
    emp_id
  FROM scenario_allocations
),
-- For each scenario, get ALL roster dates for employees in that scenario
scenario_roster AS (
  SELECT
    se.scenario_id,
    se.scenario_name,
    se.planning_date,
    er.id as emp_id,
    er.date,
    er.task as roster_code
  FROM scenario_employees se
  JOIN emp_roster er ON se.emp_id = er.id
)
-- Combine allocations with roster data
SELECT
  COALESCE(sr.scenario_id, sa.scenario_id) as scenario_id,
  COALESCE(sr.scenario_name, sa.scenario_name) as scenario_name,
  COALESCE(sr.planning_date, sa.planning_date) as planning_date,
  COALESCE(sr.emp_id, sa.emp_id) as emp_id,
  res.name as emp_name,
  res.team,
  res.title,
  res.core,
  res.support,
  COALESCE(sr.date, sa.date) as date,
  sa.tail_number as assignment,
  sr.roster_code,
  COALESCE(sa.tail_number, sr.roster_code) as display_value,
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN sr.roster_code IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM scenario_roster sr
FULL OUTER JOIN scenario_allocations sa
  ON sr.scenario_id = sa.scenario_id
  AND sr.emp_id = sa.emp_id
  AND sr.date = sa.date
LEFT JOIN resources res
  ON COALESCE(sr.emp_id, sa.emp_id) = res.id
WHERE COALESCE(sr.scenario_id, sa.scenario_id) IS NOT NULL
ORDER BY scenario_id, emp_name, date;

COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view showing assignments and roster codes for each scenario.
For each scenario, includes ALL roster dates for employees in that scenario,
not just dates with assignments. Assignment takes priority over roster in display_value.';
