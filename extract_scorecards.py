#!/usr/bin/env python3
"""
extract_scorecards.py
─────────────────────
Scans CricHeroesStats/ for Scorecard_*.pdf files, parses batting/bowling data,
and writes four CSV files:
  data/match_meta.csv
  data/match_batting.csv
  data/match_bowling.csv
  points_table.csv        ← auto-computed from scorecard results

Usage:
    pip install pdfplumber
    python extract_scorecards.py

Run this after adding new PDF files to CricHeroesStats/.
The dashboard loads these CSVs instantly — no browser-side PDF parsing needed.
"""

import csv
import glob
import os
import re
import sys

try:
    import pdfplumber
except ImportError:
    print("ERROR: pdfplumber not installed.\nRun: pip install pdfplumber")
    sys.exit(1)

SCORECARD_DIR = "CricHeroesStats"
OUTPUT_DIR    = "data"
TOLERANCE     = 4   # y-coordinate grouping tolerance (points)

# Role/badge tags to strip from player names
ROLE_TAGS = re.compile(r'\(c\s*&\s*wk\)|\(c\)|\(wk\)|\([LR]HB\)', re.I)


# ── PDF text extraction ────────────────────────────────────────────────────────

def extract_words(page):
    words = page.extract_words(x_tolerance=2, y_tolerance=2)
    return [{"text": w["text"], "x": w["x0"], "y": w["top"]}
            for w in words if w["text"].strip()]


def group_into_rows(words, tolerance=TOLERANCE):
    rows = []
    for word in words:
        placed = False
        for row in rows:
            if abs(row["y"] - word["y"]) <= tolerance:
                row["words"].append(word)
                placed = True
                break
        if not placed:
            rows.append({"y": word["y"], "words": [word]})
    for row in rows:
        row["words"].sort(key=lambda w: w["x"])
        row["tokens"] = [w["text"] for w in row["words"]]
        row["text"]   = " ".join(row["tokens"])
    rows.sort(key=lambda r: r["y"])   # top -> bottom
    return rows


# ── Page 1: match metadata ─────────────────────────────────────────────────────

def parse_page1(rows):
    full = "\n".join(r["text"] for r in rows)

    # Date: "2026-02-22, ..." or "22 Feb 2026"
    match_date = ""
    m = re.search(r'\b(\d{4}-\d{2}-\d{2})\b', full)
    if m:
        match_date = m.group(1)
    else:
        m = re.search(r'\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\b',
                      full, re.I)
        if m:
            match_date = m.group(1)

    # Venue: "Ground Machaxi J Sports, ..."  or "at <venue>"
    venue = ""
    for row in rows:
        m = re.search(r'^Ground\s+(.+)', row["text"], re.I)
        if m:
            venue = m.group(1).strip().split(",")[0].strip()
            break
    if not venue:
        for row in rows:
            m = re.search(r'\bat\s+(.+)', row["text"], re.I)
            if m and len(m.group(1).strip()) > 3:
                venue = m.group(1).strip().split(",")[0].strip()
                break
    if not venue:
        for row in rows:
            t = row["text"].lower()
            if any(k in t for k in ["ground", "stadium", "oval", "park", "arena"]):
                venue = row["text"].strip()
                break

    # Toss: "Toss Royal Cricket Blasters (RCB) opt to bat/field"
    #    or old format: "Royal Cricket Blasters Won The Toss and Chose To Bat"
    toss_winner = toss_decision = ""
    m = re.search(
        r'Toss\s+(Royal Cricket Blasters|Weekend Warriors)\s*(?:\([^)]+\))?\s*opt\s+to\s+(bat|field)',
        full, re.I)
    if m:
        toss_winner   = m.group(1)
        toss_decision = m.group(2).lower()
    else:
        m = re.search(
            r'(Royal Cricket Blasters|Weekend Warriors)[^.]*Won The Toss and Chose To (Bat|Field)',
            full, re.I)
        if m:
            toss_winner   = m.group(1)
            toss_decision = m.group(2).lower()

    # Result: "Result Weekend Warriors (WW) won by 4 wickets"
    #      or "Royal Cricket Blasters Won By 5 Runs"
    result = winner = margin = ""
    if re.search(r'Match\s+Tied', full, re.I):
        result = "Match Tied"
    else:
        m = re.search(
            r'(Royal Cricket Blasters|Weekend Warriors)\s*(?:\([^)]+\))?\s*won\s+by\s+([\d]+\s+(?:wickets?|runs?))',
            full, re.I)
        if m:
            winner = m.group(1).strip()
            margin = m.group(2).strip()
            result = f"{winner} Won By {margin}"

    return dict(match_date=match_date, venue=venue, toss_winner=toss_winner,
                toss_decision=toss_decision, result=result, winner=winner, margin=margin)


