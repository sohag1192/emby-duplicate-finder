@echo off
setlocal enabledelayedexpansion
title GitHub Auto Uploader & Release Publisher - emby-duplicate-finder

echo ===================================================
echo     Emby Duplicate Finder - GitHub Uploader
echo     Target: https://github.com/sohag1192/emby-duplicate-finder
echo ===================================================
echo.

:: Initialize git repository if not already initialized
if not exist .git (
    echo [*] Initializing Git repository...
    git init
    git branch -M main
)

:: Ensure origin remote is configured properly
git remote set-url origin https://github.com/sohag1192/emby-duplicate-finder.git 2>nul
if %ERRORLEVEL% neq 0 (
    git remote add origin https://github.com/sohag1192/emby-duplicate-finder.git
)

echo [1/5] Checking Git Status...
git status -s
echo.

:: Ask for commit message
set "commit_msg="
set /p commit_msg="Enter commit message (Press Enter for default): "
if "%commit_msg%"=="" (
    set commit_msg=Update Emby Duplicate Finder with upgraded UI, TV support, and direct deletion
)

:: Ask for release tag
echo.
echo ---------------------------------------------------
echo  [Optional] Auto-Release Tag
echo  Enter a version tag (e.g. v1.1.0 or v2.0.0) to
echo  automatically publish a GitHub Release with ZIP download!
echo  (Or press Enter to skip tagging and just push updates)
echo ---------------------------------------------------
set "release_tag="
set /p release_tag="Release Tag (e.g. v1.1.0 or Enter to skip): "

echo.
echo [2/5] Staging all files (git add .)...
git add .

echo.
echo [3/5] Committing changes...
git commit -m "%commit_msg%"

echo.
echo [4/5] Pushing to GitHub main branch...
git branch -M main
git push -u origin main

if %ERRORLEVEL% neq 0 (
    echo.
    echo Remote has newer commits. Pulling remote changes (git pull origin main --rebase)...
    git pull origin main --rebase
    echo Retrying push to GitHub...
    git push -u origin main
)

:: Push tag if specified
if not "%release_tag%"=="" (
    echo.
    echo [5/5] Creating and pushing release tag %release_tag%...
    git tag -fa %release_tag% -m "Release %release_tag%: %commit_msg%"
    git push origin %release_tag% --force
    if !ERRORLEVEL! equ 0 (
        echo.
        echo 🏷️ [TAG PUSHED] Tag %release_tag% successfully sent to GitHub!
        echo ⚡ GitHub Actions is now automatically building the ZIP package
        echo    and publishing the official release!
        echo 🔗 Release URL: https://github.com/sohag1192/emby-duplicate-finder/releases/tag/%release_tag%
    ) else (
        echo ⚠️ [TAG WARNING] Failed to push tag. Check network or credentials.
    )
) else (
    echo [5/5] Skipped release tagging. Pushed to main branch only.
)

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo  [SUCCESS] Successfully pushed to GitHub!
    echo  Repository: https://github.com/sohag1192/emby-duplicate-finder
    echo  Live Demo:  https://sohag1192.github.io/emby-duplicate-finder/
    if not "%release_tag%"=="" (
        echo  New Release: https://github.com/sohag1192/emby-duplicate-finder/releases/tag/%release_tag%
    )
    echo ===================================================
) else (
    echo.
    echo ===================================================
    echo  [NOTICE] Push encountered an issue.
    echo  - Check your internet connection or git login credentials.
    echo  - Repository: https://github.com/sohag1192/emby-duplicate-finder
    echo ===================================================
)

echo.
pause
