"""
MRO Resource Allocator API
==========================
FastAPI endpoint for resource allocation.
"""

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date

from allocator import (
    get_db_connection,
    load_data,
    get_llm_client,
    allocate_resources,
    get_retained_resources_for_ongoing_jobs,
)

app = FastAPI(
    title="MRO Resource Allocator API",
    description="LLM-based resource allocation for aircraft maintenance visits",
    version="1.0.0",
)

# Add CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class RetainedResource(BaseModel):
    """A resource that should be retained for an ongoing job."""
    emp_id: str = Field(..., description="Employee ID")
    emp_name: Optional[str] = Field(None, description="Employee name")
    role: str = Field("engineer", description="Role: 'engineer' or 'technician'")
    planned_core: Optional[str] = Field(None, description="Planned core assignment (tail number)")
    planned_support: Optional[str] = Field(None, description="Planned support assignment (tail number)")
    assignment_type: str = Field("support", description="Assignment type: 'core' if planned_core==planned_support, 'support' otherwise")


class OngoingJob(BaseModel):
    """An ongoing job where resources should be retained.
    
    Business Rule: Assignments done on Apr 30 continue for ongoing jobs on May 1 and beyond.
    - If planned_core == planned_support → Employee is CORE on that job
    - If planned_core != planned_support → Employee is SUPPORT (planned_support indicates the job)
    """
    tail_num: str = Field(..., description="Aircraft tail number or identifier")
    start_date: date = Field(..., description="Job start date (YYYY-MM-DD)")
    end_date: date = Field(..., description="Job end date (YYYY-MM-DD)")
    lic_req: Optional[str] = Field(None, description="License requirement (e.g., 'A320-CFM56-GCAA')")
    retained_resources: list[RetainedResource] = Field(default_factory=list, description="Resources to retain for this ongoing job (core if planned_core==planned_support, support otherwise)")


class Visit(BaseModel):
    """A single aircraft maintenance visit."""
    tail_num: str = Field(..., description="Aircraft tail number or identifier")
    start_date: date = Field(..., description="Visit start date (YYYY-MM-DD)")
    end_date: date = Field(..., description="Visit end date (YYYY-MM-DD)")
    num_engineers: int = Field(..., ge=1, description="Number of engineers required")
    num_technicians: int = Field(0, ge=0, description="Number of technicians required (based on work history)")
    aircraft_size: Optional[str] = Field(None, description="Aircraft size (narrowbody/widebody)")
    lic_req: Optional[str] = Field(None, description="License requirement (e.g., 'A320-CFM56-GCAA') for finding eligible engineers/technicians")


class AllocationRequest(BaseModel):
    """Request body for allocation endpoint."""
    future_visits: list[Visit] = Field(..., description="List of NEW visits to allocate (LLM plans these)")
    ongoing_jobs: list[OngoingJob] = Field(default_factory=list, description="Ongoing jobs with resources to retain (business rule: resources with planned_core/planned_support are retained)")
    verbose: bool = Field(False, description="Enable verbose logging")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "future_visits": [
                        {
                            "tail_num": "A6-BMC",
                            "start_date": "2022-05-01",
                            "end_date": "2022-05-05",
                            "num_engineers": 2,
                            "num_technicians": 1,
                            "aircraft_size": "narrowbody"
                        }
                    ],
                    "ongoing_jobs": [
                        {
                            "tail_num": "A6-XYZ",
                            "start_date": "2022-04-25",
                            "end_date": "2022-05-03",
                            "lic_req": "A320-CFM56-GCAA",
                            "retained_resources": [
                                {
                                    "emp_id": "EMP001",
                                    "emp_name": "John Smith",
                                    "role": "engineer",
                                    "planned_core": "A6-XYZ"
                                }
                            ]
                        }
                    ],
                    "verbose": False
                }
            ]
        }
    }


class BayAllocation(BaseModel):
    """Bay allocation for a visit."""
    bay: Optional[str] = None
    body_type: Optional[str] = None
    alternatives: list[str] = []
    status: str
    message: Optional[str] = None


class RetainedResourceResponse(BaseModel):
    """Response for a retained resource in an ongoing job."""
    emp_id: str
    emp_name: Optional[str] = None
    tail_num: str
    role: str  # 'engineer' or 'technician'
    assignment_type: str = "support"  # 'core' if planned_core==planned_support, 'support' otherwise
    planned_core: Optional[str] = None
    planned_support: Optional[str] = None
    retention_reason: str = "Retained for ongoing job per business rule"


class AllocationResponse(BaseModel):
    """Response body for allocation endpoint."""
    success: bool
    allocations: list[dict]
    retained_resources: list[RetainedResourceResponse] = []  # Resources retained for ongoing jobs
    bay_allocations: Optional[dict[str, BayAllocation]] = None
    summary: Optional[dict] = None
    reasoning: Optional[str] = None
    validation: Optional[dict] = None


