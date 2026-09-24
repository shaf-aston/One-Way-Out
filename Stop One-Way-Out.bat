@echo off
REM Stops the hidden One-Way-Out server (the one "Start One-Way-Out.bat" launches with no window).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4785 " ^| findstr LISTENING') do taskkill /pid %%p /f >nul 2>nul
echo One-Way-Out stopped.
