"""
Main Resource Allocation Pipeline for MRO
==========================================
Orchestrates the complete allocation workflow.
"""

import pandas as pd
from typing import Optional
from openai import AzureOpenAI

from .config import get_config
from .db import get_eligible_shifts
from .eligibility import (
    get_visit_requirements,
    get_eligible_employees,
    get_available_employees,
    build_employee_availability_matrix,
    classify_coverage,
    get_employees_becoming_available,
    get_requirements_from_lic_req_or_tail,
    get_eligible_technicians,
    get_available_technicians,
    build_technician_availability_matrix
)
from .similarity import expand_eligible_pool_with_similar
from .llm import get_llm_client, allocate_resources_with_llm
from .validation import validate_allocation, print_validation_report, allocation_to_dataframe
from .bay import allocate_bays_for_visits


def prepare_allocation_context(
    future_visits: list,
    visit_details_df: pd.DataFrame,
    emp_license_df: pd.DataFrame,
    emp_roster_df: pd.DataFrame,
    emp_similarity_df: Optional[pd.DataFrame],
    eligible_shifts: list,
    similarity_threshold: Optional[float] = None,
    emp_work_daily_df: Optional[pd.DataFrame] = None,
    tech_work_summary_df: Optional[pd.DataFrame] = None,
    retained_emp_ids: Optional[set] = None,
    ongoing_jobs_context: Optional[list] = None,
    verbose: bool = False
) -> dict:
    """
    Prepare structured context for LLM allocation.

    Includes both primary (certified) employees and similar (fallback) employees.
    Also identifies employees who will become available when their current jobs end.
    Additionally includes eligible technicians based on their work history.
    Detects conflicts (same employee eligible for overlapping visits).
    
    Business Rule: Employees with IDs in retained_emp_ids are excluded from allocation
    as they are retained for ongoing jobs based on their planned_core/planned_support.

    Args:
        future_visits: List of visit dicts with tail_num, start_date, end_date, num_engineers, num_technicians
        visit_details_df: DataFrame with aircraft requirements per tail number
        emp_license_df: DataFrame with employee certifications
        emp_roster_df: DataFrame with employee schedules
        emp_similarity_df: DataFrame with employee similarity scores (optional)
        eligible_shifts: List of working shift codes
        similarity_threshold: Minimum similarity score for fallback employees
        emp_work_daily_df: DataFrame with current employee assignments (optional)
        tech_work_summary_df: DataFrame with technician work history (optional)
        retained_emp_ids: Set of employee IDs to exclude (retained for ongoing jobs)
        ongoing_jobs_context: List of ongoing job contexts for LLM reference

    Returns:
        Dict with visits context, detected conflicts, and ongoing jobs info
    """
    # Initialize retained_emp_ids as empty set if not provided
    if retained_emp_ids is None:
        retained_emp_ids = set()
    
    if ongoing_jobs_context is None:
        ongoing_jobs_context = []
    
    visits_context = []
    all_eligible_by_visit = {}

    for idx, visit in enumerate(future_visits):
        tail_num = visit["tail_num"]
        start_date = visit["start_date"]
        end_date = visit["end_date"]
        num_engineers = visit["num_engineers"]
        num_technicians = visit.get("num_technicians", 0)  # Number of technicians required
        lic_req = visit.get("lic_req")  # License requirement (e.g., 'A320-CFM56-GCAA')

        # Get requirements - from lic_req if provided, otherwise from tail number
        reqs = get_requirements_from_lic_req_or_tail(tail_num, visit_details_df, lic_req)
        if reqs is None:
            visits_context.append({
                "visit_id": idx,
                "tail_num": tail_num,
                "lic_req": lic_req,
                "error": f"No visit details found for tail number '{tail_num}' or license requirement '{lic_req}'"
            })
            continue

        # Get PRIMARY eligible employees (certified engineers)
        # Pass lic_req to allow finding employees by license requirement
        eligible_df = get_eligible_employees(tail_num, visit_details_df, emp_license_df, lic_req, verbose=verbose)
        # Handle both 'emp_id' and 'id' column names for compatibility
        emp_id_col = "emp_id" if "emp_id" in eligible_df.columns else "id"
        primary_emp_ids = eligible_df[emp_id_col].tolist() if not eligible_df.empty else []

        # Get PRIMARY availability
        primary_available_df = get_available_employees(
            primary_emp_ids, start_date, end_date, emp_roster_df, eligible_shifts
        )

        # Build PRIMARY availability matrix
        primary_availability = build_employee_availability_matrix(primary_available_df)
        
        # Filter out retained employees (Business Rule: retain for ongoing jobs)
        if retained_emp_ids:
            primary_availability = {
                emp_id: data for emp_id, data in primary_availability.items()
                if emp_id not in retained_emp_ids
            }

        # Calculate visit days
        visit_days = pd.date_range(start_date, end_date).strftime("%Y-%m-%d").tolist()

        # Classify PRIMARY coverage
        primary_full_coverage, primary_partial_coverage = classify_coverage(
            primary_availability, visit_days
        )

        # Get SIMILAR employees as fallback
        similar_data = expand_eligible_pool_with_similar(
            primary_emp_ids,
            emp_similarity_df,
            start_date,
            end_date,
            emp_roster_df,
            eligible_shifts,
            similarity_threshold
        )
        
        # Filter out retained employees from similar data (Business Rule)
        if retained_emp_ids and similar_data.get("similar_employees"):
            similar_data["similar_employees"] = {
                emp_id: data for emp_id, data in similar_data["similar_employees"].items()
                if emp_id not in retained_emp_ids
            }
            # Update coverage lists
            similar_data["similar_full_coverage_emp_ids"] = [
                emp_id for emp_id in similar_data.get("similar_full_coverage_emp_ids", [])
                if emp_id not in retained_emp_ids
            ]
            similar_data["similar_partial_coverage_employees"] = [
                emp for emp in similar_data.get("similar_partial_coverage_employees", [])
                if emp.get("emp_id") not in retained_emp_ids
            ]

        # Get employees BECOMING AVAILABLE (currently assigned but job ends soon)
        upcoming_data = get_employees_becoming_available(
            eligible_emp_ids=primary_emp_ids,
            visit_start_date=start_date,
            visit_end_date=end_date,
            emp_work_daily_df=emp_work_daily_df,
            emp_roster_df=emp_roster_df,
            emp_license_df=emp_license_df,
            eligible_shifts=eligible_shifts,
            days_before_start=7
        )
        
        # Filter out retained employees from upcoming data (Business Rule)
        if retained_emp_ids and upcoming_data.get("upcoming_employees"):
            original_count = len(upcoming_data["upcoming_employees"])
            upcoming_data["upcoming_employees"] = {
                emp_id: data for emp_id, data in upcoming_data["upcoming_employees"].items()
                if emp_id not in retained_emp_ids
            }
            filtered_count = len(upcoming_data["upcoming_employees"])
            # Update summary
            if upcoming_data.get("summary"):
                upcoming_data["summary"]["total_becoming_available"] = filtered_count
                upcoming_data["summary"]["filtered_retained"] = original_count - filtered_count

        # Get TECHNICIANS based on work history
        technician_data = {
            "technicians": {},
            "full_coverage_count": 0,
            "full_coverage_emp_ids": [],
            "partial_coverage_employees": []
        }
        
        if num_technicians > 0 and tech_work_summary_df is not None:
            # Get eligible technicians based on their most worked aircraft
            eligible_techs_df = get_eligible_technicians(
                lic_req=lic_req,
                tail_num=tail_num,
                visit_details_df=visit_details_df,
                tech_work_summary_df=tech_work_summary_df,
                title_filter=['TECH']  # Only TECH, not CC
            )
            
            if not eligible_techs_df.empty:
                tech_emp_ids = eligible_techs_df['id'].tolist()
                
                # Get technician availability
                tech_available_df = get_available_technicians(
                    tech_emp_ids, start_date, end_date, 
                    emp_roster_df, eligible_shifts, tech_work_summary_df
                )
                
                # Build technician availability matrix
                tech_availability = build_technician_availability_matrix(
                    tech_available_df, eligible_techs_df
                )
                
                # Classify technician coverage
                tech_full_coverage, tech_partial_coverage = classify_coverage(
                    tech_availability, visit_days
                )
                
                technician_data = {
                    "technicians": tech_availability,
                    "full_coverage_count": len(tech_full_coverage),
                    "full_coverage_emp_ids": tech_full_coverage,
                    "partial_coverage_employees": tech_partial_coverage
                }
        
        # Filter out retained employees from technician data (Business Rule)
        if retained_emp_ids and technician_data.get("technicians"):
            technician_data["technicians"] = {
                emp_id: data for emp_id, data in technician_data["technicians"].items()
                if emp_id not in retained_emp_ids
            }
            technician_data["full_coverage_emp_ids"] = [
                emp_id for emp_id in technician_data.get("full_coverage_emp_ids", [])
                if emp_id not in retained_emp_ids
            ]
            technician_data["full_coverage_count"] = len(technician_data["full_coverage_emp_ids"])
            technician_data["partial_coverage_employees"] = [
                emp for emp in technician_data.get("partial_coverage_employees", [])
                if emp.get("emp_id") not in retained_emp_ids
            ]

        # Track for conflict detection (primary, similar, and upcoming)
        all_eligible_by_visit[idx] = (
            set(primary_availability.keys()) |
            set(similar_data["similar_employees"].keys()) |
            set(upcoming_data["upcoming_employees"].keys()) |
            set(technician_data["technicians"].keys())
        )

        visits_context.append({
            "visit_id": idx,
            "tail_num": tail_num,
            "lic_req": lic_req,  # License requirement if provided
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "required_engineers": num_engineers,
            "required_technicians": num_technicians,  # Technicians required
            "requirements": reqs,
            "visit_days": visit_days,
            # Primary employees (Engineers)
            "primary_employees": primary_availability,
            "primary_full_coverage_count": len(primary_full_coverage),
            "primary_full_coverage_emp_ids": primary_full_coverage,
            "primary_partial_coverage_employees": primary_partial_coverage,
            # Similar employees (fallback)
            "similar_employees": similar_data["similar_employees"],
            "similar_full_coverage_emp_ids": similar_data["similar_full_coverage_emp_ids"],
            "similar_partial_coverage_employees": similar_data["similar_partial_coverage_employees"],
            # Upcoming available employees (currently assigned, becoming free)
            "upcoming_employees": upcoming_data["upcoming_employees"],
            "upcoming_summary": upcoming_data["summary"],
            # Technicians (based on work history)
            "technicians": technician_data["technicians"],
            "technician_full_coverage_count": technician_data["full_coverage_count"],
            "technician_full_coverage_emp_ids": technician_data["full_coverage_emp_ids"],
            "technician_partial_coverage_employees": technician_data["partial_coverage_employees"],
        })

    # Detect conflicts: employees eligible for multiple visits
    conflicts = detect_conflicts(all_eligible_by_visit, future_visits)

    return {
        "visits": visits_context,
        "conflicts": conflicts,
        "total_visits": len(future_visits),
        "ongoing_jobs": ongoing_jobs_context,  # Include ongoing job info for LLM context
        "retained_emp_count": len(retained_emp_ids) if retained_emp_ids else 0
    }


