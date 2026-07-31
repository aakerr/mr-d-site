@echo off
rem ============================================================================
rem  ClassOS - Mr. D's Classroom OS launcher (Windows)
rem
rem  Double-click this file: it starts a tiny local web server in this folder,
rem  opens the classroom in your browser, and keeps a rolling copy of your
rem  backups on the way past. Closing the black window shuts the classroom down.
rem  Nothing is installed and nothing leaves this computer.
rem
rem  TO PUT IT ON THE DESKTOP: right-click this file > Send to > Desktop
rem  (create shortcut). Then right-click the new shortcut > Properties >
rem  Change Icon > Browse > pick ClassOS.ico in this same folder.
rem ============================================================================
title ClassOS - leave me open
cd /d "%~dp0"
set PORT=8000

rem --- find a python ---------------------------------------------------------
set PY=
where py >nul 2>&1 && set PY=py -3
if "%PY%"=="" ( where python >nul 2>&1 && set PY=python )
if "%PY%"=="" ( where python3 >nul 2>&1 && set PY=python3 )
if "%PY%"=="" (
  echo.
  echo   ClassOS needs Python, which this computer does not have yet.
  echo.
  echo   Get it free from https://www.python.org/downloads/
  echo   IMPORTANT: on the first screen of the installer, tick
  echo   "Add Python to PATH" before clicking Install.
  echo.
  pause
  exit /b 1
)

rem --- keep a rolling copy of the backup folder ------------------------------
rem Belt outside the browser: whatever the app has written to .\backups is
rem copied to a dated folder on every launch. No browser setting, cleared
rem cache or wiped profile can touch these.
if exist "%~dp0backups" (
  for /f "tokens=1-3 delims=/- " %%a in ("%DATE%") do set STAMP=%%c-%%a-%%b
  set STAMP=%STAMP: =%
  if not exist "%~dp0backup-history" mkdir "%~dp0backup-history" >nul 2>&1
  if not exist "%~dp0backup-history\%STAMP%" mkdir "%~dp0backup-history\%STAMP%" >nul 2>&1
  xcopy "%~dp0backups\*" "%~dp0backup-history\%STAMP%\" /E /Y /Q >nul 2>&1
)

rem --- open the classroom, then run the server -------------------------------
echo.
echo   Mr. D's Classroom OS is starting...
echo.
echo   Leave this window open while you teach.
echo   Closing it (or pressing Control-C) shuts the classroom down.
echo.
start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT%
