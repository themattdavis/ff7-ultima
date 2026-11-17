@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo       FF7 ULTIMA - NIGHTLY BUILD
echo ==========================================
echo.

echo Checking branch...
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not "%BRANCH%"=="nightly-testing" goto wrongbranch

echo Checking GitHub CLI...
where gh >nul 2>&1
if errorlevel 1 goto nogh

gh auth status
if errorlevel 1 goto noauth

echo.
echo Staging all changes...
git add -A
if errorlevel 1 goto error

git diff --cached --quiet
if errorlevel 2 goto error
if errorlevel 1 goto commit
goto push

:commit
echo.
echo Committing changes...
git commit -m "Update nightly"
if errorlevel 1 goto error

:push
echo.
echo Pushing nightly-testing to GitHub...
git push -u origin nightly-testing
if errorlevel 1 goto error

echo.
echo Triggering GitHub Actions nightly workflow...
gh workflow run nightly.yml --repo themattdavis/ff7-ultima --ref nightly-testing
if errorlevel 1 goto error

echo.
echo SUCCESS: Nightly workflow has been triggered.
echo https://github.com/themattdavis/ff7-ultima/actions
pause
exit /b 0

:wrongbranch
echo ERROR: You are not on the nightly-testing branch.
goto error

:nogh
echo ERROR: GitHub CLI is not installed or not on PATH.
goto error

:noauth
echo ERROR: GitHub CLI is not authenticated. Run gh auth login.
goto error

:error
echo.
echo ERROR: The nightly process did not complete.
pause
exit /b 1