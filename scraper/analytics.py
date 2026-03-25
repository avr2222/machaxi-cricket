"""Analytics — dot ball analysis, points table, leaderboards."""
from __future__ import annotations

import logging
import re
from collections import defaultdict

from .models import Ball
from .parsers import parse_how_out

log = logging.getLogger(__name__)


# ── Overs helper ─────────────────────────────────────────────────────────────

def overs_to_balls(overs_str: str) -> int:
    """
    Convert CricHeroes overs string to total balls.

    Handles three API formats:
      "9.1"  → 55   standard: X overs + Y balls, Y in 0-5
      "2.6"  → 12   API marks complete over with balls=6
      "2.12" → 12   API total-balls format
    """
    try:
        w, p = str(overs_str).split(".")
        whole, part = int(w), int(p)
        if part == 6:
            return whole * 6
        if part > 6:
            return part
        return whole * 6 + part
    except Exception:
        try:
            return int(float(overs_str)) * 6
        except Exception:
            return 0


# ── Dot ball analysis ─────────────────────────────────────────────────────────

def compute_dot_ball_analysis(all_balls: list[Ball]) -> list[dict]:
    """Aggregate ball-by-ball into a bowler-vs-batsman dot ball table."""
    agg: dict[tuple, dict] = defaultdict(lambda: {
        "total_balls": 0, "dot_balls": 0, "runs_off_bat": 0,
        "boundaries": 0, "sixes": 0, "wickets": 0,
    })
    for b in all_balls:
        if not b.bowler or not b.batsman:
            continue
        if b.extra_type in ("WD", "NB"):
            continue
        key = (b.match_id, b.innings, b.batting_team, b.bowler, b.batsman)
        r = agg[key]
        r["total_balls"] += 1
        r["dot_balls"] += b.is_dot_ball
        r["runs_off_bat"] += b.run
        if b.is_boundary and b.run == 4:
            r["boundaries"] += 1
        if b.is_boundary and b.run == 6:
            r["sixes"] += 1
        r["wickets"] += b.is_wicket

    rows = []
    for (match_id, innings, batting_team, bowler, batsman), r in agg.items():
        total = r["total_balls"]
        dot_pct = round(r["dot_balls"] / total * 100, 1) if total else 0.0
        rows.append({
            "match_id": match_id, "innings": innings,
            "batting_team": batting_team, "bowler": bowler, "batsman": batsman,
            "total_balls": total, "dot_balls": r["dot_balls"], "dot_pct": dot_pct,
            "runs_off_bat": r["runs_off_bat"], "boundaries": r["boundaries"],
            "sixes": r["sixes"], "wickets": r["wickets"],
        })
    rows.sort(key=lambda x: (-x["dot_balls"], x["match_id"], x["innings"]))
    return rows


# ── Team registry ─────────────────────────────────────────────────────────────

class TeamRegistry:
    """Maps team name variants → canonical short code and full name."""

    def __init__(self) -> None:
        self._reg: dict[str, dict[str, str]] = {}

    def build(self, team_names: list[str]) -> None:
        self._reg.clear()
        for full in team_names:
            m = re.search(r"\(([A-Z0-9]+)\)\s*$", full)
            short = m.group(1) if m else full[:3].upper()
            key = re.sub(r"\s*\([^)]+\)\s*$", "", full.lower()).strip()
            entry = {"short": short, "full": full}
            self._reg[key] = entry
            self._reg[short.lower()] = entry

    def find_key(self, name: str) -> str | None:
        n = name.lower().strip()
        for key in self._reg:
            if key in n:
                return key
        return None

    def short(self, name: str) -> str:
        k = self.find_key(name)
        return self._reg[k]["short"] if k else name

    def __getitem__(self, key: str) -> dict[str, str]:
        return self._reg[key]

    def keys(self) -> list[str]:
        return list(self._reg.keys())

    @property
    def all_teams(self) -> list[dict[str, str]]:
        seen: set[str] = set()
        result = []
        for val in self._reg.values():
            s = val["short"]
            if s not in seen:
                seen.add(s)
                result.append(val)
        return result


# ── Points table ──────────────────────────────────────────────────────────────

