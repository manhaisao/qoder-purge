@echo off
rem Purge(Qoder) MCP launcher.
rem Qoder may or may not inject QODER_NODE_RUNTIME, so resolve a JS runtime here.
setlocal enableextensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "RT="
set "ELECTRON_RUN_AS_NODE="

if defined QODER_NODE_RUNTIME if exist "%QODER_NODE_RUNTIME%" set "RT=%QODER_NODE_RUNTIME%"
if not defined RT if exist "%ProgramFiles%\nodejs\node.exe" set "RT=%ProgramFiles%\nodejs\node.exe"
if not defined RT if exist "%ProgramW6432%\nodejs\node.exe" set "RT=%ProgramW6432%\nodejs\node.exe"
if not defined RT if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "RT=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined RT for /f "delims=" %%P in ('where node.exe 2^>nul') do if not defined RT set "RT=%%P"

if not defined RT if exist "%LOCALAPPDATA%\Programs\Qoder CN\Qoder CN.exe" (
  set "RT=%LOCALAPPDATA%\Programs\Qoder CN\Qoder CN.exe"
  set "ELECTRON_RUN_AS_NODE=1"
)
if not defined RT if exist "%ProgramFiles%\Qoder CN\Qoder CN.exe" (
  set "RT=%ProgramFiles%\Qoder CN\Qoder CN.exe"
  set "ELECTRON_RUN_AS_NODE=1"
)

if not defined RT goto noruntime
"%RT%" "%ROOT%\bin\purge-mcp.mjs"
exit /b %errorlevel%

:noruntime
>&2 echo purge-qoder: no JavaScript runtime found
exit /b 127
