-- Fix: Simple UNION approach - much faster
-- Combine roster rows with allocation rows, let application handle merging

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
)
-- Combine allocations with roster data
SELECT
  sa.scenario_id,
  sa.scenario_name,
  sa.planning_date,
  sa.emp_id,
  res.name as emp_name,
  res.team,
  res.title,
  res.core,
  res.support,
  sa.date,
  sa.tail_number as assignment,
  er.task as roster_code,
  COALESCE(sa.tail_number, er.task) as display_value,
  CASE
    WHEN sa.tail_number IS NOT NULL THEN 'assignment'
    WHEN er.task IS NOT NULL THEN 'roster'
    ELSE NULL
  END as value_type
FROM scenario_allocations sa
LEFT JOIN resources res ON sa.emp_id = res.id
LEFT JOIN emp_roster er ON sa.emp_id = er.id AND sa.date = er.date

UNION ALL

-- Also include roster-only dates (where there's NO assignment)
SELECT
  s.scenario_id,
  s.scenario_name,
  s.planning_date,
  er.id as emp_id,
  res.name as emp_name,
  res.team,
  res.title,
  res.core,
  res.support,
  er.date,
  NULL as assignment,
  er.task as roster_code,
  er.task as display_value,
  'roster' as value_type
FROM emp_roster er
CROSS JOIN (
  SELECT DISTINCT id as scenario_id, scenario_name, planning_date
  FROM ai_allocation_scenarios
  WHERE status = 'completed'
) s
LEFT JOIN resources res ON er.id = res.id
WHERE NOT EXISTS (
  -- Exclude if there's already an assignment for this emp/date/scenario
  SELECT 1
  FROM scenario_allocations sa2
  WHERE sa2.scenario_id = s.scenario_id
  AND sa2.emp_id = er.id
  AND sa2.date = er.date
)
AND res.title = 'ENGR'  -- Only engineers

ORDER BY scenario_id, emp_name, date;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_emp_roster_id_date ON emp_roster(id, date);

-- Add comment
COMMENT ON VIEW engineer_assignment_roster_view IS
'Merged view of roster data and AI scenario allocations.
Shows assignments where they exist, roster codes otherwise.
Uses UNION to combine assignment dates with roster-only dates.';
