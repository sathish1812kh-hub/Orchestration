@echo off
echo ============================================
echo   Platform v2.0 MCP Server - Stopping...
echo ============================================
echo.

set PORT=5000
echo Searching for processes listening on port %PORT%...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo Stopping process with PID %%a...
    taskkill /F /PID %%a
    set FOUND=1
)

if %FOUND%==0 (
    echo No active processes found running on port %PORT%.
) else (
    echo Platform stopped successfully.
)

pause
