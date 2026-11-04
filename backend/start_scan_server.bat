@echo off
title ISKAMDAR Scan Server
echo Starting ISKAMDAR scan server on http://localhost:5000
echo Press Ctrl+C to stop.
echo.

REM Install/upgrade dependencies silently if needed
py -m pip install flask flask-cors requests --quiet

echo.
py "%~dp0scan_server.py"
pause
