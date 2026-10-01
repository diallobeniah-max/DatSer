$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'
$fixtureRoot = Join-Path $repoRoot 'tests\fixtures\local-only-migrations'

if (-not (Test-Path -LiteralPath $supabaseCli)) {
  throw 'Install the repository dependencies before applying local Supabase fixtures.'
}

$fixtures = Get-ChildItem -LiteralPath $fixtureRoot -Filter '*.sql' -File |
  Where-Object { $_.Name -ne '20260913192914_rxdb_member_v2_attendance_harness.sql' } |
  Sort-Object Name

foreach ($fixture in $fixtures) {
  & $supabaseCli --workdir $repoRoot db query --local --file $fixture.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Local-only SQL fixture failed: $($fixture.Name)"
  }
}

Write-Output "Applied $($fixtures.Count) local-only POC SQL fixtures to the local Supabase database."
