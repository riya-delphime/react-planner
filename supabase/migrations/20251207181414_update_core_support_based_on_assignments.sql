/*
  # Update Core and Support Values Based on Tail Assignments

  1. Changes
    - Update 80% of staff to have core and support values matching last 3 characters of tail numbers
    - Keep 20% of staff with AV for both core and support
    - Update support to AL/SL if employee has leave on Apr 30
  
  2. Logic
    - Randomly assign tail-based values (TWK, RTK, FGH, QRS, JKL, LMN, BCD, 3AB, TUV, XYZ) to 80% of staff
    - Keep remaining 20% as AV
    - Override support with leave type if applicable
*/

-- First, reset everyone to AV
UPDATE resources
SET core = 'AV', support = 'AV';

-- Update 80% of staff (approximately 47 out of 59) with tail-based values
WITH tail_values AS (
  SELECT unnest(ARRAY['TWK', 'RTK', 'FGH', 'QRS', 'JKL', 'LMN', 'BCD', '3AB', 'TUV', 'XYZ']) AS tail_code
),
random_staff AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (ORDER BY RANDOM()) as rn,
    (SELECT tail_code FROM tail_values ORDER BY RANDOM() LIMIT 1) as assigned_tail
  FROM resources
)
UPDATE resources r
SET 
  core = rs.assigned_tail,
  support = CASE 
    WHEN r.leave_data->>'2025-04-30' = 'AL' THEN 'AL'
    WHEN r.leave_data->>'2025-04-30' = 'SL' THEN 'SL'
    ELSE rs.assigned_tail
  END
FROM random_staff rs
WHERE r.id = rs.id AND rs.rn <= 47;

-- Ensure the 6 AV resources are included in the remaining 20%
UPDATE resources
SET core = 'AV', support = 'AV'
WHERE id IN ('AB12377', 'AB12363', 'AB12397', 'AB12402', 'AB12410', 'AB12421');
