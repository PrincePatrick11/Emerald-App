@echo off
REM ── Emerald DevTools — start Tauri as the MCP instance ────────────────
REM Started by launcher.py, which sets these from instance.py:
REM
REM   EMERALD_APP_DIR           app checkout to build
REM   EMERALD_TAURI_CONFIG      generated overlay: identifier, ports, window
REM   EMERALD_MCP_APP_DATA      %APPDATA%\<identifier>, where vaults.json lives
REM   EMERALD_WEBVIEW2_ARGS     debug port and the anti-throttling flags
REM   CARGO_TARGET_DIR          the instance's build directory
REM
REM Run by hand with none of them set, it uses the same defaults: port 9223,
REM the checked-in tauri.mcp.conf.json, an on-screen window, and no test data.

setlocal

REM Make sure cargo is on PATH even in a fresh shell.
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

REM The MSVC environment: from EMERALD_BUILD_TOOLS, or wherever the Visual
REM Studio installer says the newest Build Tools are. Without it Cargo still
REM looks for MSVC itself, so a missing one is a warning. No ( ) blocks
REM around paths here: one under "Program Files (x86)" would end the block.
if defined EMERALD_BUILD_TOOLS goto :have_tools
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :have_tools
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "EMERALD_BUILD_TOOLS=%%i"
:have_tools
set "VCVARS=%EMERALD_BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat"
if not defined EMERALD_BUILD_TOOLS goto :no_vcvars
if not exist "%VCVARS%" goto :no_vcvars
call "%VCVARS%" >nul
if errorlevel 1 goto :vcvars_failed
goto :tools_ready
:no_vcvars
echo WARNING: no vcvars64.bat found ("%VCVARS%") - Cargo looks for MSVC itself.
echo          Set EMERALD_BUILD_TOOLS to your Build Tools installation if the build fails.
:tools_ready

REM --disable-features replaces wry's defaults rather than merging with them,
REM which is why the three ms* features are repeated here;
REM CalculateNativeWinOcclusion is what keeps the off-screen window
REM compositing so screenshots are not stale frames.
if not defined EMERALD_WEBVIEW2_ARGS set "EMERALD_WEBVIEW2_ARGS=--remote-debugging-port=9223 --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=%EMERALD_WEBVIEW2_ARGS%"

REM App repo location. Default is the checkout this script lives in
REM (tools\mcp\ two levels below its root); override EMERALD_APP_DIR
REM to build another one.
if not defined EMERALD_APP_DIR set "EMERALD_APP_DIR=%~dp0..\.."
if not defined EMERALD_TAURI_CONFIG set "EMERALD_TAURI_CONFIG=%~dp0tauri.mcp.conf.json"

if not exist "%EMERALD_APP_DIR%\package.json" goto :no_app
if not exist "%EMERALD_APP_DIR%\src-tauri\tauri.conf.json" goto :no_app

echo App dir:       %EMERALD_APP_DIR%
echo Tauri config:  %EMERALD_TAURI_CONFIG%
echo WebView2 args: %WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS%
echo.

cd /d "%EMERALD_APP_DIR%"

REM A fresh git worktree has no usable node_modules — `git worktree add` does
REM not copy it — so nothing below would run without this.
if not exist "node_modules\.bin\tauri.cmd" (
    echo node_modules is missing or incomplete in "%CD%" - running npm install ...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed
        exit /b 1
    )
)

REM Give a brand-new instance a vault with test data in it. Skips an instance
REM that already has a vaults.json, so one you have been working in is never
REM touched. Failure here is not fatal: the app then simply starts into its
REM normal first-run vault picker.
set "EMERALD_MCP_SEED_ARGS="
if /i "%EMERALD_MCP_SEED%"=="force" set "EMERALD_MCP_SEED_ARGS=--force"
if defined EMERALD_MCP_APP_DATA (
    echo Provisioning seed vault ...
    call node "%~dp0seed\provision.mjs" --checkout "%EMERALD_APP_DIR%" --app-data "%EMERALD_MCP_APP_DATA%" %EMERALD_MCP_SEED_ARGS%
    if errorlevel 1 echo WARNING: seed provisioning failed - the app will start with its vault picker
    echo.
)

REM The dev build and the MCP instance both produce target\debug\emerald.exe
REM by default; while one is running, Cargo cannot overwrite that exe on
REM Windows and the other's build fails. The MCP instance therefore gets its
REM own target dir, outside the repository: nested inside src-tauri it would
REM look like a source change to `tauri dev`'s watcher (infinite rebuild
REM loop), and anywhere else in the checkout it would leave several GB of
REM build artifacts in it.
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%LOCALAPPDATA%\emerald-mcp-target"

call npx tauri dev --config "%EMERALD_TAURI_CONFIG%"
endlocal
goto :eof

:no_app
echo ERROR: no Emerald checkout at "%EMERALD_APP_DIR%"
echo        Override with: set "EMERALD_APP_DIR=C:\path\to\Emerald-App"
exit /b 1

:vcvars_failed
echo ERROR: vcvars64.bat failed ("%VCVARS%")
exit /b 1