def compute_points_table(
    meta_rows: list[dict],
    batting_by_match: dict[str, list[dict]],
    bowling_by_match: dict[str, list[dict]],
) -> list[dict]:
    registry = TeamRegistry()
    all_teams = {
        v
        for m in meta_rows
        for k in ("innings1_team", "innings2_team")
        if (v := m.get(k, ""))
    }
    registry.build(sorted(all_teams))
    team_keys = registry.keys()

    stats: dict[str, dict] = defaultdict(lambda: dict(
        M=0, W=0, L=0, T=0, NR=0, Pts=0,
        runs_for=0, balls_for=0, runs_against=0, balls_against=0, results=[],
    ))

    bowl_runs: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    bowl_balls: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for mid, rows in bowling_by_match.items():
        for r in rows:
            k = registry.find_key(r.get("bowling_team", ""))
            if k:
                bowl_runs[mid][k] += int(r.get("runs", 0))
                bowl_balls[mid][k] += overs_to_balls(r.get("overs", "0"))

    for meta in sorted(meta_rows, key=lambda m: m.get("match_date", "")):
        mid = meta["match_id"]
        winner_lc = meta.get("winner", "").lower()
        result_lc = meta.get("result", "").lower()
        t1_key = registry.find_key(meta.get("innings1_team", ""))
        t2_key = registry.find_key(meta.get("innings2_team", ""))
        if not t1_key or not t2_key:
            continue

        stats[t1_key]["M"] += 1
        stats[t2_key]["M"] += 1

        if "tied" in result_lc:
            for k in (t1_key, t2_key):
                stats[k]["T"] += 1
                stats[k]["Pts"] += 1
                stats[k]["results"].append("T")
        elif t1_key in winner_lc and t2_key not in winner_lc:
            _record_win(stats, t1_key, t2_key)
        elif t2_key in winner_lc and t1_key not in winner_lc:
            _record_win(stats, t2_key, t1_key)
        else:
            for k in (t1_key, t2_key):
                stats[k]["NR"] += 1
                stats[k]["Pts"] += 1
                stats[k]["results"].append("NR")

        # NRR accumulation
        runs_t1 = bowl_runs[mid].get(t2_key, 0)
        runs_t2 = bowl_runs[mid].get(t1_key, 0)
        bf_t1 = bowl_balls[mid].get(t2_key, 0)
        bf_t2 = bowl_balls[mid].get(t1_key, 0)
        if bf_t1:
            stats[t1_key]["runs_for"] += runs_t1
            stats[t1_key]["balls_for"] += bf_t1
            stats[t2_key]["runs_against"] += runs_t1
            stats[t2_key]["balls_against"] += bf_t1
        if bf_t2:
            stats[t2_key]["runs_for"] += runs_t2
            stats[t2_key]["balls_for"] += bf_t2
            stats[t1_key]["runs_against"] += runs_t2
            stats[t1_key]["balls_against"] += bf_t2

    rows = []
    for team_key, s in stats.items():
        info = registry[team_key]
        rpo_for = (s["runs_for"] / s["balls_for"] * 6) if s["balls_for"] else 0
        rpo_against = (s["runs_against"] / s["balls_against"] * 6) if s["balls_against"] else 0
        nrr = round(rpo_for - rpo_against, 3)
        wh, wp = divmod(s["balls_for"], 6)
        ah, ap = divmod(s["balls_against"], 6)
        rows.append({
            "rank": 0, "team": info["full"], "short": info["short"],
            "M": s["M"], "W": s["W"], "L": s["L"], "D": 0,
            "T": s["T"], "NR": s["NR"], "Pts": s["Pts"], "NRR": nrr,
            "For": f"{s['runs_for']}/{wh}.{wp}" if wp else f"{s['runs_for']}/{wh}",
            "Against": f"{s['runs_against']}/{ah}.{ap}" if ap else f"{s['runs_against']}/{ah}",
            "last5": "|".join(s["results"][-5:]),
            "_sort": (s["Pts"], nrr),
        })

    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        del r["_sort"]
    return rows


def _record_win(stats: dict, winner: str, loser: str) -> None:
    stats[winner]["W"] += 1
    stats[winner]["Pts"] += 2
    stats[winner]["results"].append("W")
    stats[loser]["L"] += 1
    stats[loser]["results"].append("L")


# ── Leaderboards ──────────────────────────────────────────────────────────────

