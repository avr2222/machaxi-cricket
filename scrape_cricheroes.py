#!/usr/bin/env python3
"""
scrape_cricheroes.py
────────────────────
Scrapes all past match scorecards from a CricHeroes tournament page using
Selenium (headless Chrome), then saves structured data to CSV files.

PRIMARY strategy: parse __NEXT_DATA__ JSON embedded in the /scorecard tab page.
This gives clean, complete batting + bowling data without any HTML table tricks.

Usage:
    pip install selenium beautifulsoup4 webdriver-manager
    python scrape_cricheroes.py
    python scrape_cricheroes.py --list-only
    python scrape_cricheroes.py --visible
    python scrape_cricheroes.py --full-refresh
    python scrape_cricheroes.py --tournament-url "https://cricheroes.com/tournament/..."

Outputs (./cricheroes_data/):
    tournament_matches_summary.csv
    tournament_all_batting.csv
    tournament_all_bowling.csv
    tournament_all_balls.csv          (ball-by-ball)
    tournament_dot_ball_analysis.csv  (bowler vs batsman)

Dashboard-compatible outputs (replaces PDF workflow):
    data/match_meta.csv       <- exact schema the dashboard reads
    data/match_batting.csv    <- exact schema the dashboard reads
    data/match_bowling.csv    <- exact schema the dashboard reads
    points_table.csv          <- auto-computed from results

Debug HTML dumps (./debug_html/):
    tournament_page.html       <- raw tournament listing page
    match_<id>.html            <- raw /scorecard tab HTML per match

Tracker:
    scraped_matches.json       <- skip already-scraped matches on re-run
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone

# ── Dependency check ──────────────────────────────────────────────────────────

def check_deps():
    missing = []
    for pkg in ["selenium", "bs4", "webdriver_manager"]:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg.replace("_", "-"))
    if missing:
        print("ERROR: Missing dependencies. Run:\n"
              f"  pip install {' '.join(missing)}")
        sys.exit(1)

check_deps()

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_TOURNAMENT_URL = (
    "https://cricheroes.com/tournament/1874258/"
    "machaxi-box-cricket-season-2/matches/past-matches"
)

OUTPUT_DIR   = "cricheroes_data"
DEBUG_DIR    = "debug_html"
TRACKER_FILE = "scraped_matches.json"

# CricHeroes internal API (no Selenium needed for commentary)
API_BASE    = "https://api.cricheroes.in/api/v1"
API_HEADERS = {
    "api-key":     "cr!CkH3r0s",
    "device-type": "Chrome: 124.0.0.0",
    "udid":        "VIlqkQdJ",
    "Referer":     "https://cricheroes.com/",
    "Accept":      "application/json, text/plain, */*",
    "User-Agent":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
}

PAGE_WAIT_SECS    = 8
SCROLL_PAUSE_SECS = 2
MATCH_DELAY_SECS  = 3
MAX_SCROLL_ROUNDS = 30

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ── Driver setup ─────────────────────────────────────────────────────────────

def build_driver(headless: bool) -> webdriver.Chrome:
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-software-rasterizer")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--disable-background-networking")
    opts.add_argument("--disable-default-apps")
    opts.add_argument("--disable-sync")
    opts.add_argument("--no-first-run")
    opts.add_argument("--remote-debugging-port=0")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument(f"--user-agent={USER_AGENT}")
    opts.add_argument("--window-size=1920,1080")

    service = Service(ChromeDriverManager().install())
    driver  = webdriver.Chrome(service=service, options=opts)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"}
    )
    return driver


# ── URL helpers ───────────────────────────────────────────────────────────────

def extract_match_id(url: str) -> str | None:
    m = re.search(r'/scorecard/(\d+)', url)
    return m.group(1) if m else None


def to_scorecard_tab_url(url: str) -> str:
    """
    Convert any cricheroes match URL to its /scorecard tab form.
    e.g. .../live -> .../scorecard
         .../summary -> .../scorecard
    Keeps the slug intact, only replaces the last path segment.
    """
    url = url.rstrip("/")
    # Replace last segment with 'scorecard'
    parts = url.split("/")
    last  = parts[-1]
    # If last segment looks like a tab name or 'live', replace it
    if last in ("live", "summary", "commentary", "analysis", "cricheroes", "mvp", "teams", "gallery"):
        parts[-1] = "scorecard"
    elif not last.isdigit() and "/" in url.split("/scorecard/", 1)[-1]:
        # Has slug after the ID — replace last segment
        parts[-1] = "scorecard"
    url = "/".join(parts)
    return url


def save_html(filename: str, html: str):
    os.makedirs(DEBUG_DIR, exist_ok=True)
    path = os.path.join(DEBUG_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"    [debug] HTML saved -> {path}")


def scroll_to_bottom(driver, pause: float = SCROLL_PAUSE_SECS) -> int:
    last_h = driver.execute_script("return document.body.scrollHeight")
    rounds = 0
    for _ in range(MAX_SCROLL_ROUNDS):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(pause)
        new_h = driver.execute_script("return document.body.scrollHeight")
        rounds += 1
        if new_h == last_h:
            break
        last_h = new_h
    return rounds


# ── Match URL discovery ───────────────────────────────────────────────────────

def click_load_more(driver) -> int:
    """Click 'Load more' button repeatedly until it disappears. Returns click count."""
    clicks = 0
    for _ in range(20):   # safety cap
        try:
            btn = driver.find_element(
                By.XPATH,
                "//button[normalize-space(text())='Load more']"
            )
            if not btn.is_displayed():
                break
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            time.sleep(0.5)
            btn.click()
            clicks += 1
            time.sleep(SCROLL_PAUSE_SECS + 1)   # wait for new cards to render
        except Exception:
            break   # button gone
    return clicks


def discover_match_urls(driver, tournament_url: str) -> list[dict]:
    print(f"\n[DISCOVERY] Loading tournament page...")
    print(f"  URL: {tournament_url}")
    driver.get(tournament_url)
    time.sleep(PAGE_WAIT_SECS)

    rounds = scroll_to_bottom(driver)
    print(f"  Scrolled {rounds} round(s) to load all matches.")

    # Click "Load more" until all past matches are visible
    clicks = click_load_more(driver)
    if clicks:
        print(f"  Clicked 'Load more' {clicks} time(s) — scrolling again...")
        scroll_to_bottom(driver)

    html = driver.page_source
    save_html("tournament_page.html", html)
    soup = BeautifulSoup(html, "html.parser")

    matches = {}

    # Strategy 1: <a href> containing /scorecard/
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/scorecard/" in href:
            full = href if href.startswith("http") else "https://cricheroes.com" + href
            full = to_scorecard_tab_url(full)
            mid  = extract_match_id(full)
            if mid and mid not in matches:
                matches[mid] = {"match_id": mid, "url": full}

    # Strategy 2: data-href / data-url attributes
    if not matches:
        for tag in soup.find_all(True):
            for attr in ("data-href", "data-url", "data-link"):
                val = tag.get(attr, "")
                if "/scorecard/" in val:
                    full = val if val.startswith("http") else "https://cricheroes.com" + val
                    full = to_scorecard_tab_url(full)
                    mid  = extract_match_id(full)
                    if mid and mid not in matches:
                        matches[mid] = {"match_id": mid, "url": full}

    # Strategy 3: raw regex over HTML
    if not matches:
        for path in re.findall(r'["\']([^"\']*?/scorecard/\d+[^"\']*?)["\']', html):
            full = path if path.startswith("http") else "https://cricheroes.com" + path
            full = to_scorecard_tab_url(full)
            mid  = extract_match_id(full)
            if mid and mid not in matches:
                matches[mid] = {"match_id": mid, "url": full}

    result = list(matches.values())
    print(f"  Found {len(result)} unique match URL(s).")
    return result


# ── __NEXT_DATA__ extraction (primary method) ─────────────────────────────────

def parse_next_data(soup: BeautifulSoup, match_id: str, page_url: str) -> tuple[dict, list, list]:
    """
    Parse __NEXT_DATA__ JSON embedded by Next.js in every page.
    Returns (match_info, batting_rows, bowling_rows).
    """
    script = soup.find("script", id="__NEXT_DATA__")
    if not script or not script.string:
        return {}, [], []

    try:
        data = json.loads(script.string)
    except json.JSONDecodeError:
        return {}, [], []

    page_props = data.get("props", {}).get("pageProps", {})

    # ── Match info from summaryData ──
    summary_data = page_props.get("summaryData", {}).get("data", {})
    team_a = summary_data.get("team_a", {})
    team_b = summary_data.get("team_b", {})

    raw_dt = summary_data.get("start_datetime", "")
    match_date = ""
    if raw_dt:
        try:
            dt = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
            match_date = dt.strftime("%Y-%m-%d")
        except Exception:
            match_date = raw_dt[:10]

    mom_data = summary_data.get("player_of_the_match") or {}
    info = {
        "match_id":         match_id,
        "team1":            team_a.get("name", ""),
        "team2":            team_b.get("name", ""),
        "result":           f"{summary_data.get('winning_team', '')} won by {summary_data.get('win_by', '')}".strip()
                            if summary_data.get("winning_team") else summary_data.get("match_result", ""),
        "date":             match_date,
        "toss":             summary_data.get("toss_details", ""),
        "venue":            summary_data.get("ground_name", ""),
        "man_of_match":     mom_data.get("player_name", ""),
        "man_of_match_team":mom_data.get("team_name", ""),
        "url":              page_url,
        "scraped_at":       datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # ── Batting + bowling from scorecard ──
    scorecard = page_props.get("scorecard", [])
    if not isinstance(scorecard, list) or not scorecard:
        return info, [], []

    batting_rows = []
    bowling_rows = []

    for innings_data in scorecard:
        inning_meta = innings_data.get("inning", {})
        innings_num = inning_meta.get("inning", 0)
        bat_team    = innings_data.get("teamName", "")

        # ── Batting ──
        for bat in innings_data.get("batting", []):
            batting_rows.append({
                "match_id":     match_id,
                "innings":      innings_num,
                "batting_team": bat_team,
                "player":       bat.get("name", ""),
                "player_id":    bat.get("player_id", ""),
                "how_out":      bat.get("how_to_out", ""),
                "runs":         bat.get("runs", 0),
                "balls":        bat.get("balls", 0),
                "fours":        bat.get("4s", 0),
                "sixes":        bat.get("6s", 0),
                "strike_rate":  bat.get("SR", ""),
            })

        # ── Bowling ──
        # Bowling team = the OTHER team batting this innings
        # Find it from the other innings entry
        bowl_team = ""
        for other in scorecard:
            if other is not innings_data:
                bowl_team = other.get("teamName", "")
                break

        for bowl in innings_data.get("bowling", []):
            overs_whole = int(bowl.get("overs", 0))
            overs_balls = int(bowl.get("balls", 0))
            # API "balls" = total balls delivered; convert to cricket notation X.Y
            extra_balls = overs_balls - overs_whole * 6 if overs_balls > overs_whole * 6 else overs_balls
            overs_str   = f"{overs_whole}.{extra_balls}"
            bowling_rows.append({
                "match_id":     match_id,
                "innings":      innings_num,
                "bowling_team": bowl_team,
                "player":       bowl.get("name", ""),
                "player_id":    bowl.get("player_id", ""),
                "overs":        overs_str,
                "maidens":      bowl.get("maidens", 0),
                "runs":         bowl.get("runs", 0),
                "wickets":      bowl.get("wickets", 0),
                "wides":        bowl.get("wide", 0),
                "no_balls":     bowl.get("noball", 0),
                "economy":      bowl.get("economy_rate", ""),
            })

    return info, batting_rows, bowling_rows


# ── Fallback: HTML table parsing ──────────────────────────────────────────────

def parse_batting_table_html(table, match_id: str, innings: int, bat_team: str) -> list[dict]:
    rows = []
    for tr in table.find_all("tr"):
        tds = tr.find_all(["td", "th"])
        if len(tds) < 4:
            continue
        texts = [td.get_text(separator=" ", strip=True) for td in tds]
        if any(h in texts[0].lower() for h in ("batters", "batsman", "player")):
            continue
        if re.match(r'^(total|extras?|did not bat)', texts[0], re.I):
            continue
        # Collect trailing numbers
        nums = []
        for t in reversed(texts):
            c = t.replace("*", "").strip()
            if re.fullmatch(r'[\d.]+', c):
                try:
                    nums.append(float(c))
                except ValueError:
                    break
            else:
                break
        if len(nums) < 5:
            continue
        nums.reverse()
        try:
            runs = int(nums[-5]); balls = int(nums[-4])
            fours = int(nums[-3]); sixes = int(nums[-2]); sr = float(nums[-1])
        except (ValueError, IndexError):
            continue
        player = texts[0]
        if re.fullmatch(r'\d+', player):
            player = texts[1] if len(texts) > 1 else player
        player = re.sub(r'\(c\s*&\s*wk\)|\(c\)|\(wk\)', "", player, flags=re.I).strip()
        player = re.sub(r'^\d+\s+', '', player).strip()
        if not player or len(player) < 2:
            continue
        how_out = ""
        for t in texts[1:]:
            if not re.fullmatch(r'[\d.*-]+', t.strip()):
                how_out = t; break
        rows.append({
            "match_id": match_id, "innings": innings, "batting_team": bat_team,
            "player": player, "player_id": "", "how_out": how_out,
            "runs": runs, "balls": balls, "fours": fours, "sixes": sixes, "strike_rate": sr,
        })
    return rows


def parse_bowling_table_html(table, match_id: str, innings: int, bowl_team: str) -> list[dict]:
    rows = []
    for tr in table.find_all("tr"):
        tds = tr.find_all(["td", "th"])
        if len(tds) < 4:
            continue
        texts = [td.get_text(separator=" ", strip=True) for td in tds]
        if any(h in texts[0].lower() for h in ("bowler", "player")):
            continue
        nums = []
        for t in reversed(texts):
            c = t.strip()
            if re.fullmatch(r'[\d.]+', c):
                try:
                    nums.append(float(c))
                except ValueError:
                    break
            else:
                break
        if len(nums) < 5:
            continue
        nums.reverse()
        try:
            overs = float(nums[0]); maidens = int(nums[1])
            runs = int(nums[2]); wickets = int(nums[3]); economy = float(nums[4])
        except (ValueError, IndexError):
            continue
        player = texts[0]
        if re.fullmatch(r'\d+', player):
            player = texts[1] if len(texts) > 1 else player
        player = re.sub(r'\(c\s*&\s*wk\)|\(c\)|\(wk\)', "", player, flags=re.I).strip()
        player = re.sub(r'^\d+\s+', '', player).strip()
        if not player or len(player) < 2:
            continue
        rows.append({
            "match_id": match_id, "innings": innings, "bowling_team": bowl_team,
            "player": player, "player_id": "",
            "overs": str(overs), "maidens": maidens, "runs": runs,
            "wickets": wickets, "wides": 0, "no_balls": 0, "economy": economy,
        })
    return rows


def fallback_html_parse(soup: BeautifulSoup, match_id: str) -> tuple[list, list]:
    """Try HTML table parsing when __NEXT_DATA__ scorecard is empty."""
    batting_rows, bowling_rows = [], []
    all_tables = soup.find_all("table")
    innings_num = 1
    for tbl in all_tables:
        headers_text = [th.get_text(strip=True).lower() for th in tbl.find_all(["th"])[:6]]
        if any(h in ("r", "runs", "b", "balls", "4s", "6s", "sr") for h in headers_text):
            prev = tbl.find_previous(["h1", "h2", "h3", "h4", "strong"])
            team = prev.get_text(strip=True) if prev else ""
            rows = parse_batting_table_html(tbl, match_id, innings_num, team)
            if rows:
                batting_rows.extend(rows)
                innings_num += 1
        elif any(h in ("o", "m", "w", "eco", "economy", "overs") for h in headers_text):
            prev = tbl.find_previous(["h1", "h2", "h3", "h4", "strong"])
            team = prev.get_text(strip=True) if prev else ""
            rows = parse_bowling_table_html(tbl, match_id, innings_num, team)
            if rows:
                bowling_rows.extend(rows)
    return batting_rows, bowling_rows


# ── Match info fallback from HTML ─────────────────────────────────────────────

def fallback_match_info(soup: BeautifulSoup, match_id: str, page_url: str) -> dict:
    full = soup.get_text(separator="\n")
    info = {
        "match_id":   match_id,
        "team1":      "",
        "team2":      "",
        "result":     "",
        "date":       "",
        "toss":       "",
        "venue":      "",
        "url":        page_url,
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    m = re.search(r'\b(\d{4}-\d{2}-\d{2})\b', full)
    if m:
        info["date"] = m.group(1)
    m = re.search(r'(toss[^\n]{0,120})', full, re.I)
    if m:
        info["toss"] = m.group(1).strip()[:200]
    m = re.search(r'(?:venue|ground|at)[:\s]+([^\n,]{3,60})', full, re.I)
    if m:
        info["venue"] = m.group(1).strip()
    m = re.search(r'([\w\s]+(?:won|tied|no result)[^\n]{0,80})', full, re.I)
    if m:
        info["result"] = m.group(1).strip()
    return info


# ── API-based match scrape (no Selenium, no Cloudflare) ───────────────────────

def fetch_scorecard_api(match_id: str, url: str) -> tuple[dict, list, list]:
    """
    Fetch match info + full scorecard via CricHeroes internal API.
    Returns (info_dict, batting_rows, bowling_rows).
    No browser / Selenium needed — uses the same static API key as commentary.
    """
    endpoint = f"{API_BASE}/scorecard/v2/get-scorecard/{match_id}"
    try:
        data = _api_get(endpoint)
    except Exception as e:
        print(f"    [API] get-scorecard failed: {e}")
        return {}, [], []

    if not data.get("status"):
        print(f"    [API] get-scorecard returned status=false")
        return {}, [], []

    d = data["data"]

    # ── Match info ──
    raw_dt = d.get("start_datetime", "")
    match_date = ""
    if raw_dt:
        try:
            dt = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
            match_date = dt.strftime("%Y-%m-%d")
        except Exception:
            match_date = raw_dt[:10]

    info = {
        "match_id":          match_id,
        "team1":             d.get("team_a", {}).get("name", ""),
        "team2":             d.get("team_b", {}).get("name", ""),
        "result":            d.get("match_summary", {}).get("summary", "") if isinstance(d.get("match_summary"), dict)
                             else f"{d.get('winning_team','')} won by {d.get('win_by','')}".strip(),
        "date":              match_date,
        "toss":              d.get("toss_details", ""),
        "venue":             d.get("ground_name", ""),
        "man_of_match":      "",   # not available in this endpoint
        "man_of_match_team": "",
        "url":               url,
        "scraped_at":        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    batting_rows = []
    bowling_rows = []

    for team_key in ("team_a", "team_b"):
        team_data = d.get(team_key, {})
        team_name = team_data.get("name", "")
        # bowling team = the other team
        other_key  = "team_b" if team_key == "team_a" else "team_a"
        bowl_team  = d.get(other_key, {}).get("name", "")

        for sc in team_data.get("scorecard", []):
            innings_num = sc.get("inning", 0)

            for bat in sc.get("batting", []):
                batting_rows.append({
                    "match_id":     match_id,
                    "innings":      innings_num,
                    "batting_team": team_name,
                    "player":       bat.get("name", ""),
                    "player_id":    bat.get("player_id", ""),
                    "how_out":      bat.get("how_to_out", ""),
                    "runs":         bat.get("runs", 0),
                    "balls":        bat.get("balls", 0),
                    "fours":        bat.get("4s", 0),
                    "sixes":        bat.get("6s", 0),
                    "strike_rate":  bat.get("SR", ""),
                })

            for bowl in sc.get("bowling", []):
                overs_whole = int(bowl.get("overs", 0))
                overs_balls = int(bowl.get("balls", 0))
                # API "balls" = total balls delivered; convert to cricket notation X.Y
                extra_balls = overs_balls - overs_whole * 6 if overs_balls > overs_whole * 6 else overs_balls
                bowling_rows.append({
                    "match_id":     match_id,
                    "innings":      innings_num,
                    "bowling_team": bowl_team,
                    "player":       bowl.get("name", ""),
                    "player_id":    bowl.get("player_id", ""),
                    "overs":        f"{overs_whole}.{extra_balls}",
                    "maidens":      bowl.get("maidens", 0),
                    "runs":         bowl.get("runs", 0),
                    "wickets":      bowl.get("wickets", 0),
                    "dot_balls":    bowl.get("0s", 0),       # API provides this directly
                    "fours_conceded": bowl.get("4s", 0),     # API provides this directly
                    "sixes_conceded": bowl.get("6s", 0),     # API provides this directly
                    "wides":        bowl.get("wide", 0),
                    "no_balls":     bowl.get("noball", 0),
                    "economy":      bowl.get("economy_rate", ""),
                })

    return info, batting_rows, bowling_rows


def scrape_match(driver, match: dict) -> tuple[dict, list, list]:
    """Scrape one match: try API first (no browser), fall back to Selenium."""
    match_id = match["match_id"]
    url      = match["url"]

    # ── Primary: direct API call — no Selenium, no Cloudflare risk ──
    info, batting, bowling = fetch_scorecard_api(match_id, url)
    if batting or bowling:
        print(f"    [API] {len(batting)} batting, {len(bowling)} bowling rows")
        return info, batting, bowling

    # ── Fallback: Selenium browser load ──
    print(f"    [API] empty — falling back to browser...")
    print(f"  [{match_id}] {url}")
    driver.get(url)
    time.sleep(PAGE_WAIT_SECS)

    html = driver.page_source
    save_html(f"match_{match_id}.html", html)
    soup = BeautifulSoup(html, "html.parser")

    info, batting, bowling = parse_next_data(soup, match_id, url)

    if batting or bowling:
        print(f"    [JSON] {len(batting)} batting, {len(bowling)} bowling rows")
        if not info.get("team1"):
            info = {**fallback_match_info(soup, match_id, url), **info}
        return info, batting, bowling

    print(f"    [warn] __NEXT_DATA__ scorecard empty, trying HTML tables...")
    batting, bowling = fallback_html_parse(soup, match_id)
    if not info:
        info = fallback_match_info(soup, match_id, url)
    else:
        info.setdefault("url", url)

    print(f"    [HTML] {len(batting)} batting, {len(bowling)} bowling rows")
    return info, batting, bowling


# ── Commentary (ball-by-ball) ─────────────────────────────────────────────────

def _api_get(url: str) -> dict:
    """Call CricHeroes API and return parsed JSON."""
    req = urllib.request.Request(url, headers=API_HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def parse_commentary_text(text: str) -> tuple[str, str]:
    """
    Parse 'Bowler to Batsman, description' into (bowler, batsman).
    Returns ("", "") if the pattern doesn't match.
    """
    m = re.match(r'^(.+?)\s+to\s+(.+?)(?:,|$)', text, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return "", ""


def fetch_commentary(match_id: str, innings_list: list[dict]) -> list[dict]:
    """
    Fetch ball-by-ball data for all innings of a match.

    innings_list: [{'inning_num': 1, 'team_id': 123, 'team_name': 'XYZ'}, ...]
    Returns a list of ball dicts, one per legal/extra delivery.
    """
    all_balls = []
    for inn in innings_list:
        inning_num = inn["inning_num"]
        team_id    = inn["team_id"]
        url = (f"{API_BASE}/scorecard/v2/get-commentary/{match_id}"
               f"?inning={inning_num}&teamId={team_id}")
        try:
            resp  = _api_get(url)
            balls = resp.get("data", {}).get("commentary", [])
        except Exception as e:
            print(f"      [commentary warn] inning {inning_num}: {e}")
            balls = []

        for b in balls:
            bowler, batsman = parse_commentary_text(b.get("commentary", ""))
            extra_code      = b.get("extra_type_code", "").strip()
            run             = int(b.get("run", 0))
            extra_run       = int(b.get("extra_run", 0))

            # A real dot ball: no run scored, no extra, not a wide/no-ball delivery
            # (wides & no-balls do not consume a legal ball slot)
            is_legal   = extra_code not in ("WD", "NB")
            is_dot     = is_legal and run == 0 and extra_run == 0

            all_balls.append({
                "match_id":    match_id,
                "innings":     inning_num,
                "batting_team": inn["team_name"],
                "over_ball":   b.get("ball", ""),
                "bowler":      bowler,
                "batsman":     batsman,
                "run":         run,
                "extra_type":  extra_code,
                "extra_run":   extra_run,
                "is_wicket":   int(b.get("is_out", 0)),
                "is_boundary": int(b.get("is_boundry", 0)),
                "is_dot_ball": int(is_dot),
                "commentary":  b.get("commentary", ""),
            })

    return all_balls


def compute_dot_ball_analysis(all_balls: list[dict]) -> list[dict]:
    """
    Aggregate ball-by-ball data into a bowler-vs-batsman dot ball table.
    Columns: match_id, innings, batting_team, bowler, batsman,
             total_balls, dot_balls, dot_pct, runs_off_bat, boundaries, sixes, wickets
    """
    # key: (match_id, innings, batting_team, bowler, batsman)
    agg = defaultdict(lambda: {
        "total_balls": 0, "dot_balls": 0, "runs_off_bat": 0,
        "boundaries": 0, "sixes": 0, "wickets": 0
    })

    for b in all_balls:
        if not b["bowler"] or not b["batsman"]:
            continue
        # Only count legal deliveries for dot-ball stats
        if b["extra_type"] in ("WD", "NB"):
            continue
        key = (b["match_id"], b["innings"], b["batting_team"], b["bowler"], b["batsman"])
        r   = agg[key]
        r["total_balls"]  += 1
        r["dot_balls"]    += b["is_dot_ball"]
        r["runs_off_bat"] += b["run"]
        if b["is_boundary"] and b["run"] == 4:
            r["boundaries"] += 1
        if b["is_boundary"] and b["run"] == 6:
            r["sixes"] += 1
        r["wickets"] += b["is_wicket"]

    rows = []
    for (match_id, innings, batting_team, bowler, batsman), r in agg.items():
        total = r["total_balls"]
        dot_pct = round(r["dot_balls"] / total * 100, 1) if total > 0 else 0.0
        rows.append({
            "match_id":    match_id,
            "innings":     innings,
            "batting_team": batting_team,
            "bowler":      bowler,
            "batsman":     batsman,
            "total_balls": total,
            "dot_balls":   r["dot_balls"],
            "dot_pct":     dot_pct,
            "runs_off_bat": r["runs_off_bat"],
            "boundaries":  r["boundaries"],
            "sixes":       r["sixes"],
            "wickets":     r["wickets"],
        })

    # Sort: most dot balls first, then by match
    rows.sort(key=lambda x: (-x["dot_balls"], x["match_id"], x["innings"]))
    return rows


# ── Tracker ───────────────────────────────────────────────────────────────────

def load_tracker() -> dict:
    if os.path.exists(TRACKER_FILE):
        try:
            with open(TRACKER_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"scraped": {}}


def save_tracker(tracker: dict):
    with open(TRACKER_FILE, "w", encoding="utf-8") as f:
        json.dump(tracker, f, indent=2)


def mark_scraped(tracker: dict, match_id: str, url: str):
    tracker["scraped"][match_id] = {
        "url":        url,
        "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    save_tracker(tracker)


# ── CSV output ────────────────────────────────────────────────────────────────

SUMMARY_HEADERS = [
    "match_id", "team1", "team2", "result",
    "date", "toss", "venue", "url", "scraped_at",
]
BATTING_HEADERS = [
    "match_id", "innings", "batting_team", "player", "player_id",
    "how_out", "runs", "balls", "fours", "sixes", "strike_rate",
]
BOWLING_HEADERS = [
    "match_id", "innings", "bowling_team", "player", "player_id",
    "overs", "maidens", "runs", "wickets", "wides", "no_balls", "economy",
]
BALLS_HEADERS = [
    "match_id", "innings", "batting_team", "over_ball",
    "bowler", "batsman", "run", "extra_type", "extra_run",
    "is_wicket", "is_boundary", "is_dot_ball", "commentary",
]
DOTBALL_HEADERS = [
    "match_id", "innings", "batting_team",
    "bowler", "batsman",
    "total_balls", "dot_balls", "dot_pct",
    "runs_off_bat", "boundaries", "sixes", "wickets",
]


def write_csvs(all_info: list, all_batting: list, all_bowling: list,
               all_balls: list, dot_analysis: list):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    def _write_raw(path, headers, new_rows, key_col):
        """Merge new rows with existing file, then overwrite."""
        existing = _read_existing(path, key_col)
        for row in new_rows:
            k = str(row.get(key_col, ""))
            if k:
                existing[k] = row
        merged = list(existing.values())
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            w.writeheader()
            w.writerows(merged)
        print(f"  Wrote {len(merged):>4} rows -> {path}")

    # Compose unique keys for multi-row-per-match tables
    for r in all_batting:
        r["_key"] = f"{r['match_id']}|{r['innings']}|{r['batting_team']}|{r['player']}"
    for r in all_bowling:
        r["_key"] = f"{r['match_id']}|{r['innings']}|{r['bowling_team']}|{r['player']}"
    for r in all_balls:
        r["_key"] = f"{r['match_id']}|{r['innings']}|{r['over_ball']}|{r['batsman']}|{r['bowler']}"
    for r in dot_analysis:
        r["_key"] = f"{r.get('bowler','')}|{r.get('batsman','')}|{r.get('match_id','')}"

    _write_raw(os.path.join(OUTPUT_DIR, "tournament_matches_summary.csv"),  SUMMARY_HEADERS, all_info, "match_id")
    _write_raw(os.path.join(OUTPUT_DIR, "tournament_all_batting.csv"),      BATTING_HEADERS, all_batting, "_key")
    _write_raw(os.path.join(OUTPUT_DIR, "tournament_all_bowling.csv"),      BOWLING_HEADERS, all_bowling, "_key")
    _write_raw(os.path.join(OUTPUT_DIR, "tournament_all_balls.csv"),        BALLS_HEADERS,   all_balls,   "_key")
    _write_raw(os.path.join(OUTPUT_DIR, "tournament_dot_ball_analysis.csv"),DOTBALL_HEADERS, dot_analysis,"_key")


# ── Dashboard CSV helpers ─────────────────────────────────────────────────────

# Team registry: map any name variant → canonical short name + full name
TEAM_REGISTRY = {}   # populated dynamically — see build_team_registry()

def build_team_registry(team_names: list[str]) -> None:
    """Populate TEAM_REGISTRY from a list of full team names discovered in the data."""
    TEAM_REGISTRY.clear()
    for full in team_names:
        # Extract short code from parentheses, e.g. "Weekend Warriors (WW)" → "WW"
        m = re.search(r'\(([A-Z0-9]+)\)\s*$', full)
        short = m.group(1) if m else full[:3].upper()
        key = full.lower()
        # Remove "(WW)" suffix from key
        key_clean = re.sub(r'\s*\([^)]+\)\s*$', '', key).strip()
        TEAM_REGISTRY[key_clean] = {"short": short, "full": full}
        # Also add short code as key
        TEAM_REGISTRY[short.lower()] = {"short": short, "full": full}

def _team_short(name: str) -> str:
    n = name.lower().strip()
    for key, val in TEAM_REGISTRY.items():
        if key in n:
            return val["short"]
    return name


def parse_how_out(text: str) -> tuple[str, str, str]:
    """
    Parse CricHeroes 'how_to_out' string into (dismissal_type, dismissed_by, caught_by).

    Examples:
      "not out"                           -> not_out, "", ""
      "b Vinod Reddy"                     -> bowled, "Vinod Reddy", ""
      "c Ashok b Venkat A"                -> caught, "Venkat A", "Ashok"
      "lbw b Venkat A"                    -> lbw, "Venkat A", ""
      "run out Firoz"                     -> run_out, "Firoz", ""
      "run out (Firoz)"                   -> run_out, "Firoz", ""
      "st Pavan b Venkat A"               -> stumped, "Venkat A", "Pavan"
      "retired hurt"                      -> retired_hurt, "", ""
      "OUT Run out, Throw by Firoz"       -> run_out, "Firoz", ""
    """
    if not text:
        return "unknown", "", ""
    # Strip non-ASCII artefacts (e.g. ▷ arrow chars from CricHeroes)
    t = re.sub(r'[^\x00-\x7F]+', ' ', text).strip()

    if re.search(r'\bnot\s+out\b', t, re.I):
        return "not_out", "", ""
    if re.search(r'\bretired\s+hurt\b', t, re.I):
        return "retired_hurt", "", ""

    # "c&b <bowler>" — caught and bowled (same person)
    m = re.match(r'^c\s*&\s*b\s+(.+)$', t, re.I)
    if m:
        bowler = m.group(1).strip()
        return "caught", bowler, bowler

    # "run out ..." — allow names with digits, spaces, dots, slashes
    # Also handle "/ RK" style (multiple fielders) — take first name
    if re.search(r'\brun\s+out\b', t, re.I):
        # Strip everything before "run out"
        after = re.sub(r'.*?run\s+out', '', t, flags=re.I).strip()
        # Remove leading special chars, parentheses, "throw by"
        after = re.sub(r'^[\s\(\)\[\]^>/\\|]+', '', after)
        after = re.sub(r'(?i)^throw\s+by\s+', '', after)
        # Take only up to a slash or comma (first fielder)
        after = re.split(r'[/,]', after)[0].strip()
        return "run_out", after, ""

    # "c <fielder> b <bowler>"
    m = re.match(r'^c\s+(.+?)\s+b\s+(.+)$', t, re.I)
    if m:
        return "caught", m.group(2).strip(), m.group(1).strip()

    # "st <keeper> b <bowler>"
    m = re.match(r'^st\s+(.+?)\s+b\s+(.+)$', t, re.I)
    if m:
        return "stumped", m.group(2).strip(), m.group(1).strip()

    # "lbw b <bowler>"
    m = re.match(r'^lbw\s+b\s+(.+)$', t, re.I)
    if m:
        return "lbw", m.group(1).strip(), ""

    # "b <bowler>"
    m = re.match(r'^b\s+(.+)$', t, re.I)
    if m:
        return "bowled", m.group(1).strip(), ""

    return "unknown", "", ""


def parse_toss_string(toss: str) -> tuple[str, str]:
    """
    "Toss: Royal Cricket Blasters (RCB) opt to bat" -> ("Royal Cricket Blasters", "bat")
    """
    m = re.search(r'Toss[:\s]+(.+?)\s+opt\s+to\s+(bat|field)', toss, re.I)
    if m:
        winner   = re.sub(r'\([^)]+\)', '', m.group(1)).strip()
        decision = m.group(2).lower()
        return winner, decision
    return "", ""


def parse_result_string(result: str) -> tuple[str, str]:
    """
    "Weekend Warriors (WW) won by 5 wickets" -> ("Weekend Warriors", "5 wickets")
    "Royal Cricket Blasters (RCB) won by 37 runs" -> ("Royal Cricket Blasters", "37 runs")
    """
    m = re.search(r'^(.+?)\s+won\s+by\s+(.+)$', result, re.I)
    if m:
        winner = re.sub(r'\([^)]+\)', '', m.group(1)).strip()
        margin = m.group(2).strip()
        return winner, margin
    if re.search(r'tied|no result', result, re.I):
        return "", ""
    return "", ""


def overs_to_balls(overs_str: str) -> int:
    """Convert overs string to total balls.
    Handles three CricHeroes API formats:
      "9.1"  -> 55 balls  (standard: X completed overs + Y extra balls, Y in 0-5)
      "2.6"  -> 12 balls  (API marks complete over: balls=6 means last over done, total = overs*6)
      "2.12" -> 12 balls  (API total-balls format: balls field = total delivered)
    """
    try:
        whole, part = str(overs_str).split(".")
        w, p = int(whole), int(part)
        if p == 6:
            return w * 6          # balls=6 signals last over complete; total = overs × 6
        if p > 6:
            return p              # balls is total deliveries
        return w * 6 + p          # standard notation: X.Y, Y in 0-5
    except Exception:
        try:
            return int(float(overs_str)) * 6
        except Exception:
            return 0


def compute_points_table(all_meta_dash: list[dict],
                         batting_by_match: dict,
                         bowling_by_match: dict) -> list[dict]:
    """
    Compute points table from dashboard match_meta rows.
    NRR = (runs_scored/overs_faced) - (runs_conceded/overs_conceded)
    """
    # Build team registry dynamically from match data
    all_team_names: set[str] = set()
    for info in all_meta_dash:
        for k in ("innings1_team", "innings2_team"):
            v = info.get(k, "")
            if v:
                all_team_names.add(v)
    build_team_registry(sorted(all_team_names))

    team_keys  = list(TEAM_REGISTRY.keys())
    stats = {k: dict(M=0, W=0, L=0, T=0, NR=0, Pts=0,
                     runs_for=0, balls_for=0,
                     runs_against=0, balls_against=0, results=[])
             for k in team_keys}

    # Runs conceded per bowling team per match (includes extras: wides, no-balls, leg-byes)
    # bowl_runs[mid][bowling_team_key] = total runs batting team scored (incl. all extras)
    bowl_runs  = defaultdict(lambda: defaultdict(int))
    bowl_balls = defaultdict(lambda: defaultdict(int))
    for mid, rows in bowling_by_match.items():
        for r in rows:
            team_lc = r["bowling_team"].lower()
            for k in team_keys:
                if k in team_lc:
                    bowl_runs[mid][k]  += int(r["runs"])
                    bowl_balls[mid][k] += overs_to_balls(r["overs"])
                    break

    for meta in sorted(all_meta_dash, key=lambda m: m.get("match_date", "")):
        mid    = meta["match_id"]
        winner = meta.get("winner", "").lower()
        result = meta.get("result", "").lower()
        t1_lc  = meta.get("innings1_team", "").lower()
        t2_lc  = meta.get("innings2_team", "").lower()

        t1_key = next((k for k in team_keys if k in t1_lc), None)
        t2_key = next((k for k in team_keys if k in t2_lc), None)
        if not t1_key or not t2_key:
            continue

        stats[t1_key]["M"] += 1
        stats[t2_key]["M"] += 1

        if "tied" in result:
            for k in (t1_key, t2_key):
                stats[k]["T"] += 1; stats[k]["Pts"] += 1; stats[k]["results"].append("T")
        elif t1_key in winner and t2_key not in winner:
            w_key, l_key = t1_key, t2_key
            stats[w_key]["W"] += 1; stats[w_key]["Pts"] += 2; stats[w_key]["results"].append("W")
            stats[l_key]["L"] += 1; stats[l_key]["results"].append("L")
        elif t2_key in winner and t1_key not in winner:
            w_key, l_key = t2_key, t1_key
            stats[w_key]["W"] += 1; stats[w_key]["Pts"] += 2; stats[w_key]["results"].append("W")
            stats[l_key]["L"] += 1; stats[l_key]["results"].append("L")
        else:
            for k in (t1_key, t2_key):
                stats[k]["NR"] += 1; stats[k]["Pts"] += 1; stats[k]["results"].append("NR")

        # NRR: t1 batted innings1 (t2 bowled), t2 batted innings2 (t1 bowled)
        # Use bowl_runs (conceded by opposing team) to include all extras
        runs_t1 = bowl_runs[mid].get(t2_key, 0)   # t2 bowled → t1 scored
        runs_t2 = bowl_runs[mid].get(t1_key, 0)   # t1 bowled → t2 scored
        balls_t2_bowled = bowl_balls[mid].get(t2_key, 0)  # balls t1 faced
        balls_t1_bowled = bowl_balls[mid].get(t1_key, 0)  # balls t2 faced

        if balls_t2_bowled:
            stats[t1_key]["runs_for"]      += runs_t1
            stats[t1_key]["balls_for"]     += balls_t2_bowled
            stats[t2_key]["runs_against"]  += runs_t1
            stats[t2_key]["balls_against"] += balls_t2_bowled
        if balls_t1_bowled:
            stats[t2_key]["runs_for"]      += runs_t2
            stats[t2_key]["balls_for"]     += balls_t1_bowled
            stats[t1_key]["runs_against"]  += runs_t2
            stats[t1_key]["balls_against"] += balls_t1_bowled

    rows = []
    for team_key, s in stats.items():
        info = TEAM_REGISTRY[team_key]
        rpo_for     = (s["runs_for"]     / s["balls_for"]     * 6) if s["balls_for"]     else 0
        rpo_against = (s["runs_against"] / s["balls_against"] * 6) if s["balls_against"] else 0
        nrr         = round(rpo_for - rpo_against, 3)
        wh, wp = divmod(s["balls_for"],     6)
        ah, ap = divmod(s["balls_against"], 6)
        rows.append({
            "rank":    0,
            "team":    info["full"],
            "short":   info["short"],
            "M":       s["M"], "W": s["W"], "L": s["L"],
            "D":       0,      "T": s["T"], "NR": s["NR"],
            "Pts":     s["Pts"],
            "NRR":     nrr,
            "For":     f"{s['runs_for']}/{wh}.{wp}" if wp else f"{s['runs_for']}/{wh}",
            "Against": f"{s['runs_against']}/{ah}.{ap}" if ap else f"{s['runs_against']}/{ah}",
            "last5":   "|".join(s["results"][-5:]),
            "_sort":   (s["Pts"], nrr),
        })
    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        del r["_sort"]
    return rows


def compute_leaderboards(all_batting: list, all_bowling: list) -> tuple[list, list, list, list]:
    """
    Compute batting / bowling / fielding / MVP leaderboard CSVs from raw match data.
    Returns (bat_lb, bowl_lb, field_lb, mvp_lb).
    """
    # ── Batting leaderboard ────────────────────────────────────────────────────
    bat_map: dict = {}   # player → aggregated stats
    for r in all_batting:
        key  = (r["player"].strip(), r.get("batting_team", ""))
        runs = int(r.get("runs", 0) or 0)
        balls = int(r.get("balls", 0) or 0)
        fours = int(r.get("fours", 0) or 0)
        sixes = int(r.get("sixes", 0) or 0)
        dimiss = (r.get("how_out") or r.get("dismissal_type") or "").lower()
        not_out = dimiss in ("", "not_out", "notout", "retired_hurt", "unknown", "-")

        if key not in bat_map:
            bat_map[key] = {
                "player_id": r.get("player_id", ""),
                "name":      r["player"].strip(),
                "team_id":   "",
                "team_name": r.get("batting_team", ""),
                "matches":   set(),
                "innings":   0, "total_runs": 0, "highest_run": 0,
                "not_out":   0, "balls": 0,
                "4s": 0, "6s": 0, "50s": 0, "100s": 0,
            }
        s = bat_map[key]
        s["matches"].add(r.get("match_id", ""))
        s["innings"]    += 1
        s["total_runs"] += runs
        s["balls"]      += balls
        s["4s"]         += fours
        s["6s"]         += sixes
        if runs > s["highest_run"]:
            s["highest_run"] = runs
        if not_out:
            s["not_out"] += 1
        if runs >= 100:
            s["100s"] += 1
        elif runs >= 50:
            s["50s"] += 1

    bat_lb = []
    for (player, team), s in bat_map.items():
        dism_inn = s["innings"] - s["not_out"]
        avg      = round(s["total_runs"] / dism_inn, 2) if dism_inn > 0 else "-"
        sr       = round(s["total_runs"] / s["balls"] * 100, 2) if s["balls"] > 0 else 0.0
        bat_lb.append({
            "player_id":    s["player_id"],
            "name":         player,
            "team_id":      "",
            "team_name":    team,
            "total_match":  len(s["matches"]),
            "innings":      s["innings"],
            "total_runs":   s["total_runs"],
            "highest_run":  s["highest_run"],
            "average":      avg,
            "not_out":      s["not_out"],
            "strike_rate":  sr,
            "ball_faced":   s["balls"],
            "batting_hand": "-",
            "4s":           s["4s"],
            "6s":           s["6s"],
            "50s":          s["50s"],
            "100s":         s["100s"],
        })
    bat_lb.sort(key=lambda r: -r["total_runs"])

    # ── Bowling leaderboard ────────────────────────────────────────────────────
    bowl_map: dict = {}
    for r in all_bowling:
        key  = (r["player"].strip(), r.get("bowling_team", ""))
        wkts = int(r.get("wickets", 0) or 0)
        runs = int(r.get("runs", 0) or 0)
        balls = overs_to_balls(str(r.get("overs", "0") or "0"))
        maidens = int(r.get("maidens", 0) or 0)
        dots    = int(r.get("dot_balls", 0) or 0)

        if key not in bowl_map:
            bowl_map[key] = {
                "player_id": r.get("player_id", ""),
                "name":      r["player"].strip(),
                "team_name": r.get("bowling_team", ""),
                "matches":   set(),
                "innings":   0, "total_wickets": 0, "highest_wicket": 0,
                "balls": 0, "runs": 0, "maidens": 0, "dot_balls": 0,
            }
        s = bowl_map[key]
        s["matches"].add(r.get("match_id", ""))
        s["innings"]        += 1
        s["total_wickets"]  += wkts
        s["balls"]          += balls
        s["runs"]           += runs
        s["maidens"]        += maidens
        s["dot_balls"]      += dots
        if wkts > s["highest_wicket"]:
            s["highest_wicket"] = wkts

    bowl_lb = []
    for (player, team), s in bowl_map.items():
        total_balls = s["balls"]
        total_overs = total_balls // 6 + (total_balls % 6) / 10
        econ  = round(s["runs"] / (total_balls / 6), 2) if total_balls > 0 else 0.0
        sr    = round(total_balls / s["total_wickets"], 2) if s["total_wickets"] > 0 else "-"
        avg   = round(s["runs"] / s["total_wickets"], 2) if s["total_wickets"] > 0 else "-"
        overs_str = f"{total_balls // 6}.{total_balls % 6}"
        bowl_lb.append({
            "player_id":      s["player_id"],
            "name":           player,
            "team_id":        "",
            "team_name":      team,
            "total_match":    len(s["matches"]),
            "innings":        s["innings"],
            "total_wickets":  s["total_wickets"],
            "balls":          total_balls,
            "highest_wicket": s["highest_wicket"],
            "economy":        econ,
            "SR":             sr,
            "maidens":        s["maidens"],
            "avg":            avg,
            "runs":           s["runs"],
            "bowling_style":  "-",
            "overs":          overs_str,
            "dot_balls":      s["dot_balls"],
        })
    bowl_lb.sort(key=lambda r: -r["total_wickets"])

    # ── Fielding leaderboard ───────────────────────────────────────────────────
    # Extract fielding contributions from batting dismissal records
    field_map: dict = {}

    def _fentry(player, team):
        if (player, team) not in field_map:
            field_map[(player, team)] = {
                "name": player, "team_name": team, "team_id": "", "player_id": "",
                "matches": set(), "catches": 0, "caught_behind": 0,
                "run_outs": 0, "assist_run_outs": 0, "stumpings": 0,
                "caught_and_bowl": 0,
            }
        return field_map[(player, team)]

    for r in all_batting:
        mid    = r.get("match_id", "")
        how    = (r.get("how_out") or r.get("dismissal_type") or "").lower().replace(" ", "_")
        caught_by   = (r.get("caught_by")   or "").strip()
        dismissed_by = (r.get("dismissed_by") or "").strip()
        bat_team = r.get("batting_team", "")
        # Fielding team = the bowling team (not stored directly in batting CSV; infer later)

        if "caught" in how and "caught_and_bowl" not in how and caught_by:
            e = _fentry(caught_by, "")
            e["catches"] += 1
            e["matches"].add(mid)
        if "caught_and_bowl" in how and dismissed_by:
            e = _fentry(dismissed_by, "")
            e["caught_and_bowl"] += 1
            e["matches"].add(mid)
        if "stumped" in how and caught_by:
            e = _fentry(caught_by, "")
            e["stumpings"] += 1
            e["matches"].add(mid)
        if "run_out" in how and caught_by:
            e = _fentry(caught_by, "")
            e["run_outs"] += 1
            e["matches"].add(mid)

    # Try to fill team_name from batting leaderboard (player → team)
    player_team = {r["name"]: r["team_name"] for r in bat_lb}
    player_team.update({r["name"]: r["team_name"] for r in bowl_lb})

    field_lb = []
    for (player, _), s in field_map.items():
        team = player_team.get(player, "")
        total_catches    = s["catches"] + s["caught_behind"] + s["caught_and_bowl"]
        total_dismissals = total_catches + s["run_outs"] + s["stumpings"]
        field_lb.append({
            "player_id":      s["player_id"],
            "name":           player,
            "team_id":        "",
            "team_name":      team,
            "total_match":    len(s["matches"]),
            "catches":        s["catches"],
            "caught_behind":  s["caught_behind"],
            "run_outs":       s["run_outs"],
            "assist_run_outs":s["assist_run_outs"],
            "stumpings":      s["stumpings"],
            "caught_and_bowl":s["caught_and_bowl"],
            "total_catches":  total_catches,
            "total_dismissal":total_dismissals,
        })
    field_lb.sort(key=lambda r: -r["total_dismissal"])

    # ── MVP leaderboard (approximate formula) ─────────────────────────────────
    all_players = set(r["name"] for r in bat_lb) | set(r["name"] for r in bowl_lb)
    bat_idx  = {r["name"]: r for r in bat_lb}
    bowl_idx = {r["name"]: r for r in bowl_lb}
    field_idx= {r["name"]: r for r in field_lb}

    mvp_lb = []
    for player in all_players:
        b   = bat_idx.get(player, {})
        bw  = bowl_idx.get(player, {})
        fld = field_idx.get(player, {})
        team = b.get("team_name") or bw.get("team_name") or ""

        # Batting score
        runs    = int(b.get("total_runs", 0) or 0)
        balls_b = int(b.get("ball_faced", 0) or 0)
        fours   = int(b.get("4s", 0) or 0)
        sixes   = int(b.get("6s", 0) or 0)
        fifties = int(b.get("50s", 0) or 0)
        hundreds= int(b.get("100s", 0) or 0)
        bat_score = round(runs * 0.5 + fours * 0.5 + sixes * 1.5 + fifties * 4 + hundreds * 8, 3)

        # Bowling score
        wkts   = int(bw.get("total_wickets", 0) or 0)
        runs_c = int(bw.get("runs", 0) or 0)
        dots   = int(bw.get("dot_balls", 0) or 0)
        econ   = float(bw.get("economy", 0) or 0)
        bowl_score = round(wkts * 8 + dots * 0.1 - runs_c * 0.1, 3)
        bowl_score = max(bowl_score, 0)

        # Fielding score
        dismissals = int(fld.get("total_dismissal", 0) or 0)
        field_score = round(dismissals * 2.0, 3)

        total = round(bat_score + bowl_score + field_score, 3)
        if total <= 0:
            continue

        matches = max(int(b.get("total_match", 0) or 0), int(bw.get("total_match", 0) or 0))
        mvp_lb.append({
            "Player Name":  player,
            "Team Name":    team,
            "Player Role":  "-",
            "Bowling Style":"-",
            "Batting Hand": "-",
            "Matches":      matches,
            "Batting":      bat_score,
            "Bowling":      bowl_score,
            "Fielding":     field_score,
            "Total":        total,
        })
    mvp_lb.sort(key=lambda r: -r["Total"])

    return bat_lb, bowl_lb, field_lb, mvp_lb


def _read_existing(path: str, key_col: str) -> dict:
    """Read an existing CSV and return rows keyed by key_col (deduplicated)."""
    existing = {}
    if not os.path.exists(path):
        return existing
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            k = row.get(key_col, "")
            if k:
                existing[k] = row
    return existing


def write_dashboard_csvs(all_info: list, all_batting: list, all_bowling: list,
                         all_balls: list):
    """
    Transform scraped data into the exact CSV schemas the dashboard reads,
    and write them to data/ and points_table.csv.
    Merges with any existing data so incremental runs produce complete output.
    """
    os.makedirs("data", exist_ok=True)

    # ── Index match dates ──
    date_by_mid = {r["match_id"]: r.get("date", "") for r in all_info}

    # ── Index ball data by (match_id, innings, bowling_team_partial) ──
    # For each bowler+innings, count dot_balls / fours_conceded / sixes_conceded
    bowl_stats = defaultdict(lambda: {"dot_balls": 0, "fours_conceded": 0, "sixes_conceded": 0})
    for b in all_balls:
        if b["extra_type"] in ("WD", "NB"):
            continue  # don't count extras against bowler
        key = (b["match_id"], b["innings"], b["bowler"])
        bs  = bowl_stats[key]
        if b["is_dot_ball"]:
            bs["dot_balls"] += 1
        if b["is_boundary"] and b["run"] == 4:
            bs["fours_conceded"] += 1
        if b["is_boundary"] and b["run"] == 6:
            bs["sixes_conceded"] += 1

    # ── match_meta ──
    # Build innings1/innings2 team from batting data
    innings_teams = defaultdict(dict)  # match_id -> {1: team, 2: team}
    for r in all_batting:
        innings_teams[r["match_id"]][int(r["innings"])] = r["batting_team"]

    meta_rows = []
    for info in all_info:
        mid   = info["match_id"]
        toss_winner, toss_decision = parse_toss_string(info.get("toss", ""))
        winner, margin             = parse_result_string(info.get("result", ""))
        itm   = innings_teams.get(mid, {})
        meta_rows.append({
            "match_id":          mid,
            "match_date":        info.get("date", ""),
            "innings1_team":     itm.get(1, info.get("team1", "")),
            "innings2_team":     itm.get(2, info.get("team2", "")),
            "toss_winner":       toss_winner,
            "toss_decision":     toss_decision,
            "result":            info.get("result", ""),
            "winner":            winner,
            "margin":            margin,
            "man_of_match":      info.get("man_of_match", ""),
            "man_of_match_team": info.get("man_of_match_team", ""),
        })

    # ── match_batting ──
    bat_rows = []
    position_counter = defaultdict(int)  # (match_id, innings)
    for r in all_batting:
        pos_key = (r["match_id"], r["innings"])
        position_counter[pos_key] += 1
        dtype, dis_by, caught_by = parse_how_out(r.get("how_out", ""))
        bat_rows.append({
            "match_id":       r["match_id"],
            "match_date":     date_by_mid.get(r["match_id"], ""),
            "innings":        r["innings"],
            "batting_team":   r["batting_team"],
            "position":       position_counter[pos_key],
            "player":         r["player"],
            "runs":           r["runs"],
            "balls":          r["balls"],
            "fours":          r["fours"],
            "sixes":          r["sixes"],
            "strike_rate":    r["strike_rate"],
            "dismissal_type": dtype,
            "dismissed_by":   dis_by,
            "caught_by":      caught_by,
        })

    # ── match_bowling ──
    bowl_rows = []
    for r in all_bowling:
        bkey = (r["match_id"], r["innings"], r["player"])
        bs   = bowl_stats.get(bkey, {})
        # Prefer commentary-derived stats when available; fall back to API-supplied values
        bowl_rows.append({
            "match_id":        r["match_id"],
            "match_date":      date_by_mid.get(r["match_id"], ""),
            "innings":         r["innings"],
            "bowling_team":    r["bowling_team"],
            "player":          r["player"],
            "overs":           r["overs"],
            "maidens":         r["maidens"],
            "runs":            r["runs"],
            "wickets":         r["wickets"],
            "dot_balls":       bs.get("dot_balls") if bs else r.get("dot_balls", 0),
            "fours_conceded":  bs.get("fours_conceded") if bs else r.get("fours_conceded", 0),
            "sixes_conceded":  bs.get("sixes_conceded") if bs else r.get("sixes_conceded", 0),
            "wides":           r["wides"],
            "no_balls":        r["no_balls"],
            "economy":         r["economy"],
        })

    # ── points_table ──
    bat_by_match  = defaultdict(list)
    for r in bat_rows:
        bat_by_match[r["match_id"]].append(r)
    bowl_by_match = defaultdict(list)
    for r in bowl_rows:
        bowl_by_match[r["match_id"]].append(r)

    pt_rows = compute_points_table(meta_rows, bat_by_match, bowl_by_match)

    # ── Write (merge with existing data so incremental runs stay complete) ──
    def _write_merged(path, headers, new_rows, key_col):
        """Merge new_rows into existing CSV, keyed by key_col, then write."""
        existing = _read_existing(path, key_col)
        for row in new_rows:
            k = str(row.get(key_col, ""))
            if k:
                existing[k] = row
        merged = list(existing.values())
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            w.writeheader()
            w.writerows(merged)
        print(f"  [dashboard] Wrote {len(merged):>4} rows -> {path}")

    # match_meta: one row per match → key by match_id
    _write_merged("data/match_meta.csv",
           ["match_id","match_date","innings1_team","innings2_team",
            "toss_winner","toss_decision","result","winner","margin",
            "man_of_match","man_of_match_team"],
           meta_rows, "match_id")

    # match_batting / match_bowling: multiple rows per match, key by composite
    # Compose a unique key per batting row: match_id|innings|batting_team|player
    for r in bat_rows:
        r["_key"] = f"{r['match_id']}|{r['innings']}|{r['batting_team']}|{r['player']}"
    _write_merged("data/match_batting.csv",
           ["match_id","match_date","innings","batting_team","position",
            "player","runs","balls","fours","sixes","strike_rate",
            "dismissal_type","dismissed_by","caught_by"],
           bat_rows, "_key")

    for r in bowl_rows:
        r["_key"] = f"{r['match_id']}|{r['innings']}|{r['bowling_team']}|{r['player']}"
    _write_merged("data/match_bowling.csv",
           ["match_id","match_date","innings","bowling_team","player",
            "overs","maidens","runs","wickets","dot_balls",
            "fours_conceded","sixes_conceded","wides","no_balls","economy"],
           bowl_rows, "_key")

    # points_table: always fully recomputed from all matches — plain overwrite
    with open("points_table.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["rank","team","short","M","W","L","D","T","NR","NRR",
                                          "For","Against","Pts","last5"], extrasaction="ignore")
        w.writeheader()
        w.writerows(pt_rows)
    print(f"  [dashboard] Wrote {len(pt_rows):>4} rows -> points_table.csv")

    print()
    print("  Points table:")
    for r in pt_rows:
        sign = "+" if r["NRR"] >= 0 else ""
        print(f"    #{r['rank']} {r['short']:3s}  {r['W']}W {r['L']}L  "
              f"{r['Pts']}pts  NRR {sign}{r['NRR']:.3f}")

    # ── Leaderboard CSVs (computed from all match data) ──────────────────────
    # Load ALL historical match data from existing CSV files to recompute fully
    def _load_csv(path):
        if not os.path.exists(path):
            return []
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    all_bat_hist  = _load_csv("data/match_batting.csv")
    all_bowl_hist = _load_csv("data/match_bowling.csv")

    bat_lb, bowl_lb, field_lb, mvp_lb = compute_leaderboards(all_bat_hist, all_bowl_hist)

    def _write_lb(path, headers, rows):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"  [dashboard] Wrote {len(rows):>4} rows -> {path}")

    _write_lb("batting_leaderboard.csv",
              ["player_id","name","team_id","team_name","total_match","innings",
               "total_runs","highest_run","average","not_out","strike_rate",
               "ball_faced","batting_hand","4s","6s","50s","100s"],
              bat_lb)

    _write_lb("bowling_leaderboard.csv",
              ["player_id","name","team_id","team_name","total_match","innings",
               "total_wickets","balls","highest_wicket","economy","SR",
               "maidens","avg","runs","bowling_style","overs","dot_balls"],
              bowl_lb)

    _write_lb("fielding_leaderboard.csv",
              ["player_id","name","team_id","team_name","total_match",
               "catches","caught_behind","run_outs","assist_run_outs",
               "stumpings","caught_and_bowl","total_catches","total_dismissal"],
              field_lb)

    _write_lb("mvp_leaderboard.csv",
              ["Player Name","Team Name","Player Role","Bowling Style",
               "Batting Hand","Matches","Batting","Bowling","Fielding","Total"],
              mvp_lb)

    # ── Tournament config JSON ────────────────────────────────────────────────
    import json as _json
    seen_shorts: dict[str, bool] = {}
    team_list = []
    for info in TEAM_REGISTRY.values():
        s = info["short"]
        if s not in seen_shorts:
            seen_shorts[s] = True
            team_list.append({"name": info["full"], "short": s})

    config = {"teams": team_list}
    config_path = os.path.join("data", "tournament_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        _json.dump(config, f, indent=2)
    print(f"  Wrote {config_path}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Scrape CricHeroes tournament scorecards to CSV.",
    )
    p.add_argument("--tournament-url", default=DEFAULT_TOURNAMENT_URL,
                   help="Override the tournament past-matches URL")
    p.add_argument("--list-only", action="store_true",
                   help="Only print discovered match URLs; do not scrape scorecards")
    p.add_argument("--visible", action="store_true",
                   help="Run Chrome visibly (non-headless)")
    p.add_argument("--full-refresh", action="store_true",
                   help="Re-scrape all matches, ignoring the tracker")
    return p.parse_args()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args    = parse_args()
    tracker = load_tracker()

    print("=" * 60)
    print("CricHeroes Tournament Scraper")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    driver = build_driver(headless=not args.visible)
    try:
        # Phase 1: Discover
        matches = discover_match_urls(driver, args.tournament_url)

        if not matches:
            print("\n[ERROR] No match URLs found.")
            print("  -> Check debug_html/tournament_page.html to inspect the page.")
            return

        if args.list_only:
            print(f"\nFound {len(matches)} match(es):")
            for m in matches:
                print(f"  [{m['match_id']}] {m['url']}")
            return

        # Phase 2: Filter
        if args.full_refresh:
            to_scrape = matches
            print(f"\n[--full-refresh] Re-scraping all {len(matches)} match(es).")
        else:
            already   = set(tracker["scraped"].keys())
            to_scrape = [m for m in matches if m["match_id"] not in already]
            skipped   = len(matches) - len(to_scrape)
            print(f"\nMatches found:   {len(matches)}")
            print(f"Already scraped: {skipped}")
            print(f"To scrape now:   {len(to_scrape)}")

        if not to_scrape:
            print("\nNothing new to scrape. All matches are up to date.")
            return

        # Phase 3: Scrape scorecards + commentary
        all_info, all_batting, all_bowling = [], [], []
        all_balls = []
        errors    = []

        print(f"\nScraping {len(to_scrape)} match(es)...\n")
        for idx, match in enumerate(to_scrape, 1):
            print(f"[{idx}/{len(to_scrape)}] Match {match['match_id']}")
            try:
                # Scorecard (Selenium)
                info, batting, bowling = scrape_match(driver, match)
                all_info.append(info)
                all_batting.extend(batting)
                all_bowling.extend(bowling)

                # Commentary (direct API — no Selenium needed)
                # Build innings list from scorecard data to get team IDs
                innings_meta = []
                for bat_row in batting:
                    inn_num  = bat_row["innings"]
                    team_id  = bat_row.get("player_id", "")  # not team id — need another source
                    break
                # Get innings info from the __NEXT_DATA__ we already loaded
                # Re-read the saved HTML (already on disk)
                saved_html_path = os.path.join(DEBUG_DIR, f"match_{match['match_id']}.html")
                innings_meta    = []
                if os.path.exists(saved_html_path):
                    with open(saved_html_path, encoding="utf-8") as fh:
                        sc_soup = BeautifulSoup(fh.read(), "html.parser")
                    sc_script = sc_soup.find("script", id="__NEXT_DATA__")
                    if sc_script:
                        sc_data = json.loads(sc_script.string)
                        sc_list = sc_data.get("props", {}).get("pageProps", {}).get("scorecard", [])
                        for inn in sc_list:
                            innings_meta.append({
                                "inning_num": inn["inning"]["inning"],
                                "team_id":    inn["team_id"],
                                "team_name":  inn["teamName"],
                            })

                if innings_meta:
                    balls = fetch_commentary(match["match_id"], innings_meta)
                    all_balls.extend(balls)
                    dot_count = sum(b["is_dot_ball"] for b in balls)
                    print(f"    [commentary] {len(balls)} deliveries, {dot_count} dot balls")
                else:
                    print(f"    [commentary] skipped — no innings metadata")

                mark_scraped(tracker, match["match_id"], match["url"])

            except Exception as e:
                print(f"    [ERROR] {e}")
                errors.append({"match_id": match["match_id"], "error": str(e)})

            if idx < len(to_scrape):
                time.sleep(MATCH_DELAY_SECS)

        # Phase 4: Write CSVs
        dot_analysis = compute_dot_ball_analysis(all_balls)

        print(f"\n{'-' * 40}")
        print(f"Scraped: {len(all_info)} match(es) | "
              f"{len(all_batting)} batting | "
              f"{len(all_bowling)} bowling | "
              f"{len(all_balls)} deliveries | "
              f"{sum(r['dot_balls'] for r in dot_analysis)} dot balls | "
              f"{len(errors)} error(s)")

        if all_info or all_batting or all_bowling:
            print("\nWriting CSV files...")
            write_csvs(all_info, all_batting, all_bowling, all_balls, dot_analysis)
            print("\nWriting dashboard-compatible CSVs (data/ + points_table.csv)...")
            write_dashboard_csvs(all_info, all_batting, all_bowling, all_balls)
        else:
            print("\n[WARN] No data extracted.")
            print("  -> Run --visible to watch the browser and debug.")

        if errors:
            print(f"\nErrors ({len(errors)}):")
            for e in errors:
                print(f"  [{e['match_id']}] {e['error']}")

    finally:
        driver.quit()

    print(f"\nDone: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
