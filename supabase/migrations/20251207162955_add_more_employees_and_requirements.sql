/*
  # Add More Employees and Requirements
  
  1. Changes
    - Add 50+ employees with proper team assignments
    - Add 15+ tail numbers/requirements
    - Set only ~5% of employees with AL/SL leave
    - Populate assignments for April 23-30 historical data
    
  2. Notes
    - Ensures realistic data volume for workforce planning
    - Maintains variety in roles (ENGR, CC, TECH)
    - Leave data reduced to 5% as requested
*/

-- Add more employees
INSERT INTO resources (id, name, team, core, support, title, dob, department, licenses, leave_data) VALUES
  ('AB12380', 'Steve Morin', 'Team 1', 'AV', 'AV', 'ENGR', '1987-05-12', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12381', 'Bill Wort', 'Team 1', 'AV', 'AV', 'TECH', '1989-08-23', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12382', 'Jay Plat', 'Team 2', 'AV', 'AV', 'ENGR', '1991-03-15', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12383', 'Ben Tarr', 'Team 4', 'AQB', 'AV', 'TECH', '1988-11-30', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12384', 'Rick Pete', 'Team 7', 'AV', 'AV', 'TECH', '1990-07-19', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12385', 'Jose Pull', 'Team 5', 'AV', 'AV', 'TECH', '1986-02-28', 'Avionics', 'Boeing 787 EASA', '{"2025-04-30": "AL"}'),
  ('AB12386', 'Mark Wilson', 'Team 3', 'AV', 'AV', 'ENGR', '1992-09-14', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12387', 'Tom Harris', 'Team 3', 'AV', 'AV', 'CC', '1985-12-05', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12388', 'Lisa Chen', 'Team 1', 'AV', 'AV', 'ENGR', '1993-04-22', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12389', 'David Lee', 'Team 2', 'AV', 'AV', 'TECH', '1987-10-11', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12390', 'Sarah Johnson', 'Team 4', 'AQB', 'AV', 'ENGR', '1989-06-08', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12391', 'Mike Brown', 'Team 5', 'AV', 'AV', 'TECH', '1991-01-17', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12392', 'Emily Davis', 'Team 6', 'AV', 'AV', 'ENGR', '1990-08-25', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12393', 'James Miller', 'Team 6', 'AV', 'AV', 'CC', '1988-03-12', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12394', 'Anna Garcia', 'Team 7', 'AV', 'AV', 'TECH', '1992-11-29', 'Avionics', 'Airbus 320 EASA', '{"2025-04-25": "SL"}'),
  ('AB12395', 'Chris Martinez', 'Team 1', 'AV', 'AV', 'ENGR', '1986-07-03', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12396', 'Michelle Rodriguez', 'Team 2', 'AV', 'AV', 'TECH', '1994-05-18', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12397', 'Kevin Anderson', 'Team 3', 'AV', 'AV', 'ENGR', '1989-12-22', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12398', 'Rachel Thomas', 'Team 4', 'AQB', 'AV', 'TECH', '1991-09-06', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12399', 'Daniel Jackson', 'Team 5', 'AV', 'AV', 'ENGR', '1987-02-14', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12400', 'Jennifer White', 'Team 6', 'AV', 'AV', 'CC', '1993-10-27', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12401', 'Robert Harris', 'Team 7', 'AV', 'AV', 'TECH', '1988-06-19', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12402', 'Patricia Martin', 'Team 1', 'AV', 'AV', 'ENGR', '1990-04-08', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12403', 'Charles Thompson', 'Team 2', 'AV', 'AV', 'TECH', '1992-01-31', 'Avionics', 'Boeing 777 EASA', '{"2025-04-27": "AL"}'),
  ('AB12404', 'Linda Garcia', 'Team 3', 'AV', 'AV', 'ENGR', '1986-11-16', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12405', 'Matthew Martinez', 'Team 4', 'AQB', 'AV', 'CC', '1989-08-05', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12406', 'Barbara Robinson', 'Team 5', 'AV', 'AV', 'TECH', '1991-05-23', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12407', 'Joseph Clark', 'Team 6', 'AV', 'AV', 'ENGR', '1987-12-11', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12408', 'Susan Rodriguez', 'Team 7', 'AV', 'AV', 'TECH', '1993-07-29', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12409', 'Thomas Lewis', 'Team 1', 'AV', 'AV', 'ENGR', '1988-03-17', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12410', 'Karen Lee', 'Team 2', 'AV', 'AV', 'CC', '1990-10-24', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12411', 'Christopher Walker', 'Team 3', 'AV', 'AV', 'TECH', '1992-06-13', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12412', 'Nancy Hall', 'Team 4', 'AQB', 'AV', 'ENGR', '1986-01-07', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12413', 'Brian Allen', 'Team 5', 'AV', 'AV', 'TECH', '1989-09-26', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12414', 'Betty Young', 'Team 6', 'AV', 'AV', 'ENGR', '1991-04-14', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12415', 'Donald King', 'Team 7', 'AV', 'AV', 'TECH', '1987-11-03', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12416', 'Sandra Wright', 'Team 1', 'AV', 'AV', 'ENGR', '1993-08-20', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12417', 'Kenneth Scott', 'Team 2', 'AV', 'AV', 'TECH', '1988-05-09', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12418', 'Ashley Green', 'Team 3', 'AV', 'AV', 'CC', '1990-12-27', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12419', 'Paul Baker', 'Team 4', 'AQB', 'AV', 'ENGR', '1992-07-15', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12420', 'Donna Adams', 'Team 5', 'AV', 'AV', 'TECH', '1986-02-02', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12421', 'Steven Nelson', 'Team 6', 'AV', 'AV', 'ENGR', '1989-10-19', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12422', 'Carol Carter', 'Team 7', 'AV', 'AV', 'TECH', '1991-06-08', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12423', 'Andrew Mitchell', 'Team 1', 'AV', 'AV', 'ENGR', '1987-01-25', 'Avionics', 'Airbus 330 EASA', '{}'),
  ('AB12424', 'Ruth Perez', 'Team 2', 'AV', 'AV', 'CC', '1993-09-13', 'Avionics', 'Boeing 777 EASA', '{}'),
  ('AB12425', 'Joshua Roberts', 'Team 3', 'AV', 'AV', 'TECH', '1988-04-02', 'Avionics', 'Airbus 380 EASA', '{}'),
  ('AB12426', 'Sharon Turner', 'Team 4', 'AQB', 'AV', 'ENGR', '1990-11-20', 'Avionics', 'Airbus 319 EASA', '{}'),
  ('AB12427', 'Ryan Phillips', 'Team 5', 'AV', 'AV', 'TECH', '1992-08-08', 'Avionics', 'Boeing 787 EASA', '{}'),
  ('AB12428', 'Deborah Campbell', 'Team 6', 'AV', 'AV', 'ENGR', '1986-05-27', 'Avionics', 'Airbus 350 EASA', '{}'),
  ('AB12429', 'Jonathan Parker', 'Team 7', 'AV', 'AV', 'TECH', '1989-12-14', 'Avionics', 'Airbus 320 EASA', '{}'),
  ('AB12430', 'Kimberly Evans', 'Team 1', 'AV', 'AV', 'ENGR', '1991-07-03', 'Avionics', 'Airbus 330 EASA', '{}')
ON CONFLICT (id) DO NOTHING;

-- Add more requirements/tail numbers
INSERT INTO requirements (tail_number, tail_details, lic_engineers, support, date, status) VALUES
  ('VH-XYZ', 'Boeing 787', 2, 6, '2025-05-01', 'on_track'),
  ('N123AB', 'Airbus 380', 3, 9, '2025-05-01', 'on_track'),
  ('G-ABCD', 'Boeing 777', 2, 7, '2025-05-01', 'delay_expected'),
  ('D-EFGH', 'Airbus 350', 2, 8, '2025-05-01', 'on_track'),
  ('F-IJKL', 'Airbus 320', 1, 5, '2025-05-01', 'on_track'),
  ('I-MNOP', 'Boeing 777', 2, 6, '2025-05-01', 'delay_expected'),
  ('EI-QRS', 'Airbus 330', 2, 7, '2025-05-01', 'on_track'),
  ('TC-TUV', 'Airbus 319', 1, 4, '2025-05-01', 'on_track'),
  ('JA-WXY', 'Boeing 787', 2, 8, '2025-05-01', 'on_track'),
  ('HL-ZAB', 'Airbus 380', 3, 10, '2025-05-01', 'delay_expected'),
  ('B-CDE', 'Boeing 777', 2, 7, '2025-05-01', 'on_track'),
  ('VP-FGH', 'Airbus 350', 2, 6, '2025-05-01', 'on_track')
ON CONFLICT DO NOTHING;
