@echo off
echo ============================================
echo   Platform v2.0 MCP Server - Starting...
echo ============================================
echo.
cd /d "%~dp0"

:: Fallback configuration (will be overridden by .env if present)
set PORT=5000
set NGROK_AUTHTOKEN=3FmSq6dwe8L1UWnupRzRMUdXPpk_7faSY9Z1WUzD1YSPG8ymt
set NGROK_DOMAIN=quicksand-sadness-coral.ngrok-free.dev

:: Check if port is already in use, and clean it up automatically
echo Checking if port %PORT% is in use...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo Port %PORT% is in use by PID %%a. Stopping existing process...
    taskkill /F /PID %%a >nul 2>&1
)

:: Rebuild TypeScript to ensure latest changes are run
echo Building TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed! Please resolve compilation issues first.
    pause
    exit /b %ERRORLEVEL%
)

echo Starting Node production server...
node dist/index.js
pause
