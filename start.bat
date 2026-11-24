@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)
if not exist data\seeded.flag (
  echo Building the 1000-plant database. This needs internet and your ANTHROPIC_API_KEY in .env.
  echo It takes about 30-60 minutes and uses API credits. You can stop it and run again to resume.
  call npm run seed
  if errorlevel 1 ( echo Seeding failed. Check the message above. & pause & exit /b 1 )
)
start "" http://localhost:3000
echo Starting HerbWise AI. Keep this window open. Press Ctrl+C to stop.
node server.js
pause
