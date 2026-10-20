@echo off
rem Starts Recruiting HQ (if it is not already running) and opens it. The server also serves the website,
rem so http://localhost:8000 is the whole app. To keep it running after every login, run
rem scripts\install_autostart.ps1 once.
cd /d "%~dp0"
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\keep_running.ps1"
timeout /t 8 /nobreak >nul
start "" http://localhost:8000