def detect_conflicts(all_eligible_by_visit: dict, future_visits: list) -> list:
    """
    Detect employees eligible for multiple overlapping visits.

    Args:
        all_eligible_by_visit: Dict mapping visit_id -> set of eligible emp_ids
        future_visits: List of visit dicts with dates

    Returns:
        List of conflict dicts
    """
    conflicts = []
    visit_indices = list(all_eligible_by_visit.keys())

    for i in range(len(visit_indices)):
        for j in range(i + 1, len(visit_indices)):
            v1, v2 = visit_indices[i], visit_indices[j]
            overlap = all_eligible_by_visit[v1] & all_eligible_by_visit[v2]

            if overlap:
                v1_data = future_visits[v1]
                v2_data = future_visits[v2]

                # Check if visits overlap in time
                if not (v1_data["end_date"] < v2_data["start_date"] or
                        v2_data["end_date"] < v1_data["start_date"]):
                    conflicts.append({
                        "visit_1": v1,
                        "visit_2": v2,
                        "overlapping_employees": list(overlap),
                        "overlap_type": "time_and_eligibility"
                    })
                else:
                    conflicts.append({
                        "visit_1": v1,
                        "visit_2": v2,
                        "overlapping_employees": list(overlap),
                        "overlap_type": "eligibility_only"
                    })

    return conflicts


