@echo off
REM ── Emerald DevTools — start Tauri with MSVC + WebView2 debug port ──
REM Sources vcvars64.bat so cargo finds link.exe, then runs npm run tauri:dev.

setlocal
set "BUILD_TOOLS=C:\BuildTools"

if not exist "%BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat" (
    echo ERROR: vcvars64.bat not found at %BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat
    echo        Adjust BUILD_TOOLS at the top of this script.
    exit /b 1
)

REM Make sure cargo is on PATH even in a fresh shell.
set "PATH=%USERPROFILE%\.cargo\bin;%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"

call "%BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
    echo ERROR: vcvars64.bat failed
    exit /b 1
)

set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*"
echo WebView2 args: %WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS%
echo.

REM App repo location. Default is the checkout this script lives in
REM (tools\mcp\ two levels below its root); override EMERALD_APP_DIR
REM to build another one.
if not defined EMERALD_APP_DIR set "EMERALD_APP_DIR=%~dp0..\.."

if not exist "%EMERALD_APP_DIR%\package.json" (
    echo ERROR: Emerald-App not found at %EMERALD_APP_DIR%
    echo        Override with: set "EMERALD_APP_DIR=C:\path\to\Emerald-App"
    exit /b 1
)
cd /d "%EMERALD_APP_DIR%"

call npm run tauri:dev
endlocal