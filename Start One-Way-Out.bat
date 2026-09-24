@echo off
REM === One-Way-Out: Herdr terminal + auto agents + map ===
set "HERDR=%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe"

REM 1) Herdr terminal. It needs Windows Terminal as its host, else no window shows up.
where wt.exe >nul 2>nul
if errorlevel 1 goto plainhost
start "" wt.exe -w 0 nt --title Herdr "%HERDR%"
goto hostdone
:plainhost
start "Herdr" cmd /c "%HERDR%"
:hostdone

REM 2) One-Way-Out web view (if already running it just opens the browser tab)
REM    No window: output goes to %LOCALAPPDATA%\one-way-out.log. "Stop One-Way-Out.bat" stops it.
wscript "C:\Users\Shaf\Downloads\vibe-code-projs\tools\One-Way-Out\scripts\map-hidden.vbs"

REM 3) Give the server a moment to come up
ping -n 5 127.0.0.1 >nul

REM -- AGENT LIST -- one block per agent: skips it if already running --
"%HERDR%" agent list 2>nul | findstr /i "claude" >nul
if errorlevel 1 (
    "%HERDR%" agent start claude --cwd "C:\Users\Shaf\Downloads\vibe-code-projs" -- claude
)

REM To auto-start more agents, copy the block above and change the name/folder, e.g.:
REM "%HERDR%" agent start codex --cwd "C:\path\to\project" --split right -- codex