def allocate_resources(
    future_visits: list,
    visit_details_df: pd.DataFrame,
    emp_license_df: pd.DataFrame,
    emp_roster_df: pd.DataFrame,
    shift_code_master_df: pd.DataFrame,
    emp_similarity_df: Optional[pd.DataFrame] = None,
    emp_work_daily_df: Optional[pd.DataFrame] = None,
    bay_status_df: Optional[pd.DataFrame] = None,
    bay_constraints_df: Optional[pd.DataFrame] = None,
    aircraft_size_df: Optional[pd.DataFrame] = None,
    tech_work_summary_df: Optional[pd.DataFrame] = None,
    llm_client: Optional[AzureOpenAI] = None,
    model: Optional[str] = None,
    max_retries: Optional[int] = None,
    verbose: bool = True,
    retained_emp_ids: Optional[set] = None,
    ongoing_jobs_context: Optional[list] = None
) -> dict:
    """
    Complete resource allocation pipeline.

    Args:
        future_visits: List of visit dicts with tail_num, start_date, end_date, num_engineers, num_technicians
        visit_details_df: DataFrame with aircraft requirements per tail number
        emp_license_df: DataFrame with employee certifications
        emp_roster_df: DataFrame with employee schedules
        shift_code_master_df: DataFrame with shift definitions
        emp_similarity_df: DataFrame with employee similarity scores (optional)
        emp_work_daily_df: DataFrame with current employee assignments and end dates (optional)
        bay_status_df: DataFrame with bay availability (optional)
        bay_constraints_df: DataFrame with bay to aircraft type constraints (optional)
        aircraft_size_df: DataFrame with aircraft to body type mapping (optional)
        tech_work_summary_df: DataFrame with technician work history (optional)
        llm_client: Azure OpenAI client (created if not provided)
        model: Model name to use (default from config)
        max_retries: Number of retry attempts if validation fails (default from config)
        verbose: Print progress messages
        retained_emp_ids: Set of employee IDs to exclude from allocation (retained for ongoing jobs)
        ongoing_jobs_context: List of ongoing job contexts for LLM reference

    Returns:
        Dict with allocation_result, validation_report, allocation_df, bay_allocations, and context
    """
    config = get_config()

    if max_retries is None:
        max_retries = config.allocation.max_retries

    if model is None:
        model = config.azure_openai.model

    if llm_client is None:
        llm_client = get_llm_client()

    # Get eligible shifts
    eligible_shifts = get_eligible_shifts(shift_code_master_df)

    # Ensure dates are datetime
    emp_roster_df = emp_roster_df.copy()
    emp_roster_df["date"] = pd.to_datetime(emp_roster_df["date"])

    # Initialize retained_emp_ids as empty set if not provided
    if retained_emp_ids is None:
        retained_emp_ids = set()
    
    if ongoing_jobs_context is None:
        ongoing_jobs_context = []

    # Step 1: Prepare context (includes similar employees and upcoming available)
    if verbose:
        print("Step 1: Preparing allocation context...")
        if retained_emp_ids:
            print(f"  - Excluding {len(retained_emp_ids)} retained employees from allocation pool")
        if ongoing_jobs_context:
            print(f"  - {len(ongoing_jobs_context)} ongoing jobs with retained resources")

    allocation_context = prepare_allocation_context(
        future_visits,
        visit_details_df,
        emp_license_df,
        emp_roster_df,
        emp_similarity_df,
        eligible_shifts,
        config.allocation.similarity_threshold,
        emp_work_daily_df,
        tech_work_summary_df,
        retained_emp_ids,
        ongoing_jobs_context,
        verbose=verbose
    )

    # Log warnings for visits with no eligible employees/technicians
    for visit in allocation_context["visits"]:
        if "error" not in visit:
            primary_count = len(visit["primary_employees"])
            similar_count = len(visit["similar_employees"])
            upcoming_count = len(visit.get("upcoming_employees", {}))
            technician_count = len(visit.get("technicians", {}))
            required_techs = visit.get("required_technicians", 0)

            if primary_count == 0 and similar_count == 0 and upcoming_count == 0:
                if verbose:
                    print(f"WARNING: Visit {visit['visit_id']} ({visit['tail_num']}) has NO eligible employees!")
            elif primary_count == 0 and similar_count == 0:
                if verbose:
                    print(f"INFO: Visit {visit['visit_id']} ({visit['tail_num']}) has no available primary/similar employees, {upcoming_count} becoming available soon")
            elif primary_count == 0:
                if verbose:
                    print(f"INFO: Visit {visit['visit_id']} ({visit['tail_num']}) has no primary employees, {similar_count} similar + {upcoming_count} upcoming available")
            elif upcoming_count > 0:
                if verbose:
                    print(f"INFO: Visit {visit['visit_id']} ({visit['tail_num']}) has {upcoming_count} additional employees becoming available")
            
            # Log technician info
            if required_techs > 0:
                if technician_count == 0:
                    if verbose:
                        print(f"WARNING: Visit {visit['visit_id']} ({visit['tail_num']}) requires {required_techs} technicians but found NONE with relevant experience!")
                elif technician_count < required_techs:
                    if verbose:
                        print(f"INFO: Visit {visit['visit_id']} ({visit['tail_num']}) requires {required_techs} technicians, found {technician_count} with relevant experience")
                else:
                    if verbose:
                        print(f"INFO: Visit {visit['visit_id']} ({visit['tail_num']}) has {technician_count} technicians available (need {required_techs})")

    # Step 2: Call LLM
    if verbose:
        print("Step 2: Calling LLM for allocation...")

    allocation_result = None
    validation_report = None

    for attempt in range(max_retries + 1):
        try:
            allocation_result = allocate_resources_with_llm(
                allocation_context, llm_client, model, verbose
            )

            if verbose:
                print(f"Step 3: Validating allocation (attempt {attempt + 1})...")

            validation_report = validate_allocation(allocation_result, allocation_context)

            if validation_report["is_valid"]:
                if verbose:
                    print("Allocation VALID!")
                break
            else:
                if verbose:
                    print(f"Validation failed with {len(validation_report['violations'])} violations")
                if attempt < max_retries:
                    if verbose:
                        print("Retrying...")

        except Exception as e:
            if verbose:
                print(f"Error during allocation: {e}")
            if attempt == max_retries:
                raise

    allocation_df = allocation_to_dataframe(allocation_result) if allocation_result else pd.DataFrame()

    # Step 4: Allocate bays
    bay_allocations = {}
    if bay_status_df is not None or bay_constraints_df is not None or aircraft_size_df is not None:
        if verbose:
            print("Step 4: Allocating bays...")

        bay_allocations = allocate_bays_for_visits(
            visits=future_visits,
            visit_details_df=visit_details_df,
            bay_status_df=bay_status_df,
            bay_constraints_df=bay_constraints_df,
            aircraft_size_df=aircraft_size_df
        )

        # Add bay info to allocation DataFrame - bay_allocations is keyed by tail_num
        if not allocation_df.empty and bay_allocations:
            allocation_df["bay"] = allocation_df["tail_num"].map(
                lambda tail: bay_allocations.get(tail, {}).get("bay")
            )
            allocation_df["body_type"] = allocation_df["tail_num"].map(
                lambda tail: bay_allocations.get(tail, {}).get("body_type")
            )

        if verbose:
            for tail_num, bay_info in bay_allocations.items():
                status = bay_info.get("status", "unknown")
                bay = bay_info.get("bay", "None")
                body_type = bay_info.get("body_type", "unknown")
                print(f"  {tail_num}: {bay} ({body_type}) - {status}")

    return {
        "allocation_result": allocation_result,
        "validation_report": validation_report,
        "allocation_df": allocation_df,
        "bay_allocations": bay_allocations,
        "context": allocation_context
    }


