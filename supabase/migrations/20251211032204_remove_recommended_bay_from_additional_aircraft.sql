/*
  # Remove Recommended Bay Column

  1. Changes
    - Remove `recommended_bay` column from `additional_aircraft_options` table
    - This column was added by mistake and is not needed
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'additional_aircraft_options' 
    AND column_name = 'recommended_bay'
  ) THEN
    ALTER TABLE additional_aircraft_options 
    DROP COLUMN recommended_bay;
  END IF;
END $$;
