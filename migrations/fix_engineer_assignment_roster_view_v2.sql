-- Fix: Recreate engineer_assignment_roster_view - more efficient approach
-- Only include employee-date combinations that actually have roster or assignment data

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
-- For each scenario, get all employee-dates from roster that match employees in that scenario
scenario_roster_data AS (
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
  CROSS JOIN LATERAL (
    -- Get roster data only for employees that have assignments in this scenario
    SELECT DISTINCT sa2.emp_id
    FROM scenario_allocations sa2
    WHERE sa2.scenario_id = s.scenario_id
  ) scenario_emps
  JOIN emp_roster er ON er.id = scenario_emps.emp_id
)
-- Combine roster data with allocations
SELECT
  COALESCE(srd.scenario_id, sa.scenario_id) as scenario_id,
  COALESCE(srd.scenario_name, sa.scenario_name) as scenario_name,
  COALESCE(srd.planning_date, sa.planning_date) as planning_date,
  COALESCE(srd.emp_id, sa.emp_id) as emp_id,
  COALESCE(res.name, srd.emp_name, sa.emp_name_from_alloc) as emp_name,
  COALESCE(res.team, srd.team) as team,
  COALESCE(res.title, 'ENGR') as title,
  res.core,
  res.support,
  COALESCE(srd.date, sa.date) as date,
  sa.tail_number as assignment,
  srd.roster_code,
  -- Display value: assignment if exists, otherwise roster
  COALESCE(sa.tail_number, srd.roster_code) as display_value,
  -- Type: 'assignment' or 'roster'
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN srd.roster_code IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM scenario_roster_data srd
FULL OUTER JOIN scenario_allocations sa
  ON srd.scenario_id = sa.scenario_id
  AND srd.emp_id = sa.emp_id
  AND srd.date = sa.date
LEFT JOIN resources res
  ON COALESCE(srd.emp_id, sa.emp_id) = res.id
WHERE COALESCE(sa.tail_number, srd.roster_code) IS NOT NULL
ORDER BY scenario_id, emp_name, date;

-- Add comment
COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view of roster data and AI scenario allocations for Engineer Assignment Chart.
Shows assignments (tail numbers) where they exist, roster codes otherwise.
Includes dates where employees have either roster or assignment data.';
