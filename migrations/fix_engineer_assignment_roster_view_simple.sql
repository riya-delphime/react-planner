-- Simple approach: Create separate views for assignments and roster
-- Let the application merge them with proper priority

-- View 1: Scenario assignments
DROP VIEW IF EXISTS scenario_assignments_view;
CREATE OR REPLACE VIEW scenario_assignments_view AS
SELECT
  ais.id as scenario_id,
  ais.scenario_name,
  ais.planning_date,
  alloc->>'emp_id' as emp_id,
  res.name as emp_name,
  res.team,
  res.title,
  res.core,
  res.support,
  (alloc->>'date')::date as date,
  COALESCE(alloc->>'tail_num', alloc->>'tailNumber') as assignment
FROM ai_allocation_scenarios ais,
LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(ais.api_response->'allocations') = 'array'
    THEN ais.api_response->'allocations'
    ELSE '[]'::jsonb
  END
) as alloc
LEFT JOIN resources res ON alloc->>'emp_id' = res.id
WHERE ais.status = 'completed'
AND alloc->>'emp_id' IS NOT NULL
AND alloc->>'date' IS NOT NULL;

-- View 2: Roster with scenario context (replicate for each scenario)
DROP VIEW IF EXISTS scenario_roster_view;
CREATE OR REPLACE VIEW scenario_roster_view AS
SELECT
  s.id as scenario_id,
  s.scenario_name,
  s.planning_date,
  er.id as emp_id,
  res.name as emp_name,
  res.team,
  res.title,
  res.core,
  res.support,
  er.date,
  er.task as roster_code
FROM emp_roster er
CROSS JOIN (
  SELECT id, scenario_name, planning_date
  FROM ai_allocation_scenarios
  WHERE status = 'completed'
) s
LEFT JOIN resources res ON er.id = res.id
WHERE res.title = 'ENGR';  -- Only engineers

-- Combined view
DROP VIEW IF EXISTS engineer_assignment_roster_view;
CREATE OR REPLACE VIEW engineer_assignment_roster_view AS
SELECT
  COALESCE(sa.scenario_id, sr.scenario_id) as scenario_id,
  COALESCE(sa.scenario_name, sr.scenario_name) as scenario_name,
  COALESCE(sa.planning_date, sr.planning_date) as planning_date,
  COALESCE(sa.emp_id, sr.emp_id) as emp_id,
  COALESCE(sa.emp_name, sr.emp_name) as emp_name,
  COALESCE(sa.team, sr.team) as team,
  COALESCE(sa.title, sr.title) as title,
  COALESCE(sa.core, sr.core) as core,
  COALESCE(sa.support, sr.support) as support,
  COALESCE(sa.date, sr.date) as date,
  sa.assignment,
  sr.roster_code,
  COALESCE(sa.assignment, sr.roster_code) as display_value,
  CASE
    WHEN sa.assignment IS NOT NULL THEN 'assignment'
    WHEN sr.roster_code IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM scenario_roster_view sr
LEFT JOIN scenario_assignments_view sa
  ON sr.scenario_id = sa.scenario_id
  AND sr.emp_id = sa.emp_id
  AND sr.date = sa.date
WHERE COALESCE(sa.assignment, sr.roster_code) IS NOT NULL;

COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view showing assignments and roster codes. Assignment takes priority over roster.';
