"""
Employee Eligibility Logic for MRO Resource Allocator
======================================================
Functions to determine which employees are eligible for visits
based on certifications and availability.
"""

import pandas as pd
from typing import Optional, List, Tuple


def get_visit_requirements(tail_num: str, visit_details_df: pd.DataFrame) -> Optional[dict]:
    """
    Get aircraft, engine, and license requirements for a tail number.

    Args:
        tail_num: Aircraft tail number
        visit_details_df: DataFrame with visit requirements

    Returns:
        Dict with aircraft, engine, license requirements or None if not found
    """
    row = visit_details_df[visit_details_df["tail_num"] == tail_num]
    if row.empty:
        return None
    return {
        "aircraft": row["aircraft_clean"].iloc[0],
        "engine": row["engine_clean"].iloc[0],
        "license": row["lic"].iloc[0]
    }


def parse_lic_req(lic_req: str) -> Optional[dict]:
    """
    Parse a license requirement string (e.g., 'A320-CFM56-GCAA') into components.
    
    Format expected: AIRCRAFT-ENGINE-LICENSE
    
    Handles aircraft names with variants like:
    - B787-8-RRRB211TRENT1000-FAA -> aircraft=B787-8, engine=RRRB211TRENT1000, license=FAA
    - A330-200-RRTRENT700-GCAA -> aircraft=A330-200, engine=RRTRENT700, license=GCAA
    - A320-CFM56-GCAA -> aircraft=A320, engine=CFM56, license=GCAA
    
    Args:
        lic_req: License requirement string
        
    Returns:
        Dict with aircraft, engine, license or None if invalid format
    """
    if not lic_req:
        return None
    
    parts = lic_req.split('-')
    if len(parts) < 3:
        return None
    
    # License is always the last part (GCAA, EASA, FAA, UKCAA, etc.)
    license_type = parts[-1]
    
    # Aircraft variant patterns - these indicate the part is still part of the aircraft name
    # Examples: 8, 9, 10 (B787-8, B787-9, B787-10)
    #           200, 300, 600, 700, 800, 900 (A330-200, B737-800)
    #           300F, 900ER, 200LR (B767-300F, B737-900ER, B777-200LR)
    #           V2 (A320V2)
    import re
    aircraft_variant_pattern = re.compile(r'^(\d{1,3}|V\d|\d{3}[A-Z]{1,2})$')
    
    # Start with first part as aircraft
    aircraft_parts = [parts[0]]
    engine_start_idx = 1
    
    # Check if subsequent parts are aircraft variants (until we hit the engine)
    for i in range(1, len(parts) - 1):  # -1 because last is license
        part = parts[i]
        # If it looks like an aircraft variant, include it in aircraft
        if aircraft_variant_pattern.match(part):
            aircraft_parts.append(part)
            engine_start_idx = i + 1
        else:
            # This is the start of the engine name
            break
    
    # Everything between aircraft and license is the engine
    engine_parts = parts[engine_start_idx:-1]
    
    if not engine_parts:
        return None
    
    aircraft = '-'.join(aircraft_parts)
    engine = '-'.join(engine_parts)
    
    return {
        "aircraft": aircraft,
        "engine": engine,
        "license": license_type
    }


def get_requirements_from_lic_req_or_tail(
    tail_num: str,
    visit_details_df: pd.DataFrame,
    lic_req: Optional[str] = None
) -> Optional[dict]:
    """
    Get requirements either from lic_req directly or by looking up tail number.
    
    Tries lic_req first if provided, then falls back to tail number lookup.
    
    Args:
        tail_num: Aircraft tail number (or identifier)
        visit_details_df: DataFrame with visit requirements
        lic_req: License requirement string (e.g., 'A320-CFM56-GCAA')
        
    Returns:
        Dict with aircraft, engine, license requirements or None if not found
    """
    # First try lic_req if provided
    if lic_req:
        parsed = parse_lic_req(lic_req)
        if parsed:
            return parsed
    
    # Fall back to tail number lookup
    return get_visit_requirements(tail_num, visit_details_df)


