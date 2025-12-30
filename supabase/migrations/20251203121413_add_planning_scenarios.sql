/*
  # Add Planning Scenarios Schema

  1. New Tables
    - `planning_scenarios`
      - `id` (uuid, primary key)
      - `name` (text) - scenario name like "Amd_2025_11_28_v1"
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `aircraft_schedules`
      - `id` (uuid, primary key)
      - `scenario_id` (uuid, foreign key to planning_scenarios)
      - `aircraft_reg` (text) - aircraft registration like "VH-OQC"
      - `customer` (text)
      - `fleet` (text) - aircraft type like "A380"
      - `check_type` (text)
      - `induct_date` (date)
      - `ets_date` (date) - estimated completion date
      - `cert_eng_req` (integer) - certified engineers required
      - `week_category` (text) - "1 week", "2 week", "2-4 week"
      - `bay_assignment` (text) - bay location
    
    - `additional_aircraft_options`
      - `id` (uuid, primary key)
      - `scenario_id` (uuid, foreign key to planning_scenarios)
      - `aircraft_engine_license` (text) - like "A319 - RR Trent 700-EASA"
      - `min_engineers` (integer)
      - `display_order` (integer)
    
    - `scenario_engineer_assignments`
      - `id` (uuid, primary key)
      - `scenario_id` (uuid, foreign key to planning_scenarios)
      - `resource_id` (text, foreign key to resources)
      - `aircraft_reg` (text) - can be real or dummy name
      - `is_additional_aircraft` (boolean) - true if from additional aircraft options
      - `date` (date)
      - `bay` (text)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS planning_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aircraft_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES planning_scenarios(id) ON DELETE CASCADE,
  aircraft_reg text NOT NULL,
  customer text DEFAULT '',
  fleet text NOT NULL,
  check_type text NOT NULL,
  induct_date date NOT NULL,
  ets_date date NOT NULL,
  cert_eng_req integer DEFAULT 0,
  week_category text DEFAULT '1 week',
  bay_assignment text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS additional_aircraft_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES planning_scenarios(id) ON DELETE CASCADE,
  aircraft_engine_license text NOT NULL,
  min_engineers integer DEFAULT 2,
  display_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenario_engineer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES planning_scenarios(id) ON DELETE CASCADE,
  resource_id text REFERENCES resources(id) ON DELETE CASCADE,
  aircraft_reg text NOT NULL,
  is_additional_aircraft boolean DEFAULT false,
  date date NOT NULL,
  bay text DEFAULT ''
);

ALTER TABLE planning_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE aircraft_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE additional_aircraft_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_engineer_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on planning_scenarios"
  ON planning_scenarios FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on aircraft_schedules"
  ON aircraft_schedules FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on additional_aircraft_options"
  ON additional_aircraft_options FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on scenario_engineer_assignments"
  ON scenario_engineer_assignments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);