# ── Team detection ─────────────────────────────────────────────────────────────

def detect_team(rows, max_rows=8):
    for row in rows[:max_rows]:
        t = row["text"].lower()
        if "royal cricket blasters" in t:
            return "Royal Cricket Blasters"
        if "weekend warriors" in t:
            return "Weekend Warriors"
    return ""


# ── Name cleaning ──────────────────────────────────────────────────────────────

def clean_name(tokens):
    """
    Given name tokens (already stripped of stats columns), return a clean player name.
    - Removes leading position number (e.g. "1", "2")
    - Removes role tags: (c), (wk), (c & wk), (RHB), (LHB)
    - Strips non-ASCII characters (PDF encoding artefacts)
    """
    # Drop leading position number
    if tokens and re.fullmatch(r'\d+', tokens[0]):
        tokens = tokens[1:]
    # Rebuild and strip role tags
    name = " ".join(tokens)
    name = ROLE_TAGS.sub("", name)
    # Strip non-ASCII artefacts (e.g. ᗑ prepended by PDF encoder)
    name = re.sub(r'[^\x00-\x7F]+', '', name)
    return name.strip()


# ── Dismissal parsing ──────────────────────────────────────────────────────────

def parse_dismissal(text):
    t = text.strip()
    # Order matters — most specific first
    checks = [
        (r'^(.+?)\s+not\s+out$',                  'not_out',     lambda m: ("", "")),
        (r'^(.+?)\s+retired\s+hurt$',              'retired_hurt',lambda m: ("", "")),
        # run out (Fielder) or run out Fielder Name
        (r'^(.+?)\s+run\s+out\s+\((.+?)\)$',      'run_out',     lambda m: (m.group(2).strip(), "")),
        (r'^(.+?)\s+run\s+out\s+(.+)$',            'run_out',     lambda m: (m.group(2).strip(), "")),
        (r'^(.+?)\s+run\s+out$',                   'run_out',     lambda m: ("", "")),
        (r'^(.+?)\s+lbw\s+b\s+(.+)$',             'lbw',         lambda m: (m.group(2).strip(), "")),
        (r'^(.+?)\s+c\s+(.+?)\s+b\s+(.+)$',       'caught',      lambda m: (m.group(3).strip(), m.group(2).strip())),
        (r'^(.+?)\s+st\s+(.+?)\s+b\s+(.+)$',      'stumped',     lambda m: (m.group(3).strip(), m.group(2).strip())),
        (r'^(.+?)\s+b\s+(.+)$',                   'bowled',      lambda m: (m.group(2).strip(), "")),
    ]
    for pattern, dtype, extras in checks:
        m = re.match(pattern, t, re.I)
        if m:
            return m.group(1).strip(), dtype, *extras(m)
    return t, "unknown", "", ""


# ── Batting table ──────────────────────────────────────────────────────────────

