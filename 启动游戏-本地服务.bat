@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo.
  echo Game file not found: dist\index.html
  echo Please run: npm run package
  echo.
  pause
  exit /b 1
)

start "WTF Local Server" /min cmd /c "node scripts\serve.mjs"
timeout /t 1 >nul

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" "http://127.0.0.1:8000/"
  exit /b 0
)

set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" "http://127.0.0.1:8000/"
  exit /b 0
)

start "" "http://127.0.0.1:8000/"
exit /b 0
