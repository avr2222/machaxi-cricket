"""Orchestrator — discovery → scrape → write."""
from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup
from selenium import webdriver

from .analytics import (
    compute_dot_ball_analysis,
    compute_leaderboards,
    compute_points_table,
    overs_to_balls,
)
from .api_client import CricHeroesAPIClient
from .config import ScraperConfig
from .discovery import MatchDiscovery
from .models import Ball, BattingRow, BowlingRow, InningsInfo, MatchInfo, ScrapeResult
from .parsers import (
    FallbackHTMLParser,
    FallbackInfoParser,
    NextDataParser,
    parse_how_out,
    parse_result_string,
    parse_toss_string,
)
from .storage import (
    BAT_LB_FIELDS,
    BATTING_FIELDS,
    BALLS_FIELDS,
    BOWL_LB_FIELDS,
    BOWLING_FIELDS,
    DOTBALL_FIELDS,
    FIELD_LB_FIELDS,
    MATCH_BATTING_FIELDS,
    MATCH_BOWLING_FIELDS,
    META_FIELDS,
    MVP_LB_FIELDS,
    POINTS_TABLE_FIELDS,
    SUMMARY_FIELDS,
    CSVStore,
    Tracker,
)

log = logging.getLogger(__name__)


# ── Match scraper ─────────────────────────────────────────────────────────────

class MatchScraper:
    """Scrapes one match: API first, Selenium fallback."""

    def __init__(
        self,
        driver: webdriver.Chrome,
        api: CricHeroesAPIClient,
        config: ScraperConfig,
    ) -> None:
        self._driver = driver
        self._api = api
        self._cfg = config
        self._next_parser = NextDataParser()
        self._html_parser = FallbackHTMLParser()
        self._info_parser = FallbackInfoParser()

    def scrape(self, match_id: str, url: str) -> ScrapeResult:
        # ── Primary: direct API (no Selenium, no Cloudflare) ──
        info, batting, bowling, innings_meta = self._api.fetch_scorecard(match_id, url)
        if batting or bowling:
            log.info("    [API] %d batting, %d bowling rows", len(batting), len(bowling))
            balls = self._api.fetch_commentary(match_id, innings_meta) if innings_meta else []
            return ScrapeResult(info=info, batting=batting, bowling=bowling, balls=balls)

        # ── Fallback: Selenium browser ──
        log.info("    [API] empty — browser fallback: %s", url)
        self._driver.get(url)
        time.sleep(self._cfg.page_wait_secs)

        html = self._driver.page_source
        self._save_debug(f"match_{match_id}.html", html)
        soup = BeautifulSoup(html, "html.parser")

        info, batting, bowling, innings_meta = self._next_parser.parse(
            soup, match_id, url
        )

        if batting or bowling:
            log.info("    [JSON] %d batting, %d bowling rows", len(batting), len(bowling))
            if not info or not info.team1:
                fallback = self._info_parser.parse(soup, match_id, url)
                if info:
                    fallback.result = info.result or fallback.result
                info = fallback
            balls = self._api.fetch_commentary(match_id, innings_meta)
            return ScrapeResult(info=info, batting=batting, bowling=bowling, balls=balls)

        log.warning("    __NEXT_DATA__ empty — trying HTML tables")
        batting, bowling = self._html_parser.parse(soup, match_id)
        if not info:
            info = self._info_parser.parse(soup, match_id, url)
        log.info("    [HTML] %d batting, %d bowling rows", len(batting), len(bowling))
        return ScrapeResult(info=info, batting=batting, bowling=bowling)

    def _innings_meta_from_debug(self, match_id: str) -> list[InningsInfo]:
        saved = self._cfg.debug_dir / f"match_{match_id}.html"
        if not saved.exists():
            return []
        soup = BeautifulSoup(saved.read_text(encoding="utf-8"), "html.parser")
        _, _, _, meta = self._next_parser.parse(soup, match_id, "")
        return meta

    def _save_debug(self, filename: str, html: str) -> None:
        path = self._cfg.debug_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")


# ── Output writer ─────────────────────────────────────────────────────────────

