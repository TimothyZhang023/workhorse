@echo off
echo Stopping services...

:: Stop Node Server (Port 7866)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7866 ^| findstr LISTENING') do (
    echo Killing process on port 7866 (PID: %%a)...
    taskkill /F /PID %%a
)

echo Services stopped.
pause
