@echo off
rem Local development helper (not used by Docker).
cd /d "%~dp0"
if "%API_PROXY%"=="" set API_PROXY=http://127.0.0.1:3001
npx vite --port 5173 --strictPort
