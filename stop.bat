@echo off
echo Stopping active node runtime processes...
taskkill /F /IM node.exe
echo Platform stopped successfully.
pause
