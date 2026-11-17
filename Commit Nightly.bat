@echo off
cd /d "%~dp0"

echo =================================
echo       FF7 ULTIMA - COMMIT
echo =================================
echo.

git add -A
if errorlevel 1 goto error

git diff --cached --quiet
if not errorlevel 1 (
    echo No changes to commit.
    pause
    exit /b 0
)

git commit -m "Update nightly"
if errorlevel 1 goto error

echo.
echo Successfully committed all changes!
pause
exit /b 0

:error
echo.
echo ERROR: Something went wrong.
pause
exit /b 1
