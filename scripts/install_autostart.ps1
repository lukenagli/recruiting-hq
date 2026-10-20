# One-time setup: start the Recruiting HQ watchdog now and every time you log in to Windows.
# Adds "Recruiting HQ.vbs" to your own Startup folder (no admin rights needed). Delete that file to undo.
$watchdog = Join-Path $PSScriptRoot "keep_running.ps1"
$launcher = Join-Path ([Environment]::GetFolderPath("Startup")) "Recruiting HQ.vbs"
# A tiny VBScript launches PowerShell with no window at all. In VBScript a quote inside a string is written "".
$q = [char]34
$inner = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $q$q$watchdog$q$q"
$vbs = "CreateObject($q" + "WScript.Shell$q).Run $q$inner$q, 0, False"
[IO.File]::WriteAllText($launcher, $vbs + "`r`n", [Text.Encoding]::ASCII)
Start-Process -FilePath "wscript.exe" -ArgumentList "$q$launcher$q"
Write-Output "Installed: $launcher"
