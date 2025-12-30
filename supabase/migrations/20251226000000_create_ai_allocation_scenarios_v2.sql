/*
  # Create AI Allocation Scenarios V2 Table

  Simplified table without triggers or separate extracted columns.
  All allocation data is read from api_response column.
*/

CREATE TABLE IF NOT EXISTS ai_allocation_scenarios_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text NOT NULL,
  planning_date date DEFAULT '2022-04-30',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending',

  -- Input data from frontend UI
  aircraft_schedules jsonb DEFAULT '[]'::jsonb,
  additional_aircraft jsonb DEFAULT '[]'::jsonb,
  daywise_plans jsonb DEFAULT '{}'::jsonb,

  -- API request/response (all allocation data read from api_response)
  api_request jsonb,
  api_response jsonb,

  -- Summary fields
  total_visits integer DEFAULT 0,
  total_engineers_allocated integer DEFAULT 0,
  is_valid boolean DEFAULT false,
  error_message text
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_v2_name ON ai_allocation_scenarios_v2(scenario_name);
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_v2_status ON ai_allocation_scenarios_v2(status);
CREATE INDEX IF NOT EXISTS idx_ai_allocation_scenarios_v2_created_at ON ai_allocation_scenarios_v2(created_at DESC);

-- Enable RLS
ALTER TABLE ai_allocation_scenarios_v2 ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users
CREATE POLICY "Allow all operations on ai_allocation_scenarios_v2 for authenticated"
  ON ai_allocation_scenarios_v2 FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy for anonymous users
CREATE POLICY "Allow all operations on ai_allocation_scenarios_v2 for anon"
  ON ai_allocation_scenarios_v2 FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE ai_allocation_scenarios_v2 IS 'Stores AI allocation scenarios - V2 without triggers';
COMMENT ON COLUMN ai_allocation_scenarios_v2.api_response IS 'Full response from AI API - contains allocations, bay_allocations, validation, summary';
