@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem ============================================================
rem  Email System 一键启动脚本（后台运行版）
rem  功能：1) 确保 MySQL 服务运行
rem        2) 构建并启动应用（后台常驻，可安全关闭本窗口）
rem  停止：请使用同目录下的 stop.bat
rem ============================================================

rem ---------- 可配置项 ----------
set "MYSQL_SERVICE=MySQL80.1"
set "APP_PORT=8000"
set "WAIT_MYSQL=3"
set "WAIT_START=25"
rem --------------------------------------------------------

rem 项目根目录 = 本脚本所在目录
set "BASE_DIR=%~dp0"
set "PROJECT_DIR=%BASE_DIR%email-system-java"
set "JAR_FILE=%PROJECT_DIR%\target\email-system-1.0.0.jar"
set "LOG_DIR=%BASE_DIR%logs"
set "LOG_FILE=%LOG_DIR%\app.log"
set "PID_FILE=%BASE_DIR%.app.pid"

title Email System Launcher

echo ============================================================
echo   Email System 启动脚本（后台运行）
echo ============================================================
echo.

rem ---------- 1. 检查 MySQL 服务状态 ----------
echo [1/4] 检查 MySQL 服务 [%MYSQL_SERVICE%] ...

sc query "%MYSQL_SERVICE%" >nul 2>&1
if errorlevel 1 (
    echo   [错误] 未找到服务 "%MYSQL_SERVICE%"
    echo          可用以下命令查看本机 MySQL 服务名：
    echo          sc query type= service state= all ^| findstr /i mysql
    goto :fail
)

sc query "%MYSQL_SERVICE%" | findstr /i "RUNNING" >nul
if not errorlevel 1 (
    echo   [跳过] 服务已在运行中
) else (
    echo   [启动] 正在启动服务，可能需要管理员权限 ...
    net start "%MYSQL_SERVICE%" >nul 2>&1
    if errorlevel 1 (
        echo   [错误] 启动失败。请右键以【管理员身份运行】本脚本。
        goto :fail
    )
    echo   [成功] 服务已启动，等待 %WAIT_MYSQL% 秒就绪 ...
    timeout /t %WAIT_MYSQL% /nobreak >nul
)

rem ---------- 2. 检查端口占用 ----------
echo [2/4] 检查应用端口 %APP_PORT% ...
set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%APP_PORT% " ^| findstr /i "LISTENING"') do (
    if not "%%p"=="0" if not "%%p"=="" set "PORT_PID=%%p"
)
if defined PORT_PID (
    echo   [错误] 端口 %APP_PORT% 已被 PID !PORT_PID! 占用，应用无法启动。
    echo          请先运行 stop.bat 停止旧实例，或手动执行：
    echo          taskkill /F /T /PID !PORT_PID!
    goto :fail
)
echo   [通过] 端口空闲

rem ---------- 3. 构建应用（如 jar 不存在或源码更新） ----------
echo [3/4] 检查/构建应用 ...

if not exist "%PROJECT_DIR%\pom.xml" (
    echo   [错误] 未找到项目：%PROJECT_DIR%\pom.xml
    goto :fail
)

set "NEED_BUILD=0"
if not exist "%JAR_FILE%" (
    set "NEED_BUILD=1"
    echo   [信息] 未发现 jar 包，需要构建。
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE_DIR%checkbuild.ps1"
    if errorlevel 1 (
        echo   [跳过] jar 包已是最新。
    ) else (
        set "NEED_BUILD=1"
        echo   [信息] 检测到源码有更新，需要重新构建。
    )
)

if "!NEED_BUILD!"=="1" (
    echo   [构建] 正在执行 mvn package ...
    pushd "%PROJECT_DIR%"
    call mvn -q -DskipTests clean package
    set "BUILD_RC=!errorlevel!"
    popd
    if not "!BUILD_RC!"=="0" (
        echo   [错误] 构建失败，请检查上方 Maven 输出。
        goto :fail
    )
    echo   [成功] 构建完成。
)

if not exist "%JAR_FILE%" (
    echo   [错误] 构建后仍未找到 jar：%JAR_FILE%
    goto :fail
)

rem ---------- 4. 后台启动应用 ----------
echo [4/4] 后台启动应用 ...

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

rem 用 javaw 脱离控制台后台运行；路径由 startrun.ps1 自行推导
rem javaw 无控制台窗口，输出重定向到日志文件
powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE_DIR%startrun.ps1"

if errorlevel 1 (
    echo   [错误] 后台启动失败，详情见日志：%LOG_FILE%
    goto :fail
)

rem 等待应用就绪
echo   [等待] 正在等待应用启动（最长 %WAIT_START% 秒）...
set "READY=0"
for /l %%i in (1,1,%WAIT_START%) do (
    if "!READY!"=="0" (
        ping -n 2 127.0.0.1 >nul
        netstat -ano | findstr ":%APP_PORT% " | findstr /i "LISTENING" >nul
        if not errorlevel 1 set "READY=1"
    )
)

echo.
if "!READY!"=="1" (
    echo ============================================================
    echo   启动成功！
    echo ------------------------------------------------------------
    echo   访问地址 : http://localhost:%APP_PORT%
    echo   日志文件 : %LOG_FILE%
    echo   PID 文件 : %PID_FILE%
    echo ------------------------------------------------------------
    echo   应用已在后台运行，现在可以安全关闭本窗口。
    echo   停止应用请运行：stop.bat
    echo ============================================================
) else (
    echo ============================================================
    echo   [警告] %WAIT_START% 秒内未检测到端口监听。
    echo          应用可能启动失败，请查看日志：
    echo          %LOG_FILE%
    echo ============================================================
)
echo.
pause
goto :end

:fail
echo.
echo 启动流程中断，请根据上方提示排查后重试。
pause
exit /b 1

:end
endlocal
