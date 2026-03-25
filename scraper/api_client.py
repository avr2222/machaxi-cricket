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

    # ── Tournament match discovery (no Selenium) ──────────────────────────────

    def discover_matches(self, tournament_id: str) -> list[dict[str, str]]:
        """
        Try to list all past matches via API.
        Returns a list of {match_id, url} dicts, or [] if the endpoint fails.
        """
        # Try two common endpoint patterns
        endpoints = [
            f"tournament/matches/{tournament_id}?type=past&limit=200",
            f"tournament/{tournament_id}/matches?type=past&limit=200",
        ]
        for ep in endpoints:
            try:
                data = self._get(ep)
                matches = self._parse_tournament_matches(data, tournament_id)
                if matches:
                    log.info("[API] Discovered %d matches via %s", len(matches), ep)
                    return matches
            except Exception as exc:
                log.debug("[API] Tournament endpoint %s failed: %s", ep, exc)

        log.info("[API] Tournament discovery failed — will use Selenium fallback")
        return []

    def _parse_tournament_matches(
        self, data: dict, tournament_id: str
    ) -> list[dict[str, str]]:
        if not data.get("status"):
            return []
        items = (
            data.get("data", {}).get("data", [])
            or data.get("data", {}).get("matches", [])
            or data.get("data", [])
        )
        matches = []
        for item in items:
            mid = str(item.get("match_id") or item.get("id") or "")
            if not mid:
                continue
            slug = item.get("slug") or item.get("match_slug") or mid
            url = f"https://cricheroes.com/scorecard/{mid}/{slug}/scorecard"
            matches.append({"match_id": mid, "url": url})
        return matches

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
