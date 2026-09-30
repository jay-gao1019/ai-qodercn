# ============================================================
#  Helper: decide whether the jar needs to be rebuilt.
#  Exits 0 = build needed, 1 = jar is up to date.
#  Paths are derived from this script's own location.
#  NOTE: ASCII-only output on purpose.
# ============================================================

$BaseDir    = $PSScriptRoot
$ProjectDir = Join-Path $BaseDir 'email-system-java'
$JarFile    = Join-Path $ProjectDir 'target\email-system-1.0.0.jar'

if (-not (Test-Path $JarFile)) {
    exit 0
}

$jarTime = (Get-Item $JarFile).LastWriteTimeUtc

$srcDirs = @(
    (Join-Path $ProjectDir 'src\main\java'),
    (Join-Path $ProjectDir 'src\main\resources')
)

foreach ($d in $srcDirs) {
    if (-not (Test-Path $d)) { continue }
    $newer = Get-ChildItem -Path $d -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $jarTime } |
        Select-Object -First 1
    if ($newer) { exit 0 }
}

# also consider pom.xml changes
$pom = Join-Path $ProjectDir 'pom.xml'
if ((Test-Path $pom) -and (Get-Item $pom).LastWriteTimeUtc -gt $jarTime) {
    exit 0
}

exit 1
