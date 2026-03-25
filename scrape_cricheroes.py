#!/usr/bin/env python3
"""
CricHeroes Tournament Scraper — CLI entry point.

Usage:
    python scrape_cricheroes.py
    python scrape_cricheroes.py --list-only
    python scrape_cricheroes.py --visible
    python scrape_cricheroes.py --full-refresh
    python scrape_cricheroes.py --tournament-url "https://cricheroes.com/tournament/..."

Outputs (./cricheroes_data/):
    tournament_matches_summary.csv
    tournament_all_batting.csv
    tournament_all_bowling.csv
    tournament_all_balls.csv
    tournament_dot_ball_analysis.csv

Dashboard outputs:
    data/match_meta.csv, data/match_batting.csv, data/match_bowling.csv
    points_table.csv, *_leaderboard.csv

Tracker:
    scraped_matches.json  — skips already-scraped matches on re-run
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime


def _check_deps() -> None:
    missing = []
    for pkg in ("selenium", "bs4", "webdriver_manager"):
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg.replace("_", "-"))
    if missing:
        print(f"ERROR: Missing dependencies. Run:\n  pip install {' '.join(missing)}")
        sys.exit(1)


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Scrape CricHeroes tournament scorecards to CSV."
    )
    p.add_argument(
        "--tournament-url", default=None,
        help="Override the tournament past-matches URL",
    )
    p.add_argument(
        "--list-only", action="store_true",
        help="Print discovered match URLs only; do not scrape",
    )
    p.add_argument(
        "--visible", action="store_true",
        help="Run Chrome visibly (non-headless) for debugging",
    )
    p.add_argument(
        "--full-refresh", action="store_true",
        help="Re-scrape all matches, ignoring the tracker",
    )
    return p.parse_args()


def main() -> None:
    _check_deps()
    _setup_logging()
    args = _parse_args()

    # Imports after dep check so missing-package errors are readable
    from scraper.browser import chrome_driver
    from scraper.config import ScraperConfig
    from scraper.pipeline import ScraperPipeline

    log = logging.getLogger(__name__)
    config = ScraperConfig()
    tournament_url = args.tournament_url or config.tournament_url

    log.info("=" * 60)
    log.info("CricHeroes Tournament Scraper")
    log.info("Started: %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    log.info("=" * 60)

    pipeline = ScraperPipeline(config)

    with chrome_driver(headless=not args.visible, user_agent=config.user_agent) as driver:
        pipeline.run(
            driver=driver,
            tournament_url=tournament_url,
            full_refresh=args.full_refresh,
            list_only=args.list_only,
        )

    log.info("Done: %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


if __name__ == "__main__":
    main()