def get_eligible_employees(
    tail_num: str,
    visit_details_df: pd.DataFrame,
    emp_license_df: pd.DataFrame,
    lic_req: Optional[str] = None,
    verbose: bool = False
) -> pd.DataFrame:
    """
    Get employees who have the required certifications for a tail number or license requirement.

    If lic_req is provided, uses it directly to find eligible employees.
    Otherwise, looks up requirements by tail number.

    Args:
        tail_num: Aircraft tail number
        visit_details_df: DataFrame with visit requirements
        emp_license_df: DataFrame with employee certifications
        lic_req: License requirement string (e.g., 'A320-CFM56-GCAA') - optional
        verbose: Print debug information

    Returns:
        DataFrame of eligible employees
    """
    # Get requirements from lic_req or tail number
    reqs = get_requirements_from_lic_req_or_tail(tail_num, visit_details_df, lic_req)

    if verbose:
        print(f"  DEBUG get_eligible_employees({tail_num}, lic_req={lic_req}):")
        print(f"    Parsed requirements: {reqs}")

    if reqs is None:
        if verbose:
            print(f"    ERROR: Could not parse requirements!")
        return pd.DataFrame()

    eligible = emp_license_df[
        (emp_license_df["aircraft"] == reqs["aircraft"]) &
        (emp_license_df["engine"] == reqs["engine"]) &
        (emp_license_df["lic"] == reqs["license"])
    ]

    if verbose:
        print(f"    Found {len(eligible)} eligible employees for {reqs['aircraft']}-{reqs['engine']}-{reqs['license']}")
        if len(eligible) == 0:
            # Show what's available in the database
            unique_combos = emp_license_df[['aircraft', 'engine', 'lic']].drop_duplicates()
            matching_aircraft = unique_combos[unique_combos['aircraft'] == reqs['aircraft']]
            if len(matching_aircraft) > 0:
                print(f"    Available combos for aircraft {reqs['aircraft']}:")
                for _, row in matching_aircraft.head(5).iterrows():
                    print(f"      - {row['aircraft']}-{row['engine']}-{row['lic']}")
            else:
                print(f"    No employees have license for aircraft: {reqs['aircraft']}")

    return eligible


def get_available_employees(
    eligible_emp_ids: list,
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
    emp_roster_df: pd.DataFrame,
    eligible_shifts: list
) -> pd.DataFrame:
    """
    Get roster entries for eligible employees who are working during the period.

    Args:
        eligible_emp_ids: List of employee IDs to check
        start_date: Visit start date
        end_date: Visit end date
        emp_roster_df: DataFrame with employee schedules
        eligible_shifts: List of shift codes that count as working

    Returns:
        DataFrame of available employee roster entries
    """
    available = emp_roster_df[
        (emp_roster_df["id"].isin(eligible_emp_ids)) &
        (emp_roster_df["date"].between(start_date, end_date)) &
        (emp_roster_df["task"].isin(eligible_shifts))
    ]
    return available


def build_employee_availability_matrix(
    available_df: pd.DataFrame,
    similarity_scores: Optional[dict] = None
) -> dict:
    """
    Build a per-employee, per-date availability structure.

    Args:
        available_df: DataFrame with available roster entries
        similarity_scores: Optional dict of {emp_id: score} for similar employees

    Returns:
        {emp_id: {name, team, dates: {date_str: shift_code}, similarity_score: float|None}, ...}
    """
    matrix = {}
    for _, row in available_df.iterrows():
        emp_id = row["id"]
        date_str = row["date"].strftime("%Y-%m-%d")
        if emp_id not in matrix:
            matrix[emp_id] = {
                "name": row["name"],
                "team": row["team"],
                "dates": {},
                "similarity_score": similarity_scores.get(emp_id) if similarity_scores else None
            }
        matrix[emp_id]["dates"][date_str] = row["task"]
    return matrix


def classify_coverage(
    availability_matrix: dict,
    visit_days: list
) -> tuple[list, list]:
    """
    Classify employees into full coverage and partial coverage.

    Args:
        availability_matrix: Dict from build_employee_availability_matrix
        visit_days: List of date strings for the visit

    Returns:
        Tuple of (full_coverage_emp_ids, partial_coverage_employees)
    """
    full_coverage_emps = []
    partial_coverage_emps = []
    visit_days_set = set(visit_days)

    for emp_id, emp_data in availability_matrix.items():
        available_days = set(emp_data["dates"].keys())
        if visit_days_set.issubset(available_days):
            full_coverage_emps.append(emp_id)
        else:
            partial_coverage_emps.append({
                "emp_id": emp_id,
                "available_days": list(available_days),
                "missing_days": list(visit_days_set - available_days)
            })

    return full_coverage_emps, partial_coverage_emps


