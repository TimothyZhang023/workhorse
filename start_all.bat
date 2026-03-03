@echo off
echo Building Project...
call npm install
call npm run build

echo Starting Server...
npm start
pause
