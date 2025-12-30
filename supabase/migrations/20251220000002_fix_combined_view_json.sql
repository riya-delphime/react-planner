/*
  # Fix visit_planning_combined view to include date_counts and date_bay from visit_planning

  1. Changes
    - Join visit_details with visit_planning on visit_number
    - Pull date_counts (daywise resource requirements) and date_bay (bay day-wise allocation)
    - Handle Python dict format (single quotes) by converting to valid JSON (double quotes)
    - Calculate status dynamically based on current date (fixed to April 30, 2022)

  2. Notes
    - The date_counts and date_bay columns use Python dict format with single quotes
    - We use REPLACE() to convert single quotes to double quotes for valid JSON
    - Using CREATE OR REPLACE to avoid dropping dependent views (fact_emp_work_daily, planning_kpi_cube)
*/

-- Use CREATE OR REPLACE to preserve dependent views
CREATE OR REPLACE VIEW visit_planning_combined AS
SELECT
  vd.visit_number::text as visit_id,
  COALESCE(vd.po_confirmed, false) as po_confirmed,
  vd.po_number,
  vd.tail_num,
  COALESCE(vd.customer, vd.airline) as customer,
  vd.check_type,
  -- Calculate status dynamically based on fixed date April 30, 2022
  CASE
    WHEN '2022-04-30'::date > vd.end_date::date THEN 'Completed'
    WHEN '2022-04-30'::date >= vd.start_date::date AND '2022-04-30'::date <= vd.end_date::date THEN 'Ongoing'
    ELSE 'Upcoming'
  END as status,
  vd.notes,
  vd.aircraft_clean as aircraft,
  vd.engine_clean as engine,
  vd.lic as lic_req,
  vd.license_authorities,
  vd.tooling_constraints,
  vd.start_date::date as induction_date,
  vd.end_date::date as ets_date,
  COALESCE(vd.min_engineers, 1) as min_engineers,
  COALESCE(vd.min_technicians, 0) as min_technicians,
  -- Use date_counts from visit_planning, converting single quotes to double quotes for valid JSON
  -- Prioritize visit_planning data since visit_details daywise_resc is empty
  CASE
    WHEN vp.date_counts IS NOT NULL AND vp.date_counts != '' AND vp.date_counts != '{}'
      THEN REPLACE(vp.date_counts, '''', '"')::jsonb
    WHEN vd.daywise_resc IS NOT NULL AND jsonb_array_length(vd.daywise_resc) > 0
      THEN vd.daywise_resc
    ELSE '[]'::jsonb
  END as daywise_resc,
  COALESCE(vd.bay, vd.bay_alloc) as bay_alloc,
  -- Use date_bay from visit_planning, converting single quotes to double quotes for valid JSON
  -- Prioritize visit_planning data since visit_details bay_daywise is empty
  CASE
    WHEN vp.date_bay IS NOT NULL AND vp.date_bay != '' AND vp.date_bay != '{}'
      THEN REPLACE(vp.date_bay, '''', '"')::jsonb
    WHEN vd.bay_daywise IS NOT NULL AND jsonb_array_length(vd.bay_daywise) > 0
      THEN vd.bay_daywise
    ELSE '[]'::jsonb
  END as bay_daywise,
  vd.date_created,
  vd.record_timestamp,
  'canonical' as source
FROM visit_details vd
LEFT JOIN visit_planning vp ON vd.visit_number = vp.visit_number;

-- Grant access to the view
GRANT SELECT ON visit_planning_combined TO anon, authenticated;