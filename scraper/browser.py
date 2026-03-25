"""Chrome WebDriver factory with anti-detection and context-manager support."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

log = logging.getLogger(__name__)

_ANTI_DETECT_JS = (
    "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
)


def build_driver(headless: bool = True, user_agent: str = "") -> webdriver.Chrome:
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")

    for arg in (
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--no-first-run",
        "--remote-debugging-port=0",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
    ):
        opts.add_argument(arg)

    if user_agent:
        opts.add_argument(f"--user-agent={user_agent}")

    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": _ANTI_DETECT_JS},
    )
    log.debug("Chrome driver started (headless=%s)", headless)
    return driver


@contextmanager
def chrome_driver(
    headless: bool = True, user_agent: str = ""
) -> Generator[webdriver.Chrome, None, None]:
    """Context manager — guarantees driver.quit() even on exception."""
    driver = build_driver(headless=headless, user_agent=user_agent)
    try:
        yield driver
    finally:
        driver.quit()
        log.debug("Chrome driver closed")
