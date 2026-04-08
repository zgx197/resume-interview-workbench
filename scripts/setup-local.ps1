param(
  [ValidateSet("setup", "up", "doctor", "migrate", "check")]
  [string]$Task = "setup"
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

Push-Location $repoRoot
try {
  switch ($Task) {
    "setup" {
      Invoke-RepoCommand -Label "running npm run setup:local" -Command @("npm.cmd", "run", "setup:local")
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
