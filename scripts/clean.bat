@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0.."
set "NEBULA_CLEAN_ROOT=%CD%"
title Nebula cleanup

if not exist "%NEBULA_CLEAN_ROOT%\src\run.py" (
    echo ERROR: this is not the Nebula project root ^(src\run.py not found^).
    pause
    exit /b 1
)

:menu
cls
echo.
echo   ===============================================================
echo   NEBULA - project cleanup
echo   ===============================================================
echo.
echo   [1] Quick cleanup - caches only
echo       __pycache__, .mypy_cache, .ruff_cache
echo       No logs, media_files, or venv.
echo.
echo   [2] Full cleanup without venv
echo       Caches, build artifacts, logs, media_files, and root SQLite files.
echo       venv / .venv / env / ENV directories are preserved.
echo.
echo   [3] Full cleanup with venv
echo       Same as [2], plus venv / .venv / env / ENV removal.
echo       Then run scripts\start.bat to recreate the environment.
echo.
echo   [0] Exit
echo.
set "CHOICE="
set /p "CHOICE=   Enter 0, 1, 2 or 3 and press Enter: "
if errorlevel 1 exit /b 0
set "CHOICE=!CHOICE: =!"
if "!CHOICE!"=="" goto :menu
if "!CHOICE!"=="0" exit /b 0
if "!CHOICE!"=="1" goto :confirm_quick
if "!CHOICE!"=="2" goto :confirm_no_venv
if "!CHOICE!"=="3" goto :confirm_with_venv
echo Invalid choice.
timeout /t 2 /nobreak >nul 2>nul
goto :menu

:confirm_no_venv
set "CLEAN_MODE=full_no_venv"
echo.
echo   WARNING: caches, build artifacts, logs, media_files, and root SQLite files will be deleted.
echo   Virtual environments will be preserved.
goto :confirm_prompt

:confirm_with_venv
set "CLEAN_MODE=full"
echo.
echo   WARNING: caches, build artifacts, logs, media_files, and virtual environments will be deleted.
echo   After cleanup run scripts\start.bat to recreate the environment.
goto :confirm_prompt

:confirm_quick
set "CLEAN_MODE=quick"
echo.
echo   WARNING: only cache directories will be deleted.
echo   Logs, media_files, and virtual environments will be preserved.
goto :confirm_prompt

:confirm_prompt
set "CONFIRM="
set /p "CONFIRM=   Continue cleanup? Enter Y or N and press Enter: "
if errorlevel 1 (
    echo Cancelled.
    timeout /t 2 /nobreak >nul 2>nul
    goto :menu
)
set "CONFIRM=!CONFIRM: =!"
if /I not "!CONFIRM!"=="Y" (
    echo Cancelled.
    timeout /t 2 /nobreak >nul 2>nul
    goto :menu
)

call :run_clean "%CLEAN_MODE%"
echo.
pause
goto :menu

:should_skip
set "SP=%~1"
set "SN=%~nx1"
if /I "!SN!"=="venv" exit /b 1
if /I "!SN!"==".venv" exit /b 1
if /I "!SN!"=="env" exit /b 1
if /I "!SN!"=="ENV" exit /b 1
if /I "!SN!"==".git" exit /b 1
if /I "!SN!"=="node_modules" exit /b 1
if /I "!SN!"=="media_files" exit /b 1
if /I "!SN!"=="logs" exit /b 1
if not "!SP:\venv\=!"=="!SP!" exit /b 1
if not "!SP:\.venv\=!"=="!SP!" exit /b 1
if not "!SP:\env\=!"=="!SP!" exit /b 1
if not "!SP:\ENV\=!"=="!SP!" exit /b 1
if not "!SP:\.git\=!"=="!SP!" exit /b 1
if not "!SP:\node_modules\=!"=="!SP!" exit /b 1
exit /b 0

:run_clean
set "MODE=%~1"
set "CLEAN_QUICK=0"
set /a "DIRS_DEL=0"
set /a "FILES_DEL=0"

if /I "%MODE%"=="quick" set "CLEAN_QUICK=1"

if /I "%MODE%"=="quick" (
    call :scan_cache_dirs
    goto :done_run
)

if /I "%MODE%"=="full_no_venv" (
    call :scan_cache_dirs
    call :scan_loose_files
    call :remove_root_sqlite
    call :clear_logs_media
    call :remove_logs_media_trees
    goto :done_run
)

if /I "%MODE%"=="full" (
    call :scan_cache_dirs
    call :scan_loose_files
    call :remove_root_sqlite
    call :clear_logs_media
    call :remove_full_trees
    goto :done_run
)

echo Unknown cleanup mode: %MODE%
exit /b 1

:done_run
echo.
echo Done. Deleted folders: !DIRS_DEL!, files: !FILES_DEL!
exit /b 0

