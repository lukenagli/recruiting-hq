' Starts the Recruiting HQ watchdog with no window (window style 0). Used by the "Recruiting HQ" scheduled task.
' It finds keep_running.ps1 next to itself, so moving the project folder doesn't break it.
Dim here
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\keep_running.ps1""", 0, False