def parse_batting(rows, batting_team, match_id, match_date, innings_num):
    """
    Header row: "No  Batsman  Status  R  B  M  4s  6s  SR"
    Data row:   "[pos]  [name]  [(role)]  [dismissal]  R  B  M  4s  6s  SR"
    """
    results = []

    # Find header: row containing "Batsman"
    bat_start = next((i for i, r in enumerate(rows)
                      if "Batsman" in r["text"] or "BATSMAN" in r["text"].upper()), -1)
    if bat_start < 0:
        return results

    # End: "Extras:" or "Total:"
    bat_end = len(rows)
    for i in range(bat_start + 1, len(rows)):
        t = rows[i]["text"]
        if re.match(r'^Extras', t, re.I) or re.match(r'^Total', t, re.I):
            bat_end = i
            break

    position = 1
    for i in range(bat_start + 1, bat_end):
        tokens = rows[i]["tokens"]
        if len(tokens) < 7:   # pos + name + at least 6 stat cols
            continue
        try:
            sr  = float(tokens[-1])
            six = int(tokens[-2])
            fou = int(tokens[-3])
            # M can be "-" for no minutes data
            m_raw = tokens[-4]
            int(0 if m_raw == '-' else m_raw)
            bal = int(tokens[-5])
            run = int(tokens[-6])
        except (ValueError, IndexError):
            continue
        if sr < 0:
            continue

        name_tokens = tokens[:-6]
        # Split name tokens into [name part] and [dismissal part]
        # Dismissal starts after role tags end — find where role tags / dismissal keywords begin
        # Strategy: split at first dismissal keyword
        name_tokens_text = " ".join(name_tokens)
        # Strip role tags first to isolate name + dismissal
        no_roles = ROLE_TAGS.sub("", name_tokens_text).strip()
        # Remove leading position number
        no_roles = re.sub(r'^\d+\s+', '', no_roles).strip()
        # Strip non-ASCII artefacts
        no_roles = re.sub(r'[^\x00-\x7F]+', '', no_roles).strip()

        if not no_roles:
            continue

        player, dtype, dismissed_by, caught_by = parse_dismissal(no_roles)
        # Final clean of player name
        player = re.sub(r'[^\x00-\x7F]+', '', player).strip()
        if not player or len(player) < 2:
            continue

        results.append(dict(
            match_id=match_id, match_date=match_date, innings=innings_num,
            batting_team=batting_team, position=position, player=player,
            runs=run, balls=bal, fours=fou, sixes=six, strike_rate=sr,
            dismissal_type=dtype, dismissed_by=dismissed_by, caught_by=caught_by,
        ))
        position += 1
    return results


# ── Bowling table ──────────────────────────────────────────────────────────────

def parse_bowling(rows, bowling_team, match_id, match_date, innings_num):
    """
    Header row: "No  Bowler  O  M  R  W  0s  4s  6s  WD  NB  Eco"
    Data row:   "[pos]  [name]  [(role)]  O  M  R  W  0s  4s  6s  WD  NB  Eco"
    """
    results = []

    # Find header: row containing "Bowler"
    bowl_start = next((i for i, r in enumerate(rows)
                       if "Bowler" in r["text"] or "BOWLER" in r["text"].upper()), -1)
    if bowl_start < 0:
        return results

    # End: "To Bat:" or "Fall of Wickets"
    bowl_end = len(rows)
    for i in range(bowl_start + 1, len(rows)):
        t = rows[i]["text"]
        if re.match(r'^To\s+Bat', t, re.I) or re.match(r'^Fall\s+of', t, re.I):
            bowl_end = i
            break

    for i in range(bowl_start + 1, bowl_end):
        tokens = rows[i]["tokens"]
        if len(tokens) < 11:  # pos + name + 10 stat cols
            continue
        try:
            eco  = float(tokens[-1])
            nb   = int(tokens[-2])
            wd   = int(tokens[-3])
            six  = int(tokens[-4])
            fou  = int(tokens[-5])
            dot  = int(tokens[-6])
            wkts = int(tokens[-7])
            run  = int(tokens[-8])
            mai  = int(tokens[-9])
            ov   = float(tokens[-10])
        except (ValueError, IndexError):
            continue
        if ov <= 0:
            continue

        name = clean_name(tokens[:-10])
        if not name or len(name) < 2:
            continue

        results.append(dict(
            match_id=match_id, match_date=match_date, innings=innings_num,
            bowling_team=bowling_team, player=name,
            overs=ov, maidens=mai, runs=run, wickets=wkts, dot_balls=dot,
            fours_conceded=fou, sixes_conceded=six, wides=wd, no_balls=nb, economy=eco,
        ))
    return results


# ── Process one PDF ────────────────────────────────────────────────────────────

def process_pdf(pdf_path, match_id):
    with pdfplumber.open(pdf_path) as pdf:
        p1_rows = group_into_rows(extract_words(pdf.pages[0]))
        meta    = parse_page1(p1_rows)
        meta["match_id"] = match_id

        if len(pdf.pages) < 3:
            meta.update(innings1_team="", innings2_team="")
            return meta, [], []

        p3_rows = group_into_rows(extract_words(pdf.pages[2]))
        team1   = detect_team(p3_rows)
        team2   = ("Weekend Warriors"       if team1 == "Royal Cricket Blasters" else
                   "Royal Cricket Blasters"  if team1 == "Weekend Warriors"      else "")
        meta["innings1_team"] = team1
        meta["innings2_team"] = team2

        batting1 = parse_batting(p3_rows, team1, match_id, meta["match_date"], 1)
        bowling1 = parse_bowling(p3_rows, team2, match_id, meta["match_date"], 1)

        batting2 = bowling2 = []
        if len(pdf.pages) >= 4:
            p4_rows  = group_into_rows(extract_words(pdf.pages[3]))
            batting2 = parse_batting(p4_rows, team2, match_id, meta["match_date"], 2)
            bowling2 = parse_bowling(p4_rows, team1, match_id, meta["match_date"], 2)

    return meta, batting1 + batting2, bowling1 + bowling2