:clear_logs_media
for %%L in (logs media_files) do (
    set "LP=!NEBULA_CLEAN_ROOT!\%%L"
    if exist "!LP!" (
        del /f /q "!LP!\*.*" 2>nul
        for /d %%D in ("!LP!\*") do rd /s /q "%%D" 2>nul
        echo Cleared contents: !LP!
    )
)
exit /b 0

:remove_root_sqlite
pushd "!NEBULA_CLEAN_ROOT!" 2>nul
if errorlevel 1 exit /b 1
for %%P in (*.db *.sqlite *.sqlite3 *.db-wal *.db-shm *.sqlite-wal *.sqlite-shm) do (
    if exist "%%P" (
        del /f /q "%%P" 2>nul
        if not errorlevel 1 (
            set /a "FILES_DEL+=1"
            echo Deleted root SQLite file: !NEBULA_CLEAN_ROOT!\%%P
        )
    )
)
popd
exit /b 0

:remove_logs_media_trees
for %%T in (logs media_files) do (
    set "TP=!NEBULA_CLEAN_ROOT!\%%T"
    if exist "!TP!" (
        rd /s /q "!TP!" 2>nul
        if not errorlevel 1 (
            set /a "DIRS_DEL+=1"
            echo Deleted folder: !TP!
        )
    )
)
exit /b 0

:remove_full_trees
for %%T in (venv .venv env ENV logs media_files) do (
    set "TP=!NEBULA_CLEAN_ROOT!\%%T"
    if exist "!TP!" (
        rd /s /q "!TP!" 2>nul
        if not errorlevel 1 (
            set /a "DIRS_DEL+=1"
            echo Deleted folder: !TP!
        )
    )
)
exit /b 0

:scan_cache_dirs
pushd "%NEBULA_CLEAN_ROOT%" 2>nul
if errorlevel 1 exit /b 1
for /f "delims=" %%D in ('dir /s /b /ad 2^>nul ^| findstr /v /i /c:"\\venv\\" /c:"\\.venv\\" /c:"\\env\\" /c:"\\ENV\\" /c:"\\.git\\" /c:"\\node_modules\\" /c:"\\media_files\\" /c:"\\logs\\"') do (
    call :process_cache_dir "%%D"
)
popd
exit /b 0

:process_cache_dir
set "DP=%~1"
call :should_skip "%DP%"
if errorlevel 1 exit /b 0
set "NX=%~nx1"

if "!CLEAN_QUICK!"=="1" (
    for %%X in (__pycache__ .mypy_cache .ruff_cache) do (
        if /I "%NX%"=="%%X" goto :cache_dir_hit
    )
    exit /b 0
)

for %%X in (__pycache__ .mypy_cache .ruff_cache .tox .nox .vite .eggs .benchmarks __pypackages__ node_modules dist build .next .nuxt .turbo .parcel-cache) do (
    if /I "%NX%"=="%%X" goto :cache_dir_hit
)
echo %NX%|findstr /i /r /c:"\.egg-info$" /c:"egg-info$" >nul
if not errorlevel 1 goto :cache_dir_hit
exit /b 0

:cache_dir_hit
rd /s /q "%DP%" 2>nul
if not errorlevel 1 (
    set /a "DIRS_DEL+=1"
    echo Deleted folder: %DP%
)
exit /b 0

:scan_loose_files
pushd "%NEBULA_CLEAN_ROOT%" 2>nul
if errorlevel 1 exit /b 1
for /f "delims=" %%F in ('dir /s /b /a-d 2^>nul ^| findstr /v /i /c:"\\venv\\" /c:"\\.venv\\" /c:"\\env\\" /c:"\\ENV\\" /c:"\\.git\\" /c:"\\node_modules\\" /c:"\\media_files\\" /c:"\\logs\\"') do (
    call :process_loose_file "%%F"
)
popd
exit /b 0

:process_loose_file
set "FP=%~1"
call :should_skip "%FP%"
if errorlevel 1 exit /b 0
set "NX=%~nx1"

for %%X in (.dmypy.json .eslintcache .DS_Store Thumbs.db desktop.ini npm-debug.log yarn-debug.log yarn-error.log pnpm-debug.log) do (
    if /I "%NX%"=="%%X" goto :loose_hit
)

set "EXT=%~x1"
if /I "%EXT%"==".log" goto :loose_hit
if /I "%EXT%"==".pyc" goto :loose_hit
if /I "%EXT%"==".pyo" goto :loose_hit
if /I "%EXT%"==".pyd" goto :loose_hit
echo %NX%|findstr /i /r /c:"^npm-debug\.log" /c:"^yarn-debug\.log" /c:"^yarn-error\.log" /c:"^pnpm-debug\.log" >nul
if not errorlevel 1 goto :loose_hit
exit /b 0

:loose_hit
del /f /q "%FP%" 2>nul
if not errorlevel 1 (
    set /a "FILES_DEL+=1"
    echo Deleted file: %FP%
)
exit /b 0
