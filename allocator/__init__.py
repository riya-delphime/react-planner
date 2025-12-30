"""
MRO Resource Allocator Package
==============================
LLM-based resource allocation for aircraft maintenance visits.
"""

from .config import get_config, Config
from .db import get_db_connection, load_data, get_retained_resources_for_ongoing_jobs
from .eligibility import (
    get_visit_requirements,
    get_eligible_employees,
    get_available_employees,
    build_employee_availability_matrix,
    get_employees_becoming_available,
    parse_lic_req,
    get_requirements_from_lic_req_or_tail,
    get_eligible_technicians,
    get_available_technicians,
    build_technician_availability_matrix
)
from .similarity import (
    get_similar_employees_for_primary,
    expand_eligible_pool_with_similar
)
from .llm import get_llm_client, allocate_resources_with_llm
from .validation import (
    validate_allocation,
    print_validation_report,
    allocation_to_dataframe
)
from .allocator import (
    allocate_resources,
    prepare_allocation_context,
    diagnose_employee_availability
)
from .bay import (
    allocate_bay,
    allocate_bays_for_visits,
    get_aircraft_body_type,
    get_available_bays
)

__all__ = [
    # Config
    "get_config",
    "Config",
    # Database
    "get_db_connection",
    "load_data",
    "get_retained_resources_for_ongoing_jobs",
    # Eligibility - Engineers
    "get_visit_requirements",
    "get_eligible_employees",
    "get_available_employees",
    "build_employee_availability_matrix",
    "get_employees_becoming_available",
    "parse_lic_req",
    "get_requirements_from_lic_req_or_tail",
    # Eligibility - Technicians
    "get_eligible_technicians",
    "get_available_technicians",
    "build_technician_availability_matrix",
    # Similarity
    "get_similar_employees_for_primary",
    "expand_eligible_pool_with_similar",
    # LLM
    "get_llm_client",
    "allocate_resources_with_llm",
    # Validation
    "validate_allocation",
    "print_validation_report",
    "allocation_to_dataframe",
    # Bay allocation
    "allocate_bay",
    "allocate_bays_for_visits",
    "get_aircraft_body_type",
    "get_available_bays",
    # Main pipeline
    "allocate_resources",
    "prepare_allocation_context",
    "diagnose_employee_availability",
]
