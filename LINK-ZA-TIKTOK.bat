@echo off
setlocal
cd /d "%~dp0server"

echo.
echo  ==========================================
echo    POZNAI 5  -  with public link
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is required.
  echo  Get it from https://nodejs.org  ^(the LTS button^) and run this again.
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
set "TUNNEL=1"

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"

node server.js %*
echo.
echo  Server stopped.
pause
