/*
  # Fix Core and Support Distribution

  1. Purpose
    - Distribute tail codes more evenly across resources
    - Ensure each tail code has roughly equal number of resources
    - Keep 20% as AV
  
  2. Approach
    - Assign tail codes in a round-robin fashion
    - Preserve AL/SL for resources with leave on Apr 30
*/

-- Create a better distribution
WITH tail_codes AS (
  SELECT unnest(ARRAY['TWK', 'RTK', 'FGH', 'QRS', 'JKL', 'LMN', 'BCD', '3AB', 'TUV', 'XYZ']) AS code,
         unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) AS seq
),
resource_list AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (ORDER BY id) as rn,
    leave_data->>'2025-04-30' as apr30_leave
  FROM resources
),
assigned_codes AS (
  SELECT 
    rl.id,
    rl.apr30_leave,
    CASE 
      WHEN rl.rn <= 12 THEN 'AV'
      ELSE tc.code
    END as assigned_code
  FROM resource_list rl
  LEFT JOIN tail_codes tc ON ((rl.rn - 13) % 10) + 1 = tc.seq
)
UPDATE resources r
SET 
  core = ac.assigned_code,
  support = CASE 
    WHEN ac.apr30_leave = 'AL' THEN 'AL'
    WHEN ac.apr30_leave = 'SL' THEN 'SL'
    ELSE ac.assigned_code
  END
FROM assigned_codes ac
WHERE r.id = ac.id;
