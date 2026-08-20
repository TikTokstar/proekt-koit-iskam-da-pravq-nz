@echo off
setlocal
cd /d "%~dp0server"

echo.
echo  ==========================================
echo    POZNAI 5  -  starting...
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is required - this runs the game server.
  echo.
  echo  1. Open https://nodejs.org
  echo  2. Click the big LTS button and install it
  echo  3. Run this file again
  echo.
  pause
  exit /b 1
)

rem install on first run, and again after an update adds something new
set "NEED="
if not exist "node_modules"   set "NEED=1"
if exist ".needs-install"     set "NEED=1"
if defined NEED (
  echo  Installing, takes about a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Install FAILED. Check your internet connection.
    pause
    exit /b 1
  )
  if exist ".needs-install" del ".needs-install" >nul 2>nul
  echo.
)

if "%PORT%"=="" set "PORT=8080"

rem browser opens after a short delay so the server is already up
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"

node server.js %*
echo.
echo  Server stopped.
pause