# Cache for loaded data (reloaded on each request for now, can be optimized)
_cached_data = None
_cached_client = None


def get_data():
    """Load and cache database data."""
    global _cached_data
    if _cached_data is None:
        with get_db_connection() as conn:
            _cached_data = load_data(conn)
    return _cached_data


def get_client():
    """Get and cache LLM client."""
    global _cached_client
    if _cached_client is None:
        _cached_client = get_llm_client()
    return _cached_client


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "healthy", "service": "MRO Resource Allocator API"}


@app.post("/allocate", response_model=AllocationResponse)
async def allocate(request: AllocationRequest):
    """
    Allocate engineers to aircraft maintenance visits.

    Takes a list of future visits and returns optimal engineer assignments
    based on certifications, availability, and workload distribution.
    
    Business Rule: Resources assigned with planned_core/planned_support for ongoing jobs
    on the reference date (Apr 30) are retained by default to their ongoing job.
    Only new requirements are planned by the LLM.
    """
    try:
        # Load data
        data = get_data()
        client = get_client()

        # Debug: Log data summary
        if request.verbose:
            print("\n" + "=" * 60)
            print("DEBUG: LOADED DATA SUMMARY")
            print("=" * 60)
            print(f"  - visit_details: {len(data.get('visit_details', []))} rows")
            print(f"  - emp_license: {len(data.get('emp_license', []))} rows")
            print(f"  - emp_roster: {len(data.get('emp_roster', []))} rows")
            print(f"  - emp_similarity: {len(data.get('emp_similarity', [])) if data.get('emp_similarity') is not None else 'None'}")
            print(f"  - tech_work_summary: {len(data.get('tech_work_summary', [])) if data.get('tech_work_summary') is not None else 'None'}")

            # Show sample lic requirements in database
            if 'visit_details' in data and not data['visit_details'].empty:
                visit_df = data['visit_details']
                if 'aircraft_clean' in visit_df.columns and 'engine_clean' in visit_df.columns and 'lic' in visit_df.columns:
                    unique_combos = visit_df[['aircraft_clean', 'engine_clean', 'lic']].drop_duplicates().head(10)
                    print(f"\n  Sample Aircraft-Engine-License combinations in DB:")
                    for _, row in unique_combos.iterrows():
                        print(f"    - {row['aircraft_clean']}-{row['engine_clean']}-{row['lic']}")

            # Show sample licenses in emp_license
            if 'emp_license' in data and not data['emp_license'].empty:
                lic_df = data['emp_license']
                if 'aircraft' in lic_df.columns and 'engine' in lic_df.columns and 'lic' in lic_df.columns:
                    unique_lics = lic_df[['aircraft', 'engine', 'lic']].drop_duplicates().head(10)
                    print(f"\n  Sample Employee Licenses in DB:")
                    for _, row in unique_lics.iterrows():
                        print(f"    - {row['aircraft']}-{row['engine']}-{row['lic']}")
            print("=" * 60 + "\n")

        # Process ongoing jobs and collect retained resources
        # Business Rule: Engineers & technicians with planned_core/planned_support 
        # matching an ongoing job are retained for that job
        retained_resources = []
        retained_emp_ids = set()  # Track retained employee IDs to exclude from allocation pool
        
        for ongoing_job in request.ongoing_jobs:
            # If retained_resources not provided by frontend, fetch from database
            job_retained_resources = ongoing_job.retained_resources
            
            if not job_retained_resources:
                # Fetch retained resources from database
                if request.verbose:
                    print(f"Fetching retained resources for ongoing job {ongoing_job.tail_num} from database...")
                
                with get_db_connection() as conn:
                    retained_df = get_retained_resources_for_ongoing_jobs(conn, [ongoing_job.tail_num])
                    
                    if not retained_df.empty:
                        job_retained_resources = [
                            RetainedResource(
                                emp_id=row['emp_id'],
                                emp_name=row.get('name'),
                                role='technician' if row.get('title') == 'TECH' else 'engineer',
                                planned_core=row.get('planned_core'),
                                planned_support=row.get('planned_support'),
                                assignment_type=row.get('assignment_type', 'support')
                            )
                            for _, row in retained_df.iterrows()
                        ]
            
            for resource in job_retained_resources:
                # Determine assignment_type: 'core' if planned_core == planned_support, else 'support'
                assignment_type = getattr(resource, 'assignment_type', None)
                if assignment_type is None:
                    planned_core = (resource.planned_core or '').upper().strip()
                    planned_support = (resource.planned_support or '').upper().strip()
                    assignment_type = 'core' if planned_core == planned_support and planned_core != '' else 'support'
                
                retained_resources.append(
                    RetainedResourceResponse(
                        emp_id=resource.emp_id,
                        emp_name=resource.emp_name,
                        tail_num=ongoing_job.tail_num,
                        role=resource.role,
                        assignment_type=assignment_type,
                        planned_core=resource.planned_core,
                        planned_support=resource.planned_support,
                        retention_reason=f"Retained as {assignment_type.upper()} for ongoing job {ongoing_job.tail_num} (Apr 30 assignment continues for May 1 and beyond)"
                    )
                )
                retained_emp_ids.add(resource.emp_id)
        
        if request.verbose and retained_resources:
            print(f"\n=== BUSINESS RULE: RETAINED RESOURCES (Apr 30 → May 1+) ===")
            print(f"Retaining {len(retained_resources)} resources for ongoing jobs:")
            core_count = sum(1 for rr in retained_resources if rr.assignment_type == 'core')
            support_count = sum(1 for rr in retained_resources if rr.assignment_type == 'support')
            print(f"  - CORE resources (planned_core == planned_support): {core_count}")
            print(f"  - SUPPORT resources (planned_core != planned_support): {support_count}")
            for rr in retained_resources:
                print(f"  - {rr.emp_id} ({rr.emp_name}): {rr.assignment_type.upper()} for {rr.tail_num} as {rr.role}")
            print(f"These employees will be excluded from new job allocation.\n")

        # Convert visits to the format expected by allocator
        future_visits = [
            {
                "tail_num": visit.tail_num,
                "start_date": pd.to_datetime(visit.start_date),
                "end_date": pd.to_datetime(visit.end_date),
                "num_engineers": visit.num_engineers,
                "num_technicians": visit.num_technicians,  # Technicians required (based on work history)
                "aircraft_size": visit.aircraft_size,
                "lic_req": visit.lic_req,  # License requirement for finding eligible engineers/technicians
            }
            for visit in request.future_visits
        ]

        # Convert ongoing jobs to context for LLM (for reference)
        ongoing_jobs_context = [
            {
                "tail_num": job.tail_num,
                "start_date": pd.to_datetime(job.start_date),
                "end_date": pd.to_datetime(job.end_date),
                "lic_req": job.lic_req,
                "retained_count": len(job.retained_resources),
                "retained_engineers": [r.emp_id for r in job.retained_resources if r.role == "engineer"],
                "retained_technicians": [r.emp_id for r in job.retained_resources if r.role == "technician"],
            }
            for job in request.ongoing_jobs
        ]

        # Run allocation (includes bay allocation and technician allocation)
        # Pass retained_emp_ids to exclude from allocation pool
        result = allocate_resources(
            future_visits=future_visits,
            visit_details_df=data["visit_details"],
            emp_license_df=data["emp_license"],
            emp_roster_df=data["emp_roster"],
            shift_code_master_df=data["shift_code_master"],
            emp_similarity_df=data.get("emp_similarity"),
            emp_work_daily_df=data.get("emp_work_daily"),
            bay_status_df=data.get("bay_status"),
            bay_constraints_df=data.get("bay_constraints"),
            aircraft_size_df=data.get("aircraft_size"),
            tech_work_summary_df=data.get("tech_work_summary"),  # Technician work history
            llm_client=client,
            verbose=request.verbose,
            retained_emp_ids=retained_emp_ids,  # Exclude retained resources from allocation
            ongoing_jobs_context=ongoing_jobs_context,  # Provide ongoing job info to LLM
        )

        # Get the original LLM allocation result (grouped by visit)
        # This preserves the structure: {visit_id, tail_num, assigned_engineers[], assigned_technicians[]}
        allocation_result = result.get("allocation_result", {})
        allocations = allocation_result.get("allocations", []) if allocation_result else []

        # Also get the flattened DataFrame for detailed per-day analysis if needed
        allocation_df = result.get("allocation_df", pd.DataFrame())

        # Extract bay allocations (keyed by tail_num)
        bay_allocations_raw = result.get("bay_allocations", {})
        bay_allocations = {
            tail_num: BayAllocation(**bay_info)
            for tail_num, bay_info in bay_allocations_raw.items()
        } if bay_allocations_raw else None

        # Extract summary and reasoning from LLM result (allocation_result already extracted above)
        summary = allocation_result.get("summary") if allocation_result else None
        reasoning = allocation_result.get("reasoning") if allocation_result else None
        
        # Add retained resources summary to the overall summary
        if summary:
            summary["retained_resources_count"] = len(retained_resources)
            summary["ongoing_jobs_count"] = len(request.ongoing_jobs)

        # Validation report
        validation_report = result.get("validation_report")
        validation = {
            "is_valid": validation_report.get("is_valid", False),
            "violations_count": len(validation_report.get("violations", [])),
            "violations": validation_report.get("violations", []),
        } if validation_report else None

        return AllocationResponse(
            success=True,
            allocations=allocations,
            retained_resources=retained_resources,
            bay_allocations=bay_allocations,
            summary=summary,
            reasoning=reasoning,
            validation=validation,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/allocate/reload-data")
async def reload_data():
    """Force reload of cached database data."""
    global _cached_data
    _cached_data = None
    get_data()  # Reload
    return {"status": "success", "message": "Data reloaded"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
