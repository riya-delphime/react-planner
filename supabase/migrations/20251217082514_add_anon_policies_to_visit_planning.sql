/*
  # Add Anonymous Access Policies to Visit Planning Table

  1. Changes
    - Add policies for anonymous users (anon role) to access visit_planning_canonical table
    - Allows public read, insert, update, and delete operations without authentication

  2. Security
    - Enable anon role to perform all CRUD operations on visit_planning_canonical
    - This allows the frontend to work without authentication
*/

-- Create policies for anonymous users (anon role)
CREATE POLICY "Anonymous users can read all visits"
  ON visit_planning_canonical
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert visits"
  ON visit_planning_canonical
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update visits"
  ON visit_planning_canonical
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete visits"
  ON visit_planning_canonical
  FOR DELETE
  TO anon
  USING (true);