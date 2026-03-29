"""CSV and JSON persistence — Tracker and CSVStore."""
from __future__ import annotations

import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

# ── CSV field lists ────────────────────────────────────────────────────────────

SUMMARY_FIELDS = [
    "match_id", "team1", "team2", "result",
    "date", "toss", "venue", "url", "scraped_at",
]
BATTING_FIELDS = [
    "match_id", "innings", "batting_team", "player", "player_id",
    "how_out", "runs", "balls", "fours", "sixes", "strike_rate",
]
BOWLING_FIELDS = [
    "match_id", "innings", "bowling_team", "player", "player_id",
    "overs", "maidens", "runs", "wickets", "wides", "no_balls", "economy",
]
BALLS_FIELDS = [
    "match_id", "innings", "batting_team", "over_ball",
    "bowler", "batsman", "run", "extra_type", "extra_run",
    "is_wicket", "is_boundary", "is_dot_ball", "commentary",
]
DOTBALL_FIELDS = [
    "match_id", "innings", "batting_team", "bowler", "batsman",
    "total_balls", "dot_balls", "dot_pct",
    "runs_off_bat", "boundaries", "sixes", "wickets",
]
META_FIELDS = [
    "match_id", "match_date", "innings1_team", "innings2_team",
    "toss_winner", "toss_decision", "result", "winner", "margin",
    "man_of_match", "man_of_match_team",
]
MATCH_BATTING_FIELDS = [
    "match_id", "match_date", "innings", "batting_team", "position",
    "player", "runs", "balls", "fours", "sixes", "strike_rate",
    "dismissal_type", "dismissed_by", "caught_by",
]
MATCH_BOWLING_FIELDS = [
    "match_id", "match_date", "innings", "bowling_team", "player",
    "overs", "maidens", "runs", "wickets", "dot_balls",
    "fours_conceded", "sixes_conceded", "wides", "no_balls", "economy",
]
POINTS_TABLE_FIELDS = [
    "rank", "team", "short", "M", "W", "L", "D", "T", "NR",
    "NRR", "For", "Against", "Pts", "last5",
]
BAT_LB_FIELDS = [
    "player_id", "name", "team_id", "team_name", "total_match", "innings",
    "total_runs", "highest_run", "average", "not_out", "strike_rate",
    "ball_faced", "batting_hand", "4s", "6s", "50s", "100s",
]
BOWL_LB_FIELDS = [
    "player_id", "name", "team_id", "team_name", "total_match", "innings",
    "total_wickets", "balls", "highest_wicket", "economy", "SR",
    "maidens", "avg", "runs", "bowling_style", "overs", "dot_balls",
]
FIELD_LB_FIELDS = [
    "player_id", "name", "team_id", "team_name", "total_match",
    "catches", "caught_behind", "run_outs", "assist_run_outs",
    "stumpings", "caught_and_bowl", "total_catches", "total_dismissal",
]
MVP_LB_FIELDS = [
    "Player Name", "Team Name", "Player Role", "Bowling Style",
    "Batting Hand", "Matches", "Batting", "Bowling", "Fielding", "Total",
]


# ── Tracker ───────────────────────────────────────────────────────────────────

class Tracker:
    """Persists the set of already-scraped match IDs to JSON."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._data: dict = self._load()

    def _load(self) -> dict:
        if self._path.exists():
            try:
                return json.loads(self._path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"scraped": {}}

    def is_scraped(self, match_id: str) -> bool:
        return match_id in self._data["scraped"]

    def mark(self, match_id: str, url: str) -> None:
        self._data["scraped"][match_id] = {
            "url": url,
            "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self._path.write_text(
            json.dumps(self._data, indent=2), encoding="utf-8"
        )

    @property
    def scraped_ids(self) -> frozenset[str]:
        return frozenset(self._data["scraped"])

    @property
    def scraped_entries(self) -> dict[str, dict]:
        """Return the full {match_id: {url, scraped_at}} mapping."""
        return dict(self._data["scraped"])


# ── CSVStore ──────────────────────────────────────────────────────────────────

class CSVStore:
    """Reads/writes CSV files with merge-on-key support."""

    def read(self, path: Path) -> list[dict]:
        if not path.exists():
            return []
        with path.open(newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def write_replace_by_match(
        self,
        path: Path,
        fields: list[str],
        new_rows: list[dict],
    ) -> int:
        """Replace all rows for match IDs present in new_rows, keep the rest."""
        new_match_ids = {str(r.get("match_id", "")) for r in new_rows if r.get("match_id")}
        existing = [r for r in self.read(path) if r.get("match_id") not in new_match_ids]
        merged = existing + new_rows
        self._write(path, fields, merged)
        log.info("  Wrote %4d rows -> %s", len(merged), path)
        return len(merged)

    def write_merged(
        self,
        path: Path,
        fields: list[str],
        new_rows: list[dict],
        key_col: str,
    ) -> int:
        """Merge new_rows into existing file (keyed by key_col) then overwrite."""
        existing = {r[key_col]: r for r in self.read(path) if r.get(key_col)}
        for row in new_rows:
            k = str(row.get(key_col, ""))
            if k:
                existing[k] = row
        merged = list(existing.values())
        self._write(path, fields, merged)
        log.info("  Wrote %4d rows -> %s", len(merged), path)
        return len(merged)

    def write(self, path: Path, fields: list[str], rows: list[dict]) -> int:
        self._write(path, fields, rows)
        log.info("  Wrote %4d rows -> %s", len(rows), path)
        return len(rows)

    @staticmethod
    def _write(path: Path, fields: list[str], rows: list[dict]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
