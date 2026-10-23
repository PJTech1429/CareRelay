$ErrorActionPreference = 'Stop'
try { Set-Location (Split-Path $PSScriptRoot -Parent); . (Join-Path $PSScriptRoot 'Find-CareRelayNode.ps1'); $CareRelayNode = Find-CareRelayNode; & $CareRelayNode scripts/stop-release.js; exit $LASTEXITCODE } catch { Write-Host $_.Exception.Message; exit 1 }
