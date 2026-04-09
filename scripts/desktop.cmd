@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0desktop.ps1" %*
endlocal