class OutputWriter:
    """Transforms scraped data into CSV files for the dashboard."""

    def __init__(self, store: CSVStore, config: ScraperConfig) -> None:
        self._store = store
        self._cfg = config

    def write_raw(
        self,
        all_info: list[MatchInfo],
        all_batting: list[BattingRow],
        all_bowling: list[BowlingRow],
        all_balls: list[Ball],
        dot_analysis: list[dict],
    ) -> None:
        od = self._cfg.output_dir

        def _bat_key(r: BattingRow) -> str:
            return f"{r.match_id}|{r.innings}|{r.batting_team}|{r.player}"

        def _bowl_key(r: BowlingRow) -> str:
            return f"{r.match_id}|{r.innings}|{r.bowling_team}|{r.player}"

        def _ball_key(r: Ball) -> str:
            return f"{r.match_id}|{r.innings}|{r.over_ball}|{r.batsman}|{r.bowler}"

        info_dicts = [vars(i) for i in all_info]
        bat_dicts = [{**vars(r), "_key": _bat_key(r)} for r in all_batting]
        bowl_dicts = [{**vars(r), "_key": _bowl_key(r)} for r in all_bowling]
        ball_dicts = [{**vars(r), "_key": _ball_key(r)} for r in all_balls]
        dot_dicts = [
            {**r, "_key": f"{r['bowler']}|{r['batsman']}|{r['match_id']}"}
            for r in dot_analysis
        ]

        self._store.write_merged(od / "tournament_matches_summary.csv", SUMMARY_FIELDS, info_dicts, "match_id")
        self._store.write_merged(od / "tournament_all_batting.csv", BATTING_FIELDS, bat_dicts, "_key")
        self._store.write_merged(od / "tournament_all_bowling.csv", BOWLING_FIELDS, bowl_dicts, "_key")
        self._store.write_merged(od / "tournament_all_balls.csv", BALLS_FIELDS, ball_dicts, "_key")
        self._store.write_merged(od / "tournament_dot_ball_analysis.csv", DOTBALL_FIELDS, dot_dicts, "_key")

    def write_dashboard(
        self,
        all_info: list[MatchInfo],
        all_batting: list[BattingRow],
        all_bowling: list[BowlingRow],
        all_balls: list[Ball],
    ) -> None:
        dd = self._cfg.data_dir
        date_by_mid = {i.match_id: i.date for i in all_info}

        # Ball stats per bowler per innings (from commentary)
        bowl_stats: dict[tuple, dict] = defaultdict(
            lambda: {"dot_balls": 0, "fours_conceded": 0, "sixes_conceded": 0}
        )
        for b in all_balls:
            if b.extra_type in ("WD", "NB"):
                continue
            key = (b.match_id, b.innings, b.bowler)
            bs = bowl_stats[key]
            if b.is_dot_ball:
                bs["dot_balls"] += 1
            if b.is_boundary and b.run == 4:
                bs["fours_conceded"] += 1
            if b.is_boundary and b.run == 6:
                bs["sixes_conceded"] += 1

        # Innings teams from batting data
        innings_teams: dict[str, dict[int, str]] = defaultdict(dict)
        for r in all_batting:
            innings_teams[r.match_id][int(r.innings)] = r.batting_team

        # match_meta
        meta_rows = []
        for info in all_info:
            toss_winner, toss_decision = parse_toss_string(info.toss)
            winner, margin = parse_result_string(info.result)
            itm = innings_teams.get(info.match_id, {})
            meta_rows.append({
                "match_id": info.match_id,
                "match_date": info.date,
                "innings1_team": itm.get(1, info.team1),
                "innings2_team": itm.get(2, info.team2),
                "toss_winner": toss_winner,
                "toss_decision": toss_decision,
                "result": info.result,
                "winner": winner,
                "margin": margin,
                "man_of_match": info.man_of_match,
                "man_of_match_team": info.man_of_match_team,
            })

        # match_batting
        position_counter: dict[tuple, int] = defaultdict(int)
        bat_rows = []
        for r in all_batting:
            pos_key = (r.match_id, r.innings)
            position_counter[pos_key] += 1
            dtype, dis_by, caught_by = parse_how_out(r.how_out)
            bat_rows.append({
                "match_id": r.match_id,
                "match_date": date_by_mid.get(r.match_id, ""),
                "innings": r.innings, "batting_team": r.batting_team,
                "position": position_counter[pos_key], "player": r.player,
                "runs": r.runs, "balls": r.balls, "fours": r.fours,
                "sixes": r.sixes, "strike_rate": r.strike_rate,
                "dismissal_type": dtype, "dismissed_by": dis_by,
                "caught_by": caught_by,
                "_key": f"{r.match_id}|{r.innings}|{r.batting_team}|{r.player}",
            })

        # match_bowling
        bowl_rows = []
        for r in all_bowling:
            bkey = (r.match_id, r.innings, r.player)
            bs = bowl_stats.get(bkey, {})
            bowl_rows.append({
                "match_id": r.match_id,
                "match_date": date_by_mid.get(r.match_id, ""),
                "innings": r.innings, "bowling_team": r.bowling_team, "player": r.player,
                "overs": r.overs, "maidens": r.maidens, "runs": r.runs,
                "wickets": r.wickets,
                "dot_balls": bs.get("dot_balls", r.dot_balls),
                "fours_conceded": bs.get("fours_conceded", r.fours_conceded),
                "sixes_conceded": bs.get("sixes_conceded", r.sixes_conceded),
                "wides": r.wides, "no_balls": r.no_balls, "economy": r.economy,
                "_key": f"{r.match_id}|{r.innings}|{r.bowling_team}|{r.player}",
            })

        # Write match-level CSVs
        self._store.write_merged(dd / "match_meta.csv", META_FIELDS, meta_rows, "match_id")
        self._store.write_merged(dd / "match_batting.csv", MATCH_BATTING_FIELDS, bat_rows, "_key")
        self._store.write_merged(dd / "match_bowling.csv", MATCH_BOWLING_FIELDS, bowl_rows, "_key")

        # Points table (fully recomputed)
        bat_by_match: dict[str, list[dict]] = defaultdict(list)
        for r in bat_rows:
            bat_by_match[r["match_id"]].append(r)
        bowl_by_match: dict[str, list[dict]] = defaultdict(list)
        for r in bowl_rows:
            bowl_by_match[r["match_id"]].append(r)

        pt_rows = compute_points_table(meta_rows, bat_by_match, bowl_by_match)
        self._store.write(Path("points_table.csv"), POINTS_TABLE_FIELDS, pt_rows)
        self._log_points_table(pt_rows)

        # Leaderboards (from full match history)
        all_bat_hist = self._store.read(dd / "match_batting.csv")
        all_bowl_hist = self._store.read(dd / "match_bowling.csv")
        bat_lb, bowl_lb, field_lb, mvp_lb = compute_leaderboards(all_bat_hist, all_bowl_hist)

        self._store.write(Path("batting_leaderboard.csv"), BAT_LB_FIELDS, bat_lb)
        self._store.write(Path("bowling_leaderboard.csv"), BOWL_LB_FIELDS, bowl_lb)
        self._store.write(Path("fielding_leaderboard.csv"), FIELD_LB_FIELDS, field_lb)
        self._store.write(Path("mvp_leaderboard.csv"), MVP_LB_FIELDS, mvp_lb)

        # Tournament config JSON
        self._write_tournament_config(pt_rows)

    def _write_tournament_config(self, pt_rows: list[dict]) -> None:
        teams = [{"name": r["team"], "short": r["short"]} for r in pt_rows]
        path = self._cfg.data_dir / "tournament_config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"teams": teams}, indent=2), encoding="utf-8")
        log.info("  Wrote %s", path)

    @staticmethod
    def _log_points_table(rows: list[dict]) -> None:
        log.info("  Points table:")
        for r in rows:
            sign = "+" if r["NRR"] >= 0 else ""
            log.info(
                "    #%d %s  %dW %dL  %dpts  NRR %s%.3f",
                r["rank"], r["short"], r["W"], r["L"], r["Pts"], sign, r["NRR"],
            )


