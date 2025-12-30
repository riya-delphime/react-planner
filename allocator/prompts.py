"""
LLM Prompts for MRO Resource Allocation
=======================================
Contains system and user prompt templates for the allocation LLM.
"""

SYSTEM_PROMPT = """You are an MRO (Maintenance, Repair, and Overhaul) resource allocation specialist.
Your task is to assign engineers AND technicians to aircraft maintenance visits based on their certifications, experience, and availability.

BUSINESS RULE - ONGOING JOB RETENTION (Apr 30 → May 1 and beyond):
- Assignments done on Apr 30 should continue for ongoing jobs on May 1 and beyond.
- Resources (engineers/technicians) assigned to ongoing jobs are ALREADY RETAINED and excluded from your pool.
- Assignment types:
  * CORE: If planned_core == planned_support → Employee is a core resource on that job
  * SUPPORT: If planned_core != planned_support → Employee is a support resource (planned_support indicates the ongoing job)
- You only need to plan allocations for NEW visits - ongoing jobs are already staffed with their retained core/support resources.
- This ensures continuity and stability of work on ongoing maintenance tasks.

HARD CONSTRAINTS (must never be violated):
1. Each employee can only be assigned to ONE visit per day
2. Employees must be available (scheduled for a working shift) on the assigned days

ALLOCATION GOAL - BEST EFFORT:
- The "Required Engineers" and "Required Technicians" are TARGET numbers (minimum desired).
- Your goal is to assign AS MANY as possible, up to the target number.
- If you cannot meet the target, assign as many qualified employees as available.
- Even 1 engineer is better than 0 - always allocate something if anyone is available.
- Status guide:
  * "fully_staffed": Assigned count >= Required count
  * "partially_staffed": Assigned count > 0 but < Required count
  * "understaffed": Assigned count = 0 (no one available)

EMPLOYEE TYPES FOR ENGINEERS:
- PRIMARY: Engineers with exact certification match (aircraft, engine, license). ALWAYS prefer these.
- SIMILAR: Fallback engineers identified by similarity scoring. Only use when PRIMARY employees are insufficient.
  - Similar employees have a similarity score (0-1). Higher score = better match.
  - Only similar employees with score >= 0.90 are included.
- UPCOMING: Engineers who are currently assigned to another job but will become available when their current job ends.
  - These are certified employees whose current assignment ends before/during the visit.
  - Check their "available_from" date - they can only be assigned from that date onwards.
  - Prefer UPCOMING employees over SIMILAR when they become available at visit start.

TECHNICIANS:
- Technicians (TECH) are matched based on their WORK HISTORY, not certifications.
- They are ranked by their experience on the specific aircraft-engine-license combination.
- Match types:
  - "exact": Technician's most worked map_key matches the visit's requirements exactly.
  - "aircraft_only": Technician has experience on the same aircraft type, but different engine/license.
- Prefer technicians with "exact" match over "aircraft_only".
- Consider their "experience_count" - higher count means more relevant experience.

OPTIMIZATION CRITERIA (in priority order):
1. For ENGINEERS: ALWAYS prefer PRIMARY > UPCOMING > SIMILAR
2. For TECHNICIANS: Prefer "exact" match > "aircraft_only" match, then by experience_count
3. If using SIMILAR employees, prefer those with higher similarity scores
4. Prefer employees with FULL coverage (available all days of the visit) over partial coverage
5. Distribute workload evenly - avoid assigning the same employees to multiple visits when alternatives exist
6. Prefer team continuity - if possible, assign employees from the same team to a visit
7. For conflicting visits (same employee eligible for multiple overlapping visits), assign to the visit with fewer alternatives

IMPORTANT - PARTIAL COVERAGE IS ACCEPTABLE:
- If NO employee has FULL coverage for a visit, you MUST still assign employees with PARTIAL coverage.
- Assign employees for the days they ARE available, even if they cannot cover the entire visit.
- Multiple employees with partial coverage can together cover a visit.
- It is ALWAYS better to have partial staffing than no staffing at all.
- Only mark a visit as "understaffed" if the total number of assigned employees is less than required, NOT because of partial coverage.

CRITICAL REQUIREMENTS:
1. You MUST provide an allocation entry for EVERY visit listed below - no exceptions.
2. Each visit has a unique visit_id (0, 1, 2, ...). Your response MUST include one allocation object for each visit_id.
3. If no employees are available for a visit, still include it with empty arrays and status "understaffed".

OUTPUT FORMAT:
Return a valid JSON object with this structure:
{
    "allocations": [
        {
            "visit_id": <int>,  // MUST match the visit_id from the input
            "tail_num": "<string>",  // MUST match the tail_num from the input
            "assigned_engineers": [
                {
                    "emp_id": "<string>",
                    "name": "<string>",
                    "team": "<string>",
                    "employee_type": "primary" | "similar" | "upcoming",
                    "similarity_score": <float or null>,
                    "assigned_days": ["YYYY-MM-DD", ...]
                }
            ],
            "assigned_technicians": [
                {
                    "emp_id": "<string>",
                    "name": "<string>",
                    "team": "<string>",
                    "title": "TECH",
                    "match_type": "exact" | "aircraft_only",
                    "experience_count": <int>,
                    "most_worked_aircraft": "<string>",
                    "assigned_days": ["YYYY-MM-DD", ...]
                }
            ],
            "engineer_status": "fully_staffed" | "partially_staffed" | "understaffed",
            "technician_status": "fully_staffed" | "partially_staffed" | "understaffed" | "not_required",
            "notes": "<any relevant notes about this allocation>"
        }
        // ... repeat for EVERY visit_id (0, 1, 2, etc.)
    ],
    "summary": {
        "total_visits": <int>,
        "engineers_fully_staffed": <int>,
        "engineers_partially_staffed": <int>,
        "engineers_understaffed": <int>,
        "technicians_fully_staffed": <int>,
        "technicians_partially_staffed": <int>,
        "technicians_understaffed": <int>,
        "primary_employees_used": <int>,
        "similar_employees_used": <int>,
        "upcoming_employees_used": <int>,
        "technicians_used": <int>
    },
    "reasoning": "<brief explanation of key allocation decisions>"
}

IMPORTANT REMINDERS:
1. Only return the JSON object, no additional text.
2. You MUST include an allocation for EVERY visit_id provided in the input.
3. The number of items in your "allocations" array MUST equal the total_visits count."""


