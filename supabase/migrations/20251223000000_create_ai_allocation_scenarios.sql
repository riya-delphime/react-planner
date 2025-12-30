/*
  # Create AI Allocation Scenarios Table

  1. New Table
    - `ai_allocation_scenarios`
      - `id` (uuid, primary key)
      - `scenario_name` (text) - Name from the UI input
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `status` (text) - pending, processing, completed, failed
      
      Input data from UI:
      - `aircraft_schedules` (jsonb) - Array of aircraft schedule objects from the main table
      - `additional_aircraft` (jsonb) - Array of additional aircraft options
      - `daywise_plans` (jsonb) - Daywise planning data per aircraft
      
      API Response:
      - `api_request` (jsonb) - The request sent to the AI API
      - `api_response` (jsonb) - Full response from AI allocation API
      - `allocations` (jsonb) - Extracted allocations array for easy querying
      - `bay_allocations` (jsonb) - Bay allocation results
      - `validation` (jsonb) - Validation results from AI

  2. Security
    - Enable RLS
    - Add policies for all operations
*/

CREATE TABLE IF NOT EXISTS ai_allocation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending',
  
  -- Input data from frontend UI
  aircraft_schedules jsonb DEFAULT '[]'::jsonb,
  additional_aircraft jsonb DEFAULT '[]'::jsonb,
  daywise_plans jsonb DEFAULT '{}'::jsonb,
  
  -- API request/response
  api_request jsonb,
  api_response jsonb,
  
  -- Extracted fields for easier querying
  allocations jsonb DEFAULT '[]'::jsonb,
  bay_allocations jsonb,
  validation jsonb,
  
  -- Summary fields
  total_visits integer DEFAULT 0,
  total_engineers_allocated integer DEFAULT 0,
  is_valid boolean DEFAULT false,
  error_message text
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_name ON ai_allocation_scenarios(scenario_name);
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_status ON ai_allocation_scenarios(status);
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_created_at ON ai_allocation_scenarios(created_at DESC);

-- Enable RLS (skip if already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'ai_allocation_scenarios'
    AND rowsecurity = true
  ) THEN
    ALTER TABLE ai_allocation_scenarios ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Policy for authenticated users (drop and recreate to be idempotent)
DROP POLICY IF EXISTS "Allow all operations on ai_allocation_scenarios for authenticated" ON ai_allocation_scenarios;
CREATE POLICY "Allow all operations on ai_allocation_scenarios for authenticated"
  ON ai_allocation_scenarios FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy for anonymous users (drop and recreate to be idempotent)
DROP POLICY IF EXISTS "Allow all operations on ai_allocation_scenarios for anon" ON ai_allocation_scenarios;
CREATE POLICY "Allow all operations on ai_allocation_scenarios for anon"
  ON ai_allocation_scenarios FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE ai_allocation_scenarios IS 'Stores AI allocation scenarios with inputs from frontend and API responses';
COMMENT ON COLUMN ai_allocation_scenarios.scenario_name IS 'User-provided scenario name from the UI';
COMMENT ON COLUMN ai_allocation_scenarios.aircraft_schedules IS 'JSON array of aircraft schedules from the Planning Scenario Builder table';
COMMENT ON COLUMN ai_allocation_scenarios.additional_aircraft IS 'JSON array of additional aircraft options';
COMMENT ON COLUMN ai_allocation_scenarios.daywise_plans IS 'JSON object with daywise resource plans per aircraft';
COMMENT ON COLUMN ai_allocation_scenarios.api_request IS 'The request payload sent to the AI allocation API';
COMMENT ON COLUMN ai_allocation_scenarios.api_response IS 'Full response received from the AI allocation API';
COMMENT ON COLUMN ai_allocation_scenarios.allocations IS 'Extracted allocations array from API response';
COMMENT ON COLUMN ai_allocation_scenarios.bay_allocations IS 'Bay allocation results from API response';

