"""
Test script for MRO Resource Allocator API
===========================================
Run the API first: uv run uvicorn main:app --reload --port 8000
Then run this script: uv run python test_api.py
"""

import requests
import json

API_URL = "http://localhost:8000"


def test_health():
    """Test health check endpoint."""
    print("=" * 60)
    print("Testing health check...")
    response = requests.get(f"{API_URL}/")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.status_code == 200


def test_allocate():
    """Test allocation endpoint."""
    print("\n" + "=" * 60)
    print("Testing allocation endpoint...")

    payload = {
        "future_visits": [
            {
                "tail_num": "A6-BMC",
                "start_date": "2022-05-01",
                "end_date": "2022-05-05",
                "num_engineers": 2,
                "aircraft_size": "narrowbody"
            },
            {
                "tail_num": "A6-EIT",
                "start_date": "2022-05-17",
                "end_date": "2022-05-22",
                "num_engineers": 3,
                "aircraft_size": "widebody"
            }
        ],
        "verbose": False
    }

    print(f"\nRequest payload:")
    print(json.dumps(payload, indent=2))

    response = requests.post(
        f"{API_URL}/allocate",
        json=payload,
        headers={"Content-Type": "application/json"}
    )

    print(f"\nStatus: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        print(f"\nSuccess: {result['success']}")
        print(f"Number of allocations: {len(result['allocations'])}")

        if result.get('summary'):
            print(f"\nSummary:")
            print(json.dumps(result['summary'], indent=2))

        if result.get('reasoning'):
            print(f"\nReasoning: {result['reasoning']}")

        if result.get('validation'):
            print(f"\nValidation: {'VALID' if result['validation']['is_valid'] else 'INVALID'}")
            print(f"Violations: {result['validation']['violations_count']}")

        print(f"\nAllocations:")
        for alloc in result['allocations']:
            bay_info = f", Bay: {alloc.get('bay')}" if alloc.get('bay') else ""
            print(f"  - Visit {alloc.get('visit_id')}, {alloc.get('tail_num')}: "
                  f"{alloc.get('emp_id')} ({alloc.get('name')}) - {alloc.get('employee_type')}{bay_info}")

        # Display bay allocations
        if result.get('bay_allocations'):
            print(f"\nBay Allocations:")
            for visit_id, bay_info in result['bay_allocations'].items():
                bay = bay_info.get('bay', 'None')
                body_type = bay_info.get('body_type', 'unknown')
                status = bay_info.get('status', 'unknown')
                alternatives = bay_info.get('alternatives', [])
                print(f"  - Visit {visit_id}: {bay} ({body_type}) - {status}")
                if alternatives:
                    print(f"    Alternatives: {', '.join(alternatives[:3])}")

        return True
    else:
        print(f"Error: {response.text}")
        return False


def test_single_visit():
    """Test with a single visit."""
    print("\n" + "=" * 60)
    print("Testing single visit allocation...")

    payload = {
        "future_visits": [
            {
                "tail_num": "A6-BMC",
                "start_date": "2022-05-01",
                "end_date": "2022-05-03",
                "num_engineers": 1
            }
        ]
    }

    response = requests.post(f"{API_URL}/allocate", json=payload)
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        print(f"Allocations: {len(result['allocations'])}")
        print(json.dumps(result['allocations'], indent=2))
        return True
    else:
        print(f"Error: {response.text}")
        return False


if __name__ == "__main__":
    print("MRO Resource Allocator API Test")
    print("Make sure the API is running on http://localhost:8000")
    print()

    try:
        # Run tests
        health_ok = test_health()

        if health_ok:
            test_allocate()
            # test_single_visit()  # Uncomment to test single visit
        else:
            print("\nHealth check failed. Is the API running?")

    except requests.exceptions.ConnectionError:
        print("\nERROR: Could not connect to API.")
        print("Start the API with: uv run uvicorn main:app --reload --port 8000")

