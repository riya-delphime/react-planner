/*
  # Update Leave Data and Create Conflicts

  1. Purpose
    - Remove all SL entries from May 1
    - Ensure AL on Apr 30 carries over to May 1
    - Create 4 employees who have assignments on Apr 30 but are also on leave (conflicts)
  
  2. Changes
    - Update resources to remove SL from May 1
    - Add AL to May 1 for employees who have AL on Apr 30
    - Create conflicts by marking 4 assigned employees as having leave on Apr 30
*/

-- First, let's identify 4 employees who have assignments on Apr 30 and add leave conflicts
UPDATE resources
SET leave_data = jsonb_set(
  COALESCE(leave_data, '{}'::jsonb),
  '{2025-04-30}',
  '"AL"'
)
WHERE id IN (
  SELECT DISTINCT a.resource_id
  FROM assignments a
  WHERE a.date = '2025-04-30'
  AND NOT EXISTS (
    SELECT 1 FROM resources r2 
    WHERE r2.id = a.resource_id 
    AND r2.leave_data->>'2025-04-30' IN ('AL', 'SL')
  )
  ORDER BY a.resource_id
  LIMIT 4
);

-- For all employees with AL on Apr 30, add AL to May 1
UPDATE resources
SET leave_data = jsonb_set(
  leave_data,
  '{2025-05-01}',
  '"AL"'
)
WHERE leave_data->>'2025-04-30' = 'AL';

-- Remove all SL entries from May 1
UPDATE resources
SET leave_data = leave_data - '2025-05-01'
WHERE leave_data->>'2025-05-01' = 'SL';
