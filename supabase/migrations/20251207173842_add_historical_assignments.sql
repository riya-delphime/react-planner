/*
  # Add Historical Assignments
  
  1. Changes
    - Add requirements for April 23-27 and 30 with same 10 tail numbers
    - Add some sample assignments to show consistent tail numbers
    
  2. Notes
    - Ensures historical data consistency
    - Shows realistic assignment patterns
*/

-- Add requirements for historical dates (April 23-27, 30)
INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  -- April 23
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-23', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-23', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-23', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-23', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-23', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-23', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-23', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-23', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-23', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-23', 'on_track'),
  
  -- April 24
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-24', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-24', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-24', 'delay_expected'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-24', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-24', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-24', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-24', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-24', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-24', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-24', 'on_track'),
  
  -- April 25
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-25', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-25', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-25', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-25', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-25', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-25', 'delay_expected'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-25', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-25', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-25', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-25', 'on_track'),
  
  -- April 26
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-26', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-26', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-26', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-26', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-26', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-26', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-26', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-26', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-26', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-26', 'on_track'),
  
  -- April 27
  ('AF-TWK', 'Airbus 319', 1, 4, '2025-04-27', 'on_track'),
  ('AM-RTK', 'Boeing 777', 2, 6, '2025-04-27', 'on_track'),
  ('FK-LMN', 'Airbus 330', 2, 7, '2025-04-27', 'on_track'),
  ('VH-XYZ', 'Boeing 787', 2, 5, '2025-04-27', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 8, '2025-04-27', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 6, '2025-04-27', 'on_track'),
  ('D-EFGH', 'Airbus 350', 2, 7, '2025-04-27', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 4, '2025-04-27', 'on_track'),
  ('EI-QRS', 'Airbus 330', 2, 6, '2025-04-27', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 3, '2025-04-27', 'on_track')
ON CONFLICT DO NOTHING;

-- Add some sample historical assignments to show consistent patterns
DO $$
DECLARE
  req_record RECORD;
  resource_ids text[] := ARRAY['AB12348', 'AB12352', 'AB12355', 'AB12363', 'AB12364', 'AB12367', 'AB12376', 'AB12377', 'AB12380', 'AB12381', 'AB12382', 'AB12383', 'AB12384', 'AB12386', 'AB12387', 'AB12388', 'AB12389', 'AB12390'];
  assignment_count int := 0;
  max_assignments_per_day int := 15;
BEGIN
  FOR req_record IN 
    SELECT id, date, tail_number 
    FROM requirements 
    WHERE date IN ('2025-04-23', '2025-04-24', '2025-04-25', '2025-04-26', '2025-04-27', '2025-04-30')
    ORDER BY date, tail_number
  LOOP
    assignment_count := 0;
    FOR i IN 1..array_length(resource_ids, 1) LOOP
      IF assignment_count >= max_assignments_per_day THEN
        EXIT;
      END IF;
      
      IF NOT EXISTS (
        SELECT 1 FROM assignments 
        WHERE resource_id = resource_ids[i] 
        AND date = req_record.date
      ) THEN
        INSERT INTO assignments (requirement_id, resource_id, date, role_type)
        VALUES (req_record.id, resource_ids[i], req_record.date, 'support')
        ON CONFLICT DO NOTHING;
        
        assignment_count := assignment_count + 1;
      END IF;
    END LOOP;
  END LOOP;
END $$;
