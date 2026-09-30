@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem ============================================================
rem  Email System 一键停止脚本
rem  功能：1) 停止 Spring Boot 应用  2) 停止 MySQL 服务
rem  与 start.bat 配套使用
rem ============================================================

rem ---------- 可配置项（需与 start.bat 保持一致） ----------
set "MYSQL_SERVICE=MySQL80.1"
set "APP_PORT=8000"
set "BASE_DIR=%~dp0"
set "PID_FILE=%BASE_DIR%.app.pid"
set "LOG_DIR=%BASE_DIR%logs"
rem --------------------------------------------------------

title Email System Stopper

echo ============================================================
echo   Email System 停止脚本
echo ============================================================
echo.

rem ---------- 1. 停止 Spring Boot 应用 ----------
echo [1/2] 停止 Spring Boot 应用 ...

if not exist "%BASE_DIR%stopprocs.ps1" (
    echo   [错误] 未找到辅助脚本 "%BASE_DIR%stopprocs.ps1"
    goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE_DIR%stopprocs.ps1" -AppPort %APP_PORT%
if errorlevel 1 (
    echo   [警告] 进程终止过程出现问题，请检查上方输出。
)

rem --- 确认端口是否释放 ---
ping -n 3 127.0.0.1 >nul
netstat -ano | findstr ":%APP_PORT% " | findstr /i "LISTENING" >nul
if not errorlevel 1 (
    echo   [警告] 端口 %APP_PORT% 仍处于监听状态，请手动检查。
) else (
    echo   [完成] 应用已停止，端口已释放。
)
echo.

rem ---------- 2. 停止 MySQL 服务 ----------
echo [2/2] 停止 MySQL 服务 [%MYSQL_SERVICE%] ...

sc query "%MYSQL_SERVICE%" >nul 2>&1
if errorlevel 1 (
    echo   [错误] 未找到服务 "%MYSQL_SERVICE%"，请检查服务名。
    goto :fail
)

sc query "%MYSQL_SERVICE%" | findstr /i "RUNNING" >nul
if errorlevel 1 (
    echo   [跳过] 服务未在运行。
) else (
    echo   [停止] 正在停止服务，可能需要管理员权限 ...
    net stop "%MYSQL_SERVICE%" >nul 2>&1
    if errorlevel 1 (
        echo   [错误] 停止失败。请右键以【管理员身份运行】本脚本。
        goto :fail
    )
    echo   [成功] 服务已停止。
)

echo.
echo ============================================================
echo   处理完毕。
echo ============================================================
pause
goto :end

:fail
echo.
echo 停止流程中断，请根据上方提示排查后重试。
pause
exit /b 1

:end
endlocal