def get_eligible_technicians(
    lic_req: Optional[str],
    tail_num: Optional[str],
    visit_details_df: pd.DataFrame,
    tech_work_summary_df: Optional[pd.DataFrame],
    title_filter: Optional[List[str]] = None
) -> pd.DataFrame:
    """
    Get technicians (CC/TECH) who have experience working on the required aircraft.
    
    Technicians are matched based on their most worked aircraft-engine-license 
    combination (max_worked_map_key) from their work history.
    
    Args:
        lic_req: License requirement string (e.g., 'A320-CFM56-GCAA')
        tail_num: Aircraft tail number (fallback if lic_req not provided)
        visit_details_df: DataFrame with visit requirements
        tech_work_summary_df: DataFrame with technician work history (emp_cc_tech_work_summary_vw)
        title_filter: List of titles to include (default: ['CC', 'TECH'])
        
    Returns:
        DataFrame of eligible technicians with their work history stats
    """
    if tech_work_summary_df is None or tech_work_summary_df.empty:
        return pd.DataFrame()
    
    # Get requirements
    reqs = get_requirements_from_lic_req_or_tail(tail_num, visit_details_df, lic_req)
    if reqs is None:
        return pd.DataFrame()
    
    # Build the map_key to match (e.g., "A320-CFM56-GCAA" or "A350-RRTRENTXWB-UKCAA")
    target_map_key = f"{reqs['aircraft']}-{reqs['engine']}-{reqs['license']}"
    
    # Filter by title (default: TECH only, CC can be separate)
    if title_filter is None:
        title_filter = ['TECH']
    
    eligible_df = tech_work_summary_df[
        tech_work_summary_df['title'].isin(title_filter)
    ].copy()
    
    if eligible_df.empty:
        return pd.DataFrame()
    
    # Primary match: technicians whose most worked map_key matches exactly
    primary_matches = eligible_df[
        eligible_df['max_worked_map_key'] == target_map_key
    ].copy()
    
    # Secondary match: technicians who have worked on the same aircraft type
    # (even if engine/license differs)
    secondary_matches = eligible_df[
        (eligible_df['max_worked_aircraft'] == reqs['aircraft']) &
        (~eligible_df['id'].isin(primary_matches['id']))
    ].copy()
    
    # Mark match type
    if not primary_matches.empty:
        primary_matches['match_type'] = 'exact'
        primary_matches['match_score'] = 100
    
    if not secondary_matches.empty:
        secondary_matches['match_type'] = 'aircraft_only'
        secondary_matches['match_score'] = 70
    
    # Combine results, primary matches first
    result = pd.concat([primary_matches, secondary_matches], ignore_index=True)
    
    # Sort by match score (descending) then by experience (map_key_occurrences)
    if not result.empty and 'map_key_occurrences' in result.columns:
        result = result.sort_values(
            ['match_score', 'map_key_occurrences'], 
            ascending=[False, False]
        )
    
    return result


