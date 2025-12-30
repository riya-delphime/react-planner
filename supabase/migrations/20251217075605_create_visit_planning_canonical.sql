/*
  # Create Visit Planning Canonical Table

  1. New Tables
    - `visit_planning_canonical`
      - `visit_id` (text, primary key) - Unique visit identifier (e.g., VIS-00001)
      - `po_confirmed` (boolean) - Whether PO is confirmed
      - `po_number` (text) - Purchase order number
      - `tailnum` (text) - Aircraft tail number
      - `customer` (text) - Customer name
      - `check_type` (text) - Type of maintenance check
      - `status` (text) - Visit status (PLANNED/CONFIRMED/WHAT_IF/CANCELLED/etc.)
      - `notes` (text) - Customer notes or general notes
      - `aircraft` (text) - Aircraft type
      - `engine` (text) - Engine type
      - `lic_req` (text) - License requirements summary
      - `license_authorities` (jsonb) - Array of license authorities (e.g., ["FAA","EASA"])
      - `tooling_constraints` (text) - Tooling and constraints description
      - `induction_date` (date) - Aircraft induction date
      - `ets_date` (date) - Estimated time of shipment/completion
      - `min_team_size` (integer) - Minimum team size required
      - `daywise_resc` (jsonb) - Day-wise resource requirements [{date, role, required}]
      - `bay_alloc` (text) - Allocated bay identifier
      - `bay_daywise` (jsonb) - Day-wise bay allocations [{date, bay_id}]
      - `date_created` (timestamptz) - Record creation timestamp
      - `record_timestamp` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `visit_planning_canonical` table
    - Add policy for authenticated users to read all visits
    - Add policy for authenticated users to insert visits
    - Add policy for authenticated users to update visits
    - Add policy for authenticated users to delete visits

  3. Indexes
    - Add index on tailnum for faster filtering
    - Add index on customer for faster filtering
    - Add index on induction_date for date-range queries
    - Add index on status for status filtering
*/

CREATE TABLE IF NOT EXISTS visit_planning_canonical (
    visit_id             text PRIMARY KEY,
    po_confirmed         boolean DEFAULT false,
    po_number            text,
    tailnum              text,
    customer             text,
    check_type           text,
    status               text DEFAULT 'PLANNED',
    notes                text,
    aircraft             text,
    engine               text,
    lic_req              text,
    license_authorities  jsonb DEFAULT '[]'::jsonb,
    tooling_constraints  text,
    induction_date       date,
    ets_date             date,
    min_team_size        integer DEFAULT 0,
    daywise_resc         jsonb DEFAULT '[]'::jsonb,
    bay_alloc            text,
    bay_daywise          jsonb DEFAULT '[]'::jsonb,
    date_created         timestamptz DEFAULT now(),
    record_timestamp     timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE visit_planning_canonical ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can read all visits"
  ON visit_planning_canonical
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert visits"
  ON visit_planning_canonical
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update visits"
  ON visit_planning_canonical
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete visits"
  ON visit_planning_canonical
  FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_visit_planning_tailnum ON visit_planning_canonical(tailnum);
CREATE INDEX IF NOT EXISTS idx_visit_planning_customer ON visit_planning_canonical(customer);
CREATE INDEX IF NOT EXISTS idx_visit_planning_induction_date ON visit_planning_canonical(induction_date);
CREATE INDEX IF NOT EXISTS idx_visit_planning_status ON visit_planning_canonical(status);

-- Create trigger to update record_timestamp on updates
CREATE OR REPLACE FUNCTION update_visit_planning_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.record_timestamp = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_visit_planning_timestamp_trigger
    BEFORE UPDATE ON visit_planning_canonical
    FOR EACH ROW
    EXECUTE FUNCTION update_visit_planning_timestamp();