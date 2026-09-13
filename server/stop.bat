@echo off
title Stop SoundCloud Discord RPC
echo Stopping SoundCloud Discord RPC Companion Server...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3020" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo SoundCloud Discord RPC server stopped.
ping -n 3 127.0.0.1 >nul
