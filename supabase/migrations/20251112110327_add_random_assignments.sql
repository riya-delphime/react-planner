/*
  # Add Random Assignments

  Adds sample assignments across April 23-30 for demonstration purposes.
  Uses AF-TWG and FK-LMN tail numbers only, as per requirements.
*/

WITH req_ids AS (
  SELECT id, tail_number FROM requirements 
  WHERE tail_number IN ('AF-TWG', 'FK-LMN')
),
resource_list AS (
  SELECT id FROM resources
  WHERE id IN ('AB12348', 'AB12364', 'AB12352', 'AB12355', 'AB12363', 'AB12367', 'AB12376', 'AB12377')
),
dates AS (
  SELECT '2025-04-23'::date as d UNION ALL
  SELECT '2025-04-24'::date UNION ALL
  SELECT '2025-04-25'::date UNION ALL
  SELECT '2025-04-26'::date UNION ALL
  SELECT '2025-04-27'::date UNION ALL
  SELECT '2025-04-30'::date
)
INSERT INTO assignments (requirement_id, resource_id, date, role_type)
SELECT 
  r.id,
  res.id,
  d.d,
  'support'
FROM req_ids r
CROSS JOIN resource_list res
CROSS JOIN dates d
WHERE random() < 0.35
ON CONFLICT DO NOTHING;
