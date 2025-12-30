"""
Example Usage of the MRO Resource Allocator
============================================
Shows how to use the allocator package.
"""

import pandas as pd
import json

from allocator import (
    get_db_connection,
    load_data,
    get_llm_client,
    allocate_resources,
    print_validation_report,
    diagnose_employee_availability
)


def main():
    """Run example allocation."""

    # Connect to database and load data
    print("Connecting to database...")
    with get_db_connection() as conn:
        print("Loading data...")
        data = load_data(conn)

    # Define future visits to allocate
    future_visits = [
        {
            "tail_num": "A6-BMC",
            "start_date": pd.to_datetime("2022-05-01"),
            "end_date": pd.to_datetime("2022-05-05"),
            "num_engineers": 2,
            "aircraft_size": "narrowbody"
        },
        {
            "tail_num": "A6-EIT",
            "start_date": pd.to_datetime("2022-05-17"),
            "end_date": pd.to_datetime("2022-05-22"),
            "num_engineers": 3,
            "aircraft_size": "widebody"
        }
    ]

    # Get LLM client
    print("Initializing LLM client...")
    client = get_llm_client()

    # Run allocation
    print("\n" + "=" * 60)
    print("RUNNING RESOURCE ALLOCATION")
    print("=" * 60)

    result = allocate_resources(
        future_visits=future_visits,
        visit_details_df=data["visit_details"],
        emp_license_df=data["emp_license"],
        emp_roster_df=data["emp_roster"],
        shift_code_master_df=data["shift_code_master"],
        emp_similarity_df=data.get("emp_similarity"),  # Optional
        emp_work_daily_df=data.get("emp_work_daily"),  # Employees becoming available
        bay_status_df=data.get("bay_status"),  # Bay availability
        bay_constraints_df=data.get("bay_constraints"),  # Bay constraints
        aircraft_size_df=data.get("aircraft_size"),  # Aircraft body type mapping
        llm_client=client,
        verbose=True
    )

    # Print results
    print("\n" + "=" * 60)
    print("ALLOCATION RESULT:")
    print("=" * 60)
    print(json.dumps(result["allocation_result"], indent=2))

    print_validation_report(result["validation_report"])

    print("\nFinal Allocation DataFrame:")
    print(result["allocation_df"].to_string())

    # Check if any similar or upcoming employees were used
    if not result["allocation_df"].empty:
        similar_used = result["allocation_df"][
            result["allocation_df"]["employee_type"] == "similar"
        ]
        if not similar_used.empty:
            print("\n" + "=" * 60)
            print("SIMILAR EMPLOYEES USED (FALLBACK):")
            print("=" * 60)
            print(similar_used.to_string())

        upcoming_used = result["allocation_df"][
            result["allocation_df"]["employee_type"] == "upcoming"
        ]
        if not upcoming_used.empty:
            print("\n" + "=" * 60)
            print("UPCOMING EMPLOYEES USED (BECOMING AVAILABLE):")
            print("=" * 60)
            print(upcoming_used.to_string())

    # Print bay allocations
    if result.get("bay_allocations"):
        print("\n" + "=" * 60)
        print("BAY ALLOCATIONS:")
        print("=" * 60)
        for visit_id, bay_info in result["bay_allocations"].items():
            bay = bay_info.get("bay", "None")
            body_type = bay_info.get("body_type", "unknown")
            status = bay_info.get("status", "unknown")
            alternatives = bay_info.get("alternatives", [])
            print(f"  Visit {visit_id}: {bay} ({body_type}) - {status}")
            if alternatives:
                print(f"    Alternatives: {', '.join(alternatives[:5])}")

    # Optional: Diagnose partial availability
    print("\n" + "=" * 60)
    print("DIAGNOSING PARTIAL AVAILABILITY")
    print("=" * 60)

    diagnosis = diagnose_employee_availability(
        emp_ids=["AB12364", "AB12350"],
        start_date=pd.to_datetime("2022-05-17"),
        end_date=pd.to_datetime("2022-05-22"),
        emp_roster_df=data["emp_roster"],
        shift_code_master_df=data["shift_code_master"]
    )

    print("\nFull availability breakdown:")
    print(diagnosis.to_string())

    print("\nDone!")


if __name__ == "__main__":
    main()
