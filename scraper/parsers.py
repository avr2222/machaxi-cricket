"""HTML/JSON parsing — scorecard extraction and dismissal string parsing."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from .models import BattingRow, BowlingRow, InningsInfo, MatchInfo

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


# ── Primary parser: __NEXT_DATA__ JSON ───────────────────────────────────────

class NextDataParser:
    """Parses the __NEXT_DATA__ JSON block embedded by Next.js."""

    def parse(
        self, soup: BeautifulSoup, match_id: str, page_url: str
    ) -> tuple[MatchInfo | None, list[BattingRow], list[BowlingRow], list[InningsInfo]]:
        script = soup.find("script", id="__NEXT_DATA__")
        if not script or not script.string:
            return None, [], [], []
        try:
            data = json.loads(script.string)
        except json.JSONDecodeError:
            return None, [], [], []

        page_props = data.get("props", {}).get("pageProps", {})
        info = self._parse_match_info(page_props, match_id, page_url)
        batting, bowling, innings_meta = self._parse_scorecard(page_props, match_id)
        return info, batting, bowling, innings_meta

    def _parse_match_info(
        self, page_props: dict, match_id: str, url: str
    ) -> MatchInfo:
        summary = page_props.get("summaryData", {}).get("data", {})
        team_a = summary.get("team_a", {})
        team_b = summary.get("team_b", {})
        mom = summary.get("player_of_the_match") or {}
        winning = summary.get("winning_team", "")
        win_by = summary.get("win_by", "")
        result = (
            f"{winning} won by {win_by}".strip()
            if winning
            else summary.get("match_result", "")
        )
        return MatchInfo(
            match_id=match_id,
            team1=team_a.get("name", ""),
            team2=team_b.get("name", ""),
            result=result,
            date=_parse_date(summary.get("start_datetime", "")),
            toss=summary.get("toss_details", ""),
            venue=summary.get("ground_name", ""),
            man_of_match=mom.get("player_name", ""),
            man_of_match_team=mom.get("team_name", ""),
            url=url,
            scraped_at=_now_utc(),
        )

    def _parse_scorecard(
        self, page_props: dict, match_id: str
    ) -> tuple[list[BattingRow], list[BowlingRow], list[InningsInfo]]:
        scorecard = page_props.get("scorecard", [])
        if not isinstance(scorecard, list) or not scorecard:
            return [], [], []

        batting_rows: list[BattingRow] = []
        bowling_rows: list[BowlingRow] = []
        innings_meta: list[InningsInfo] = []

        for innings_data in scorecard:
            inning_meta = innings_data.get("inning", {})
            inn_num = inning_meta.get("inning", 0)
            bat_team = innings_data.get("teamName", "")
            team_id = innings_data.get("team_id", 0)

            innings_meta.append(InningsInfo(
                inning_num=inn_num,
                team_id=int(team_id),
                team_name=bat_team,
            ))

            for bat in innings_data.get("batting", []):
                batting_rows.append(BattingRow(
                    match_id=match_id, innings=inn_num, batting_team=bat_team,
                    player=bat.get("name", ""),
                    player_id=str(bat.get("player_id", "")),
                    how_out=bat.get("how_to_out", ""),
                    runs=int(bat.get("runs", 0)),
                    balls=int(bat.get("balls", 0)),
                    fours=int(bat.get("4s", 0)),
                    sixes=int(bat.get("6s", 0)),
                    strike_rate=bat.get("SR", ""),
                ))

            bowl_team = next(
                (o.get("teamName", "") for o in scorecard if o is not innings_data),
                "",
            )
            for bowl in innings_data.get("bowling", []):
                w = int(bowl.get("overs", 0))
                tb = int(bowl.get("balls", 0))
                extra = tb - w * 6
                if extra < 0 or extra > 5:
                    extra = tb % 6
                bowling_rows.append(BowlingRow(
                    match_id=match_id, innings=inn_num, bowling_team=bowl_team,
                    player=bowl.get("name", ""),
                    player_id=str(bowl.get("player_id", "")),
                    overs=f"{w}.{extra}",
                    maidens=int(bowl.get("maidens", 0)),
                    runs=int(bowl.get("runs", 0)),
                    wickets=int(bowl.get("wickets", 0)),
                    wides=int(bowl.get("wide", 0)),
                    no_balls=int(bowl.get("noball", 0)),
                    economy=bowl.get("economy_rate", ""),
                ))

        return batting_rows, bowling_rows, innings_meta


# ── Fallback: HTML table parsing ──────────────────────────────────────────────

class FallbackHTMLParser:
    """Last-resort table parser when __NEXT_DATA__ scorecard is empty."""

    def parse(
        self, soup: BeautifulSoup, match_id: str
    ) -> tuple[list[BattingRow], list[BowlingRow]]:
        batting_rows: list[BattingRow] = []
        bowling_rows: list[BowlingRow] = []
        innings_num = 1
        for tbl in soup.find_all("table"):
            headers = [
                th.get_text(strip=True).lower()
                for th in tbl.find_all("th")[:6]
            ]
            prev = tbl.find_previous(["h1", "h2", "h3", "h4", "strong"])
            team = prev.get_text(strip=True) if prev else ""

            if any(h in ("r", "runs", "b", "balls", "4s", "6s", "sr") for h in headers):
                rows = self._parse_batting(tbl, match_id, innings_num, team)
                if rows:
                    batting_rows.extend(rows)
                    innings_num += 1
            elif any(h in ("o", "m", "w", "eco", "economy", "overs") for h in headers):
                rows = self._parse_bowling(tbl, match_id, innings_num, team)
                if rows:
                    bowling_rows.extend(rows)
        return batting_rows, bowling_rows

    def _parse_batting(
        self, table, match_id: str, innings: int, team: str
    ) -> list[BattingRow]:
        rows = []
        for tr in table.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            if len(tds) < 4:
                continue
            texts = [td.get_text(separator=" ", strip=True) for td in tds]
            if any(h in texts[0].lower() for h in ("batters", "batsman", "player")):
                continue
            if re.match(r"^(total|extras?|did not bat)", texts[0], re.I):
                continue
            nums = self._trailing_nums(texts)
            if len(nums) < 5:
                continue
            try:
                runs, balls, fours, sixes, sr = (
                    int(nums[-5]), int(nums[-4]),
                    int(nums[-3]), int(nums[-2]), float(nums[-1]),
                )
            except (ValueError, IndexError):
                continue
            player = self._clean_name(texts[0], texts[1] if len(texts) > 1 else "")
            if not player:
                continue
            how_out = next(
                (t for t in texts[1:] if not re.fullmatch(r"[\d.*-]+", t.strip())), ""
            )
            rows.append(BattingRow(
                match_id=match_id, innings=innings, batting_team=team,
                player=player, player_id="", how_out=how_out,
                runs=runs, balls=balls, fours=fours, sixes=sixes, strike_rate=sr,
            ))
        return rows

    def _parse_bowling(
        self, table, match_id: str, innings: int, team: str
    ) -> list[BowlingRow]:
        rows = []
        for tr in table.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            if len(tds) < 4:
                continue
            texts = [td.get_text(separator=" ", strip=True) for td in tds]
            if any(h in texts[0].lower() for h in ("bowler", "player")):
                continue
            nums = self._trailing_nums(texts)
            if len(nums) < 5:
                continue
            try:
                overs, maidens, runs, wickets, economy = (
                    float(nums[0]), int(nums[1]),
                    int(nums[2]), int(nums[3]), float(nums[4]),
                )
            except (ValueError, IndexError):
                continue
            player = self._clean_name(texts[0], texts[1] if len(texts) > 1 else "")
            if not player:
                continue
            rows.append(BowlingRow(
                match_id=match_id, innings=innings, bowling_team=team,
                player=player, player_id="", overs=str(overs),
                maidens=maidens, runs=runs, wickets=wickets,
                wides=0, no_balls=0, economy=economy,
            ))
        return rows

    @staticmethod
    def _trailing_nums(texts: list[str]) -> list[float]:
        nums: list[float] = []
        for t in reversed(texts):
            c = t.replace("*", "").strip()
            if re.fullmatch(r"[\d.]+", c):
                try:
                    nums.append(float(c))
                except ValueError:
                    break
            else:
                break
        nums.reverse()
        return nums

    @staticmethod
    def _clean_name(first: str, second: str) -> str:
        player = first if not re.fullmatch(r"\d+", first) else second
        player = re.sub(r"\(c\s*&\s*wk\)|\(c\)|\(wk\)", "", player, flags=re.I)
        player = re.sub(r"^\d+\s+", "", player).strip()
        return player if len(player) >= 2 else ""


# ── Fallback: match info from page text ───────────────────────────────────────

class FallbackInfoParser:
    """Extracts basic match metadata from raw page text."""

    def parse(self, soup: BeautifulSoup, match_id: str, url: str) -> MatchInfo:
        full = soup.get_text(separator="\n")

        def _find(pattern: str, flags: int = 0) -> str:
            m = re.search(pattern, full, flags)
            return m.group(1).strip() if m else ""

        return MatchInfo(
            match_id=match_id, team1="", team2="",
            result=_find(r"([\w\s]+(?:won|tied|no result)[^\n]{0,80})", re.I)[:200],
            date=_find(r"\b(\d{4}-\d{2}-\d{2})\b"),
            toss=_find(r"(toss[^\n]{0,120})", re.I)[:200],
            venue=_find(r"(?:venue|ground|at)[:\s]+([^\n,]{3,60})", re.I),
            url=url, scraped_at=_now_utc(),
        )


# ── Dismissal string parsers (used by dashboard CSV writer) ──────────────────

def parse_how_out(text: str) -> tuple[str, str, str]:
    """
    Parse 'how_to_out' into (dismissal_type, dismissed_by, caught_by).

    Returns one of:
      bowled, caught, lbw, stumped, run_out, not_out, retired_hurt, unknown
    """
    if not text:
        return "unknown", "", ""
    t = re.sub(r"[^\x00-\x7F]+", " ", text).strip()

    if re.search(r"\bnot\s+out\b", t, re.I):
        return "not_out", "", ""
    if re.search(r"\bretired\s+hurt\b", t, re.I):
        return "retired_hurt", "", ""

    # caught-and-bowled
    m = re.match(r"^c\s*&\s*b\s+(.+)$", t, re.I)
    if m:
        bowler = m.group(1).strip()
        return "caught", bowler, bowler

    _PATTERNS = [
        (r"^c\s+(.+?)\s+b\s+(.+)$", "caught"),
        (r"^st\s+(.+?)\s+b\s+(.+)$", "stumped"),
        (r"^lbw\s+b\s+(.+)$", "lbw"),
        (r"^b\s+(.+)$", "bowled"),
    ]
    for pattern, dtype in _PATTERNS:
        m = re.match(pattern, t, re.I)
        if m:
            groups = m.groups()
            if len(groups) == 2:
                return dtype, groups[1].strip(), groups[0].strip()
            return dtype, groups[0].strip(), ""

    if re.search(r"\brun\s+out\b", t, re.I):
        after = re.sub(r".*?run\s+out", "", t, flags=re.I).strip()
        after = re.sub(r"^[\s\(\)\[\]^>/\\|]+", "", after)
        after = re.sub(r"(?i)^throw\s+by\s+", "", after)
        fielder = re.split(r"[/,]", after)[0].strip()
        return "run_out", fielder, ""

    return "unknown", "", ""


def parse_toss_string(toss: str) -> tuple[str, str]:
    """Returns (winner_name, decision) from a toss description string."""
    m = re.search(r"Toss[:\s]+(.+?)\s+opt\s+to\s+(bat|field)", toss, re.I)
    if m:
        winner = re.sub(r"\([^)]+\)", "", m.group(1)).strip()
        return winner, m.group(2).lower()
    return "", ""


def parse_result_string(result: str) -> tuple[str, str]:
    """Returns (winner_name, margin) from a match result string."""
    m = re.search(r"^(.+?)\s+won\s+by\s+(.+)$", result, re.I)
    if m:
        winner = re.sub(r"\([^)]+\)", "", m.group(1)).strip()
        return winner, m.group(2).strip()
    return "", ""
