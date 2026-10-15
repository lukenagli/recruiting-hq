@echo off
rem Starts Recruiting HQ: the API server and the website, each in its own window, then opens the site.
rem Close the two windows to stop the app.
cd /d "%~dp0"
start "Recruiting HQ - server" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000"
start "Recruiting HQ - website" cmd /k "npm run dev --prefix frontend"
timeout /t 5 /nobreak >nul
start "" http://localhost:5173
