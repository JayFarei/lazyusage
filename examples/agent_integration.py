#!/usr/bin/env python3
"""Example: Agent capacity check before spawning sub-agent.

This demonstrates how an AI agent can check capacity before spawning
a sub-agent to avoid hitting rate limits.
"""

import subprocess
import json
import sys


def check_capacity(service='claude', threshold=20):
    """Check remaining capacity for service.

    Args:
        service: Service to check ('claude', 'codex', or 'all')
        threshold: Minimum remaining percentage (default: 20%)

    Returns:
        Tuple of (has_capacity: bool, message: str)
    """
    try:
        # Run usage-check with JSON output
        result = subprocess.run(
            ['usage-check', service, '--json'],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode != 0:
            return False, f"Error: {result.stderr}"

        # Parse JSON output
        data = json.loads(result.stdout)

        # Check each service
        for svc in data['services']:
            if not svc['available']:
                continue

            # Check all metrics (prioritize most restrictive)
            for metric in svc['metrics']:
                if metric['remaining_pct'] < threshold:
                    return False, (
                        f"{svc['name']} low capacity: "
                        f"{metric['name']} only {metric['remaining_pct']}% remaining"
                    )

        return True, "Capacity available"

    except subprocess.TimeoutExpired:
        return False, "Timeout checking capacity"
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON response: {e}"
    except Exception as e:
        return False, f"Error: {e}"


def get_most_restrictive_metric(service='claude'):
    """Get the most restrictive (lowest remaining) metric for a service.

    Args:
        service: Service to check ('claude' or 'codex')

    Returns:
        Tuple of (metric_name: str, remaining_pct: int) or (None, None)
    """
    try:
        result = subprocess.run(
            ['usage-check', service, '--json'],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode != 0:
            return None, None

        data = json.loads(result.stdout)

        # Find service in results
        for svc in data['services']:
            if svc['name'] == service and svc['available']:
                # Find metric with lowest remaining percentage
                min_metric = min(
                    svc['metrics'],
                    key=lambda m: m['remaining_pct']
                )
                return min_metric['name'], min_metric['remaining_pct']

        return None, None

    except Exception:
        return None, None


def main():
    """Example usage: Check Claude capacity before spawning sub-agent."""

    print("Checking Claude capacity...")

    # Get most restrictive metric
    metric_name, remaining_pct = get_most_restrictive_metric('claude')

    if metric_name is None:
        print("✗ Error checking capacity")
        sys.exit(1)

    print(f"Most restrictive metric: {metric_name} ({remaining_pct}% remaining)")

    # Check if we have capacity (20% threshold)
    has_capacity, msg = check_capacity('claude', threshold=20)

    if has_capacity:
        print(f"✓ {msg}")
        print("Spawning sub-agent...")
        # spawn_subagent()
        sys.exit(0)
    else:
        print(f"✗ {msg}")
        print("Deferring sub-agent spawn")
        sys.exit(1)


if __name__ == '__main__':
    main()