def get_available_technicians(
    tech_emp_ids: list,
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
    emp_roster_df: pd.DataFrame,
    eligible_shifts: list,
    tech_work_summary_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """
    Get roster entries for eligible technicians who are working during the period.
    
    Args:
        tech_emp_ids: List of technician employee IDs to check
        start_date: Visit start date
        end_date: Visit end date
        emp_roster_df: DataFrame with employee schedules
        eligible_shifts: List of shift codes that count as working
        tech_work_summary_df: DataFrame with technician work history (for enrichment)
        
    Returns:
        DataFrame of available technician roster entries
    """
    available = emp_roster_df[
        (emp_roster_df["id"].isin(tech_emp_ids)) &
        (emp_roster_df["date"].between(start_date, end_date)) &
        (emp_roster_df["task"].isin(eligible_shifts))
    ].copy()
    
    # Enrich with technician info if available
    if tech_work_summary_df is not None and not tech_work_summary_df.empty:
        tech_info = tech_work_summary_df[['id', 'title', 'max_worked_aircraft', 'aircraft_occurrences', 'max_worked_map_key', 'map_key_occurrences']].drop_duplicates()
        available = available.merge(tech_info, on='id', how='left')
    
    return available


def build_technician_availability_matrix(
    available_df: pd.DataFrame,
    eligible_techs_df: pd.DataFrame
) -> dict:
    """
    Build a per-technician, per-date availability structure.
    
    Args:
        available_df: DataFrame with available roster entries for technicians
        eligible_techs_df: DataFrame with eligible technician info (from get_eligible_technicians)
        
    Returns:
        {emp_id: {name, team, title, dates: {date_str: shift_code}, 
                  most_worked_aircraft, experience_count, match_type}, ...}
    """
    # Build lookup for tech info
    tech_info_lookup = {}
    if not eligible_techs_df.empty:
        for _, row in eligible_techs_df.iterrows():
            tech_info_lookup[row['id']] = {
                'title': row.get('title', 'TECH'),
                'max_worked_aircraft': row.get('max_worked_aircraft', ''),
                'experience_count': row.get('map_key_occurrences', 0),
                'match_type': row.get('match_type', 'unknown'),
                'match_score': row.get('match_score', 0)
            }
    
    matrix = {}
    for _, row in available_df.iterrows():
        emp_id = row["id"]
        date_str = row["date"].strftime("%Y-%m-%d")
        
        if emp_id not in matrix:
            tech_info = tech_info_lookup.get(emp_id, {})
            matrix[emp_id] = {
                "name": row["name"],
                "team": row["team"],
                "title": tech_info.get('title', row.get('title', 'TECH')),
                "dates": {},
                "most_worked_aircraft": tech_info.get('max_worked_aircraft', ''),
                "experience_count": tech_info.get('experience_count', 0),
                "match_type": tech_info.get('match_type', 'unknown'),
                "match_score": tech_info.get('match_score', 0)
            }
        matrix[emp_id]["dates"][date_str] = row["task"]
    
    return matrix


def get_employees_becoming_available(
    eligible_emp_ids: list,
    visit_start_date: pd.Timestamp,
    visit_end_date: pd.Timestamp,
    emp_work_daily_df: Optional[pd.DataFrame],
    emp_roster_df: pd.DataFrame,
    emp_license_df: pd.DataFrame,
    eligible_shifts: list,
    days_before_start: int = 7
) -> dict:
    """
    Get employees who will become available before or during a visit period
    based on their current assignment end dates (ets_date).

    An employee is "becoming available" if:
    1. They are currently assigned to a job (in emp_work_daily)
    2. Their current job ends (ets_date) before or during the visit period
    3. They would be available based on their roster after their job ends

    Args:
        eligible_emp_ids: List of employee IDs who have the required certifications
        visit_start_date: Visit start date
        visit_end_date: Visit end date
        emp_work_daily_df: DataFrame with current employee assignments (emp_id, ets_date)
        emp_roster_df: DataFrame with employee schedules
        emp_license_df: DataFrame with employee certifications
        eligible_shifts: List of shift codes that count as working
        days_before_start: Also consider employees becoming free N days before visit starts

    Returns:
        Dict with:
            - upcoming_employees: {emp_id: {name, team, available_from, available_days, current_job_ends}}
            - summary: {total_becoming_available, available_from_start, available_during_visit}
    """
    if emp_work_daily_df is None or emp_work_daily_df.empty:
        return {
            "upcoming_employees": {},
            "summary": {
                "total_becoming_available": 0,
                "available_from_start": 0,
                "available_during_visit": 0
            }
        }

    # Get unique emp_id and their latest ets_date (in case of multiple entries)
    # Handle both 'emp_id' and 'id' column names for compatibility
    emp_id_col = "emp_id" if "emp_id" in emp_work_daily_df.columns else "id"
    emp_end_dates = emp_work_daily_df[[emp_id_col, "ets_date"]].drop_duplicates()
    emp_end_dates = emp_end_dates.groupby(emp_id_col)["ets_date"].max().reset_index()
    # Rename to standard 'emp_id' for consistency
    if emp_id_col != "emp_id":
        emp_end_dates = emp_end_dates.rename(columns={emp_id_col: "emp_id"})

    # Filter to only eligible employees
    emp_end_dates = emp_end_dates[emp_end_dates["emp_id"].isin(eligible_emp_ids)]

    # Calculate the window: employees whose job ends between (visit_start - days_before_start) and visit_end
    lookback_date = visit_start_date - pd.Timedelta(days=days_before_start)

    # Find employees becoming available
    becoming_available = emp_end_dates[
        (emp_end_dates["ets_date"] >= lookback_date) &
        (emp_end_dates["ets_date"] <= visit_end_date)
    ]

    upcoming_employees = {}
    available_from_start_count = 0
    available_during_visit_count = 0

    for _, row in becoming_available.iterrows():
        emp_id = row["emp_id"]
        ets_date = row["ets_date"]

        # The employee becomes available the day after their current job ends
        available_from = ets_date + pd.Timedelta(days=1)

        # Get employee roster data
        emp_roster = emp_roster_df[emp_roster_df["id"] == emp_id]
        if emp_roster.empty:
            continue

        emp_name = emp_roster["name"].iloc[0]
        emp_team = emp_roster["team"].iloc[0] if "team" in emp_roster.columns else "Unknown"

        # Get available days from when they become free until visit end
        check_start = max(available_from, visit_start_date)
        available_roster = emp_roster[
            (emp_roster["date"] >= check_start) &
            (emp_roster["date"] <= visit_end_date) &
            (emp_roster["task"].isin(eligible_shifts))
        ]

        if available_roster.empty:
            continue

        available_days = available_roster["date"].dt.strftime("%Y-%m-%d").tolist()

        # Classify availability timing
        if available_from <= visit_start_date:
            available_from_start_count += 1
        else:
            available_during_visit_count += 1

        upcoming_employees[emp_id] = {
            "name": emp_name,
            "team": emp_team,
            "current_job_ends": ets_date.strftime("%Y-%m-%d"),
            "available_from": available_from.strftime("%Y-%m-%d"),
            "available_days": available_days,
            "days_until_available": max(0, (available_from - visit_start_date).days)
        }

    return {
        "upcoming_employees": upcoming_employees,
        "summary": {
            "total_becoming_available": len(upcoming_employees),
            "available_from_start": available_from_start_count,
            "available_during_visit": available_during_visit_count
        }
    }
