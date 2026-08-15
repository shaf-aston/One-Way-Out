@echo off
REM === One-click Herdr: terminal + auto agents + Herdr Map ===
set "HERDR=%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe"

REM 1) Herdr terminal. It needs Windows Terminal as its host, else no window shows up.
where wt.exe >nul 2>nul
if errorlevel 1 goto plainhost
start "" wt.exe -w 0 nt --title Herdr "%HERDR%"
goto hostdone
:plainhost
start "Herdr" cmd /c "%HERDR%"
:hostdone

REM 2) Herdr Map web view (if already running it just opens the browser tab)
start "Herdr Map" /min cmd /c "node C:\Users\Shaf\herdr-map\server.mjs"

REM 3) Give the server a moment to come up
ping -n 5 127.0.0.1 >nul

REM -- AGENT LIST -- one block per agent: skips it if already running --
"%HERDR%" agent list 2>nul | findstr /i "claude" >nul
if errorlevel 1 (
    "%HERDR%" agent start claude --cwd "C:\Users\Shaf\Downloads\vibe-code-projs\perfume-web-vibesBoys" -- claude
)

REM To auto-start more agents, copy the block above and change the name/folder, e.g.:
REM "%HERDR%" agent start codex --cwd "C:\path\to\project" --split right -- codex
