@echo off
rem Local development helper (not used by Docker).
cd /d "%~dp0"
if "%DATABASE_URL%"=="" set DATABASE_URL=postgresql://ec:ec_test@127.0.0.1:55432/ec_dev
npx tsx watch src/server.ts