# ── Points Table — computed from scorecard data ────────────────────────────────

TEAMS = {
    "Royal Cricket Blasters": {"short": "RCB", "full": "Royal Cricket Blasters (RCB)"},
    "Weekend Warriors":       {"short": "WW",  "full": "Weekend Warriors (WW)"},
}

def overs_to_balls(overs_float):
    """Convert 3.4 overs notation to total balls (3 overs + 4 balls = 22 balls)."""
    whole = int(overs_float)
    part  = round((overs_float - whole) * 10)
    return whole * 6 + part

def compute_points_table(all_meta, all_batting, all_bowling):
    """
    Derive a full points table from parsed scorecard data.
    NRR = (runs_scored / overs_faced) - (runs_conceded / overs_conceded)
    """
    stats = {name: dict(M=0, W=0, L=0, T=0, NR=0, Pts=0,
                        runs_for=0, balls_for=0, runs_against=0, balls_against=0,
                        results=[])
             for name in TEAMS}

    # Index batting totals per match per team
    bat_totals = {}
    for r in all_batting:
        mid  = r["match_id"]
        team = r["batting_team"]
        bat_totals.setdefault(mid, {}).setdefault(team, 0)
        bat_totals[mid][team] += int(r["runs"])

    # Index bowling: balls bowled per match per bowling team
    bowl_totals = {}
    for r in all_bowling:
        mid  = r["match_id"]
        team = r["bowling_team"]
        bowl_totals.setdefault(mid, {}).setdefault(team, 0)
        bowl_totals[mid][team] += overs_to_balls(float(r["overs"]))

    for meta in sorted(all_meta, key=lambda m: m.get("match_date", "")):
        mid    = meta["match_id"]
        winner = meta.get("winner", "")
        result = meta.get("result", "")
        t1     = meta.get("innings1_team", "")
        t2     = meta.get("innings2_team", "")

        if not t1 or not t2 or t1 not in stats or t2 not in stats:
            continue

        stats[t1]["M"] += 1
        stats[t2]["M"] += 1

        if "tied" in result.lower():
            for t in (t1, t2):
                stats[t]["T"] += 1; stats[t]["Pts"] += 1; stats[t]["results"].append("T")
        elif winner in (t1, t2):
            loser = t2 if winner == t1 else t1
            stats[winner]["W"]   += 1; stats[winner]["Pts"] += 2; stats[winner]["results"].append("W")
            stats[loser]["L"]    += 1; stats[loser]["results"].append("L")
        else:
            for t in (t1, t2):
                stats[t]["NR"] += 1; stats[t]["Pts"] += 1; stats[t]["results"].append("NR")

        # NRR: t1 batted inn1 (t2 bowled), t2 batted inn2 (t1 bowled)
        runs_t1        = bat_totals.get(mid, {}).get(t1, 0)
        runs_t2        = bat_totals.get(mid, {}).get(t2, 0)
        balls_t2_bowled = bowl_totals.get(mid, {}).get(t2, 0)  # balls t1 faced
        balls_t1_bowled = bowl_totals.get(mid, {}).get(t1, 0)  # balls t2 faced

        if balls_t2_bowled > 0:
            stats[t1]["runs_for"]      += runs_t1
            stats[t1]["balls_for"]     += balls_t2_bowled
            stats[t2]["runs_against"]  += runs_t1
            stats[t2]["balls_against"] += balls_t2_bowled

        if balls_t1_bowled > 0:
            stats[t2]["runs_for"]      += runs_t2
            stats[t2]["balls_for"]     += balls_t1_bowled
            stats[t1]["runs_against"]  += runs_t2
            stats[t1]["balls_against"] += balls_t1_bowled

    rows = []
    for name, s in stats.items():
        rpo_for     = (s["runs_for"]     / s["balls_for"]     * 6) if s["balls_for"]     > 0 else 0
        rpo_against = (s["runs_against"] / s["balls_against"] * 6) if s["balls_against"] > 0 else 0
        nrr = round(rpo_for - rpo_against, 3)

        w, p = divmod(s["balls_for"], 6)
        for_str     = f"{s['runs_for']}/{w}.{p}"
        w, p = divmod(s["balls_against"], 6)
        against_str = f"{s['runs_against']}/{w}.{p}"

        rows.append({
            "team":    TEAMS[name]["full"],
            "short":   TEAMS[name]["short"],
            "M": s["M"], "W": s["W"], "L": s["L"],
            "D": 0,      "T": s["T"], "NR": s["NR"],
            "Pts":     s["Pts"],
            "NRR":     nrr,
            "For":     for_str,
            "Against": against_str,
            "last5":   "|".join(s["results"][-5:]),
            "_sort":   (s["Pts"], nrr),
        })

    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        del r["_sort"]

    return rows


