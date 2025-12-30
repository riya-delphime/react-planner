/*
  # Fill Historical Assignments for Apr 23-30

  1. Purpose
    - Create comprehensive assignments for all dates from Apr 23-30
    - Ensure most cells have tail number assignments (not empty)
    - Only ~5% should have leave (AL/SL)
  
  2. Approach
    - Delete existing assignments for these dates
    - Create assignments for each resource on each day
    - Match resources to tails based on core/support
    - Skip only if resource has leave on that specific day
*/

-- Delete existing assignments for these dates
DELETE FROM assignments 
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Create comprehensive assignments
WITH tail_mapping AS (
  SELECT 'AF-TWK' as tail_number, 'TWK' as code
  UNION ALL SELECT 'AM-RTK', 'RTK'
  UNION ALL SELECT 'D-EFGH', 'FGH'
  UNION ALL SELECT 'EI-QRS', 'QRS'
  UNION ALL SELECT 'F-IJKL', 'JKL'
  UNION ALL SELECT 'FK-LMN', 'LMN'
  UNION ALL SELECT 'G-ABCD', 'BCD'
  UNION ALL SELECT 'N123AB', '3AB'
  UNION ALL SELECT 'TC-TUV', 'TUV'
  UNION ALL SELECT 'VH-XYZ', 'XYZ'
),
date_list AS (
  SELECT unnest(ARRAY[
    '2025-04-23'::date, '2025-04-24'::date, '2025-04-25'::date,
    '2025-04-26'::date, '2025-04-27'::date, '2025-04-30'::date
  ]) AS date_val
),
resource_assignments AS (
  SELECT 
    r.id as resource_id,
    r.title,
    r.core,
    r.support,
    tm.tail_number,
    d.date_val,
    req.id as requirement_id
  FROM resources r
  CROSS JOIN date_list d
  INNER JOIN tail_mapping tm ON (r.core = tm.code OR r.support = tm.code)
  INNER JOIN requirements req ON req.tail_number = tm.tail_number AND req.date = d.date_val
  WHERE 
    -- Only skip if resource has leave on that specific day
    (r.leave_data->>(d.date_val::text) IS NULL 
     OR r.leave_data->>(d.date_val::text) NOT IN ('AL', 'SL'))
    -- Only exclude AV resources
    AND r.core != 'AV' AND r.support != 'AV'
)
INSERT INTO assignments (resource_id, requirement_id, date, role_type)
SELECT DISTINCT
  resource_id,
  requirement_id,
  date_val,
  'support'
FROM resource_assignments;
