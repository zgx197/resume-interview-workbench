param(
  [int]$Port = 3000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

function Test-DevUrl {
  param(
    [string]$Url
  )

  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $true
  } catch {
    return $false
  }
}

function Wait-DevUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DevUrl -Url $Url) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$browserUrl = "http://127.0.0.1:$Port"
$healthUrl = "$browserUrl/api/debug/logs/summary?limit=1"

if (Test-DevUrl -Url $healthUrl) {
  Write-Host "Dev server already running: $browserUrl"
  if (-not $NoBrowser) {
    Start-Process $browserUrl | Out-Null
  }
  exit 0
}

# Start dev in a separate minimized window so it survives the current shell closing.
$commandParts = @(
  "Set-Location '$repoRoot'"
  "`$env:PORT='$Port'"
  "`$env:DEV_BROWSER_URL='$browserUrl'"
  "`$env:DEV_OPEN_BROWSER='0'"
  "npm.cmd run dev"
)
$command = $commandParts -join "; "

Start-Process `
  -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command `
  -WorkingDirectory $repoRoot `
  -WindowStyle Minimized | Out-Null

if (Wait-DevUrl -Url $healthUrl) {
  Write-Host "Dev server started: $browserUrl"
  if (-not $NoBrowser) {
    Start-Process $browserUrl | Out-Null
  }
  exit 0
}

Write-Host "Dev server window started, but health check did not pass within 30 seconds."
exit 1
