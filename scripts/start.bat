@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0.."
set "ROOT=%CD%"
set "PYEXE=%ROOT%\venv\Scripts\python.exe"
title Nebula server startup

if not exist "%ROOT%\src\run.py" (
    echo ERROR: src\run.py was not found.
    echo Start this script from the Nebula project scripts directory.
    goto :fail_pause
)

echo.
echo ================================================================
echo   NEBULA - development server startup
echo ================================================================
echo.

echo [1/6] Checking .env ...
if not exist "%ROOT%\.env" (
    if exist "%ROOT%\.env.example" (
        echo       Creating .env from .env.example ...
        copy /Y "%ROOT%\.env.example" "%ROOT%\.env" >nul
        if errorlevel 1 (
            echo       ERROR: failed to copy .env.example
            goto :fail_pause
        )
        echo       Done. Edit .env if needed ^(SECRET_KEY, DB_PASSWORD^).
        echo       Make sure MySQL is running; database schema: infra\db\init.sql
    ) else (
        echo       ERROR: neither .env nor .env.example was found.
        goto :fail_pause
    )
) else (
    echo       .env found.
)
echo.

echo [2/6] Checking Python virtual environment ...
set "VENV_NEW=0"
if not exist "%PYEXE%" (
    echo       Creating venv ...
    py -3 -m venv "%ROOT%\venv" 2>nul
    if not exist "%PYEXE%" py -m venv "%ROOT%\venv" 2>nul
    if not exist "%PYEXE%" python -m venv "%ROOT%\venv" 2>nul
    if not exist "%PYEXE%" (
        echo       ERROR: failed to create venv.
        echo       Install Python 3 from python.org and run start.bat again.
        goto :fail_pause
    )
    set "VENV_NEW=1"
    echo       venv created.
) else (
    echo       venv already exists.
)

set "VIRTUAL_ENV=%ROOT%\venv"
set "PATH=%ROOT%\venv\Scripts;%PATH%"
if "!VENV_NEW!"=="1" (
    echo       Upgrading pip ...
    "%PYEXE%" -m pip install -q -U pip
    if errorlevel 1 echo       WARNING: failed to upgrade pip; continuing.
)
echo.

echo [3/6] Checking dependencies ...
set "DEPS_HASH_FILE=%ROOT%\venv\.deps.sha256"
set "CUR_HASH="
if exist "%ROOT%\pyproject.toml" (
    for /f "skip=1 tokens=*" %%H in ('certutil -hashfile "%ROOT%\pyproject.toml" SHA256 2^>nul') do (
        if not defined CUR_HASH set "CUR_HASH=%%H"
    )
)
if defined CUR_HASH set "CUR_HASH=!CUR_HASH: =!"

set "OLD_HASH="
if exist "%DEPS_HASH_FILE%" set /p OLD_HASH=<"%DEPS_HASH_FILE%"

set "DEPS_SAME=0"
if defined CUR_HASH if /I "!CUR_HASH!"=="!OLD_HASH!" set "DEPS_SAME=1"

if "!DEPS_SAME!"=="1" (
    echo       Dependencies are up to date.
) else (
    echo       Installing or updating dependencies ...
    "%PYEXE%" -m pip cache purge >nul 2>&1
    "%PYEXE%" -m pip install -q --no-cache-dir "%ROOT%"
    if errorlevel 1 (
        echo       Retrying pip install with detailed output ...
        "%PYEXE%" -m pip install --no-cache-dir "%ROOT%"
        if errorlevel 1 (
            echo       ERROR: pip install failed.
            goto :fail_pause
        )
    )
    if defined CUR_HASH (
        >"%DEPS_HASH_FILE%" echo !CUR_HASH!
    )
    echo       Dependencies installed or updated.
)
echo.

echo [4/6] Checking port 5000 ...
set "PORT_BUSY=0"
netstat -ano | findstr /r /c:":5000 .*LISTENING" >nul
if not errorlevel 1 (
    set "PORT_BUSY=1"
    echo       WARNING: port 5000 is already in use. The server may not start.
    echo       Processes on port 5000:
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5000 .*LISTENING"') do (
        echo         PID %%P  ^(stop with: taskkill /PID %%P /F^)
    )
) else (
    echo       Port 5000 is free.
)
echo.

echo [5/6] Checking logs and media_files directories ...
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%ROOT%\media_files" mkdir "%ROOT%\media_files"
echo       Done.
echo.

echo [6/6] Starting server ...
echo   Static files: static\ ^(HTML, CSS, JS^)
echo   URL: http://127.0.0.1:5000
echo   Stop: Ctrl+C
echo.

if "%PORT_BUSY%"=="0" (
    start "" "http://127.0.0.1:5000"
)

pushd "%ROOT%"
"%PYEXE%" src\run.py
set "EXITCODE=%ERRORLEVEL%"
popd

if not "%EXITCODE%"=="0" (
    echo.
    echo Server exited with code %EXITCODE%.
    pause
)
exit /b %EXITCODE%

:fail_pause
echo.
pause
exit /b 1
