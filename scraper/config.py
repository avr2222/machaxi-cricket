"""Centralised configuration — single source of truth for all constants."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ScraperConfig:
    # ── Tournament ────────────────────────────────────────────────────────────
    tournament_url: str = (
        "https://cricheroes.com/tournament/1874258/"
        "machaxi-box-cricket-season-2/matches/past-matches"
    )

    # ── Output paths ─────────────────────────────────────────────────────────
    output_dir: Path = Path("cricheroes_data")
    debug_dir: Path = Path("debug_html")
    data_dir: Path = Path("data")
    tracker_file: Path = Path("scraped_matches.json")

    # ── Timing ────────────────────────────────────────────────────────────────
    page_wait_secs: float = 8.0
    scroll_pause_secs: float = 2.0
    match_delay_secs: float = 3.0
    max_scroll_rounds: int = 30

    # ── Browser ───────────────────────────────────────────────────────────────
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    # ── CricHeroes internal API ───────────────────────────────────────────────
    api_base: str = "https://api.cricheroes.in/api/v1"
    api_key: str = "cr!CkH3r0s"
    api_device_type: str = "Chrome: 124.0.0.0"
    api_udid: str = "VIlqkQdJ"

    @property
    def api_headers(self) -> dict[str, str]:
        return {
            "api-key": self.api_key,
            "device-type": self.api_device_type,
            "udid": self.api_udid,
            "Referer": "https://cricheroes.com/",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": self.user_agent,
        }

    def tournament_id_from_url(self) -> str:
        """Extract numeric tournament ID from the tournament URL."""
        import re
        m = re.search(r"/tournament/(\d+)/", self.tournament_url)
        return m.group(1) if m else ""


DEFAULT_CONFIG = ScraperConfig()
