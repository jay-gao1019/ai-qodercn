# ============================================================
#  Helper: launch the Spring Boot jar detached in the background
#  Called by start.bat.
#  All paths are derived from this script's own location, so no
#  parameters are needed (avoids cmd-line quoting issues with
#  non-ASCII directory names).
#  NOTE: ASCII-only output on purpose.
#  PowerShell 5.1 reads BOM-less .ps1 as ANSI, so non-ASCII
#  text here would get corrupted and break parsing.
# ============================================================

$ErrorActionPreference = 'Stop'

$BaseDir    = $PSScriptRoot
$ProjectDir = Join-Path $BaseDir 'email-system-java'
$JarFile    = Join-Path $ProjectDir 'target\email-system-1.0.0.jar'
$LogFile    = Join-Path $BaseDir 'logs\app.log'
$PidFile    = Join-Path $BaseDir '.app.pid'

function Get-JavaWPath {
    # Prefer javaw next to JAVA_HOME, fall back to PATH lookup
    $candidates = @()
    if ($env:JAVA_HOME) {
        $candidates += (Join-Path $env:JAVA_HOME 'bin\javaw.exe')
    }
    $cmd = Get-Command javaw.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }

    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

$javaw = Get-JavaWPath
if (-not $javaw) {
    Write-Host "  [ERROR] javaw.exe not found. Check JAVA_HOME or PATH."
    exit 1
}

if (-not (Test-Path $JarFile)) {
    Write-Host "  [ERROR] Jar not found: $JarFile"
    exit 1
}

# Make sure the log directory exists
$logDir = Split-Path $LogFile -Parent
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Rotate log: keep previous run as app.log.bak
if (Test-Path $LogFile) {
    $bak = "$LogFile.bak"
    if (Test-Path $bak) { Remove-Item $bak -Force -ErrorAction SilentlyContinue }
    Move-Item $LogFile $bak -Force -ErrorAction SilentlyContinue
}

$argList = @('-jar', $JarFile)

# Start-Process creates a truly detached process:
# javaw has no console window, and the child is independent
# of the caller's lifetime, so closing the cmd window is safe.
$proc = Start-Process -FilePath $javaw `
    -ArgumentList $argList `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError "$LogFile.err" `
    -WindowStyle Hidden `
    -PassThru

if (-not $proc) {
    Write-Host "  [ERROR] Failed to start process."
    exit 1
}

$proc.Id | Out-File -FilePath $PidFile -Encoding ASCII -Force
Write-Host "  [OK]   Application started in background (PID $($proc.Id))."
exit 0
