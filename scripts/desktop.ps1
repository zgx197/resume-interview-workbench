param(
  [switch]$Doctor
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($Doctor) {
  Write-Host "[desktop] running npm run desktop:doctor"
  npm.cmd run desktop:doctor
  exit $LASTEXITCODE
}

Write-Host "[desktop] running npm run desktop:dev"
npm.cmd run desktop:dev
exit $LASTEXITCODE
