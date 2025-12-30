/*
  # Update RLS Policies for Planning Scenarios

  1. Changes
    - Drop existing restrictive policies
    - Add new policies that allow anon role access
    - This enables the application to work without authentication
  
  2. Security Note
    - These policies allow public access
    - Suitable for internal tools without auth requirements
*/

DROP POLICY IF EXISTS "Allow all operations on planning_scenarios" ON planning_scenarios;
DROP POLICY IF EXISTS "Allow all operations on aircraft_schedules" ON aircraft_schedules;
DROP POLICY IF EXISTS "Allow all operations on additional_aircraft_options" ON additional_aircraft_options;
DROP POLICY IF EXISTS "Allow all operations on scenario_engineer_assignments" ON scenario_engineer_assignments;

CREATE POLICY "Enable all access for planning_scenarios"
  ON planning_scenarios FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Enable all access for aircraft_schedules"
  ON aircraft_schedules FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Enable all access for additional_aircraft_options"
  ON additional_aircraft_options FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Enable all access for scenario_engineer_assignments"
  ON scenario_engineer_assignments FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);