# ── CSV output ─────────────────────────────────────────────────────────────────

def write_csv(path, headers, rows):
    dirpath = os.path.dirname(path)
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Wrote {len(rows):>4} rows -> {path}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    debug = "--debug" in sys.argv
    pdf_files = sorted(glob.glob(os.path.join(SCORECARD_DIR, "Scorecard_*.pdf")))
    if not pdf_files:
        print(f"No PDF files found in {SCORECARD_DIR}/")
        return

    if debug:
        # Print page-1 text of first PDF to diagnose result/date parsing
        first = pdf_files[0]
        print(f"\n=== DEBUG: Page 1 text of {os.path.basename(first)} ===\n")
        with pdfplumber.open(first) as pdf:
            rows = group_into_rows(extract_words(pdf.pages[0]))
            for r in rows:
                print(repr(r["text"]))
        print("\n=== END DEBUG ===\n")
        return

    print(f"Found {len(pdf_files)} PDF(s) in {SCORECARD_DIR}/\n")

    all_meta, all_batting, all_bowling = [], [], []
    errors = 0

    for pdf_path in pdf_files:
        match_id = re.search(r'Scorecard_(\d+)\.pdf', pdf_path).group(1)
        print(f"  [{match_id}] ", end="", flush=True)
        try:
            meta, batting, bowling = process_pdf(pdf_path, match_id)
            all_meta.append(meta)
            all_batting.extend(batting)
            all_bowling.extend(bowling)
            print(f"OK  -- {len(batting)} batting, {len(bowling)} bowling rows")
        except Exception as e:
            print(f"ERROR: {e}")
            errors += 1

    print(f"\nTotal: {len(all_meta)} matches, {len(all_batting)} batting rows, "
          f"{len(all_bowling)} bowling rows, {errors} error(s)\n")

    META_HEADERS    = ["match_id","match_date","innings1_team","innings2_team",
                       "toss_winner","toss_decision","result","winner","margin"]
    BATTING_HEADERS = ["match_id","match_date","innings","batting_team","position",
                       "player","runs","balls","fours","sixes","strike_rate",
                       "dismissal_type","dismissed_by","caught_by"]
    BOWLING_HEADERS = ["match_id","match_date","innings","bowling_team","player",
                       "overs","maidens","runs","wickets","dot_balls",
                       "fours_conceded","sixes_conceded","wides","no_balls","economy"]

    write_csv(os.path.join(OUTPUT_DIR, "match_meta.csv"),    META_HEADERS,    all_meta)
    write_csv(os.path.join(OUTPUT_DIR, "match_batting.csv"), BATTING_HEADERS, all_batting)
    write_csv(os.path.join(OUTPUT_DIR, "match_bowling.csv"), BOWLING_HEADERS, all_bowling)

    # Auto-generate points_table.csv from scorecard results
    pt_rows = compute_points_table(all_meta, all_batting, all_bowling)
    PT_HEADERS = ["rank","team","short","M","W","L","D","T","NR","NRR","For","Against","Pts","last5"]
    write_csv("points_table.csv", PT_HEADERS, pt_rows)
    for r in pt_rows:
        print(f"  #{r['rank']} {r['short']:3s}  {r['W']}W {r['L']}L  {r['Pts']}pts  NRR {r['NRR']:+.3f}")

    print("\nDone! Refresh the dashboard -- all scorecard data loads instantly now.")


if __name__ == "__main__":
    main()
