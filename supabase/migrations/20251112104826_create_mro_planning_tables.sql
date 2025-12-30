/*
  # MRO Resource Planning Database Schema

  1. New Tables
    - `resources`
      - `id` (text, primary key) - Employee ID (e.g., AB12348)
      - `name` (text) - Employee name
      - `team` (text) - Team assignment
      - `core` (text) - Core skill/license
      - `support` (text) - Support skill
      - `title` (text) - Job title/role
      - `dob` (date) - Date of birth
      - `department` (text) - Department
      - `licenses` (text) - Aircraft licenses
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `requirements`
      - `id` (uuid, primary key)
      - `tail_number` (text) - Aircraft tail number
      - `tail_details` (text) - Aircraft type
      - `lic_engineers` (integer) - Number of licensed engineers needed
      - `support` (integer) - Number of support staff needed
      - `date` (date) - Requirement date
      - `status` (text) - Status (pending, assigned, completed)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `assignments`
      - `id` (uuid, primary key)
      - `requirement_id` (uuid, foreign key)
      - `resource_id` (text, foreign key)
      - `date` (date) - Assignment date
      - `role_type` (text) - licensed or support
      - `created_at` (timestamptz)
    
    - `kpis`
      - `id` (uuid, primary key)
      - `date` (date) - Date for KPI
      - `weekly_utilization` (decimal) - Weekly resource utilization percentage
      - `daily_utilization` (decimal) - Daily resource utilization percentage
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS resources (
  id text PRIMARY KEY,
  name text NOT NULL,
  team text NOT NULL,
  core text NOT NULL,
  support text NOT NULL,
  title text NOT NULL,
  dob date,
  department text,
  licenses text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tail_number text NOT NULL,
  tail_details text NOT NULL,
  lic_engineers integer NOT NULL DEFAULT 0,
  support integer NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid REFERENCES requirements(id) ON DELETE CASCADE,
  resource_id text REFERENCES resources(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  role_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  weekly_utilization decimal NOT NULL DEFAULT 0,
  daily_utilization decimal NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(date)
);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to resources"
  ON resources FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert to resources"
  ON resources FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update to resources"
  ON resources FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read access to requirements"
  ON requirements FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert to requirements"
  ON requirements FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update to requirements"
  ON requirements FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read access to assignments"
  ON assignments FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert to assignments"
  ON assignments FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public delete from assignments"
  ON assignments FOR DELETE
  TO public
  USING (true);

CREATE POLICY "Allow public read access to kpis"
  ON kpis FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert to kpis"
  ON kpis FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update to kpis"
  ON kpis FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

INSERT INTO resources (id, name, team, core, support, title, dob, department, licenses) VALUES
  ('AB12348', 'Carson Ryan', 'Team 4', 'AQB', 'AQB', 'ENGR', '1986-12-23', 'Avionics', 'Airbus 319 EASA'),
  ('AB12364', 'Joe Henry', 'Team 7', 'AV', 'AV', 'CC', '1985-03-15', 'Avionics', 'Airbus 320 EASA'),
  ('AB12352', 'Cam Dwight', 'Team 2', 'AV', 'AL', 'ENGR', '1990-06-20', 'Avionics', 'Airbus 330 EASA'),
  ('AB12355', 'Jimmy Wang', 'Team 5', 'AV', 'AV', 'ENGR', '1988-09-10', 'Avionics', 'Boeing 777 EASA'),
  ('AB12363', 'Brandon Cavill', 'Team 7', 'AV', 'AV', 'ENGR', '1992-11-05', 'Avionics', 'Airbus 380 EASA'),
  ('AB12367', 'Benny Red', 'Team 5', 'AV', 'AV', 'TECH', '1987-04-18', 'Avionics', 'Boeing 787 EASA'),
  ('AB12376', 'Oba Lomi', 'Team 5', 'AV', 'AV', 'TECH', '1991-07-22', 'Avionics', 'Airbus 350 EASA'),
  ('AB12377', 'Jan Bond', 'Team 7', 'AV', 'AV', 'TECH', '1989-02-14', 'Avionics', 'Boeing 777 EASA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  ('AF-TWG', 'Airbus 319', 1, 5, CURRENT_DATE, 'pending'),
  ('FK-LMN', 'Airbus 330', 2, 8, CURRENT_DATE, 'pending'),
  ('AM-RTK', 'Boeing 777', 1, 7, CURRENT_DATE, 'pending')
ON CONFLICT DO NOTHING;

INSERT INTO kpis (date, weekly_utilization, daily_utilization) VALUES
  (CURRENT_DATE, 98.0, 95.0)
ON CONFLICT (date) DO UPDATE SET
  weekly_utilization = EXCLUDED.weekly_utilization,
  daily_utilization = EXCLUDED.daily_utilization;
