"""
Allocation Validation for MRO Resource Allocator
=================================================
Validates LLM allocation results against hard constraints.
"""

import pandas as pd


def validate_allocation(allocation_result: dict, allocation_context: dict) -> dict:
    """
    Validate the LLM's allocation against hard constraints.

    Checks for:
    - Invalid visit references
    - Ineligible employees (not in primary or similar pools)
    - Unavailable days
    - Double bookings (same employee on same day for multiple visits)
    - Understaffing warnings
    - Similar employee usage warnings

    Args:
        allocation_result: The allocation from the LLM
        allocation_context: The context that was sent to the LLM

    Returns:
        Validation report with violations and warnings
    """
    violations = []
    warnings = []

    visit_lookup = {v["visit_id"]: v for v in allocation_context["visits"] if "error" not in v}
    employee_day_assignments = {}

    for allocation in allocation_result.get("allocations", []):
        visit_id = allocation["visit_id"]

        if visit_id not in visit_lookup:
            violations.append({
                "type": "invalid_visit",
                "visit_id": visit_id,
                "message": f"Visit {visit_id} not found in context"
            })
            continue

        visit = visit_lookup[visit_id]

        # Combine primary and similar employees for eligibility check
        primary_emp_ids = set(visit.get("primary_employees", {}).keys())
        similar_emp_ids = set(visit.get("similar_employees", {}).keys())
        all_eligible_emp_ids = primary_emp_ids | similar_emp_ids

        # Get availability lookup
        primary_availability = visit.get("primary_employees", {})
        similar_availability = visit.get("similar_employees", {})

        for engineer in allocation.get("assigned_engineers", []):
            # Handle both 'emp_id' and 'id' for compatibility
            emp_id = engineer.get("emp_id") or engineer.get("id")
            if not emp_id:
                violations.append({
                    "type": "missing_emp_id",
                    "visit_id": visit_id,
                    "message": f"Engineer assignment missing emp_id/id field for visit {visit_id}"
                })
                continue
            assigned_days = engineer.get("assigned_days", [])
            employee_type = engineer.get("employee_type", "unknown")

            # Check if employee is eligible
            if emp_id not in all_eligible_emp_ids:
                violations.append({
                    "type": "ineligible_employee",
                    "visit_id": visit_id,
                    "emp_id": emp_id,
                    "message": f"Employee {emp_id} is not eligible (primary or similar) for visit {visit_id}"
                })
                continue

            # Get availability for this employee
            if emp_id in primary_availability:
                emp_availability = primary_availability[emp_id]["dates"]
            elif emp_id in similar_availability:
                emp_availability = similar_availability[emp_id]["dates"]
                # Warn about similar employee usage
                warnings.append({
                    "type": "similar_employee_used",
                    "visit_id": visit_id,
                    "emp_id": emp_id,
                    "similarity_score": similar_availability[emp_id].get("similarity_score"),
                    "message": f"Similar employee {emp_id} used for visit {visit_id} (not certified)"
                })
            else:
                emp_availability = {}

            # Check each assigned day
            for day in assigned_days:
                if day not in emp_availability:
                    violations.append({
                        "type": "unavailable_day",
                        "visit_id": visit_id,
                        "emp_id": emp_id,
                        "date": day,
                        "message": f"Employee {emp_id} is not available on {day}"
                    })

                # Check for double booking
                if emp_id not in employee_day_assignments:
                    employee_day_assignments[emp_id] = {}

                if day in employee_day_assignments[emp_id]:
                    other_visit = employee_day_assignments[emp_id][day]
                    violations.append({
                        "type": "double_booking",
                        "emp_id": emp_id,
                        "date": day,
                        "visit_1": other_visit,
                        "visit_2": visit_id,
                        "message": f"Employee {emp_id} is double-booked on {day}"
                    })
                else:
                    employee_day_assignments[emp_id][day] = visit_id

        # Check staffing levels
        num_assigned = len(allocation.get("assigned_engineers", []))
        num_required = visit["required_engineers"]

        if num_assigned < num_required:
            warnings.append({
                "type": "understaffed",
                "visit_id": visit_id,
                "required": num_required,
                "assigned": num_assigned,
                "message": f"Visit {visit_id} has {num_assigned}/{num_required} engineers"
            })

    return {
        "is_valid": len(violations) == 0,
        "violations": violations,
        "warnings": warnings,
        "summary": {
            "total_violations": len(violations),
            "total_warnings": len(warnings)
        }
    }


def print_validation_report(validation: dict):
    """Pretty print the validation report."""
    print("\n" + "=" * 60)
    print("VALIDATION REPORT")
    print("=" * 60)

    if validation["is_valid"]:
        print("STATUS: VALID - All hard constraints satisfied")
    else:
        print("STATUS: INVALID - Constraint violations found!")

    if validation["violations"]:
        print(f"\nVIOLATIONS ({len(validation['violations'])}):")
        for v in validation["violations"]:
            print(f"  - [{v['type']}] {v['message']}")

    if validation["warnings"]:
        print(f"\nWARNINGS ({len(validation['warnings'])}):")
        for w in validation["warnings"]:
            print(f"  - [{w['type']}] {w['message']}")

    print("=" * 60)


def allocation_to_dataframe(allocation_result: dict) -> pd.DataFrame:
    """
    Convert allocation result to a pandas DataFrame.

    Args:
        allocation_result: The allocation from the LLM

    Returns:
        DataFrame with one row per employee-day assignment
    """
    rows = []
    for allocation in allocation_result.get("allocations", []):
        visit_id = allocation["visit_id"]
        tail_num = allocation["tail_num"]
        # Handle both old format (status) and new format (engineer_status/technician_status)
        engineer_status = allocation.get("engineer_status", allocation.get("status", "unknown"))
        technician_status = allocation.get("technician_status", "not_required")

        # Process engineers
        for engineer in allocation.get("assigned_engineers", []):
            for day in engineer.get("assigned_days", []):
                rows.append({
                    "visit_id": visit_id,
                    "tail_num": tail_num,
                    "emp_id": engineer["emp_id"],
                    "name": engineer["name"],
                    "team": engineer["team"],
                    "role": "engineer",
                    "employee_type": engineer.get("employee_type", "primary"),
                    "similarity_score": engineer.get("similarity_score"),
                    "match_type": None,
                    "experience_count": None,
                    "date": day,
                    "status": engineer_status
                })

        # Process technicians
        for technician in allocation.get("assigned_technicians", []):
            for day in technician.get("assigned_days", []):
                rows.append({
                    "visit_id": visit_id,
                    "tail_num": tail_num,
                    "emp_id": technician["emp_id"],
                    "name": technician["name"],
                    "team": technician["team"],
                    "role": "technician",
                    "employee_type": "technician",
                    "similarity_score": None,
                    "match_type": technician.get("match_type"),
                    "experience_count": technician.get("experience_count"),
                    "date": day,
                    "status": technician_status
                })

    return pd.DataFrame(rows)
