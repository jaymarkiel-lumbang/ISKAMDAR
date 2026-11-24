@echo off
title ISKAMDAR Scan Server
echo Starting ISKAMDAR scan server on http://localhost:5000
echo Press Ctrl+C to stop.
echo.

python -m pip install flask flask-cors requests playwright py3langid --quiet

echo.
python "%~dp0scan_server.py"
pause