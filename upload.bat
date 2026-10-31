@echo off
setlocal enabledelayedexpansion
title GitHub Auto Uploader - emby-duplicate-finder

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

echo [1/4] Checking Git Status...
git status -s
echo.

:: Ask for commit message
set "commit_msg="
set /p commit_msg="Enter commit message (Press Enter for default message): "
if "%commit_msg%"=="" (
    set commit_msg=Update Emby Duplicate Finder with upgraded UI, TV support, and direct deletion
)

echo.
echo [2/4] Staging all files (git add .)...
git add .

echo.
echo [3/4] Committing changes...
git commit -m "%commit_msg%"

echo.
echo [4/4] Pushing to GitHub main branch...
git branch -M main
git push -u origin main

if %ERRORLEVEL% neq 0 (
    echo.
    echo Remote has newer commits. Pulling remote changes (git pull origin main --rebase)...
    git pull origin main --rebase
    echo Retrying push to GitHub...
    git push -u origin main
)

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo  [SUCCESS] Successfully pushed to GitHub!
    echo  Repository: https://github.com/sohag1192/emby-duplicate-finder
    echo  Live Demo:  https://sohag1192.github.io/emby-duplicate-finder/
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
