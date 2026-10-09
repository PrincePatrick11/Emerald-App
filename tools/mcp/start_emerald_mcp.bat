@echo off
REM ── Emerald DevTools — start Tauri in an isolated MCP instance ────────
REM Every per-instance value arrives in the environment, set by launcher.py
REM from instance.py, so several worktrees can run at once:
REM
REM   EMERALD_MCP_SLOT          instance number (0 = the main checkout)
REM   EMERALD_APP_DIR           app checkout to build
REM   EMERALD_TAURI_CONFIG      generated overlay: identifier, ports, window
REM   EMERALD_MCP_APP_DATA      %APPDATA%\<identifier>, where vaults.json lives
REM   EMERALD_WEBVIEW2_ARGS     debug port and the anti-throttling flags
REM   EMERALD_SEED_TARGET_FROM  Cargo target dir to warm-start this one from
REM   CARGO_TARGET_DIR          this instance's build directory
REM
REM Run by hand with none of them set, it reproduces slot 0 exactly: port
REM 9223, the checked-in tauri.mcp.conf.json, an on-screen window.

setlocal
if not defined EMERALD_BUILD_TOOLS set "EMERALD_BUILD_TOOLS=C:\BuildTools"

if not exist "%EMERALD_BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat" (
    echo ERROR: vcvars64.bat not found at %EMERALD_BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat
    echo        Set EMERALD_BUILD_TOOLS to your Build Tools installation.
    exit /b 1
)

REM Make sure cargo is on PATH even in a fresh shell.
set "PATH=%USERPROFILE%\.cargo\bin;%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"

call "%EMERALD_BUILD_TOOLS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
    echo ERROR: vcvars64.bat failed
    exit /b 1
)

REM The fallback is slot 0's own command line. --disable-features replaces
REM wry's defaults rather than merging with them, which is why the three
REM ms* features are repeated here; CalculateNativeWinOcclusion is what keeps
REM the off-screen window compositing so screenshots are not stale frames.
if not defined EMERALD_WEBVIEW2_ARGS set "EMERALD_WEBVIEW2_ARGS=--remote-debugging-port=9223 --remote-allow-origins=* --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=%EMERALD_WEBVIEW2_ARGS%"

REM App repo location. Default is the checkout this script lives in
REM (tools\mcp\ two levels below its root); override EMERALD_APP_DIR
REM to build another one.
if not defined EMERALD_APP_DIR set "EMERALD_APP_DIR=%~dp0..\.."
if not defined EMERALD_TAURI_CONFIG set "EMERALD_TAURI_CONFIG=%~dp0tauri.mcp.conf.json"
if not defined EMERALD_MCP_SLOT set "EMERALD_MCP_SLOT=0 (manual)"

if not exist "%EMERALD_APP_DIR%\package.json" goto :no_app
if not exist "%EMERALD_APP_DIR%\src-tauri\tauri.conf.json" goto :no_app

echo Slot:          %EMERALD_MCP_SLOT%
echo App dir:       %EMERALD_APP_DIR%
echo Tauri config:  %EMERALD_TAURI_CONFIG%
echo App data:      %EMERALD_MCP_APP_DATA%
echo WebView2 args: %WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS%
echo.

cd /d "%EMERALD_APP_DIR%"

REM A fresh git worktree has no usable node_modules — `git worktree add` does
REM not copy it — so nothing below would run without this.
if not exist "node_modules\.bin\tauri.cmd" (
    echo node_modules is missing or incomplete in %CD% - running npm install ...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed
        exit /b 1
    )
)

REM Give a brand-new instance a vault with test data in it. Skips instances
REM that already have a vaults.json, so an instance you have been working in
REM is never touched. Failure here is not fatal: the app then simply starts
REM into its normal first-run vault setup.
set "EMERALD_MCP_SEED_ARGS="
if /i "%EMERALD_MCP_SEED%"=="force" set "EMERALD_MCP_SEED_ARGS=--force"
if defined EMERALD_MCP_APP_DATA (
    echo Provisioning seed vault ...
    call node "%~dp0seed\provision.mjs" --checkout "%EMERALD_APP_DIR%" --app-data "%EMERALD_MCP_APP_DATA%" %EMERALD_MCP_SEED_ARGS%
    if errorlevel 1 echo WARNING: seed provisioning failed - the app will start with its own vault setup
    echo.
)

REM Reclaim build directories of slots whose worktree is gone, and of ones
REM nobody has used in a while. Running instances and slot 0 are never
REM touched. Done here rather than in the server because deleting several GB
REM takes long enough to stall a tool call.
if defined EMERALD_MCP_PYTHON (
    echo Stopping idle instances and pruning unused build directories ...
    call "%EMERALD_MCP_PYTHON%" "%EMERALD_MCP_DIR%\instance.py" --reap
    call "%EMERALD_MCP_PYTHON%" "%EMERALD_MCP_DIR%\instance.py" --prune
    if errorlevel 1 echo WARNING: prune failed - continuing
    echo.
)

REM Dev and MCP builds both produce target\debug\emerald.exe by default; if
REM another instance is running, Cargo can't overwrite that exe on Windows and
REM the build fails. Every instance therefore gets its own target dir. They
REM live outside both repos: nested inside src-tauri one would look like a
REM source change to `tauri dev`'s watcher (infinite rebuild loop), and
REM anywhere in Emerald-App it would leave several GB of devtools build
REM artifacts in the official repo.
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%LOCALAPPDATA%\emerald-mcp-target"

REM Copy an existing warm target dir into a new instance rather than paying
REM for a 5-15 minute cold build. /E never deletes, and the default /COPY:DAT
REM preserves timestamps — Cargo compares mtimes, so a copy without them would
REM rebuild everything and defeat the point. Robocopy's failure threshold is 8;
REM 1-7 mean files were copied or skipped, which is success. A locked
REM emerald.exe in the source is one of those skips and is harmless.
if not defined EMERALD_SEED_TARGET_FROM goto :build
if exist "%CARGO_TARGET_DIR%\debug" goto :build
if not exist "%EMERALD_SEED_TARGET_FROM%\debug" goto :build
echo Seeding Cargo target dir from %EMERALD_SEED_TARGET_FROM% ...
robocopy "%EMERALD_SEED_TARGET_FROM%" "%CARGO_TARGET_DIR%" /E /NFL /NDL /NJH /NJS /NP /MT:8 >nul
if errorlevel 8 echo WARNING: seed copy failed - falling back to a cold build
echo.

:build
REM A target dir that was copied from another slot or moved to another drive
REM still carries absolute paths from where it was built; tauri's build
REM scripts read their permission files from there. Rewriting them is cheap
REM and a no-op when the dir has not moved.
if defined EMERALD_MCP_PYTHON (
    call "%EMERALD_MCP_PYTHON%" "%EMERALD_MCP_DIR%\instance.py" --relocate-target "%CARGO_TARGET_DIR%" >nul
    if errorlevel 1 echo WARNING: could not relocate %CARGO_TARGET_DIR% - a moved build dir may fail to build
)
call npx tauri dev --config "%EMERALD_TAURI_CONFIG%"
endlocal
goto :eof

:no_app
echo ERROR: Emerald-App not found at %EMERALD_APP_DIR%
echo        Override with: set "EMERALD_APP_DIR=C:\path\to\Emerald-App"
exit /b 1
