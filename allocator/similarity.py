"""
Similar Employees Fallback Logic for MRO Resource Allocator
===========================================================
Functions to find and process similar employees as fallback
when primary eligible employees are insufficient.
"""

import pandas as pd
import json
from typing import Optional

from .config import get_config
from .eligibility import get_available_employees, build_employee_availability_matrix


def parse_similar_employees(similar_emp_value) -> list:
    """
    Parse the similar_emp column value into a list of dicts.

    The column can contain:
    - A JSON string: '[{"employee_number": "AB123", ...}]'
    - A Python list (if already parsed)
    - None or empty

    Args:
        similar_emp_value: Value from the similar_emp column

    Returns:
        List of similar employee dicts with employee_number, full_name, score
    """
    if similar_emp_value is None:
        return []

    if isinstance(similar_emp_value, list):
        return similar_emp_value

    if isinstance(similar_emp_value, str):
        try:
            return json.loads(similar_emp_value)
        except json.JSONDecodeError:
            return []

    return []


def get_similar_emp_column(df: pd.DataFrame) -> str:
    """
    Get the similar employee column name (handles variations like 'similar_emp' or 'similar_ emp').
    """
    for col in df.columns:
        if "similar" in col.lower() and "emp" in col.lower():
            return col
    raise KeyError("No similar employee column found in DataFrame")


def get_similar_employees_for_primary(
    primary_emp_ids: list,
    emp_similarity_df: Optional[pd.DataFrame],
    similarity_threshold: Optional[float] = None
) -> dict:
    """
    Get similar employees for a list of primary eligible employees.

    Args:
        primary_emp_ids: List of primary eligible employee IDs
        emp_similarity_df: DataFrame with similarity data
        similarity_threshold: Minimum similarity score (default from config)

    Returns:
        Dict mapping similar_emp_id -> {name, max_score, similar_to: [primary_emp_ids]}
    """
    if emp_similarity_df is None or emp_similarity_df.empty:
        return {}

    if similarity_threshold is None:
        config = get_config()
        similarity_threshold = config.allocation.similarity_threshold

    # Get the correct column name (handles 'similar_emp' or 'similar_ emp')
    similar_col = get_similar_emp_column(emp_similarity_df)

    similar_employees = {}

    for primary_id in primary_emp_ids:
        # Find the row for this primary employee
        row = emp_similarity_df[emp_similarity_df["employee_number"] == primary_id]

        if row.empty:
            continue

        similar_list = parse_similar_employees(row[similar_col].iloc[0])

        for similar in similar_list:
            score = similar.get("score", 0)

            # Skip if below threshold
            if score < similarity_threshold:
                continue

            sim_id = similar.get("employee_number")
            sim_name = similar.get("full_name", "Unknown")

            # Skip if this similar employee is already a primary employee
            if sim_id in primary_emp_ids:
                continue

            if sim_id not in similar_employees:
                similar_employees[sim_id] = {
                    "name": sim_name,
                    "max_score": score,
                    "similar_to": [primary_id]
                }
            else:
                # Update max score if higher
                if score > similar_employees[sim_id]["max_score"]:
                    similar_employees[sim_id]["max_score"] = score
                # Track which primary employees this is similar to
                if primary_id not in similar_employees[sim_id]["similar_to"]:
                    similar_employees[sim_id]["similar_to"].append(primary_id)

    return similar_employees


def get_similar_employees_availability(
    similar_employees: dict,
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
    emp_roster_df: pd.DataFrame,
    eligible_shifts: list
) -> dict:
    """
    Get availability matrix for similar employees.

    Args:
        similar_employees: Dict from get_similar_employees_for_primary
        start_date: Visit start date
        end_date: Visit end date
        emp_roster_df: Employee roster DataFrame
        eligible_shifts: List of working shift codes

    Returns:
        Availability matrix with similarity scores included
    """
    if not similar_employees:
        return {}

    similar_emp_ids = list(similar_employees.keys())

    # Build similarity scores dict for the availability matrix
    similarity_scores = {
        emp_id: data["max_score"]
        for emp_id, data in similar_employees.items()
    }

    # Get availability
    available_df = get_available_employees(
        similar_emp_ids,
        start_date,
        end_date,
        emp_roster_df,
        eligible_shifts
    )

    # Build matrix with similarity scores
    matrix = build_employee_availability_matrix(available_df, similarity_scores)

    return matrix


def expand_eligible_pool_with_similar(
    primary_emp_ids: list,
    emp_similarity_df: Optional[pd.DataFrame],
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
    emp_roster_df: pd.DataFrame,
    eligible_shifts: list,
    similarity_threshold: Optional[float] = None
) -> dict:
    """
    Main function to expand the eligible pool with similar employees.

    Args:
        primary_emp_ids: List of primary eligible employee IDs
        emp_similarity_df: DataFrame with similarity data
        start_date: Visit start date
        end_date: Visit end date
        emp_roster_df: Employee roster DataFrame
        eligible_shifts: List of working shift codes
        similarity_threshold: Minimum similarity score

    Returns:
        Dict with:
            - similar_employees: Availability matrix for similar employees
            - similar_full_coverage_emp_ids: IDs with full coverage
            - similar_partial_coverage_employees: Partial coverage details
    """
    # Get similar employees based on primary employees
    similar_employees = get_similar_employees_for_primary(
        primary_emp_ids,
        emp_similarity_df,
        similarity_threshold
    )

    if not similar_employees:
        return {
            "similar_employees": {},
            "similar_full_coverage_emp_ids": [],
            "similar_partial_coverage_employees": []
        }

    # Get their availability
    similar_availability = get_similar_employees_availability(
        similar_employees,
        start_date,
        end_date,
        emp_roster_df,
        eligible_shifts
    )

    # Calculate visit days
    visit_days = pd.date_range(start_date, end_date).strftime("%Y-%m-%d").tolist()

    # Classify coverage
    full_coverage_emps = []
    partial_coverage_emps = []

    for emp_id, emp_data in similar_availability.items():
        available_days = set(emp_data["dates"].keys())
        if set(visit_days).issubset(available_days):
            full_coverage_emps.append(emp_id)
        else:
            partial_coverage_emps.append({
                "emp_id": emp_id,
                "available_days": list(available_days),
                "missing_days": list(set(visit_days) - available_days)
            })

    return {
        "similar_employees": similar_availability,
        "similar_full_coverage_emp_ids": full_coverage_emps,
        "similar_partial_coverage_employees": partial_coverage_emps
    }
