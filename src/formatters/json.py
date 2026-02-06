"""JSON formatter with service availability metadata."""

import json
from datetime import datetime
from typing import Dict, List, Optional


def format_json(service: str, metrics: Dict[str, any]) -> str:
    """Format metrics as JSON with subscription.

    Args:
        service: Service name ('claude' or 'codex')
        metrics: Metrics dict

    Returns:
        JSON string
    """
    output = {
        "service": service,
        "timestamp": datetime.now().isoformat(),
        "subscription_type": metrics.get('subscription_type'),
        "metrics": []
    }

    for name, data in metrics.items():
        # Skip subscription_type in iteration
        if name == 'subscription_type':
            continue

        output["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    return json.dumps(output, indent=2)


def format_all_json(claude_metrics: Dict[str, any], codex_metrics: Dict[str, any]) -> str:
    """Format combined Claude and Codex metrics as JSON.

    Args:
        claude_metrics: Claude metrics dict
        codex_metrics: Codex metrics dict

    Returns:
        JSON string with both services
    """
    output = {
        "timestamp": datetime.now().isoformat(),
        "services": {
            "claude": {
                "subscription_type": claude_metrics.get('subscription_type'),
                "metrics": []
            },
            "codex": {
                "subscription_type": codex_metrics.get('subscription_type'),
                "metrics": []
            }
        }
    }

    # Add Claude metrics
    for name, data in claude_metrics.items():
        if name == 'subscription_type':
            continue
        output["services"]["claude"]["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    # Add Codex metrics
    for name, data in codex_metrics.items():
        if name == 'subscription_type':
            continue
        output["services"]["codex"]["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    return json.dumps(output, indent=2)


def format_combined_json(
    claude_metrics: Optional[Dict[str, any]],
    codex_metrics: Optional[Dict[str, any]],
    available_services: List[str]
) -> str:
    """Format combined metrics with service availability metadata.

    Args:
        claude_metrics: Claude metrics dict (None if not collected)
        codex_metrics: Codex metrics dict (None if not collected)
        available_services: List of available service names

    Returns:
        JSON string with availability metadata
    """
    output = {
        "timestamp": datetime.now().isoformat(),
        "available_services": available_services,
        "services": []
    }

    # Add Claude service
    claude_service = {
        "name": "claude",
        "available": "claude" in available_services,
        "subscription_type": claude_metrics.get('subscription_type') if claude_metrics else None,
        "metrics": []
    }

    if claude_metrics:
        for name, data in claude_metrics.items():
            if name == 'subscription_type':
                continue
            claude_service["metrics"].append({
                "name": name,
                "used_pct": data["used_pct"],
                "remaining_pct": data["remaining_pct"],
                "resets": data["resets"]
            })

    output["services"].append(claude_service)

    # Add Codex service
    codex_service = {
        "name": "codex",
        "available": "codex" in available_services,
        "subscription_type": codex_metrics.get('subscription_type') if codex_metrics else None,
        "metrics": []
    }

    if codex_metrics:
        for name, data in codex_metrics.items():
            if name == 'subscription_type':
                continue
            codex_service["metrics"].append({
                "name": name,
                "used_pct": data["used_pct"],
                "remaining_pct": data["remaining_pct"],
                "resets": data["resets"]
            })

    output["services"].append(codex_service)

    return json.dumps(output, indent=2)
