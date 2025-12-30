"""
LLM Client and Allocation for MRO Resource Allocator
=====================================================
Handles Azure OpenAI client creation and LLM-based allocation calls.
"""

import json
from openai import AzureOpenAI

from .config import get_config, AzureOpenAIConfig
from .prompts import SYSTEM_PROMPT, build_user_prompt


def get_llm_client(config: AzureOpenAIConfig | None = None) -> AzureOpenAI:
    """
    Create and return an Azure OpenAI client.

    Args:
        config: Optional AzureOpenAIConfig, uses env config if not provided

    Returns:
        AzureOpenAI client instance
    """
    if config is None:
        config = get_config().azure_openai

    return AzureOpenAI(
        api_key=config.api_key,
        api_version=config.api_version,
        azure_endpoint=config.endpoint,
    )


def allocate_resources_with_llm(
    allocation_context: dict,
    client: AzureOpenAI,
    model: str | None = None,
    verbose: bool = True
) -> dict:
    """
    Call the LLM to perform resource allocation.

    Args:
        allocation_context: Structured context with visits and conflicts
        client: Azure OpenAI client
        model: Model name (default from config)
        verbose: Print progress messages

    Returns:
        Parsed JSON allocation result from LLM
    """
    if model is None:
        model = get_config().azure_openai.model

    # Debug: Print context summary before building prompt
    if verbose:
        print("\n" + "=" * 60)
        print("DEBUG: ALLOCATION CONTEXT SUMMARY")
        print("=" * 60)
        for visit in allocation_context.get("visits", []):
            if "error" in visit:
                print(f"  Visit {visit.get('visit_id')}: ERROR - {visit.get('error')}")
            else:
                primary_count = len(visit.get("primary_employees", {}))
                similar_count = len(visit.get("similar_employees", {}))
                upcoming_count = len(visit.get("upcoming_employees", {}))
                tech_count = len(visit.get("technicians", {}))
                print(f"  Visit {visit.get('visit_id')} ({visit.get('tail_num')}, lic_req={visit.get('lic_req')}):")
                print(f"    - Period: {visit.get('start_date')} to {visit.get('end_date')}")
                print(f"    - Required: {visit.get('required_engineers')} engineers, {visit.get('required_technicians')} technicians")
                print(f"    - Primary engineers: {primary_count}, Similar: {similar_count}, Upcoming: {upcoming_count}")
                print(f"    - Technicians available: {tech_count}")
                print(f"    - Primary full coverage: {len(visit.get('primary_full_coverage_emp_ids', []))}")
                print(f"    - Primary partial coverage: {len(visit.get('primary_partial_coverage_employees', []))}")
                if primary_count > 0:
                    print(f"    - Primary employee IDs: {list(visit.get('primary_employees', {}).keys())[:5]}...")
        print("=" * 60 + "\n")

    user_prompt = build_user_prompt(allocation_context)

    if verbose:
        print("=" * 60)
        print("PROMPT SENT TO LLM:")
        print("=" * 60)
        print(user_prompt)
        print("=" * 60)

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.1,
        response_format={"type": "json_object"}
    )

    result = response.choices[0].message.content
    return json.loads(result)
