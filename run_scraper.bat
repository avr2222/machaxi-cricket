@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: run_scraper.bat
:: Runs the CricHeroes scraper every Monday via Windows Task Scheduler.
::
:: To schedule:
::   1. Open Task Scheduler (taskschd.msc)
::   2. Create Basic Task → Weekly → Monday → 07:00 AM
::   3. Action: Start a program
::      Program/script:  C:\Users\venkateswara.rao\Documents\GitHub\machaxi-cricket\run_scraper.bat
::      Start in:        C:\Users\venkateswara.rao\Documents\GitHub\machaxi-cricket
::
:: For a full re-scrape, change the line below to add --full-refresh
:: ─────────────────────────────────────────────────────────────────────────────

setlocal

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set LOG_FILE=%SCRIPT_DIR%scraper_log.txt

echo ======================================== >> "%LOG_FILE%"
echo Run started: %DATE% %TIME%              >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"

:: Run the scraper (headless by default)
python "%SCRIPT_DIR%scrape_cricheroes.py" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQU 0 (
    echo Run finished OK: %DATE% %TIME%  >> "%LOG_FILE%"
) else (
    echo Run FAILED (exit code %ERRORLEVEL%): %DATE% %TIME%  >> "%LOG_FILE%"
)

echo. >> "%LOG_FILE%"
endlocal
