# Keeps Recruiting HQ running on this computer: checks every 20 seconds and starts the server if it is not up.
# The server also serves the built website, so http://localhost:8000 is the whole app.
# Started at login by "Recruiting HQ.vbs" in the Windows Startup folder (see scripts\install_autostart.ps1).
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$logs = Join-Path $env:LOCALAPPDATA "RecruitingHQ"
New-Item -ItemType Directory -Force $logs | Out-Null

# Only one watchdog at a time.
$mutex = New-Object System.Threading.Mutex($false, "Local\RecruitingHQWatchdog")
if (-not $mutex.WaitOne(0)) { exit }

while ($true) {
    $up = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if (-not $up) {
        Add-Content (Join-Path $logs "watchdog.log") "$(Get-Date -Format s) server was down, starting it"
        Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "backend.main:app", "--port", "8000" `
            -WorkingDirectory $root -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logs "server.out.log") -RedirectStandardError (Join-Path $logs "server.err.log")
        Start-Sleep -Seconds 10
    }
    Start-Sleep -Seconds 20
}