# ── Main pipeline ─────────────────────────────────────────────────────────────

class ScraperPipeline:
    """Orchestrates the full scrape: discover → filter → scrape → write."""

    def __init__(self, config: ScraperConfig) -> None:
        self._cfg = config
        self._store = CSVStore()
        self._tracker = Tracker(config.tracker_file)

    def run(
        self,
        driver: webdriver.Chrome,
        tournament_url: str,
        full_refresh: bool = False,
        list_only: bool = False,
    ) -> None:
        api = CricHeroesAPIClient(self._cfg)
        writer = OutputWriter(self._store, self._cfg)

        # Phase 1: Discover matches (API first, Selenium fallback)
        tournament_id = self._cfg.tournament_id_from_url()
        matches = []
        if tournament_id:
            matches = api.discover_matches(tournament_id)

        if not matches:
            log.info("[Discovery] API failed — using Selenium browser")
            discovery = MatchDiscovery(driver, self._cfg, api)
            matches = discovery.discover(tournament_url)

        if not matches:
            if full_refresh and self._tracker.scraped_ids:
                log.warning(
                    "[Discovery] All discovery methods failed — "
                    "falling back to %d match(es) in tracker for --full-refresh",
                    len(self._tracker.scraped_ids),
                )
                matches = [
                    {"match_id": mid, "url": info["url"]}
                    for mid, info in self._tracker.scraped_entries.items()
                ]
            else:
                log.error("[ERROR] No match URLs found. Check debug_html/tournament_page.html")
                return

        if list_only:
            log.info("Found %d match(es):", len(matches))
            for m in matches:
                log.info("  [%s] %s", m["match_id"], m["url"])
            return

        # Phase 2: Filter already-scraped
        if full_refresh:
            to_scrape = matches
            log.info("[--full-refresh] Re-scraping all %d match(es)", len(matches))
        else:
            already = self._tracker.scraped_ids
            to_scrape = [m for m in matches if m["match_id"] not in already]
            log.info("Matches found:   %d", len(matches))
            log.info("Already scraped: %d", len(matches) - len(to_scrape))
            log.info("To scrape now:   %d", len(to_scrape))

        if not to_scrape:
            log.info("Nothing new to scrape. All matches are up to date.")
            return

        # Phase 3: Scrape
        match_scraper = MatchScraper(driver, api, self._cfg)
        results: list[ScrapeResult] = []
        errors: list[dict] = []

        log.info("Scraping %d match(es)...", len(to_scrape))
        for idx, match in enumerate(to_scrape, 1):
            log.info("[%d/%d] Match %s", idx, len(to_scrape), match["match_id"])
            try:
                result = match_scraper.scrape(match["match_id"], match["url"])
                results.append(result)
                dot_count = sum(b.is_dot_ball for b in result.balls)
                log.info(
                    "    [commentary] %d deliveries, %d dot balls",
                    len(result.balls), dot_count,
                )
                self._tracker.mark(match["match_id"], match["url"])
            except Exception as exc:
                log.error("    [ERROR] %s: %s", match["match_id"], exc)
                errors.append({"match_id": match["match_id"], "error": str(exc)})

            if idx < len(to_scrape):
                time.sleep(self._cfg.match_delay_secs)

        # Phase 4: Write
        if not results:
            log.warning("[WARN] No data extracted. Run with --visible to debug.")
            return

        all_info = [r.info for r in results]
        all_batting = [row for r in results for row in r.batting]
        all_bowling = [row for r in results for row in r.bowling]
        all_balls = [ball for r in results for ball in r.balls]
        dot_analysis = compute_dot_ball_analysis(all_balls)

        log.info(
            "Scraped: %d matches | %d batting | %d bowling | %d deliveries | %d errors",
            len(all_info), len(all_batting), len(all_bowling), len(all_balls), len(errors),
        )

        log.info("Writing raw CSV files...")
        writer.write_raw(all_info, all_batting, all_bowling, all_balls, dot_analysis)
        log.info("Writing dashboard CSVs...")
        writer.write_dashboard(all_info, all_batting, all_bowling, all_balls)

        if errors:
            log.error("Errors (%d):", len(errors))
            for e in errors:
                log.error("  [%s] %s", e["match_id"], e["error"])
