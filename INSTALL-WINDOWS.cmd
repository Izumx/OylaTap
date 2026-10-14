@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo OylaTap: автоматическая установка и запуск
echo Скачиваем необходимые программы через Windows Package Manager.
call :refreshPath
where winget >nul 2>&1
if errorlevel 1 goto missingWinget

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 || (a===22 && b>=12)?0:1)" >nul 2>&1
if not errorlevel 1 goto nodeReady
call :install OpenJS.NodeJS.LTS
if errorlevel 1 goto failed
:nodeReady

where docker >nul 2>&1
if not errorlevel 1 goto dockerInstalled
call :install Docker.DockerDesktop
if errorlevel 1 goto failed
:dockerInstalled

where ffmpeg >nul 2>&1
if errorlevel 1 goto installFfmpeg
where ffprobe >nul 2>&1
if not errorlevel 1 goto ffmpegReady
:installFfmpeg
call :install Gyan.FFmpeg
if errorlevel 1 goto failed
:ffmpegReady

echo Запускаем Docker Desktop и ждём PostgreSQL-среду...
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; docker info *> $null; if ($LASTEXITCODE -ne 0) { $desktop=Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'; if (Test-Path -LiteralPath $desktop) { Start-Process -FilePath $desktop }; for ($i=0; $i -lt 90; $i++) { Start-Sleep -Seconds 2; docker info *> $null; if ($LASTEXITCODE -eq 0) { exit 0 } }; Write-Host 'Docker ещё не готов. Откройте Docker Desktop, завершите настройку WSL и повторите запуск установщика. Если Windows просит перезагрузку, сначала перезагрузите ПК.'; exit 1 }; exit 0"
if errorlevel 1 goto failed
echo Готовим проект. Это окно нужно оставить открытым после запуска сайта.
node scripts/local-start.mjs
if errorlevel 1 goto failed
exit /b 0

:install
echo Устанавливаем %~1...
winget install --exact --id "%~1" --source winget --accept-package-agreements --accept-source-agreements
if "%errorlevel%"=="3010" goto reboot
if "%errorlevel%"=="1641" goto reboot
if errorlevel 1 exit /b 1
call :refreshPath
exit /b 0

:refreshPath
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:reboot
echo Установка требует перезагрузки Windows. После неё снова откройте INSTALL-WINDOWS.cmd.
exit /b 1

:missingWinget
echo Windows Package Manager не найден. Установите «Установщик приложений» Microsoft и снова откройте этот файл.
start "" "https://apps.microsoft.com/detail/9nblggh4nns1"
goto failed

:failed
echo Установка или запуск не завершены. Причина указана выше. После исправления снова откройте INSTALL-WINDOWS.cmd.
pause
exit /b 1