def diagnose_employee_availability(
    emp_ids: list,
    start_date,
    end_date,
    emp_roster_df: pd.DataFrame,
    shift_code_master_df: pd.DataFrame
) -> pd.DataFrame:
    """
    Diagnose why employees are not available on certain days.
    Shows what shift they have on each day and whether it's a working shift.

    Args:
        emp_ids: List of employee IDs to diagnose
        start_date: Start date
        end_date: End date
        emp_roster_df: Employee roster DataFrame
        shift_code_master_df: Shift definitions DataFrame

    Returns:
        DataFrame with availability diagnosis
    """
    emp_roster_df = emp_roster_df.copy()
    emp_roster_df["date"] = pd.to_datetime(emp_roster_df["date"])

    eligible_shifts = get_eligible_shifts(shift_code_master_df)

    # Get all days in the range
    all_days = pd.date_range(start_date, end_date)

    results = []
    for emp_id in emp_ids:
        emp_roster = emp_roster_df[emp_roster_df["id"] == emp_id]
        emp_name = emp_roster["name"].iloc[0] if not emp_roster.empty else "Unknown"

        for day in all_days:
            day_roster = emp_roster[emp_roster["date"] == day]

            if day_roster.empty:
                results.append({
                    "emp_id": emp_id,
                    "name": emp_name,
                    "date": day.strftime("%Y-%m-%d"),
                    "shift": "NO ROSTER ENTRY",
                    "is_working_shift": False,
                    "available": False,
                    "reason": "No roster entry for this date"
                })
            else:
                shift = day_roster["task"].iloc[0]
                is_working = shift in eligible_shifts

                # Get shift details
                shift_info = shift_code_master_df[shift_code_master_df["shift_code"] == shift]
                duration = shift_info["duration_hours"].iloc[0] if not shift_info.empty else 0

                reason = "Available - working shift" if is_working else f"Not available - shift '{shift}' has {duration}h duration"

                results.append({
                    "emp_id": emp_id,
                    "name": emp_name,
                    "date": day.strftime("%Y-%m-%d"),
                    "shift": shift,
                    "duration_hours": duration,
                    "is_working_shift": is_working,
                    "available": is_working,
                    "reason": reason
                })

    return pd.DataFrame(results)
