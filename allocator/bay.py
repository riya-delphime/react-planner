"""
Bay Allocation Logic for MRO Resource Allocator
================================================
Functions to allocate bays based on aircraft size and availability.
"""

import pandas as pd
from typing import Optional


def get_aircraft_body_type(
    aircraft: str,
    aircraft_size_df: Optional[pd.DataFrame],
    visit_details_df: Optional[pd.DataFrame] = None
) -> Optional[str]:
    """
    Get the body type (narrowbody/widebody) for an aircraft.

    Args:
        aircraft: Aircraft type (e.g., 'A321', 'B777-300')
        aircraft_size_df: DataFrame with aircraft to body_type mapping
        visit_details_df: Fallback - DataFrame with visit details that may have aircraft info

    Returns:
        Body type string ('narrowbody' or 'widebody') or None if not found
    """
    if aircraft_size_df is not None and not aircraft_size_df.empty:
        match = aircraft_size_df[aircraft_size_df["aircraft"] == aircraft]
        if not match.empty:
            return match["body_type"].iloc[0]

    # Fallback: try to infer from aircraft name
    aircraft_upper = aircraft.upper()
    narrowbody_patterns = ["A319", "A320", "A321", "B737", "B757"]
    widebody_patterns = ["A330", "A340", "A350", "A380", "B747", "B767", "B777", "B787"]

    for pattern in narrowbody_patterns:
        if pattern in aircraft_upper:
            return "narrowbody"

    for pattern in widebody_patterns:
        if pattern in aircraft_upper:
            return "widebody"

    return None


def get_available_bays(
    body_type: str,
    bay_status_df: Optional[pd.DataFrame],
    bay_constraints_df: Optional[pd.DataFrame],
    exclude_bays: Optional[list] = None
) -> list:
    """
    Get list of available bays that can accommodate an aircraft body type.

    Args:
        body_type: Aircraft body type ('narrowbody' or 'widebody')
        bay_status_df: DataFrame with bay availability (bay_alloc, bay_status, aircraft_type)
        bay_constraints_df: DataFrame with bay constraints (bay_alloc, aircraft_type)
        exclude_bays: List of bays to exclude (already allocated)

    Returns:
        List of available bay names, sorted by preference
    """
    if bay_status_df is None or bay_status_df.empty:
        return []

    exclude_bays = exclude_bays or []

    # Filter for available bays
    available = bay_status_df[bay_status_df["bay_status"] == "Available"].copy()

    if available.empty:
        return []

    # If we have constraints, merge them
    if bay_constraints_df is not None and not bay_constraints_df.empty:
        available = pd.merge(
            available,
            bay_constraints_df[["bay_alloc", "aircraft_type"]].drop_duplicates(),
            on="bay_alloc",
            how="left",
            suffixes=("", "_constraint")
        )
        # Use constraint aircraft_type if available
        if "aircraft_type_constraint" in available.columns:
            available["aircraft_type"] = available["aircraft_type_constraint"].fillna(
                available["aircraft_type"]
            )

    # Filter by body type compatibility
    if "aircraft_type" in available.columns:
        compatible = available[available["aircraft_type"] == body_type]
    else:
        # No constraints, assume all bays work
        compatible = available

    # Exclude already allocated bays
    if exclude_bays:
        compatible = compatible[~compatible["bay_alloc"].isin(exclude_bays)]

    return compatible["bay_alloc"].tolist()


def allocate_bay(
    tail_num: str,
    aircraft: str,
    bay_status_df: Optional[pd.DataFrame],
    bay_constraints_df: Optional[pd.DataFrame],
    aircraft_size_df: Optional[pd.DataFrame],
    allocated_bays: Optional[list] = None
) -> dict:
    """
    Allocate a bay for a specific aircraft visit.

    Args:
        tail_num: Aircraft tail number
        aircraft: Aircraft type (e.g., 'A321', 'B777-300')
        bay_status_df: DataFrame with bay availability
        bay_constraints_df: DataFrame with bay constraints
        aircraft_size_df: DataFrame with aircraft to body_type mapping
        allocated_bays: List of bays already allocated to other visits

    Returns:
        Dict with allocation result:
            - bay: Allocated bay name or None
            - body_type: Aircraft body type
            - alternatives: List of other available bays
            - status: 'allocated', 'no_available_bays', 'unknown_aircraft_type'
    """
    allocated_bays = allocated_bays or []

    # Determine body type
    body_type = get_aircraft_body_type(aircraft, aircraft_size_df)

    if body_type is None:
        return {
            "bay": None,
            "body_type": None,
            "alternatives": [],
            "status": "unknown_aircraft_type",
            "message": f"Could not determine body type for aircraft {aircraft}"
        }

    # Get available bays
    available_bays = get_available_bays(
        body_type,
        bay_status_df,
        bay_constraints_df,
        exclude_bays=allocated_bays
    )

    if not available_bays:
        return {
            "bay": None,
            "body_type": body_type,
            "alternatives": [],
            "status": "no_available_bays",
            "message": f"No available {body_type} bays"
        }

    # Allocate first available bay
    allocated_bay = available_bays[0]
    # Limit alternatives to max 2
    alternatives = available_bays[1:3] if len(available_bays) > 1 else []

    return {
        "bay": allocated_bay,
        "body_type": body_type,
        "alternatives": alternatives,
        "status": "allocated",
        "message": f"Allocated {allocated_bay} for {body_type} aircraft"
    }


