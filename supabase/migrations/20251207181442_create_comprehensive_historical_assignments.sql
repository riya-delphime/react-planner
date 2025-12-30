/*
  # Create Comprehensive Historical Assignments for Apr 23-30

  1. Purpose
    - Create historical assignments for all dates from Apr 23-30
    - Assign resources to tail numbers where core/support matches last 3 characters
    - Ensure all tail numbers have assignments across all days
  
  2. Approach
    - Delete existing historical assignments
    - Create requirements for all dates
    - Assign resources based on core/support matching tail numbers
    - Distribute assignments across all staff and days
*/

-- Delete existing assignments for these dates
DELETE FROM assignments 
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Delete existing requirements for these dates
DELETE FROM requirements 
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Create requirements for Apr 23-30 (all 10 tail numbers for each day)
INSERT INTO requirements (tail_number, tail_details, date, status)
SELECT 
  tail_number,
  tail_number || ' (Historical)',
  date_val,
  'on_track'
FROM (
  SELECT unnest(ARRAY[
    'AF-TWK', 'AM-RTK', 'D-EFGH', 'EI-QRS', 'F-IJKL', 
    'FK-LMN', 'G-ABCD', 'N123AB', 'TC-TUV', 'VH-XYZ'
  ]) AS tail_number
) tails
CROSS JOIN (
  SELECT unnest(ARRAY[
    '2025-04-23'::date, '2025-04-24'::date, '2025-04-25'::date,
    '2025-04-26'::date, '2025-04-27'::date, '2025-04-30'::date
  ]) AS date_val
) dates;

-- Create assignments by matching resources to tail numbers
-- Each resource will be assigned to a tail that matches their core/support
WITH tail_mapping AS (
  SELECT 
    'AF-TWK' as tail_number, 'TWK' as code
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
  CROSS JOIN (
    SELECT unnest(ARRAY[
      '2025-04-23'::date, '2025-04-24'::date, '2025-04-25'::date,
      '2025-04-26'::date, '2025-04-27'::date, '2025-04-30'::date
    ]) AS date_val
  ) d
  LEFT JOIN tail_mapping tm ON (r.core = tm.code OR r.support = tm.code)
  LEFT JOIN requirements req ON req.tail_number = tm.tail_number AND req.date = d.date_val
  WHERE 
    -- Skip if resource has leave on that day
    (r.leave_data->>(d.date_val::text) IS NULL 
     OR r.leave_data->>(d.date_val::text) NOT IN ('AL', 'SL'))
    -- Only assign if core/support matches a tail
    AND tm.tail_number IS NOT NULL
    -- Randomly assign only some resources each day (60-80% assignment rate)
    AND RANDOM() > 0.3
)
INSERT INTO assignments (resource_id, requirement_id, date, role_type)
SELECT 
  resource_id,
  requirement_id,
  date_val,
  'support'
FROM resource_assignments
WHERE requirement_id IS NOT NULL;
