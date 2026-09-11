@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ===============================
echo  Trade Station - Portable build
echo ===============================
echo.
echo Output when finished:
echo   dist\portable\Trade-Station-Portable.exe
echo   dist\portable\win-unpacked\Trade Station.exe
echo.

call npm run build:portable
if errorlevel 1 (
  echo.
  echo ERROR: Portable build failed.
  pause
  exit /b 1
)

echo.
echo Done.
if exist "dist\portable\Trade-Station-Portable.exe" (
  echo Portable EXE: dist\portable\Trade-Station-Portable.exe
) else (
  echo WARNING: Trade-Station-Portable.exe not found — check dist\portable\
)
echo.
pause
exit /b 0
