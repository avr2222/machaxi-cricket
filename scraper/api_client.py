"""CricHeroes internal API client — no browser, no Cloudflare risk."""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone

from .config import ScraperConfig
from .models import Ball, BattingRow, BowlingRow, InningsInfo, MatchInfo

log = logging.getLogger(__name__)


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_date(raw: str) -> str:
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return raw[:10]


def _overs_notation(whole: int, total_balls: int) -> str:
    extra = total_balls - whole * 6
    if extra < 0 or extra > 5:
        extra = total_balls % 6
    return f"{whole}.{extra}"


def _parse_commentary_players(text: str) -> tuple[str, str]:
    m = re.match(r"^(.+?)\s+to\s+(.+?)(?:,|$)", text, re.I)
    return (m.group(1).strip(), m.group(2).strip()) if m else ("", "")


class CricHeroesAPIClient:
    """Wraps every CricHeroes internal API endpoint."""

    def __init__(self, config: ScraperConfig) -> None:
        self._cfg = config

    # ── Low-level ─────────────────────────────────────────────────────────────

    def _get(self, path: str) -> dict:
        url = f"{self._cfg.api_base}/{path.lstrip('/')}"
        req = urllib.request.Request(url, headers=self._cfg.api_headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())

    # ── Tournament match discovery ─────────────────────────────────────────────

    def discover_matches(self, tournament_id: str) -> list[dict[str, str]]:
        """
        Discover past matches. Tries api.cricheroes.in first (same API that
        scorecards use), then falls back to cricheroes.com Next.js route.
        Returns [] on failure so the caller can use Selenium.
        """
        import time
        ts = int(time.time() * 1000)

        # Try 1: internal API (same host as scorecard — works in GitHub Actions)
        api_paths = [
            f"match/get-tournament-matches/3/-1/-1?tournamentid={tournament_id}&status=3&pagesize=50&pageno=1&datetime={ts}",
            f"tournament/match/list?tournament_id={tournament_id}&status=past&limit=200",
        ]
        for path in api_paths:
            try:
                data = self._get(path)
                matches: dict[str, dict] = {}
                self._collect_items(data.get("data", []) if isinstance(data.get("data"), list) else [], matches)
                if not matches and isinstance(data.get("data"), dict):
                    self._collect_items(data["data"].get("data", []), matches)
                if matches:
                    # follow pagination
                    next_path = (data.get("page") or {}).get("next")
                    while next_path:
                        try:
                            next_url = (
                                next_path if next_path.startswith("http")
                                else f"{self._cfg.api_base}/{next_path.lstrip('/')}"
                            )
                            pdata = self._get_url(next_url)
                            self._collect_items(pdata.get("data", []), matches)
                            next_path = (pdata.get("page") or {}).get("next")
                        except Exception:
                            break
                    result = list(matches.values())
                    log.info("[API] Discovered %d matches via %s", len(result), path.split("?")[0])
                    return result
            except Exception as exc:
                log.debug("[API] %s failed: %s", path.split("?")[0], exc)

        # Try 2: cricheroes.com Next.js pagination route
        nextjs_url = (
            f"https://cricheroes.com/match/get-tournament-matches/3/-1/-1"
            f"?tournamentid={tournament_id}&status=3&pagesize=50&pageno=1&datetime={ts}"
        )
        try:
            result = self._paginate_matches(nextjs_url)
            if result:
                log.info("[API] Discovered %d matches via Next.js route", len(result))
                return result
        except Exception as exc:
            log.debug("[API] Next.js route failed: %s", exc)

        log.info("[API] Tournament discovery failed — will use Selenium fallback")
        return []

    def discover_matches_from_html(self, html: str) -> list[dict[str, str]]:
        """
        Parse matches from __NEXT_DATA__ JSON embedded in the tournament page HTML,
        then follow pagination to collect all matches.
        """
        m = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            html, re.DOTALL,
        )
        if not m:
            log.info("[API] __NEXT_DATA__ not found in page HTML (Cloudflare challenge?)")
            return []
        try:
            data = json.loads(m.group(1))
            mr = data["props"]["pageProps"]["matchResponse"]
        except (KeyError, json.JSONDecodeError) as exc:
            log.info("[API] __NEXT_DATA__ parse failed: %s", exc)
            return []

        matches: dict[str, dict] = {}
        self._collect_items(mr.get("data", []), matches)

        next_path = (mr.get("page") or {}).get("next")
        while next_path:
            try:
                next_url = f"https://cricheroes.com{next_path}"
                page_data = self._get_url(next_url)
                self._collect_items(page_data.get("data", []), matches)
                next_path = (page_data.get("page") or {}).get("next")
            except Exception as exc:
                log.debug("[API] Pagination page failed: %s", exc)
                break

        result = list(matches.values())
        log.info("[API] Discovered %d matches from __NEXT_DATA__", len(result))
        return result

    def _paginate_matches(self, start_url: str) -> list[dict[str, str]]:
        """Fetch all pages starting from start_url, following page.next links."""
        matches: dict[str, dict] = {}
        next_url: str | None = start_url
        while next_url:
            data = self._get_url(next_url)
            self._collect_items(data.get("data", []), matches)
            next_path = (data.get("page") or {}).get("next")
            next_url = f"https://cricheroes.com{next_path}" if next_path else None
        return list(matches.values())

    def _collect_items(self, items: list, matches: dict) -> None:
        """Parse match items and add to matches dict (keyed by match_id)."""
        for item in items:
            mid = str(item.get("match_id") or "")
            if not mid or mid in matches:
                continue
            t_slug = item.get("tournament_name", "").lower().replace(" ", "-")
            team_a = item.get("team_a", "").lower().replace(" ", "-")
            team_b = item.get("team_b", "").lower().replace(" ", "-")
            match_slug = f"{team_a}-vs-{team_b}"
            url = f"https://cricheroes.com/scorecard/{mid}/{t_slug}/{match_slug}/scorecard"
            matches[mid] = {"match_id": mid, "url": url}

    def _get_url(self, url: str) -> dict:
        """GET an arbitrary URL with the configured headers."""
        req = urllib.request.Request(url, headers=self._cfg.api_headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())

    # ── Scorecard ─────────────────────────────────────────────────────────────

    def fetch_scorecard(
        self, match_id: str, url: str
    ) -> tuple[MatchInfo | None, list[BattingRow], list[BowlingRow], list["InningsInfo"]]:
        try:
            data = self._get(f"scorecard/v2/get-scorecard/{match_id}")
        except Exception as exc:
            log.warning("[API] get-scorecard %s: %s", match_id, exc)
            return None, [], [], []

        if not data.get("status"):
            log.warning("[API] get-scorecard %s returned status=false", match_id)
            return None, [], [], []

        d = data["data"]
        info = self._parse_match_info(d, match_id, url)
        batting, bowling = self._parse_innings(d, match_id)
        innings_meta = self._parse_innings_meta(d)
        return info, batting, bowling, innings_meta

    def _parse_innings_meta(self, d: dict) -> list["InningsInfo"]:
        """Extract innings metadata (team_id, inning_num) from scorecard data."""
        from .models import InningsInfo
        meta: list[InningsInfo] = []
        for team_key in ("team_a", "team_b"):
            team_data = d.get(team_key, {})
            team_id = int(team_data.get("team_id") or team_data.get("id") or 0)
            team_name = team_data.get("name", "")
            for sc in team_data.get("scorecard", []):
                inn_num = int(sc.get("inning", 0))
                if team_id and inn_num:
                    meta.append(InningsInfo(
                        inning_num=inn_num,
                        team_id=team_id,
                        team_name=team_name,
                    ))
        return meta

    def _parse_match_info(self, d: dict, match_id: str, url: str) -> MatchInfo:
        raw_dt = d.get("start_datetime", "")
        winning = d.get("winning_team", "")
        win_by = d.get("win_by", "")
        summary = d.get("match_summary")
        result = (
            summary.get("summary", "") if isinstance(summary, dict)
            else f"{winning} won by {win_by}".strip() if winning
            else ""
        )
        # MOM: try match_summary.player_of_the_match, then top-level
        mom = (
            (summary.get("player_of_the_match") if isinstance(summary, dict) else None)
            or d.get("player_of_the_match")
            or {}
        )
        return MatchInfo(
            match_id=match_id,
            team1=d.get("team_a", {}).get("name", ""),
            team2=d.get("team_b", {}).get("name", ""),
            result=result,
            date=_parse_date(raw_dt),
            toss=d.get("toss_details", ""),
            venue=d.get("ground_name", ""),
            url=url,
            scraped_at=_now_utc(),
            man_of_match=mom.get("player_name", "") if isinstance(mom, dict) else "",
            man_of_match_team=mom.get("team_name", "") if isinstance(mom, dict) else "",
        )

    def _parse_innings(
        self, d: dict, match_id: str
    ) -> tuple[list[BattingRow], list[BowlingRow]]:
        batting_rows: list[BattingRow] = []
        bowling_rows: list[BowlingRow] = []

        for team_key in ("team_a", "team_b"):
            team_data = d.get(team_key, {})
            team_name = team_data.get("name", "")
            other_key = "team_b" if team_key == "team_a" else "team_a"
            bowl_team = d.get(other_key, {}).get("name", "")

            for sc in team_data.get("scorecard", []):
                inn = sc.get("inning", 0)
                for bat in sc.get("batting", []):
                    batting_rows.append(BattingRow(
                        match_id=match_id, innings=inn, batting_team=team_name,
                        player=bat.get("name", ""),
                        player_id=str(bat.get("player_id", "")),
                        how_out=bat.get("how_to_out", ""),
                        runs=int(bat.get("runs", 0)),
                        balls=int(bat.get("balls", 0)),
                        fours=int(bat.get("4s", 0)),
                        sixes=int(bat.get("6s", 0)),
                        strike_rate=bat.get("SR", ""),
                    ))
                for bowl in sc.get("bowling", []):
                    w = int(bowl.get("overs", 0))
                    tb = int(bowl.get("balls", 0))
                    bowling_rows.append(BowlingRow(
                        match_id=match_id, innings=inn, bowling_team=bowl_team,
                        player=bowl.get("name", ""),
                        player_id=str(bowl.get("player_id", "")),
                        overs=_overs_notation(w, tb),
                        maidens=int(bowl.get("maidens", 0)),
                        runs=int(bowl.get("runs", 0)),
                        wickets=int(bowl.get("wickets", 0)),
                        dot_balls=int(bowl.get("0s", 0)),
                        fours_conceded=int(bowl.get("4s", 0)),
                        sixes_conceded=int(bowl.get("6s", 0)),
                        wides=int(bowl.get("wide", 0)),
                        no_balls=int(bowl.get("noball", 0)),
                        economy=bowl.get("economy_rate", ""),
                    ))

        return batting_rows, bowling_rows

    # ── Commentary ────────────────────────────────────────────────────────────

    def fetch_commentary(
        self, match_id: str, innings_list: list[InningsInfo]
    ) -> list[Ball]:
        all_balls: list[Ball] = []
        for inn in innings_list:
            all_balls.extend(self._fetch_innings_commentary(match_id, inn))
        return all_balls

    def _fetch_innings_commentary(
        self, match_id: str, inn: InningsInfo
    ) -> list[Ball]:
        path = (
            f"scorecard/v2/get-commentary/{match_id}"
            f"?inning={inn.inning_num}&teamId={inn.team_id}"
        )
        try:
            data = self._get(path)
            raw = data.get("data", {}).get("commentary", [])
        except Exception as exc:
            log.warning("[API] commentary inn %d: %s", inn.inning_num, exc)
            return []

        balls = []
        for b in raw:
            bowler, batsman = _parse_commentary_players(b.get("commentary", ""))
            extra = b.get("extra_type_code", "").strip()
            run = int(b.get("run", 0))
            extra_run = int(b.get("extra_run", 0))
            is_legal = extra not in ("WD", "NB")
            is_dot = is_legal and run == 0 and extra_run == 0
            balls.append(Ball(
                match_id=match_id, innings=inn.inning_num,
                batting_team=inn.team_name,
                over_ball=b.get("ball", ""),
                bowler=bowler, batsman=batsman,
                run=run, extra_type=extra, extra_run=extra_run,
                is_wicket=int(b.get("is_out", 0)),
                is_boundary=int(b.get("is_boundry", 0)),
                is_dot_ball=int(is_dot),
                commentary=b.get("commentary", ""),
            ))
        return balls