def build_user_prompt(allocation_context: dict) -> str:
    """
    Build the user prompt with visit details and constraints.

    Args:
        allocation_context: Dict containing visits, conflicts, total_visits, and ongoing_jobs

    Returns:
        Formatted prompt string for the LLM
    """
    prompt_parts = []
    
    # Add ongoing jobs context if present (Business Rule information)
    ongoing_jobs = allocation_context.get("ongoing_jobs", [])
    retained_emp_count = allocation_context.get("retained_emp_count", 0)
    
    if ongoing_jobs or retained_emp_count > 0:
        prompt_parts.append("## BUSINESS RULE: ONGOING JOB RETENTION (Apr 30 assignments continue)")
        prompt_parts.append(f"- {len(ongoing_jobs)} ongoing jobs with retained resources")
        prompt_parts.append(f"- {retained_emp_count} employees retained for ongoing jobs (EXCLUDED from your pool)")
        prompt_parts.append("- CORE resources: planned_core == planned_support (dedicated to the job)")
        prompt_parts.append("- SUPPORT resources: planned_core != planned_support (supporting the job per planned_support)")
        prompt_parts.append("")
        
        if ongoing_jobs:
            prompt_parts.append("### Ongoing Jobs (Already Staffed - DO NOT REALLOCATE):")
            for job in ongoing_jobs:
                retained_eng = len(job.get("retained_engineers", []))
                retained_tech = len(job.get("retained_technicians", []))
                prompt_parts.append(f"  - {job['tail_num']}: {job.get('start_date', 'N/A')} to {job.get('end_date', 'N/A')}")
                prompt_parts.append(f"    Retained: {retained_eng} engineers, {retained_tech} technicians (core + support)")
            prompt_parts.append("")
    
    prompt_parts.append("Please allocate engineers and technicians to the following NEW aircraft maintenance visits:\n")

    for visit in allocation_context["visits"]:
        if "error" in visit:
            prompt_parts.append(f"\n## Visit {visit['visit_id']}: {visit['tail_num']}")
            prompt_parts.append(f"ERROR: {visit['error']}")
            continue

        prompt_parts.append(f"\n## Visit {visit['visit_id']}: {visit['tail_num']}")
        prompt_parts.append(f"- Period: {visit['start_date']} to {visit['end_date']}")
        prompt_parts.append(f"- Target Engineers (min): {visit['required_engineers']} (assign as many as possible)")

        # Include technician requirement
        required_techs = visit.get('required_technicians', 0)
        prompt_parts.append(f"- Target Technicians (min): {required_techs} (assign as many as possible)")
        
        prompt_parts.append(f"- Aircraft: {visit['requirements']['aircraft']}, Engine: {visit['requirements']['engine']}, License: {visit['requirements']['license']}")
        prompt_parts.append(f"- Visit Days: {', '.join(visit['visit_days'])}")

        # Primary employees section (Engineers)
        primary_employees = visit.get("primary_employees", {})
        primary_full_coverage = visit.get("primary_full_coverage_emp_ids", [])

        prompt_parts.append(f"\n### PRIMARY Engineers (Certified) - {len(primary_employees)} total, {len(primary_full_coverage)} with full coverage:")

        if primary_employees:
            for emp_id, emp_data in primary_employees.items():
                available_days = list(emp_data["dates"].keys())
                coverage = "FULL" if emp_id in primary_full_coverage else "PARTIAL"
                prompt_parts.append(f"  - {emp_id} ({emp_data['name']}, {emp_data['team']}): {coverage} coverage, available: {', '.join(sorted(available_days))}")
        else:
            prompt_parts.append("  (No primary engineers available)")

        # Similar employees section
        similar_employees = visit.get("similar_employees", {})
        similar_full_coverage = visit.get("similar_full_coverage_emp_ids", [])

        if similar_employees:
            prompt_parts.append(f"\n### SIMILAR Engineers (Fallback) - {len(similar_employees)} total, {len(similar_full_coverage)} with full coverage:")

            for emp_id, emp_data in similar_employees.items():
                available_days = list(emp_data["dates"].keys())
                coverage = "FULL" if emp_id in similar_full_coverage else "PARTIAL"
                score = emp_data.get("similarity_score", 0)
                prompt_parts.append(f"  - {emp_id} ({emp_data['name']}, {emp_data['team']}): score={score:.2f}, {coverage} coverage, available: {', '.join(sorted(available_days))}")

        # Upcoming employees section (currently assigned, becoming free)
        upcoming_employees = visit.get("upcoming_employees", {})
        upcoming_summary = visit.get("upcoming_summary", {})

        if upcoming_employees:
            total_upcoming = upcoming_summary.get("total_becoming_available", len(upcoming_employees))
            from_start = upcoming_summary.get("available_from_start", 0)
            prompt_parts.append(f"\n### UPCOMING Engineers (Becoming Available) - {total_upcoming} total, {from_start} available from visit start:")

            for emp_id, emp_data in upcoming_employees.items():
                available_days = emp_data.get("available_days", [])
                available_from = emp_data.get("available_from", "unknown")
                job_ends = emp_data.get("current_job_ends", "unknown")
                days_until = emp_data.get("days_until_available", 0)

                if days_until == 0:
                    timing = "available from start"
                else:
                    timing = f"available in {days_until} days (from {available_from})"

                prompt_parts.append(f"  - {emp_id} ({emp_data['name']}, {emp_data['team']}): current job ends {job_ends}, {timing}, available days: {', '.join(sorted(available_days))}")

        # Technicians section (based on work history)
        technicians = visit.get("technicians", {})
        tech_full_coverage = visit.get("technician_full_coverage_emp_ids", [])

        if required_techs > 0:
            prompt_parts.append(f"\n### TECHNICIANS (By Work Experience) - {len(technicians)} total, {len(tech_full_coverage)} with full coverage:")

            if technicians:
                for emp_id, tech_data in technicians.items():
                    available_days = list(tech_data["dates"].keys())
                    coverage = "FULL" if emp_id in tech_full_coverage else "PARTIAL"
                    match_type = tech_data.get("match_type", "unknown")
                    experience = tech_data.get("experience_count", 0)
                    most_worked = tech_data.get("most_worked_aircraft", "unknown")
                    
                    prompt_parts.append(f"  - {emp_id} ({tech_data['name']}, {tech_data['team']}): {match_type} match, exp={experience}, most_worked={most_worked}, {coverage} coverage, available: {', '.join(sorted(available_days))}")
            else:
                prompt_parts.append("  (No technicians with relevant experience available)")

    if allocation_context["conflicts"]:
        prompt_parts.append("\n## CONFLICTS DETECTED:")
        for conflict in allocation_context["conflicts"]:
            prompt_parts.append(f"- Visits {conflict['visit_1']} and {conflict['visit_2']}: {len(conflict['overlapping_employees'])} shared employees")
            prompt_parts.append(f"  Type: {conflict['overlap_type']}")
            if conflict["overlap_type"] == "time_and_eligibility":
                prompt_parts.append(f"  WARNING: These visits overlap in time - same employee cannot work both!")

    # Add a final reminder about the total visits count
    total_visits = allocation_context.get("total_visits", len(allocation_context.get("visits", [])))
    visit_ids = [v["visit_id"] for v in allocation_context.get("visits", []) if "error" not in v]
    prompt_parts.append(f"\n## SUMMARY")
    prompt_parts.append(f"- Total visits to allocate: {total_visits}")
    prompt_parts.append(f"- Visit IDs: {visit_ids}")
    prompt_parts.append(f"- REMINDER: Your response MUST include exactly {total_visits} allocation objects, one for each visit_id listed above.")

    return "\n".join(prompt_parts)
