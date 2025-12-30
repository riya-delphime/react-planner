/*
  # Add Recommended Bay to Additional Aircraft Options

  1. Changes
    - Add `recommended_bay` column to `additional_aircraft_options` table
    - This will allow planners to specify a recommended bay slot for additional aircraft requirements
  
  2. Details
    - Column is nullable (optional) and defaults to empty string
    - Stores bay identifiers like "Bay 1", "Bay 2", etc.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'additional_aircraft_options' 
    AND column_name = 'recommended_bay'
  ) THEN
    ALTER TABLE additional_aircraft_options 
    ADD COLUMN recommended_bay text DEFAULT '';
  END IF;
END $$;
