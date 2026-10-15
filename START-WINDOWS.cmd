@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Установите Node.js LTS: https://nodejs.org/
  pause
  exit /b 1
)
node scripts/local-start.mjs
if errorlevel 1 pause
