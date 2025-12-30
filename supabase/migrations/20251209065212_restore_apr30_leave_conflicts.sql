/*
  # Restore April 30 Leave Conflicts for Demo

  This migration restores the original leave conflicts on April 30th by:
  1. Removing all NO-SHOW entries from leave_data for 2025-04-30
  2. Restoring AL (Annual Leave) entries that were changed to SL (Sick Leave)
  
  This ensures alerts and exceptions are visible again after page refresh.
*/

-- Reset leave_data for April 30 to restore conflicts
UPDATE resources
SET leave_data = jsonb_set(
  COALESCE(leave_data, '{}'::jsonb),
  '{2025-04-30}',
  '"AL"'::jsonb
)
WHERE leave_data->>'2025-04-30' = 'SL'
  AND id IN (
    SELECT DISTINCT resource_id 
    FROM assignments 
    WHERE date = '2025-04-30'
  );

-- Remove NO-SHOW entries for April 30
UPDATE resources
SET leave_data = leave_data - '2025-04-30'
WHERE leave_data->>'2025-04-30' = 'NO-SHOW';
