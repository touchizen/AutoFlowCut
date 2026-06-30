@echo off
setlocal

set PROJDIR=%~dp0..
set MAPPING=%PROJDIR%\release\__appx-x64\mapping.txt

cd /d "%PROJDIR%"

REM Get version from package.json
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set OUTPUT=%PROJDIR%\release\AutoFlowCut_%VERSION%.appx

echo [1/2] Running electron-builder to generate mapping.txt...
call npx electron-builder --win appx 2>nul

echo [2/2] Packing APPX v%VERSION% with makeappx...
REM /l skips localized/scaled-resource semantic validation — required now that
REM electron-builder emits resources.pri + scale-* resource packages (matches
REM app-builder-lib's own makeappx invocation when scaled assets are present).
makeappx.exe pack /l /f "%MAPPING%" /p "%OUTPUT%" /o
if errorlevel 1 exit /b 1

echo === APPX build succeeded: %OUTPUT% ===
exit /b 0
