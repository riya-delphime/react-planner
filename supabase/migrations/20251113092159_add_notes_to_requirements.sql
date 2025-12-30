/*
  # Add notes field to requirements table

  1. Changes
    - Add notes column to requirements table for lead engineer comments
    - Update existing requirements with sample notes data
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'requirements' AND column_name = 'notes'
  ) THEN
    ALTER TABLE requirements ADD COLUMN notes text;
  END IF;
END $$;

UPDATE requirements
SET notes = CASE
  WHEN tail_number = 'AF-TWK' THEN 'Need a lead engineer with Airbus with RR Trent EASA certification. 5 support required'
  WHEN tail_number = 'FK-LMN' THEN '2 FTE engineers for Airbus 330'
  WHEN tail_number = 'AM-RTK' THEN '1 Lead Engineer with FAA boeing licence'
  ELSE notes
END;