def compute_leaderboards(
    all_batting: list[dict], all_bowling: list[dict]
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    bat_lb = _batting_leaderboard(all_batting)
    bowl_lb = _bowling_leaderboard(all_bowling)
    field_lb = _fielding_leaderboard(all_batting, bat_lb, bowl_lb)
    mvp_lb = _mvp_leaderboard(bat_lb, bowl_lb, field_lb)
    return bat_lb, bowl_lb, field_lb, mvp_lb


def _batting_leaderboard(rows: list[dict]) -> list[dict]:
    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["player"].strip(), r.get("batting_team", ""))
        runs = int(r.get("runs", 0) or 0)
        balls = int(r.get("balls", 0) or 0)
        dismissal = (r.get("how_out") or r.get("dismissal_type") or "").lower()
        not_out = dismissal in ("", "not_out", "notout", "retired_hurt", "unknown", "-")
        if key not in agg:
            agg[key] = dict(
                player_id=r.get("player_id", ""), name=key[0], team_name=key[1],
                matches=set(), innings=0, total_runs=0, highest_run=0,
                not_out=0, balls=0, fours=0, sixes=0, fifties=0, hundreds=0,
            )
        s = agg[key]
        s["matches"].add(r.get("match_id", ""))
        s["innings"] += 1
        s["total_runs"] += runs
        s["balls"] += balls
        s["fours"] += int(r.get("fours", 0) or 0)
        s["sixes"] += int(r.get("sixes", 0) or 0)
        s["highest_run"] = max(s["highest_run"], runs)
        if not_out:
            s["not_out"] += 1
        if runs >= 100:
            s["hundreds"] += 1
        elif runs >= 50:
            s["fifties"] += 1

    result = []
    for (player, team), s in agg.items():
        dism = s["innings"] - s["not_out"]
        avg = round(s["total_runs"] / dism, 2) if dism else "-"
        sr = round(s["total_runs"] / s["balls"] * 100, 2) if s["balls"] else 0.0
        result.append({
            "player_id": s["player_id"], "name": player, "team_id": "",
            "team_name": team, "total_match": len(s["matches"]),
            "innings": s["innings"], "total_runs": s["total_runs"],
            "highest_run": s["highest_run"], "average": avg,
            "not_out": s["not_out"], "strike_rate": sr,
            "ball_faced": s["balls"], "batting_hand": "-",
            "4s": s["fours"], "6s": s["sixes"],
            "50s": s["fifties"], "100s": s["hundreds"],
        })
    result.sort(key=lambda r: -r["total_runs"])
    return result


def _bowling_leaderboard(rows: list[dict]) -> list[dict]:
    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["player"].strip(), r.get("bowling_team", ""))
        wkts = int(r.get("wickets", 0) or 0)
        runs = int(r.get("runs", 0) or 0)
        balls = overs_to_balls(str(r.get("overs", "0") or "0"))
        if key not in agg:
            agg[key] = dict(
                player_id=r.get("player_id", ""), name=key[0], team_name=key[1],
                matches=set(), innings=0, total_wickets=0, highest_wicket=0,
                balls=0, runs=0, maidens=0, dot_balls=0,
            )
        s = agg[key]
        s["matches"].add(r.get("match_id", ""))
        s["innings"] += 1
        s["total_wickets"] += wkts
        s["balls"] += balls
        s["runs"] += runs
        s["maidens"] += int(r.get("maidens", 0) or 0)
        s["dot_balls"] += int(r.get("dot_balls", 0) or 0)
        s["highest_wicket"] = max(s["highest_wicket"], wkts)

    result = []
    for (player, team), s in agg.items():
        tb = s["balls"]
        econ = round(s["runs"] / (tb / 6), 2) if tb else 0.0
        sr = round(tb / s["total_wickets"], 2) if s["total_wickets"] else "-"
        avg = round(s["runs"] / s["total_wickets"], 2) if s["total_wickets"] else "-"
        result.append({
            "player_id": s["player_id"], "name": player, "team_id": "",
            "team_name": team, "total_match": len(s["matches"]),
            "innings": s["innings"], "total_wickets": s["total_wickets"],
            "balls": tb, "highest_wicket": s["highest_wicket"],
            "economy": econ, "SR": sr, "maidens": s["maidens"],
            "avg": avg, "runs": s["runs"], "bowling_style": "-",
            "overs": f"{tb // 6}.{tb % 6}", "dot_balls": s["dot_balls"],
        })
    result.sort(key=lambda r: -r["total_wickets"])
    return result


