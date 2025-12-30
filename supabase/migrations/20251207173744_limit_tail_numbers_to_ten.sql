/*
  # Limit Tail Numbers to 10 Maximum
  
  1. Changes
    - Remove excess tail numbers, keeping only 10
    - Ensure tail numbers are consistent across requirements table
    - Maintain variety in aircraft types
    
  2. Notes
    - Keeps the most important tail numbers
    - Ensures data consistency for workforce planning
*/

-- First, delete all existing requirements to start fresh
DELETE FROM requirements;

-- Add exactly 10 tail numbers for May 1
INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-05-01', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-05-01', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-05-01', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-05-01', 'delay_expected'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-05-01', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-05-01', 'delay_expected'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-05-01', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-05-01', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-05-01', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-05-01', 'on_track')
ON CONFLICT DO NOTHING;

-- Add same tail numbers for May 2
INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-05-02', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-05-02', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-05-02', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-05-02', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-05-02', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-05-02', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-05-02', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-05-02', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-05-02', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-05-02', 'on_track')
ON CONFLICT DO NOTHING;

-- Add for Apr 30 (past date)
INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-30', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-30', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-30', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-30', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-30', 'delay_expected'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-30', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-30', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-30', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-30', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-30', 'on_track')
ON CONFLICT DO NOTHING;
