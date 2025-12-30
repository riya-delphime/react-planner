/*
  # Recreate Historical Assignments with Proper Distribution

  1. Purpose
    - Recreate assignments for Apr 23-30 with proper tail code distribution
    - Ensure all tail numbers have assignments spread across days
  
  2. Approach
    - Delete existing assignments
    - Create new assignments matching resources to tails based on core/support
*/

-- Delete existing assignments for these dates
DELETE FROM assignments 
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Create assignments by matching resources to tail numbers
-- Each resource will be assigned to a tail that matches their core/support
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
resource_tail_matches AS (
  SELECT 
    r.id as resource_id,
    r.title,
    r.core,
    r.support,
    tm.tail_number,
    d.date_val,
    req.id as requirement_id,
    ROW_NUMBER() OVER (PARTITION BY r.id, d.date_val ORDER BY RANDOM()) as rn
  FROM resources r
  CROSS JOIN date_list d
  INNER JOIN tail_mapping tm ON (r.core = tm.code OR r.support = tm.code)
  INNER JOIN requirements req ON req.tail_number = tm.tail_number AND req.date = d.date_val
  WHERE 
    -- Skip if resource has leave on that day
    (r.leave_data->>(d.date_val::text) IS NULL 
     OR r.leave_data->>(d.date_val::text) NOT IN ('AL', 'SL'))
    -- Randomly assign only some resources each day (60-80% assignment rate)
    AND RANDOM() > 0.25
)
INSERT INTO assignments (resource_id, requirement_id, date, role_type)
SELECT 
  resource_id,
  requirement_id,
  date_val,
  'support'
FROM resource_tail_matches
WHERE rn = 1;
