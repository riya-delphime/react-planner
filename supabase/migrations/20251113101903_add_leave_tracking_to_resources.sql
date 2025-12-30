/*
  # Add Leave Tracking to Resources

  1. Changes
    - Add `leave_data` JSONB column to resources table to track leave information
    - This will store leave types (AL for Annual Leave, SL for Sick Leave) and dates
    - Flexible structure to handle multiple leave periods per employee
  
  2. Security
    - No changes to RLS policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resources' AND column_name = 'leave_data'
  ) THEN
    ALTER TABLE resources ADD COLUMN leave_data JSONB DEFAULT '{}';
  END IF;
END $$;