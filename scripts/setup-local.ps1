param(
  [ValidateSet("setup", "up", "doctor", "migrate", "check")]
  [string]$Task = "setup",
  [int]$Port = 3000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-RepoCommand {
  param(
    [string]$Label,
    [string[]]$Command
  )

  Write-Host "[setup-local] $Label"
  & $Command[0] $Command[1..($Command.Length - 1)]
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $($Command -join ' ')"
  }
}

function Start-AppAfterSetup {
  Write-Host "[setup-local] starting local web app"
  $devScript = Join-Path $PSScriptRoot "dev.ps1"
  $arguments = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $devScript,
    "-Port", $Port
  )
  if ($NoBrowser) {
    $arguments += "-NoBrowser"
  }

  & "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start local web app."
  }
}

Push-Location $repoRoot
try {
  switch ($Task) {
    "setup" {
      Invoke-RepoCommand -Label "running npm run setup:local" -Command @("npm.cmd", "run", "setup:local")
      Start-AppAfterSetup
    }
    "up" {
      Invoke-RepoCommand -Label "running npm run db:up" -Command @("npm.cmd", "run", "db:up")
    }
    "doctor" {
      Invoke-RepoCommand -Label "running npm run db:doctor" -Command @("npm.cmd", "run", "db:doctor")
    }
    "migrate" {
      Invoke-RepoCommand -Label "running npm run db:migrate" -Command @("npm.cmd", "run", "db:migrate")
    }
    "check" {
      Invoke-RepoCommand -Label "running npm run check" -Command @("npm.cmd", "run", "check")
    }
  }
} finally {
  Pop-Location
}
