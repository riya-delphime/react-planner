/*
  # Create emp_360 View - Comprehensive Employee Profile

  This view aggregates employee data from multiple tables to provide a 360-degree
  view of each employee for the Daily Planning page.

  ## Source Tables:
  - emp_master: id, name, doj (date of joining), title, profitCenter
  - emp_lic: id, aircraft, engine, lic, date_of_issue, status, map_key
  - emp_leaves: id, date, AL_leave_balance, SL_leave_balance
  - emp_trainings: id, training_name, start_date, end_date
  - emp_roster: id, name, mobile, team, date, task, createdAt
  - df_actual: id, name, mobile, team, date, task (tail numbers)
  - emp_planned: id, task_type, task, date (planned-core, planned-support)
  - visit_details: To derive aircraft types from tail numbers

  ## Reference Date: Configurable via get_reference_date() function
*/

-- ============================================================================
-- REFERENCE DATE CONFIGURATION
-- Change this single value to update the reference date across all views
-- ============================================================================
CREATE OR REPLACE FUNCTION get_reference_date()
RETURNS date AS $$
BEGIN
  RETURN '2022-04-30'::date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create safe_to_date function for text input
CREATE OR REPLACE FUNCTION safe_to_date(date_str text)
RETURNS date AS $$
BEGIN
  -- Try YYYY-MM-DD format first
  BEGIN
    RETURN date_str::date;
  EXCEPTION WHEN others THEN
    -- Try DD/MM/YYYY format
    BEGIN
      RETURN TO_DATE(date_str, 'DD/MM/YYYY');
    EXCEPTION WHEN others THEN
      -- Try D/M/YY format
      BEGIN
        RETURN TO_DATE(date_str, 'D/M/YY');
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
    END;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create safe_to_date overload for date input (passthrough)
CREATE OR REPLACE FUNCTION safe_to_date(date_val date)
RETURNS date AS $$
BEGIN
  RETURN date_val;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop existing view if it exists
DROP VIEW IF EXISTS emp_360;

-- Create the comprehensive employee 360 view
CREATE VIEW emp_360 AS
WITH
  -- Base employee data from emp_master (ensure one row per employee)
  emp_base AS (
    SELECT DISTINCT ON (em.id)
      em.id AS emp_id,
      em.name AS emp_name,
      em.title,
      em."profitCenter" AS profit_center,
      em.doj AS date_of_joining,
      CASE
        WHEN em.doj IS NOT NULL AND em.doj != ''
        THEN EXTRACT(YEAR FROM AGE(get_reference_date(), safe_to_date(em.doj)))::integer
        ELSE 0
      END AS years_of_experience
    FROM emp_master em
    ORDER BY em.id
  ),

  -- Get team assignment from emp_roster (most recent entry per employee)
  emp_team AS (
    SELECT DISTINCT ON (er.id)
      er.id AS emp_id,
      er.team
    FROM emp_roster er
    WHERE er.team IS NOT NULL AND er.team != ''
    ORDER BY er.id, safe_to_date(er.date) DESC NULLS LAST
  ),

  -- Aggregate licenses per employee (format: AIRCRAFT-ENGINE-LIC)
  emp_licenses_agg AS (
    SELECT
      el.id AS emp_id,
      ARRAY_AGG(DISTINCT CONCAT_WS('-', el.aircraft, el.engine, el.lic))
        FILTER (WHERE el.aircraft IS NOT NULL) AS licenses,
      COUNT(DISTINCT el.map_key) AS license_count
    FROM emp_lic el
    WHERE el.status IS NULL OR el.status != 'Expired'
    GROUP BY el.id
  ),

  -- Note: df_actual table may not exist on all environments
  -- Most worked aircraft feature is disabled until df_actual is available
  -- emp_most_worked placeholder returns empty set
  emp_most_worked AS (
    SELECT
      NULL::text AS emp_id,
      NULL::text AS most_worked_aircraft
    WHERE false
  ),

  -- Get leave balances from emp_leaves (most recent record per employee)
  -- Note: emp_leaves uses 'id' column, not 'emp_id'
  emp_leave_balance AS (
    SELECT DISTINCT ON (el.id)
      el.id AS emp_id,
      COALESCE(el."AL_leave_balance", 0) AS al_balance,
      COALESCE(el."SL_leave_balance", 0) AS sl_balance,
      (COALESCE(el."AL_leave_balance", 0) + COALESCE(el."SL_leave_balance", 0)) AS total_leave_balance
    FROM emp_leaves el
    ORDER BY el.id, safe_to_date(el.date) DESC NULLS LAST
  ),

  -- Count upcoming leaves from emp_roster (task = 'AL' or 'SL' beyond reference date)
  emp_upcoming_leaves AS (
    SELECT
      er.id AS emp_id,
      COUNT(*) AS upcoming_leaves_count
    FROM emp_roster er
    WHERE er.task IN ('AL', 'SL')
      AND safe_to_date(er.date) > get_reference_date()
      AND safe_to_date(er.date) <= get_reference_date() + INTERVAL '14 days'
    GROUP BY er.id
  ),

  -- Aggregate trainings from emp_trainings
  -- Note: emp_trainings uses 'id' column, not 'emp_id'
  emp_training_summary AS (
    SELECT
      et.id AS emp_id,
      ARRAY_AGG(DISTINCT et.training_name ORDER BY et.training_name)
        FILTER (WHERE safe_to_date(et.start_date) > get_reference_date()
                AND safe_to_date(et.start_date) <= get_reference_date() + INTERVAL '14 days')
        AS upcoming_trainings,
      COUNT(DISTINCT et.training_name)
        FILTER (WHERE safe_to_date(et.start_date) > get_reference_date()
                AND safe_to_date(et.start_date) <= get_reference_date() + INTERVAL '14 days')
        AS upcoming_trainings_count
    FROM emp_trainings et
    GROUP BY et.id
  ),

  -- Get planned core assignment for reference date
  emp_planned_core AS (
    SELECT DISTINCT ON (ep.id)
      ep.id AS emp_id,
      ep.task AS planned_core
    FROM emp_planned ep
    WHERE ep.task_type = 'planned-core'
      AND safe_to_date(ep.date) = get_reference_date()
    ORDER BY ep.id
  ),

  -- Get planned support assignment for reference date
  emp_planned_support AS (
    SELECT DISTINCT ON (ep.id)
      ep.id AS emp_id,
      ep.task AS planned_support
    FROM emp_planned ep
    WHERE ep.task_type = 'planned-support'
      AND safe_to_date(ep.date) = get_reference_date()
    ORDER BY ep.id
  )

