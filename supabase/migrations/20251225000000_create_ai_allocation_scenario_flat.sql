/*
  # Create AI Allocation Scenario Flat View

  This view flattens the api_response JSON from ai_allocation_scenarios table
  into a queryable format with all allocations, schedules, bays, summary, and validation data.

  ## View: ai_scenario_flat
    - Joins allocations with schedules, bay allocations, summary, and validation
    - One row per employee allocation per visit per scenario
*/

-- Drop existing objects if they exist
DROP TRIGGER IF EXISTS trigger_flatten_allocation ON ai_allocation_scenarios;
DROP FUNCTION IF EXISTS flatten_ai_allocation_response();
DROP TABLE IF EXISTS ai_scenario_flat CASCADE;
DROP TABLE IF EXISTS ai_allocation_scenario_summary CASCADE;
DROP TABLE IF EXISTS ai_allocation_scenario_validation CASCADE;
DROP TABLE IF EXISTS ai_allocation_scenario_bay CASCADE;
DROP TABLE IF EXISTS ai_allocation_scenario_retained CASCADE;
DROP TABLE IF EXISTS ai_allocation_scenario_meta CASCADE;
DROP VIEW IF EXISTS ai_scenario_flat CASCADE;

-- Create the flattened view
CREATE OR REPLACE VIEW ai_scenario_flat AS
WITH base AS (
  SELECT t.* FROM ai_allocation_scenarios t
),
alloc AS (
  SELECT
    b.id,
    a.visit_id,
    a."date",
    a.tail_num,
    a.emp_id,
    a.name,
    a.role,
    a.team,
    a.employee_type,
    a.status AS alloc_status,
    a.match_type,
    a.experience_count,
    a.similarity_score,
    a.bay AS alloc_bay,
    a.body_type AS alloc_body_type
  FROM base b
  CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(b.allocations, '[]'::jsonb)) AS a(
    bay text,
    "date" date,
    name text,
    role text,
    team text,
    emp_id text,
    status text,
    tail_num text,
    visit_id int,
    body_type text,
    match_type text,
    employee_type text,
    experience_count int,
    similarity_score numeric
  )
),
sched AS (
  SELECT
    b.id,
    (s.ord - 1)::int AS visit_id,
    s.rec->>'fleet' AS fleet,
    s.rec->>'lic_req' AS lic_req,
    s.rec->>'customer' AS customer,
    s.rec->>'check_type' AS check_type,
    (s.rec->>'induct_date')::date AS induct_date,
    (s.rec->>'ets_date')::date AS ets_date,
    s.rec->>'aircraft_reg' AS aircraft_reg,
    (s.rec->>'min_engineers')::int AS min_engineers,
    (s.rec->>'min_technicians')::int AS min_technicians,
    (s.rec->>'is_from_db')::boolean AS is_from_db,
    s.rec->>'status_category' AS status_category
  FROM base b
  CROSS JOIN LATERAL (
    SELECT ordinality AS ord, value AS rec
    FROM jsonb_array_elements(COALESCE(b.aircraft_schedules, '[]'::jsonb)) WITH ORDINALITY
  ) s
),
bay AS (
  SELECT
    b.id,
    (e.key)::int AS visit_id,
    e.value->>'bay' AS bay,
    e.value->>'status' AS bay_status,
    e.value->>'message' AS bay_message,
    e.value->>'body_type' AS bay_body_type,
    e.value->'alternatives' AS alternatives
  FROM base b
  CROSS JOIN LATERAL jsonb_each(COALESCE(b.bay_allocations, '{}'::jsonb)) e(key, value)
),
summary AS (
  SELECT
    b.id,
    (b.api_response->'summary'->>'total_visits')::int AS sum_total_visits,
    (b.api_response->'summary'->>'primary_employees_used')::int AS sum_primary_employees_used,
    (b.api_response->'summary'->>'technicians_used')::int AS sum_technicians_used,
    (b.api_response->'summary'->>'engineers_fully_staffed')::int AS sum_engineers_fully_staffed,
    (b.api_response->'summary'->>'engineers_partially_staffed')::int AS sum_engineers_partially_staffed,
    (b.api_response->'summary'->>'engineers_understaffed')::int AS sum_engineers_understaffed,
    (b.api_response->'summary'->>'technicians_fully_staffed')::int AS sum_technicians_fully_staffed,
    (b.api_response->'summary'->>'technicians_partially_staffed')::int AS sum_technicians_partially_staffed,
    (b.api_response->'summary'->>'technicians_understaffed')::int AS sum_technicians_understaffed,
    (b.api_response->'summary'->>'ongoing_jobs_count')::int AS sum_ongoing_jobs_count,
    (b.api_response->'summary'->>'retained_resources_count')::int AS sum_retained_resources_count,
    b.api_response->>'reasoning' AS reasoning
  FROM base b
),
val AS (
  SELECT
    b.id,
    (b.validation->>'is_valid')::boolean AS validation_is_valid,
    (b.validation->>'violations_count')::int AS validation_violations_count,
    b.validation->'violations' AS validation_violations
  FROM base b
)
SELECT
  -- Scenario info
  b.id,
  b.scenario_name,
  b.created_at,
  b.updated_at,
  b.status,
  b.total_visits,
  b.total_engineers_allocated,
  b.is_valid,
  b.error_message,

  -- Schedule info
  s.fleet,
  s.lic_req,
  s.customer,
  s.check_type,
  s.induct_date,
  s.ets_date,
  s.aircraft_reg,
  s.min_engineers,
  s.min_technicians,
  s.is_from_db,
  s.status_category,

  -- Bay allocation
  bys.bay AS bay_allocated,
  bys.bay_status,
  bys.bay_message,
  bys.bay_body_type,

  -- Allocation details
  a.visit_id,
  a."date",
  a.tail_num,
  a.emp_id,
  a.name,
  a.role,
  a.team,
  a.employee_type,
  a.alloc_status,
  a.match_type,
  a.experience_count,
  a.similarity_score,
  a.alloc_bay,
  a.alloc_body_type,

  -- Summary metrics
  sm.sum_total_visits,
  sm.sum_primary_employees_used,
  sm.sum_technicians_used,
  sm.sum_engineers_fully_staffed,
  sm.sum_engineers_partially_staffed,
  sm.sum_engineers_understaffed,
  sm.sum_technicians_fully_staffed,
  sm.sum_technicians_partially_staffed,
  sm.sum_technicians_understaffed,
  sm.sum_ongoing_jobs_count,
  sm.sum_retained_resources_count,
  sm.reasoning,

  -- Validation
  v.validation_is_valid,
  v.validation_violations_count,
  v.validation_violations

FROM base b
JOIN alloc a ON a.id = b.id
LEFT JOIN sched s ON s.id = b.id AND s.visit_id = a.visit_id
LEFT JOIN bay bys ON bys.id = b.id AND bys.visit_id = a.visit_id
LEFT JOIN summary sm ON sm.id = b.id
LEFT JOIN val v ON v.id = b.id;

-- Add comment for documentation
COMMENT ON VIEW ai_scenario_flat IS 'Flattened view of AI allocation scenarios - one row per employee allocation per visit';
