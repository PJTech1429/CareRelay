$ErrorActionPreference = 'Stop'
try {
 Set-Location (Split-Path $PSScriptRoot -Parent)
 . (Join-Path $PSScriptRoot 'Find-CareRelayNode.ps1')
 $CareRelayNode = Find-CareRelayNode
 $CareRelayDataRoot = Join-Path $env:LOCALAPPDATA 'CareRelay-RC2'
 New-Item -ItemType Directory -Path $CareRelayDataRoot -Force | Out-Null
 Remove-Item Env:CARERELAY_LIVE_AUTHORIZATION -ErrorAction SilentlyContinue
 Remove-Item Env:UPSTREAM_MCP_URL -ErrorAction SilentlyContinue
 $env:CARERELAY_DATA = Join-Path $CareRelayDataRoot 'guided.json'
 $env:CARERELAY_DYNAMIC_DATA = Join-Path $CareRelayDataRoot 'household.json'
 $env:CARERELAY_OPEN_BROWSER = '1'
 $env:PORT = '0'
 $env:CARERELAY_AUTO_PORT = '1'
 Write-Host 'CareRelay: Free Offline demo; optional Live AI requires per-request approval. No npm install and no AWS calls on startup.'
 Write-Host 'The verified browser address is selected automatically. Stop with STOP-CARERELAY.cmd or Ctrl+C.'
 Write-Host 'Your household and spending journal persist in LocalAppData\CareRelay-RC2.'
 & $CareRelayNode (Join-Path $PSScriptRoot 'launch-current.js')
 exit $LASTEXITCODE
} catch { Write-Host ('CareRelay could not start: ' + $_.Exception.Message); exit 1 }
