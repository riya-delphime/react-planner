/*
  # Re-apply April 30 Leave Conflicts

  This migration re-adds AL (Annual Leave) status to 4 resources with assignments on April 30.
  These conflicts will trigger alerts in the UI.
*/

-- Add AL status to 4 employees who have assignments on Apr 30
UPDATE resources
SET leave_data = jsonb_set(
  COALESCE(leave_data, '{}'::jsonb),
  '{2025-04-30}',
  '"AL"'::jsonb
)
WHERE id IN (
  SELECT DISTINCT a.resource_id
  FROM assignments a
  INNER JOIN resources r ON r.id = a.resource_id
  WHERE a.date = '2025-04-30'
  AND r.support != 'AV'
  AND (r.leave_data->>'2025-04-30' IS NULL OR r.leave_data->>'2025-04-30' = '')
  ORDER BY a.resource_id
  LIMIT 4
);
