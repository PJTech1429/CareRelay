@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0carerelay\scripts\Start-CareRelay.ps1"
if errorlevel 1 pause
