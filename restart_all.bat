@echo off
echo Restarting services...

call stop_all.bat
timeout /t 2
start start_all.bat

echo Restart command issued.
