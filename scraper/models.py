"""Data models — typed dataclasses for all scraped entities."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MatchInfo:
    match_id: str
    team1: str
    team2: str
    result: str
    date: str
    toss: str
    venue: str
    url: str
    scraped_at: str
    man_of_match: str = ""
    man_of_match_team: str = ""


@dataclass
class BattingRow:
    match_id: str
    innings: int
    batting_team: str
    player: str
    player_id: str
    how_out: str
    runs: int
    balls: int
    fours: int
    sixes: int
    strike_rate: str | float


@dataclass
class BowlingRow:
    match_id: str
    innings: int
    bowling_team: str
    player: str
    player_id: str
    overs: str
    maidens: int
    runs: int
    wickets: int
    wides: int
    no_balls: int
    economy: str | float
    dot_balls: int = 0
    fours_conceded: int = 0
    sixes_conceded: int = 0


@dataclass
class Ball:
    match_id: str
    innings: int
    batting_team: str
    over_ball: str
    bowler: str
    batsman: str
    run: int
    extra_type: str
    extra_run: int
    is_wicket: int
    is_boundary: int
    is_dot_ball: int
    commentary: str


@dataclass
class InningsInfo:
    inning_num: int
    team_id: int
    team_name: str


@dataclass
class ScrapeResult:
    """All data collected for one match."""
    info: MatchInfo
    batting: list[BattingRow] = field(default_factory=list)
    bowling: list[BowlingRow] = field(default_factory=list)
    balls: list[Ball] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.error is None and (bool(self.batting) or bool(self.bowling))