def _fielding_leaderboard(
    batting_rows: list[dict],
    bat_lb: list[dict],
    bowl_lb: list[dict],
) -> list[dict]:
    agg: dict[str, dict] = {}

    def _entry(player: str) -> dict:
        if player not in agg:
            agg[player] = dict(
                name=player, player_id="", matches=set(),
                catches=0, caught_behind=0, run_outs=0,
                assist_run_outs=0, stumpings=0, caught_and_bowl=0,
            )
        return agg[player]

    for r in batting_rows:
        mid = r.get("match_id", "")
        how = (r.get("how_out") or r.get("dismissal_type") or "").lower().replace(" ", "_")
        caught_by = (r.get("caught_by") or "").strip()
        dismissed_by = (r.get("dismissed_by") or "").strip()

        if "caught" in how and "caught_and_bowl" not in how and caught_by:
            e = _entry(caught_by); e["catches"] += 1; e["matches"].add(mid)
        if "caught_and_bowl" in how and dismissed_by:
            e = _entry(dismissed_by); e["caught_and_bowl"] += 1; e["matches"].add(mid)
        if "stumped" in how and caught_by:
            e = _entry(caught_by); e["stumpings"] += 1; e["matches"].add(mid)
        if "run_out" in how and caught_by:
            e = _entry(caught_by); e["run_outs"] += 1; e["matches"].add(mid)

    player_team = {r["name"]: r["team_name"] for r in bat_lb}
    player_team.update({r["name"]: r["team_name"] for r in bowl_lb})

    result = []
    for player, s in agg.items():
        total_catches = s["catches"] + s["caught_behind"] + s["caught_and_bowl"]
        total_dismissals = total_catches + s["run_outs"] + s["stumpings"]
        result.append({
            "player_id": s["player_id"], "name": player, "team_id": "",
            "team_name": player_team.get(player, ""),
            "total_match": len(s["matches"]),
            "catches": s["catches"], "caught_behind": s["caught_behind"],
            "run_outs": s["run_outs"], "assist_run_outs": s["assist_run_outs"],
            "stumpings": s["stumpings"], "caught_and_bowl": s["caught_and_bowl"],
            "total_catches": total_catches, "total_dismissal": total_dismissals,
        })
    result.sort(key=lambda r: -r["total_dismissal"])
    return result


def _mvp_leaderboard(
    bat_lb: list[dict], bowl_lb: list[dict], field_lb: list[dict]
) -> list[dict]:
    bat_idx = {r["name"]: r for r in bat_lb}
    bowl_idx = {r["name"]: r for r in bowl_lb}
    field_idx = {r["name"]: r for r in field_lb}
    all_players = set(bat_idx) | set(bowl_idx)

    result = []
    for player in all_players:
        b = bat_idx.get(player, {})
        bw = bowl_idx.get(player, {})
        fld = field_idx.get(player, {})
        team = b.get("team_name") or bw.get("team_name") or ""

        bat_score = round(
            int(b.get("total_runs", 0) or 0) * 0.5
            + int(b.get("4s", 0) or 0) * 0.5
            + int(b.get("6s", 0) or 0) * 1.5
            + int(b.get("50s", 0) or 0) * 4
            + int(b.get("100s", 0) or 0) * 8,
            3,
        )
        bowl_score = max(
            round(
                int(bw.get("total_wickets", 0) or 0) * 8
                + int(bw.get("dot_balls", 0) or 0) * 0.1
                - int(bw.get("runs", 0) or 0) * 0.1,
                3,
            ),
            0,
        )
        field_score = round(int(fld.get("total_dismissal", 0) or 0) * 2.0, 3)
        total = round(bat_score + bowl_score + field_score, 3)

        if total <= 0:
            continue

        matches = max(
            int(b.get("total_match", 0) or 0),
            int(bw.get("total_match", 0) or 0),
        )
        result.append({
            "Player Name": player, "Team Name": team,
            "Player Role": "-", "Bowling Style": "-", "Batting Hand": "-",
            "Matches": matches, "Batting": bat_score,
            "Bowling": bowl_score, "Fielding": field_score, "Total": total,
        })
    result.sort(key=lambda r: -r["Total"])
    return result
