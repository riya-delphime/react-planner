/*
  # Add Leave Conflicts for Demo

  1. Purpose
    - Add AL (Annual Leave) status to 4 resources with assignments on April 30
    - This creates leave conflicts that will show in the alerts bar
    - These conflicts can be resolved with the Fix All button

  2. Changes
    - Mark 4 assigned resources as having AL on April 30
    - These will trigger "leave update" alerts in the UI
*/

-- Add AL status to 4 employees who have assignments on Apr 30
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
    AND r2.leave_data->>'2025-04-30' IS NOT NULL
  )
  ORDER BY a.resource_id
  LIMIT 4
);