def allocate_bays_for_visits(
    visits: list,
    visit_details_df: pd.DataFrame,
    bay_status_df: Optional[pd.DataFrame],
    bay_constraints_df: Optional[pd.DataFrame],
    aircraft_size_df: Optional[pd.DataFrame]
) -> dict:
    """
    Allocate bays for multiple visits.

    Args:
        visits: List of visit dicts with tail_num (and optionally aircraft_size)
        visit_details_df: DataFrame with aircraft requirements per tail number
        bay_status_df: DataFrame with bay availability
        bay_constraints_df: DataFrame with bay constraints
        aircraft_size_df: DataFrame with aircraft to body_type mapping

    Returns:
        Dict mapping tail_num -> bay allocation result
    """
    allocations = {}
    allocated_bays = []

    for idx, visit in enumerate(visits):
        tail_num = visit["tail_num"]
        print(f"[BAY] Processing visit {idx}: tail_num={tail_num}, aircraft_size={visit.get('aircraft_size')}")

        # Get aircraft type from visit details database
        visit_row = visit_details_df[visit_details_df["tail_num"] == tail_num]
        print(f"[BAY]   Found in DB: {not visit_row.empty}")

        # Try to get aircraft type from database or visit input
        aircraft = None
        body_type = None

        if not visit_row.empty:
            # Found in database - get aircraft type
            if "aircraft_clean" in visit_row.columns:
                aircraft = visit_row["aircraft_clean"].iloc[0]
            elif "aircraft" in visit_row.columns:
                aircraft = visit_row["aircraft"].iloc[0]
            print(f"[BAY]   Aircraft from DB: {aircraft}")

        # If no aircraft from DB, try to use aircraft_size from visit input (for UI-added aircraft)
        if aircraft is None:
            body_type = visit.get("aircraft_size")
            print(f"[BAY]   Using aircraft_size from visit input: {body_type}")

            if body_type:
                # Use body_type directly from visit input
                print(f"[BAY]   Calling get_available_bays with body_type={body_type}, bay_status_df is {'None' if bay_status_df is None else 'present'}")
                available_bays = get_available_bays(
                    body_type,
                    bay_status_df,
                    bay_constraints_df,
                    exclude_bays=allocated_bays
                )
                if available_bays:
                    allocated_bay = available_bays[0]
                    allocated_bays.append(allocated_bay)
                    allocations[tail_num] = {
                        "bay": allocated_bay,
                        "body_type": body_type,
                        "alternatives": available_bays[1:3] if len(available_bays) > 1 else [],  # Max 2 alternatives
                        "status": "allocated",
                        "message": f"Allocated {allocated_bay} for {body_type} aircraft"
                    }
                else:
                    allocations[tail_num] = {
                        "bay": None,
                        "body_type": body_type,
                        "alternatives": [],
                        "status": "no_available_bays",
                        "message": f"No available {body_type} bays"
                    }
            else:
                # No aircraft info from DB and no aircraft_size from visit - cannot allocate
                allocations[tail_num] = {
                    "bay": None,
                    "body_type": None,
                    "alternatives": [],
                    "status": "unknown_aircraft",
                    "message": f"Could not determine aircraft type for {tail_num}. Provide aircraft_size in visit."
                }
            continue

        # Have aircraft type from database - allocate bay using aircraft_size_df lookup
        result = allocate_bay(
            tail_num=tail_num,
            aircraft=aircraft,
            bay_status_df=bay_status_df,
            bay_constraints_df=bay_constraints_df,
            aircraft_size_df=aircraft_size_df,
            allocated_bays=allocated_bays
        )

        if result["bay"]:
            allocated_bays.append(result["bay"])

        allocations[tail_num] = result

    return allocations

