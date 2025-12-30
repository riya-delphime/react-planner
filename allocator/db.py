"""
Database Operations for MRO Resource Allocator
===============================================
Handles database connections and data loading.
"""

import pandas as pd
import psycopg2
from typing import Optional
from contextlib import contextmanager

from .config import get_config


@contextmanager
def get_db_connection():
    """
    Create and return a database connection as a context manager.

    Usage:
        with get_db_connection() as conn:
            df = pd.read_sql("SELECT * FROM table", conn)
    """
    config = get_config()
    conn = psycopg2.connect(config.database.url)
    try:
        yield conn
    finally:
        conn.close()


def load_data(conn, reference_date: Optional[str] = None) -> dict:
    """
    Load all required tables from the database.

    Args:
        conn: Database connection
        reference_date: Date for bay status lookup (YYYY-MM-DD format, default: today)

    Returns:
        dict with DataFrames:
            - emp_roster: Employee schedule/roster
            - emp_license: Employee certifications (aircraft, engine, license)
            - emp_details: Employee information (emp_360)
            - visit_details: Aircraft visit requirements
            - shift_code_master: Shift definitions
            - emp_similarity: Employee similarity scores (if exists)
            - emp_work_daily: Current employee assignments with end dates (if exists)
            - bay_status: Bay availability status (if exists)
            - bay_constraints: Bay to aircraft type constraints (if exists)
            - aircraft_size: Aircraft to body type mapping (if exists)
            - tech_work_summary: Technician work history summary (if exists)
    """
    emp_roster = pd.read_sql("SELECT * FROM emp_roster", conn)
    emp_license = pd.read_sql("SELECT * FROM emp_lic", conn)
    emp_details = pd.read_sql("SELECT * FROM emp_360", conn)
    visit_details = pd.read_sql("SELECT * FROM visit_details", conn)
    shift_code_master = pd.read_sql("SELECT * FROM shift_code_master", conn)

    # Try to load similarity table if it exists
    emp_similarity = load_emp_similarity(conn)

    # Try to load employee work assignments table if it exists
    emp_work_daily = load_emp_work_daily(conn)

    # Load bay-related data
    bay_data = load_bay_data(conn, reference_date)

    # Load technician work summary (CC/TECH roles)
    tech_work_summary = load_tech_work_summary(conn)

    # Data cleanup
    emp_roster["date"] = pd.to_datetime(emp_roster["date"])

    return {
        "emp_roster": emp_roster,
        "emp_license": emp_license,
        "emp_details": emp_details,
        "visit_details": visit_details,
        "shift_code_master": shift_code_master,
        "emp_similarity": emp_similarity,
        "emp_work_daily": emp_work_daily,
        "tech_work_summary": tech_work_summary,
        **bay_data
    }


def load_emp_similarity(conn) -> Optional[pd.DataFrame]:
    """
    Load employee similarity data if the table exists.

    The similarity table should have:
        - employee_number: The employee ID
        - full_name: Employee name
        - similar_emp: JSON/list of similar employees with scores

    Returns:
        DataFrame or None if table doesn't exist
    """
    try:
        # Check if table exists
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'emp_similarity'
            );
        """
        exists = pd.read_sql(check_query, conn).iloc[0, 0]

        if exists:
            return pd.read_sql("SELECT * FROM emp_similarity", conn)
        else:
            return None
    except Exception:
        return None


def load_emp_work_daily(conn) -> Optional[pd.DataFrame]:
    """
    Load employee work assignment data if the table exists.

    The fact_emp_work_daily table contains current employee assignments with:
        - emp_id: Employee ID
        - ets_date: End date of current assignment (when employee becomes free)

    Returns:
        DataFrame or None if table doesn't exist
    """
    try:
        # Check if table exists
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'fact_emp_work_daily'
            );
        """
        exists = pd.read_sql(check_query, conn).iloc[0, 0]

        if exists:
            df = pd.read_sql("SELECT * FROM fact_emp_work_daily", conn)
            # Clean up - get unique emp_id and ets_date combinations
            if "ets_date" in df.columns:
                df["ets_date"] = pd.to_datetime(df["ets_date"])
            return df
        else:
            return None
    except Exception:
        return None


