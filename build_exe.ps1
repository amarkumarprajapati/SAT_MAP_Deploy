#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$RootDir = $PSScriptRoot
$BuildDir = Join-Path $RootDir 'SAT_Build'
$InternalDir = Join-Path $BuildDir 'internal'
$DistDir = Join-Path $InternalDir 'dist'
$PackagingDir = Join-Path $InternalDir 'packaging'
$ReleaseDir = Join-Path $BuildDir 'release'

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

$PythonExe = $null
$PythonPrefixArgs = @()
if (Get-Command py.exe -ErrorAction SilentlyContinue) {
    $PythonExe = (Get-Command py.exe).Source
    $PythonPrefixArgs = @('-3')
} elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
    $PythonExe = (Get-Command python.exe).Source
} else {
    throw 'Python 3.10 or newer is required. Install Python and add it to PATH.'
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node.js and npm are required. Install Node.js LTS and reopen PowerShell.'
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js was not found in PATH. Install Node.js LTS and reopen PowerShell.'
}

Write-Host 'Cleaning previous generated build files...'
foreach ($GeneratedDir in @($InternalDir, $ReleaseDir)) {
    if (Test-Path -LiteralPath $GeneratedDir) {
        Remove-Item -LiteralPath $GeneratedDir -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
foreach ($ServiceDir in @('backend', 'osint', 'frontend', 'node')) {
    New-Item -ItemType Directory -Path (Join-Path $DistDir $ServiceDir) -Force | Out-Null
}

Write-Host 'Building FastAPI backend...'
Push-Location (Join-Path $RootDir 'SAT_MAP_Backend')
try {
    Invoke-Native $PythonExe ($PythonPrefixArgs + @('-m', 'pip', 'install', '-r', 'requirements.txt', 'pyinstaller'))
    Invoke-Native $PythonExe ($PythonPrefixArgs + @('-m', 'PyInstaller', 'backend.spec', '--distpath', $DistDir, '--workpath', (Join-Path $InternalDir 'temp\backend'), '--clean', '-y'))
} finally {
    Pop-Location
}
$BackendExe = Join-Path $DistDir 'backend\backend.exe'
if (-not (Test-Path -LiteralPath $BackendExe)) {
    throw "PyInstaller did not create the expected backend executable: $BackendExe"
}

Write-Host 'Building OSINT service...'
Push-Location (Join-Path $RootDir 'osint')
try {
    Invoke-Native (Get-Command npm.cmd).Source @('install')
    Invoke-Native (Get-Command npm.cmd).Source @('run', 'build')
    $OsintPackageDir = Join-Path $DistDir 'osint'
    $OsintDistDir = Join-Path $OsintPackageDir 'dist'
    New-Item -ItemType Directory -Path $OsintDistDir -Force | Out-Null
    Copy-Item -Path (Join-Path (Get-Location) 'dist\*') -Destination $OsintDistDir -Recurse -Force
    Copy-Item -LiteralPath (Join-Path (Get-Location) 'package.json') -Destination $OsintPackageDir -Force
    Copy-Item -LiteralPath (Join-Path (Get-Location) 'package-lock.json') -Destination $OsintPackageDir -Force
    Invoke-Native (Get-Command npm.cmd).Source @('ci', '--omit=dev', '--prefix', $OsintPackageDir)
} finally {
    Pop-Location
}

Write-Host 'Building Next.js frontend...'
Push-Location (Join-Path $RootDir 'SAT_MAP_Frontend')
try {
    Invoke-Native (Get-Command npm.cmd).Source @('install')
    Invoke-Native (Get-Command npm.cmd).Source @('run', 'build')
    $StandaloneDir = Join-Path (Get-Location) '.next\standalone'
    if (-not (Test-Path -LiteralPath $StandaloneDir)) {
        throw 'Next.js standalone output is missing. Check next.config.ts for output: standalone.'
    }
    Copy-Item -Path (Join-Path $StandaloneDir '*') -Destination (Join-Path $DistDir 'frontend') -Recurse -Force
    New-Item -ItemType Directory -Path (Join-Path $DistDir 'frontend\.next\static') -Force | Out-Null
    Copy-Item -Path (Join-Path (Get-Location) '.next\static\*') -Destination (Join-Path $DistDir 'frontend\.next\static') -Recurse -Force
    $PublicDir = Join-Path (Get-Location) 'public'
    if (Test-Path -LiteralPath $PublicDir) {
        Copy-Item -Path $PublicDir -Destination (Join-Path $DistDir 'frontend\public') -Recurse -Force
    }
} finally {
    Pop-Location
}

Write-Host 'Bundling Node.js runtime...'
$NodePath = (Get-Command node.exe).Source
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $DistDir 'node\node.exe') -Force

Write-Host 'Packaging SAT Map installer...'
Push-Location (Join-Path $RootDir 'electron-shell')
try {
    Invoke-Native (Get-Command npm.cmd).Source @('install')
    $OutputArgument = "--config.directories.output=$PackagingDir"
    Invoke-Native (Get-Command npm.cmd).Source @('exec', '--', 'electron-builder', '--win', 'nsis', $OutputArgument)
} finally {
    Pop-Location
}

$BuiltInstaller = Join-Path $PackagingDir 'SAT Map Setup.exe'
if (-not (Test-Path -LiteralPath $BuiltInstaller)) {
    throw "Build command completed but expected installer was not found: $BuiltInstaller"
}
Copy-Item -LiteralPath $BuiltInstaller -Destination $ReleaseDir -Force
$InstallerExe = Join-Path $ReleaseDir 'SAT Map Setup.exe'
Write-Host 'Build completed successfully.' -ForegroundColor Green
Write-Host 'Run or distribute this installer:' -ForegroundColor Green
Write-Host $InstallerExe -ForegroundColor Green
Write-Host 'Intermediate service files are in SAT_Build\internal.' -ForegroundColor DarkGray
