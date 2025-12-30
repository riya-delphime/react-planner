/*
  # Reset NO-SHOW Status for Demo

  1. Purpose
    - Remove NO-SHOW status from resources who have assignments on April 30
    - This will cause alerts to show on page load for demo purposes
    - Resources without login times and assignments will trigger exception alerts

  2. Changes
    - Remove NO-SHOW status from April 30 leave_data for 16 resources
    - These resources will now show as having assignment conflicts (no login time)
*/

-- Remove NO-SHOW status from April 30 for all resources
UPDATE resources
SET leave_data = leave_data - '2025-04-30'
WHERE leave_data->>'2025-04-30' = 'NO-SHOW';