@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ====================================
echo   "Poznai 5"  -  update
echo  ====================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE.ps1"

if errorlevel 1 (
  echo.
  echo  Update FAILED.
  echo  Check your internet connection and try again.
)

echo.
pause
