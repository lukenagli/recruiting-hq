' Starts the Recruiting HQ watchdog with no window (window style 0). Used by the "Recruiting HQ" scheduled task.
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\lnagl\OneDrive - Yale University\MGT 409 - AI Foundation for Managers\Homework\Final Project\scripts\keep_running.ps1""", 0, False
