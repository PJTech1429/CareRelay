$ErrorActionPreference = 'Stop'
try {
 Set-Location (Split-Path $PSScriptRoot -Parent)
 . (Join-Path $PSScriptRoot 'Find-CareRelayNode.ps1')
 $CareRelayNode = Find-CareRelayNode
 Write-Host 'Current application tests: local fixtures only; ZERO AWS calls.'
 & $CareRelayNode scripts/run-tests.js
 exit $LASTEXITCODE
} catch { Write-Host ('Tests could not start: ' + $_.Exception.Message); exit 1 }
