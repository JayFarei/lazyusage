"""SQLite database for usage history storage."""

import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional


class UsageStore:
    """SQLite-based storage for usage snapshots."""

    DEFAULT_DB_PATH = Path.home() / ".local" / "share" / "usage-cli" / "usage.db"

    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize database connection.

        Args:
            db_path: Path to database file. If None, uses default location.
                    Can also be set via USAGE_CLI_DB_PATH env var.
        """
        # Resolve database path
        if db_path is None:
            db_path = os.environ.get("USAGE_CLI_DB_PATH", str(self.DEFAULT_DB_PATH))

        self.db_path = Path(db_path)

        # Ensure parent directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        # Initialize database
        self._init_database()

    def _init_database(self):
        """Initialize database schema."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Create table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS usage_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    service TEXT NOT NULL CHECK (service IN ('claude', 'codex')),
                    metric_name TEXT NOT NULL,
                    used_pct INTEGER NOT NULL,
                    remaining_pct INTEGER NOT NULL,
                    resets TEXT,
                    resets_at TEXT,
                    subscription_type TEXT,
                    source TEXT NOT NULL DEFAULT 'pty',
                    collection_id TEXT
                )
            """)

            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_snapshots_service_metric_ts
                ON usage_snapshots (service, metric_name, timestamp)
            """)

            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp
                ON usage_snapshots (timestamp)
            """)

            conn.commit()

    def store_snapshot(
        self,
        service: str,
        metrics: Dict,
        source: str,
        collection_id: Optional[str] = None
    ):
        """
        Store usage snapshot.

        Args:
            service: Service name ('claude' or 'codex')
            metrics: Metrics dict from provider
            source: Data source (api, pty, cache, fallback)
            collection_id: Optional UUID to group related snapshots
        """
        if not metrics:
            return

        if collection_id is None:
            collection_id = str(uuid.uuid4())

        timestamp = datetime.utcnow().isoformat() + 'Z'

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Get subscription type
            subscription_type = metrics.get('subscription_type')

            # Store each metric
            for metric_name, metric_data in metrics.items():
                # Skip subscription_type key
                if metric_name == 'subscription_type' or not isinstance(metric_data, dict):
                    continue

                used_pct = metric_data.get('used_pct', 0)
                remaining_pct = metric_data.get('remaining_pct', 0)
                resets = metric_data.get('resets')

                # Try to parse resets to resets_at (ISO format)
                resets_at = None
                if resets:
                    try:
                        from ..utils.time import parse_time_to_datetime
                        dt = parse_time_to_datetime(resets)
                        resets_at = dt.isoformat() + 'Z'
                    except Exception:
                        pass

                cursor.execute("""
                    INSERT INTO usage_snapshots
                    (timestamp, service, metric_name, used_pct, remaining_pct,
                     resets, resets_at, subscription_type, source, collection_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    timestamp, service, metric_name, used_pct, remaining_pct,
                    resets, resets_at, subscription_type, source, collection_id
                ))

            conn.commit()

    def get_latest_snapshot(self, service: str) -> Optional[Dict]:
        """
        Get the latest snapshot for a service.

        Args:
            service: Service name ('claude' or 'codex')

        Returns:
            Dict with latest metrics or None
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute("""
                SELECT metric_name, used_pct, remaining_pct, resets, subscription_type
                FROM usage_snapshots
                WHERE service = ?
                  AND collection_id = (
                      SELECT collection_id
                      FROM usage_snapshots
                      WHERE service = ?
                      ORDER BY timestamp DESC
                      LIMIT 1
                  )
            """, (service, service))

            rows = cursor.fetchall()
            if not rows:
                return None

            # Reconstruct metrics dict
            metrics = {}
            subscription_type = None

            for row in rows:
                metric_name = row['metric_name']
                metrics[metric_name] = {
                    'used_pct': row['used_pct'],
                    'remaining_pct': row['remaining_pct'],
                    'resets': row['resets'],
                }
                if row['subscription_type']:
                    subscription_type = row['subscription_type']

            if subscription_type:
                metrics['subscription_type'] = subscription_type

            return metrics

    def cleanup_old_snapshots(self, days: int = 30):
        """
        Delete snapshots older than specified days.

        Args:
            days: Delete snapshots older than this many days
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM usage_snapshots
                WHERE timestamp < datetime('now', '-' || ? || ' days')
            """, (days,))

            deleted = cursor.rowcount
            conn.commit()

            return deleted
