@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\game.html" (
  echo.
  echo Game file not found: dist\game.html
  echo Please run: npm run package
  echo.
  pause
  exit /b 1
)

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" "%~dp0dist\game.html"
  exit /b 0
)

set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" "%~dp0dist\game.html"
  exit /b 0
)

rem Fallback: use the system default HTML handler.
start "" "%~dp0dist\game.html"
exit /b 0
