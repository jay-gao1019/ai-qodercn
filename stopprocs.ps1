# ============================================================
#  Helper: stop the Email System application.
#  Called by stop.bat.
#  Strategy (in order):
#    1) PID file written by start.bat (most precise)
#    2) Process listening on the app port (fallback)
#    3) Leftover Maven processes (java.exe with spring-boot:run)
#  NOTE: ASCII-only output on purpose.
#  PowerShell 5.1 reads BOM-less .ps1 as ANSI, so non-ASCII
#  text here would get corrupted and break parsing.
# ============================================================
param(
    [Parameter(Mandatory = $true)][int]$AppPort
)

$ErrorActionPreference = 'SilentlyContinue'

# Derive paths from this script's own location to avoid
# cmd-line quoting issues with non-ASCII directory names.
$BaseDir = $PSScriptRoot
$PidFile = Join-Path $BaseDir '.app.pid'

$killed = 0

function Stop-Tree {
    param([int]$ProcId)
    if (-not $ProcId -or $ProcId -eq 0) { return $false }
    # terminate descendants first, then the target itself
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcId" |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    if ($p) {
        Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
        return $true
    }
    return $false
}

# --- 1. PID file ---
if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $filePid = 0
    if ([int]::TryParse($raw, [ref]$filePid) -and $filePid -gt 0) {
        if (Get-Process -Id $filePid -ErrorAction SilentlyContinue) {
            Write-Host "  [KILL] PID $filePid from pid-file, terminating process tree ..."
            if (Stop-Tree -ProcId $filePid) {
                Write-Host "  [OK]   PID $filePid terminated."
                $killed++
            }
        } else {
            Write-Host "  [SKIP] PID $filePid in pid-file is not running."
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# --- 2. Process listening on the app port ---
$conns = Get-NetTCPConnection -LocalPort $AppPort -State Listen
if ($conns) {
    $ownerPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $ownerPids) {
        if ($procId -and $procId -ne 0) {
            Write-Host "  [KILL] Port $AppPort held by PID $procId, terminating process tree ..."
            if (Stop-Tree -ProcId $procId) {
                Write-Host "  [OK]   PID $procId terminated."
                $killed++
            }
        }
    }
}

# --- 3. Leftover Maven processes ---
$mvnProcs = Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
    Where-Object { $_.CommandLine -like '*spring-boot:run*' }
foreach ($p in $mvnProcs) {
    Write-Host "  [KILL] Maven process PID $($p.ProcessId), terminating process tree ..."
    if (Stop-Tree -ProcId $p.ProcessId) {
        Write-Host "  [OK]   PID $($p.ProcessId) terminated."
        $killed++
    }
}

if ($killed -eq 0) {
    Write-Host "  [SKIP] No running app or Maven process found."
}

exit 0