def load_bay_data(conn, reference_date: Optional[str] = None) -> dict:
    """
    Load bay-related data for bay allocation.

    Args:
        conn: Database connection
        reference_date: Date for bay status lookup (YYYY-MM-DD format)

    Returns:
        Dict with bay_status, bay_constraints, aircraft_size DataFrames (or None if not exists)
    """
    bay_status = None
    bay_constraints = None
    aircraft_size = None

    try:
        # Load bay status using the stored function
        if reference_date:
            bay_status_query = f"SELECT * FROM public.get_bay_status_asof(DATE '{reference_date}')"
        else:
            bay_status_query = "SELECT * FROM public.get_bay_status_asof(CURRENT_DATE)"

        try:
            bay_status = pd.read_sql(bay_status_query, conn)
        except Exception:
            # Function might not exist, try direct table
            pass

        # Load bay constraints
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'bay_constraints'
            );
        """
        if pd.read_sql(check_query, conn).iloc[0, 0]:
            bay_constraints = pd.read_sql("SELECT * FROM bay_constraints", conn)
            # Rename 'bay' to 'bay_alloc' for consistency
            if "bay" in bay_constraints.columns:
                bay_constraints = bay_constraints.rename(columns={"bay": "bay_alloc"})

        # Load aircraft size mapping
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'aircraft_size'
            );
        """
        if pd.read_sql(check_query, conn).iloc[0, 0]:
            aircraft_size = pd.read_sql("SELECT * FROM aircraft_size", conn)

    except Exception:
        pass

    return {
        "bay_status": bay_status,
        "bay_constraints": bay_constraints,
        "aircraft_size": aircraft_size
    }


def load_tech_work_summary(conn) -> Optional[pd.DataFrame]:
    """
    Load technician work summary data if the view/table exists.

    The emp_cc_tech_work_summary_vw contains work history for CC and TECH roles:
        - id: Employee ID
        - name: Employee name
        - team: Team name
        - title: Role (CC, TECH)
        - max_worked_aircraft: Most worked aircraft type
        - aircraft_occurrences: Number of times worked on this aircraft
        - max_worked_map_key: Most worked aircraft-engine-license combination
        - map_key_occurrences: Number of times worked on this combination

    Returns:
        DataFrame or None if view doesn't exist
    """
    try:
        # Check if view exists
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'emp_cc_tech_work_summary_vw'
            );
        """
        exists = pd.read_sql(check_query, conn).iloc[0, 0]

        if exists:
            return pd.read_sql("SELECT * FROM emp_cc_tech_work_summary_vw", conn)
        else:
            return None
    except Exception:
        return None


def get_eligible_shifts(shift_code_master_df: pd.DataFrame) -> list:
    """
    Get list of shift codes that are working shifts (non-zero duration).

    Args:
        shift_code_master_df: DataFrame with shift definitions

    Returns:
        List of eligible shift codes
    """
    return shift_code_master_df[
        shift_code_master_df["duration_hours"] != 0
    ].shift_code.tolist()


def get_retained_resources_for_ongoing_jobs(conn, ongoing_job_tails: list) -> pd.DataFrame:
    """
    Fetch employees who have planned_core or planned_support matching ongoing job tail numbers.
    
    Business Rule: 
    - Assignments done on Apr 30 should continue for ongoing jobs on May 1 and beyond
    - If planned_core == planned_support → Employee is CORE on that job
    - If planned_core != planned_support → Employee is SUPPORT on the job (planned_support indicates the job)
    - Resources are retained for their ongoing jobs and excluded from new job allocations.

    Args:
        conn: Database connection
        ongoing_job_tails: List of tail numbers (e.g., ['A6-XYZ', 'VH-ABC'])

    Returns:
        DataFrame with columns: emp_id, name, title, planned_core, planned_support, assignment_type, matched_tail
    """
    if not ongoing_job_tails:
        return pd.DataFrame(columns=['emp_id', 'name', 'title', 'planned_core', 'planned_support', 'assignment_type', 'matched_tail'])
    
    try:
        # Check if emp_360 view exists
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'emp_360'
            );
        """
        exists = pd.read_sql(check_query, conn).iloc[0, 0]
        
        if not exists:
            # Fallback: try emp_planned table
            return _get_retained_from_emp_planned(conn, ongoing_job_tails)
        
        # Build query to find employees with matching planned assignments
        # Match both full tail number and tail code (last 3 characters)
        tail_conditions = []
        for tail in ongoing_job_tails:
            tail_code = tail.split('-')[-1] if '-' in tail else tail
            tail_conditions.append(f"UPPER(planned_core) LIKE '%{tail_code.upper()}%'")
            tail_conditions.append(f"UPPER(planned_support) LIKE '%{tail_code.upper()}%'")
            tail_conditions.append(f"UPPER(planned_core) = '{tail.upper()}'")
            tail_conditions.append(f"UPPER(planned_support) = '{tail.upper()}'")
        
        where_clause = " OR ".join(tail_conditions)
        
        # Query with assignment_type calculation
        # If planned_core == planned_support → 'core', otherwise → 'support'
        # Note: emp_360 view uses emp_id and emp_name columns
        query = f"""
            SELECT
                emp_id,
                emp_name as name,
                title,
                planned_core,
                planned_support,
                CASE
                    WHEN UPPER(COALESCE(planned_core, '')) = UPPER(COALESCE(planned_support, ''))
                         AND COALESCE(planned_core, '') != ''
                    THEN 'core'
                    ELSE 'support'
                END as assignment_type
            FROM emp_360
            WHERE {where_clause}
        """
        
        df = pd.read_sql(query, conn)
        
        # Add matched_tail column - determine which ongoing job tail this employee is retained for
        if not df.empty:
            def find_matched_tail(row):
                planned_core = str(row.get('planned_core', '')).upper()
                planned_support = str(row.get('planned_support', '')).upper()
                
                for tail in ongoing_job_tails:
                    tail_upper = tail.upper()
                    tail_code = tail.split('-')[-1].upper() if '-' in tail else tail.upper()
                    
                    # For support assignments, match on planned_support
                    if row['assignment_type'] == 'support':
                        if tail_code in planned_support or planned_support == tail_upper:
                            return tail
                    # For core assignments, match on planned_core (which equals planned_support)
                    else:
                        if tail_code in planned_core or planned_core == tail_upper:
                            return tail
                return None
            
            df['matched_tail'] = df.apply(find_matched_tail, axis=1)
            # Filter out rows where we couldn't match a tail
            df = df[df['matched_tail'].notna()]
        
        return df
        
    except Exception as e:
        print(f"Error fetching retained resources: {e}")
        return pd.DataFrame(columns=['emp_id', 'name', 'title', 'planned_core', 'planned_support', 'assignment_type', 'matched_tail'])


