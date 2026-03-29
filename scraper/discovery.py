"""Selenium-based tournament match URL discovery (fallback when API fails)."""
from __future__ import annotations

import logging
import re
import time

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By

from .api_client import CricHeroesAPIClient
from .config import ScraperConfig

log = logging.getLogger(__name__)

_TAB_SEGMENTS = frozenset({
    "live", "summary", "commentary", "analysis",
    "cricheroes", "mvp", "teams", "gallery",
})


def _extract_match_id(url: str) -> str | None:
    m = re.search(r"/scorecard/(\d+)", url)
    return m.group(1) if m else None


def _to_scorecard_url(url: str) -> str:
    """Normalise any CricHeroes match URL to its /scorecard tab form."""
    url = url.rstrip("/")
    parts = url.split("/")
    last = parts[-1]
    if last in _TAB_SEGMENTS or (
        not last.isdigit() and "/scorecard/" in url.split("/scorecard/", 1)[-1]
    ):
        parts[-1] = "scorecard"
    return "/".join(parts)


class MatchDiscovery:
    """Discovers past-match URLs from the tournament page via Selenium."""

    def __init__(
        self,
        driver: webdriver.Chrome,
        config: ScraperConfig,
        api: CricHeroesAPIClient | None = None,
    ) -> None:
        self._driver = driver
        self._cfg = config
        self._api = api or CricHeroesAPIClient(config)

    def discover(self, tournament_url: str) -> list[dict[str, str]]:
        log.info("[Selenium] Loading tournament page: %s", tournament_url)
        self._driver.get(tournament_url)
        time.sleep(self._cfg.page_wait_secs)

        rounds = self._scroll_to_bottom()
        log.info("[Selenium] Scrolled %d round(s)", rounds)

        clicks = self._click_load_more()
        if clicks:
            log.info("[Selenium] Clicked 'Load more' %d time(s) — re-scrolling", clicks)
            self._scroll_to_bottom()

        html = self._driver.page_source
        self._save_debug("tournament_page.html", html)

        # Try __NEXT_DATA__ + pagination first (fast, reliable)
        matches = self._api.discover_matches_from_html(html)
        if matches:
            return matches

        # Fallback: scrape <a href> links from the rendered DOM
        matches = self._extract_match_urls(html)
        log.info("[Selenium] Found %d unique match URL(s)", len(matches))
        return matches

    # ── Private helpers ───────────────────────────────────────────────────────

    def _scroll_to_bottom(self) -> int:
        last_h = self._driver.execute_script("return document.body.scrollHeight")
        rounds = 0
        for _ in range(self._cfg.max_scroll_rounds):
            self._driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(self._cfg.scroll_pause_secs)
            new_h = self._driver.execute_script("return document.body.scrollHeight")
            rounds += 1
            if new_h == last_h:
                break
            last_h = new_h
        return rounds

    def _click_load_more(self) -> int:
        clicks = 0
        for _ in range(20):
            try:
                btn = self._driver.find_element(
                    By.XPATH, "//button[normalize-space(text())='Load more']"
                )
                if not btn.is_displayed():
                    break
                self._driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center'});", btn
                )
                time.sleep(0.5)
                btn.click()
                clicks += 1
                time.sleep(self._cfg.scroll_pause_secs + 1)
            except Exception:
                break
        return clicks

    def _extract_match_urls(self, html: str) -> list[dict[str, str]]:
        soup = BeautifulSoup(html, "html.parser")
        matches: dict[str, dict[str, str]] = {}

        for a in soup.find_all("a", href=True):
            self._register(a["href"], matches)

        if not matches:
            for tag in soup.find_all(True):
                for attr in ("data-href", "data-url", "data-link"):
                    self._register(tag.get(attr, ""), matches)

        if not matches:
            for path in re.findall(
                r'["\']([^"\']*?/scorecard/\d+[^"\']*?)["\']', html
            ):
                self._register(path, matches)

        return list(matches.values())

    def _register(self, href: str, matches: dict) -> None:
        if "/scorecard/" not in href:
            return
        full = href if href.startswith("http") else f"https://cricheroes.com{href}"
        full = _to_scorecard_url(full)
        mid = _extract_match_id(full)
        if mid and mid not in matches:
            matches[mid] = {"match_id": mid, "url": full}

    def _save_debug(self, filename: str, html: str) -> None:
        path = self._cfg.debug_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")
        log.debug("HTML saved -> %s", path)
