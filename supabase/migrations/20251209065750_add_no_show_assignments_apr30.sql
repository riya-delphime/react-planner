/*
  # Add No-Show Assignments for April 30

  This migration adds assignments for employees with blank TTL login times on April 30.
  These will trigger no-show alerts in the system:
  
  1. AB12386 (Mark Wilson) - ENGR, FGH - assigned to D-EFGH
  2. AB12390 (Sarah Johnson) - ENGR, BCD - assigned to G-ABCD
  3. AB12392 (Emily Davis) - ENGR, TUV - assigned to TC-TUV
  
  These employees have blank login times (30% probability based on ID hashing)
  and will show as no-shows in the alerts.
*/

-- Add assignment for AB12386 (Mark Wilson) to D-EFGH on Apr 30
INSERT INTO assignments (requirement_id, resource_id, date, role_type)
SELECT id, 'AB12386', '2025-04-30', 'support'
FROM requirements
WHERE tail_number = 'D-EFGH' AND date = '2025-04-30'
ON CONFLICT DO NOTHING;

-- Add assignment for AB12390 (Sarah Johnson) to G-ABCD on Apr 30
INSERT INTO assignments (requirement_id, resource_id, date, role_type)
SELECT id, 'AB12390', '2025-04-30', 'support'
FROM requirements
WHERE tail_number = 'G-ABCD' AND date = '2025-04-30'
ON CONFLICT DO NOTHING;

-- Add assignment for AB12392 (Emily Davis) to TC-TUV on Apr 30
INSERT INTO assignments (requirement_id, resource_id, date, role_type)
SELECT id, 'AB12392', '2025-04-30', 'support'
FROM requirements
WHERE tail_number = 'TC-TUV' AND date = '2025-04-30'
ON CONFLICT DO NOTHING;
