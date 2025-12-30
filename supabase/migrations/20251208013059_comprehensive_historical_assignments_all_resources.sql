/*
  # Comprehensive Historical Assignments for All Resources

  1. Purpose
    - Create assignments for ALL resources for dates Apr 23-30
    - Only skip resources that have leave (AL/SL) on specific dates
    - Ensure ~95% have tail number assignments (5% have leave)
    - Set ~10% of requirements to delayed status for color coding
  
  2. Changes
    - Delete all existing assignments for Apr 23-30
    - Create assignments based on core/support matching when possible
    - For AV and other resources, assign to a distributed set of tails
    - Update requirement statuses so 10% show as delayed
*/

-- Delete existing assignments
DELETE FROM assignments 
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Update requirement statuses for color coding (set ~10% to delayed)
UPDATE requirements
SET status = CASE 
  WHEN (
    (EXTRACT(DAY FROM date) + 
     ASCII(SUBSTRING(tail_number FROM 1 FOR 1)) + 
     LENGTH(tail_number)) % 10
  ) = 0 THEN 'delay_expected'
  ELSE 'on_track'
END
WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30');

-- Create assignments for all resources across all dates
WITH tail_mapping AS (
  SELECT 'AF-TWK' as tail_number, 'TWK' as code, 1 as priority
  UNION ALL SELECT 'AM-RTK', 'RTK', 2
  UNION ALL SELECT 'D-EFGH', 'FGH', 3
  UNION ALL SELECT 'EI-QRS', 'QRS', 4
  UNION ALL SELECT 'F-IJKL', 'JKL', 5
  UNION ALL SELECT 'FK-LMN', 'LMN', 6
  UNION ALL SELECT 'G-ABCD', 'BCD', 7
  UNION ALL SELECT 'N123AB', '3AB', 8
  UNION ALL SELECT 'TC-TUV', 'TUV', 9
  UNION ALL SELECT 'VH-XYZ', 'XYZ', 10
),
date_list AS (
  SELECT unnest(ARRAY[
    '2025-04-23'::date, '2025-04-24'::date, '2025-04-25'::date,
    '2025-04-26'::date, '2025-04-27'::date, '2025-04-30'::date
  ]) AS date_val
),
resource_tail_assignments AS (
  SELECT 
    r.id as resource_id,
    d.date_val,
    COALESCE(
      (SELECT tm.tail_number FROM tail_mapping tm WHERE r.core = tm.code LIMIT 1),
      (SELECT tm.tail_number FROM tail_mapping tm WHERE r.support = tm.code LIMIT 1),
      (SELECT tm.tail_number FROM tail_mapping tm 
       ORDER BY (ASCII(r.id) + tm.priority + EXTRACT(DAY FROM d.date_val)) % 10 
       LIMIT 1)
    ) as assigned_tail
  FROM resources r
  CROSS JOIN date_list d
  WHERE 
    r.leave_data->>(d.date_val::text) IS NULL 
    OR r.leave_data->>(d.date_val::text) NOT IN ('AL', 'SL')
)
INSERT INTO assignments (resource_id, requirement_id, date, role_type)
SELECT 
  rta.resource_id,
  req.id as requirement_id,
  rta.date_val,
  'support'
FROM resource_tail_assignments rta
INNER JOIN requirements req ON req.tail_number = rta.assigned_tail AND req.date = rta.date_val
ON CONFLICT DO NOTHING;
