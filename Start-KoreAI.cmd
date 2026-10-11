@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Run npm.cmd install first.
  pause
  exit /b 1
)
if not exist dist\server.js (
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)
node dist\server.js %*
endlocal
