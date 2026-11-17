@echo off
rem WifiGuest - installer launcher (double-click)
rem Menjalankan install-agent.ps1, script akan minta izin admin (UAC) otomatis.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-agent.ps1"
pause
