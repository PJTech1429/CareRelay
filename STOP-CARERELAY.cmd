@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0carerelay\scripts\Stop-CareRelay.ps1"
if errorlevel 1 pause
