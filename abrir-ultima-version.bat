@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  Gigi - compilar y abrir la ultima version
echo  ------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq Gigi.exe" 2>nul | "%SystemRoot%\System32\find.exe" /I "Gigi.exe" >nul
if not errorlevel 1 (
  echo Gigi ya esta abierto.
  echo Cierralo y vuelve a ejecutar este archivo para compilar la ultima version.
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder" (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo Compilando la ultima version. Esto puede tardar unos minutos...
echo.
call npm run dist:win
if errorlevel 1 goto :fail

if not exist "dist\win-unpacked\Gigi.exe" (
  echo [ERROR] No se genero dist\win-unpacked\Gigi.exe.
  pause
  exit /b 1
)

echo.
echo Abriendo Gigi con la ultima compilacion...
start "" "%CD%\dist\win-unpacked\Gigi.exe"
exit /b 0

:fail
echo.
echo [ERROR] La compilacion fallo. Revisa los mensajes de arriba.
pause
exit /b 1