-- Final SELECT combining all CTEs
SELECT
  -- Employee Identity
  eb.emp_id,
  eb.emp_name,
  eb.title,
  eb.profit_center,
  eb.date_of_joining,
  COALESCE(eteam.team, 'Unassigned') AS team,

  -- Experience & Skills
  eb.years_of_experience,
  COALESCE(emw.most_worked_aircraft, 'N/A') AS most_worked_aircraft,

  -- License Information
  COALESCE(ela.licenses, ARRAY[]::text[]) AS licenses,
  COALESCE(ela.license_count, 0)::integer AS license_count,

  -- Leave & Availability
  COALESCE(elb.al_balance, 0)::integer AS al_leave_balance,
  COALESCE(elb.sl_balance, 0)::integer AS sl_leave_balance,
  COALESCE(elb.total_leave_balance, 0)::integer AS total_leave_balance,
  COALESCE(eul.upcoming_leaves_count, 0)::integer AS upcoming_leaves_count,

  -- Trainings
  COALESCE(ets.upcoming_trainings, ARRAY[]::text[]) AS upcoming_trainings,
  COALESCE(ets.upcoming_trainings_count, 0)::integer AS upcoming_trainings_count,

  -- Planned Assignments for reference date
  COALESCE(epc.planned_core, '') AS planned_core,
  COALESCE(eps.planned_support, '') AS planned_support

FROM emp_base eb
LEFT JOIN emp_team eteam ON eb.emp_id = eteam.emp_id
LEFT JOIN emp_licenses_agg ela ON eb.emp_id = ela.emp_id
LEFT JOIN emp_most_worked emw ON eb.emp_id = emw.emp_id
LEFT JOIN emp_leave_balance elb ON eb.emp_id = elb.emp_id
LEFT JOIN emp_upcoming_leaves eul ON eb.emp_id = eul.emp_id
LEFT JOIN emp_training_summary ets ON eb.emp_id = ets.emp_id
LEFT JOIN emp_planned_core epc ON eb.emp_id = epc.emp_id
LEFT JOIN emp_planned_support eps ON eb.emp_id = eps.emp_id;

-- Grant access to the view
GRANT SELECT ON emp_360 TO anon, authenticated;

-- Add comment documenting the view
COMMENT ON VIEW emp_360 IS 'Comprehensive 360-degree employee profile aggregating data from emp_master, emp_lic, emp_leaves, emp_trainings, emp_roster, df_actual, and emp_planned tables. Reference date configured via get_reference_date() function.';