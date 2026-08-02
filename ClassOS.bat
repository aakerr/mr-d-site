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
rem
rem STAMP is computed HERE, not inside the if-block below: batch expands %VAR%
rem at parse time, so a STAMP set inside the parentheses reads back empty on
rem the very lines that use it. And it comes from PowerShell, not %DATE%:
rem %DATE% is locale-formatted and on US Windows reads "Sun 08/02/2026" — the
rem leading day name turned the old for/f parse into a folder called
rem "02-Sun-08". Get-Date is identical on every machine and matches the Mac
rem launcher's YYYY-MM-DD_HHMM.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%i"
if exist "%~dp0backups" (
  if not exist "%~dp0backup-history" mkdir "%~dp0backup-history" >nul 2>&1
  if not exist "%~dp0backup-history\%STAMP%" mkdir "%~dp0backup-history\%STAMP%" >nul 2>&1
  rem Records only - NOT the media subfolder. Thirty launches x a term of
  rem lesson PDFs would be gigabytes of identical files, and the files still
  rem live (once) in backups\media.
  copy "%~dp0backups\*.json" "%~dp0backup-history\%STAMP%\" >nul 2>&1
)

rem --- open the classroom, then run the server -------------------------------
echo.
echo   Mr. D's Classroom OS is starting...
echo.
echo   Leave this window open while you teach.
echo   Closing it (or pressing Control-C) shuts the classroom down.
echo.
start "" "http://localhost:%PORT%"
rem classos-server.py serves exactly like http.server but also answers a
rem shutdown request, which is what lets "Backup and Close" in the app
rem actually close the classroom.
%PY% classos-server.py %PORT%
