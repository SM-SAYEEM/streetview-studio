@echo off
title StreetView Studio v2.1.0
echo Starting StreetView Studio v2.1.0 Engine...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"
python server.py
pause
