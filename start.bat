@echo off
setlocal
cd /d "%~dp0"
set PORT=8877

echo.
echo Hachibito (local)
echo --------------------------------
echo Opening http://localhost:%PORT%/
echo Close this window to stop the server.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/"
  py -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

echo Python not found. Using PowerShell local server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\server.ps1" -Port %PORT%