def _get_retained_from_emp_planned(conn, ongoing_job_tails: list) -> pd.DataFrame:
    """
    Fallback: Fetch retained resources from emp_planned table directly.
    
    Business Rule:
    - If planned_core == planned_support → Employee is CORE on that job
    - If planned_core != planned_support → Employee is SUPPORT (planned_support indicates the job)
    """
    try:
        check_query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'emp_planned'
            );
        """
        exists = pd.read_sql(check_query, conn).iloc[0, 0]
        
        if not exists:
            return pd.DataFrame(columns=['emp_id', 'name', 'title', 'planned_core', 'planned_support', 'assignment_type', 'matched_tail'])
        
        # Build query to find matching tasks
        tail_conditions = []
        for tail in ongoing_job_tails:
            tail_code = tail.split('-')[-1] if '-' in tail else tail
            tail_conditions.append(f"UPPER(task) LIKE '%{tail_code.upper()}%'")
            tail_conditions.append(f"UPPER(task) = '{tail.upper()}'")
        
        where_clause = " OR ".join(tail_conditions)
        
        query = f"""
            WITH emp_planned_agg AS (
                SELECT 
                    ep.id as emp_id,
                    COALESCE(em.name, ep.id) as name,
                    COALESCE(em.title, 'ENGR') as title,
                    MAX(CASE WHEN ep.task_type = 'planned-core' THEN ep.task END) as planned_core,
                    MAX(CASE WHEN ep.task_type = 'planned-support' THEN ep.task END) as planned_support
                FROM emp_planned ep
                LEFT JOIN emp_master em ON ep.id = em.id
                WHERE {where_clause}
                GROUP BY ep.id, em.name, em.title
            )
            SELECT 
                *,
                CASE 
                    WHEN UPPER(COALESCE(planned_core, '')) = UPPER(COALESCE(planned_support, '')) 
                         AND COALESCE(planned_core, '') != '' 
                    THEN 'core'
                    ELSE 'support'
                END as assignment_type
            FROM emp_planned_agg
        """
        
        df = pd.read_sql(query, conn)
        
        # Add matched_tail column
        if not df.empty:
            def find_matched_tail(row):
                planned_core = str(row.get('planned_core', '')).upper()
                planned_support = str(row.get('planned_support', '')).upper()
                
                for tail in ongoing_job_tails:
                    tail_upper = tail.upper()
                    tail_code = tail.split('-')[-1].upper() if '-' in tail else tail.upper()
                    
                    # For support assignments, match on planned_support
                    if row['assignment_type'] == 'support':
                        if tail_code in planned_support or planned_support == tail_upper:
                            return tail
                    # For core assignments, match on planned_core
                    else:
                        if tail_code in planned_core or planned_core == tail_upper:
                            return tail
                return None
            
            df['matched_tail'] = df.apply(find_matched_tail, axis=1)
            df = df[df['matched_tail'].notna()]
        
        return df
        
    except Exception as e:
        print(f"Error fetching from emp_planned: {e}")
        return pd.DataFrame(columns=['emp_id', 'name', 'title', 'planned_core', 'planned_support', 'assignment_type', 'matched_tail'])
