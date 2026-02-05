"""JSON formatter."""

import json
from datetime import datetime
from typing import Dict


def format_json(service: str, metrics: Dict[str, Dict]) -> str:
    """Format metrics as JSON.

    Args:
        service: Service name ('claude' or 'codex')
        metrics: Metrics dict

    Returns:
        JSON string
    """
    output = {
        "service": service,
        "timestamp": datetime.now().isoformat(),
        "metrics": []
    }

    for name, data in metrics.items():
        output["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    return json.dumps(output, indent=2)


def format_all_json(claude_metrics: Dict[str, Dict], codex_metrics: Dict[str, Dict]) -> str:
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
                "metrics": []
            },
            "codex": {
                "metrics": []
            }
        }
    }

    # Add Claude metrics
    for name, data in claude_metrics.items():
        output["services"]["claude"]["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    # Add Codex metrics
    for name, data in codex_metrics.items():
        output["services"]["codex"]["metrics"].append({
            "name": name,
            "used_pct": data["used_pct"],
            "remaining_pct": data["remaining_pct"],
            "resets": data["resets"]
        })

    return json.dumps(output, indent=2)
