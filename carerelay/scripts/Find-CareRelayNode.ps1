function Find-CareRelayNode {
 $CareRelayCandidates = @((Join-Path $PSScriptRoot '..\.tools\node22\node.exe'),(Join-Path $PSScriptRoot '..\..\.tools\node22\node.exe'))
 $CareRelayInstalled = Get-Command node -ErrorAction SilentlyContinue
 if ($CareRelayInstalled) { $CareRelayCandidates += $CareRelayInstalled.Source }
 $CareRelayBases = @((Join-Path $env:USERPROFILE 'Downloads'))
 $CareRelayBases += @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object { $_.Root })
 foreach ($CareRelayBase in @($CareRelayBases | Select-Object -Unique)) {
  if (Test-Path -LiteralPath $CareRelayBase) { foreach ($CareRelayFolder in @(Get-ChildItem -LiteralPath $CareRelayBase -Directory -Filter 'CareRelay*' -ErrorAction SilentlyContinue)) { $CareRelayCandidates += (Join-Path $CareRelayFolder.FullName '.tools\node22\node.exe'); $CareRelayCandidates += (Join-Path $CareRelayFolder.FullName 'carerelay\.tools\node22\node.exe') } }
 }
 foreach ($CareRelayCandidate in $CareRelayCandidates) { if (Test-Path -LiteralPath $CareRelayCandidate) { $CareRelayVersion = & $CareRelayCandidate --version; if ($LASTEXITCODE -eq 0 -and [int]($CareRelayVersion.TrimStart('v').Split('.')[0]) -ge 22) { return $CareRelayCandidate } } }
 throw 'Node 22+ not found. Copy your existing portable node.exe into carerelay\.tools\node22, or extract the official Node Windows portable ZIP there. Your global Node 14 stays unchanged. See README.md at the package root.'
}
