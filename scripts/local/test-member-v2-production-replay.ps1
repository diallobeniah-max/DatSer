param(
  [switch] $IncludeBrowser,
  [switch] $FullSuite,
  [switch] $Serial,
  [string] $TestName,
  [string] $BrowserTestName
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$supabaseCli = Join-Path $repoRoot 'node_modules\.bin\supabase.cmd'
$dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $supabaseCli)) { throw 'Repository-pinned Supabase CLI is missing.' }
$script:dockerPublishedPorts = @(& $dockerExe ps --format '{{.Ports}}' | ForEach-Object {
  [regex]::Matches($_, ':(\d+)->') | ForEach-Object { [int]$_.Groups[1].Value }
})

function Test-PortAvailable([int] $Port) {
  if ($script:dockerPublishedPorts -contains $Port) { return $false }
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try { $listener.Start(); return $true } catch { return $false } finally { try { $listener.Stop() } catch {} }
}

$basePort = 55000
while ($basePort -lt 63000) {
  $ports = @($basePort, ($basePort + 1), ($basePort + 2), ($basePort + 3), ($basePort + 5), ($basePort + 7), ($basePort + 9))
  if (($ports | Where-Object { -not (Test-PortAvailable $_) }).Count -eq 0) { break }
  $basePort += 11
}
if ($basePort -ge 63000) { throw 'Could not reserve an unused local port range for the isolated Supabase replay.' }

$projectId = 'DatSer-MemberV2-Replay-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$tempRoot = Join-Path $env:TEMP $projectId
$tempSupabase = Join-Path $tempRoot 'supabase'
$tempMigrations = Join-Path $tempSupabase 'migrations'
$tempTests = Join-Path $tempSupabase 'tests'
New-Item -ItemType Directory -Path $tempMigrations -Force | Out-Null
New-Item -ItemType Directory -Path $tempTests -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'supabase\config.toml') -Destination (Join-Path $tempSupabase 'config.toml')
Copy-Item -LiteralPath (Join-Path $repoRoot 'tests\fixtures\production-replay\manifest.json') -Destination (Join-Path $tempRoot 'production-replay-manifest.json')

$configPath = Join-Path $tempSupabase 'config.toml'
$config = Get-Content -LiteralPath $configPath -Raw
$projectIdPattern = '(?m)^project_id\s*=\s*"[^"]+"\s*$'
if ([regex]::Matches($config, $projectIdPattern).Count -ne 1) { throw 'Expected exactly one local project_id in the copied Supabase config.' }
$config = [regex]::Replace($config, $projectIdPattern, "project_id = `"$projectId`"")
if ($config -notmatch [regex]::Escape("project_id = `"$projectId`"")) { throw 'Could not set the disposable replay project id.' }
$config = $config.Replace('port = 54321', "port = $basePort")
$config = $config.Replace('port = 54322', "port = $($basePort + 1)")
$config = $config.Replace('shadow_port = 54320', "shadow_port = $($basePort - 1)")
$config = $config.Replace('port = 54323', "port = $($basePort + 2)")
$config = $config.Replace('port = 54324', "port = $($basePort + 3)")
$config = $config.Replace('inspector_port = 8083', "inspector_port = $($basePort + 9)")
$config = $config.Replace('port = 54327', "port = $($basePort + 7)")
$config = [regex]::Replace($config, '(?ms)(\[db\.seed\][^\[]*?^enabled = )true', '$1false', 1)
Set-Content -LiteralPath $configPath -Value $config -NoNewline -Encoding utf8

$migrationFiles = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase\migrations') -File -Filter '*.sql' |
  Where-Object {
    $_.Name -match '^\d{14}_.+\.sql$' -and $_.Name -notin @(
      '20260803163214_share_all_months_with_workspace_accounts.sql',
      '20260803163624_remove_typo_yawdiallo_collaborator.sql',
      '20260825200845_csv_import_history.sql'
    )
  } | Sort-Object Name
foreach ($migration in $migrationFiles) {
  $destination = Join-Path $tempMigrations $migration.Name
  Copy-Item -LiteralPath $migration.FullName -Destination $destination
  if ((Get-FileHash -LiteralPath $migration.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) {
    throw "Tracked production migration copy changed during replay setup: $($migration.Name)"
  }
}
Write-Output "TRACKED_PRODUCTION_MIGRATIONS_COPIED_BYTE_FOR_BYTE: $($migrationFiles.Count)"

# These explicit fixtures model known-applied historical versions without
# rewriting any tracked migration or importing production identity/data rows.
$historicalBaselines = @(
  @{ Source = '20260803163214_historical_schema_baseline.sql'; Target = '20260803163214_local_replay_historical_baseline.sql' },
  @{ Source = '20260803163624_historical_cleanup_baseline.sql'; Target = '20260803163624_local_replay_historical_baseline.sql' },
  @{ Source = '20260825200845_csv_history_applied_baseline.sql'; Target = '20260825200845_local_replay_historical_baseline.sql' }
)
foreach ($baseline in $historicalBaselines) {
  $sourcePath = Join-Path $repoRoot "tests\fixtures\production-replay\$($baseline.Source)"
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Required historical replay baseline is missing: $($baseline.Source)" }
  Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $tempMigrations $baseline.Target)
  Write-Output "HISTORICAL_PRODUCTION_VERSION_MODELED_EXPLICITLY: $($baseline.Target.Substring(0,14))"
}

# February existed before the historical policy migrations were created. A
# fresh empty database needs this disposable baseline fixture before replay.
$februaryBaseline = Join-Path $repoRoot 'tests\fixtures\local-only-migrations\20260207120000_poc_create_february_2026_prerequisite.sql'
Copy-Item -LiteralPath $februaryBaseline -Destination (Join-Path $tempMigrations '20260207100000_local_replay_february_baseline.sql')
$replayCompatibilityFixtures = @(
  @{ Source = '20260314235959_poc_prepare_member_bundle_function_return_types.sql'; Target = '20260314235959_local_replay_member_bundle_return_types.sql' },
  @{ Source = '20260315000000_poc_reconcile_member_bundle_transactions.sql'; Target = '20260315000000_local_replay_member_bundle_compatibility.sql' },
  @{ Source = '20260701110000_poc_prepare_update_owner_admin_override_return_type.sql'; Target = '20260701110000_local_replay_admin_override_return_type.sql' },
  @{ Source = '20260802064000_poc_prepare_cross_month_attendance_return_type.sql'; Target = '20260802064000_local_replay_cross_month_return_type.sql' },
  @{ Source = '20260815154000_poc_prepare_ai_provider_resolve_key_return_type.sql'; Target = '20260815154000_local_replay_ai_provider_return_type.sql' }
)
foreach ($fixture in $replayCompatibilityFixtures) {
  Copy-Item -LiteralPath (Join-Path $repoRoot "tests\fixtures\local-only-migrations\$($fixture.Source)") -Destination (Join-Path $tempMigrations $fixture.Target)
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'supabase\tests\member_v2_production_security.test.sql') -Destination (Join-Path $tempTests 'member_v2_production_security.test.sql')

$dbContainer = "supabase_db_$projectId"
$viteProcess = $null
$stackStarted = $false
$startAttempted = $false
Push-Location $repoRoot
try {
  $startAttempted = $true
  $startOutput = & $supabaseCli start --workdir $tempRoot --ignore-health-check 2>&1
  if ($LASTEXITCODE -ne 0) {
    $safeStartOutput = $startOutput | ForEach-Object { "$_" }
    $safeStartOutput = ($safeStartOutput -join "`n") -replace '(?im)^.*(?:ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|SECRET_KEY).*$','[credential-bearing line redacted]'
    $safeStartOutput = $safeStartOutput -replace '\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b','[JWT redacted]'
    $safeStartOutput = $safeStartOutput -replace '(?s)At statement:.*','[migration SQL omitted]'
    $safeStartOutput = $safeStartOutput -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[email redacted]'
    Write-Output $safeStartOutput
    throw 'Isolated Supabase could not start.'
  }
  $stackStarted = $true

  $statusOutput = & $supabaseCli status --workdir $tempRoot --output json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Could not read isolated local Supabase status.' }
  $status = ($statusOutput -join "`n") | ConvertFrom-Json
  $env:DATSER_LOCAL_SUPABASE_URL = $status.API_URL
  $env:DATSER_LOCAL_SUPABASE_ANON_KEY = $status.ANON_KEY
  $env:DATSER_LOCAL_SUPABASE_SERVICE_ROLE_KEY = $status.SERVICE_ROLE_KEY
  $env:DATSER_LOCAL_SUPABASE_DB_CONTAINER = $dbContainer
  $env:VITE_SUPABASE_URL = $status.API_URL
  $env:VITE_SUPABASE_ANON_KEY = $status.ANON_KEY
  $env:VITE_DATSER_MEMBER_V2_SHARED_WEB_VALIDATION = 'true'

  $schemaQuery = "select json_build_object('memberTables', (select count(*) from pg_tables where schemaname='public' and tablename like 'member_v2_%'), 'createRpc', to_regprocedure('public.create_member_v2(text,uuid,uuid,jsonb,text,text)') is not null, 'attendanceSaveRpc', to_regprocedure('public.save_member_v2_attendance(uuid,uuid,text,date,text,uuid,bigint,text,text)') is not null, 'deleteRpc', exists(select 1 from pg_proc where proname='delete_member_v2'), 'signalTable', to_regclass('public.member_v2_realtime_signals') is not null, 'signalPublication', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='member_v2_realtime_signals'), 'csvUpdatePolicy', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='CSV import source images update' and qual is not null and with_check is not null), 'gateDefaultOff', not exists(select 1 from public.member_v2_rollout_workspaces where enabled))::text;"
  $proof = & (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe') exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -c $schemaQuery
  if ($LASTEXITCODE -ne 0) { throw 'Production schema proof query failed.' }
  $schema = ($proof -join '').Trim() | ConvertFrom-Json
  if (-not $schema.createRpc -or -not $schema.attendanceSaveRpc -or -not $schema.deleteRpc -or -not $schema.signalTable -or -not $schema.signalPublication -or -not $schema.csvUpdatePolicy -or -not $schema.gateDefaultOff -or $schema.memberTables -lt 5) {
    throw 'Replay database does not satisfy the expected production migration contract.'
  }
  Write-Output 'PRODUCTION_REPLAY_WITH_EXPLICIT_HISTORICAL_BASELINES: PASS'
  Write-Output 'FORWARD_CSV_POLICY_REPAIR: PASS'
  Write-Output 'ROLLOUT_GATE_DEFAULT_OFF: PASS'

  # This retired POC fixture is deliberately applied only after the production
  # migration replay and its schema assertions, outside the migration path.
  $pocFixture = Join-Path $repoRoot 'tests\fixtures\local-only-migrations\20260912200747_rxdb_backend_poc_phase0.sql'
  $pocContainerPath = '/tmp/datser-member-v2-local-poc-phase0.sql'
  & $dockerExe cp $pocFixture "${dbContainer}:$pocContainerPath"
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the opt-in local POC fixture into the disposable database container.' }
  $pocOutput = & $dockerExe exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f $pocContainerPath 2>&1
  if ($LASTEXITCODE -ne 0) { $pocOutput | ForEach-Object { Write-Output $_ }; throw 'Opt-in local POC test fixture failed after production replay.' }
  Write-Output 'LOCAL_ONLY_POC_FIXTURE: APPLIED_AFTER_PRODUCTION_REPLAY'

  $dbTestOutput = & $supabaseCli test db --local --workdir $tempRoot 2>&1
  if ($LASTEXITCODE -ne 0) { $dbTestOutput | ForEach-Object { Write-Output $_ }; throw 'Member V2 database security tests failed.' }
  $dbTestOutput | ForEach-Object { Write-Output $_ }

  if ($TestName) {
    $targetOutput = & node_modules\.bin\vitest.cmd --run src/services/member-v2/MemberService.localSupabase.integration.test.js -t $TestName 2>&1
  } elseif ($FullSuite -and $Serial) {
    $targetOutput = & node_modules\.bin\vitest.cmd --run --environment jsdom --maxWorkers=1 --minWorkers=1 2>&1
  } elseif ($FullSuite) {
    $targetOutput = & npm test 2>&1
  } else {
    $targetOutput = & npm run test:member-v2 2>&1
  }
  if ($LASTEXITCODE -ne 0) { $targetOutput | ForEach-Object { Write-Output $_ }; throw 'Selected local test suite failed.' }
  $targetOutput | ForEach-Object { Write-Output $_ }

  if ($IncludeBrowser) {
    $appPort = $basePort + 5
    $env:PLAYWRIGHT_REAL_MEMBER_V2_URL = "http://127.0.0.1:$appPort"
    $viteOut = Join-Path $tempRoot 'vite.stdout.log'
    $viteErr = Join-Path $tempRoot 'vite.stderr.log'
    $viteEntry = Join-Path $repoRoot 'node_modules\vite\bin\vite.js'
    $viteProcess = Start-Process -FilePath 'node.exe' -ArgumentList @("`"$viteEntry`"",'--host','127.0.0.1','--port',"$appPort",'--strictPort') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $viteOut -RedirectStandardError $viteErr
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      try { $null = Invoke-WebRequest -Uri "$($env:PLAYWRIGHT_REAL_MEMBER_V2_URL)/index.html" -TimeoutSec 2; $ready = $true; break } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'Isolated Vite app did not become ready for Member V2 browser validation.' }
    $browserArgs = @('test','--config','playwright.real-member-v2-offline.config.js')
    if ($BrowserTestName) { $browserArgs += @('--grep', $BrowserTestName) }
    $browserOutput = & node_modules\.bin\playwright.cmd @browserArgs 2>&1
    if ($LASTEXITCODE -ne 0) { $browserOutput | ForEach-Object { Write-Output $_ }; throw 'Member V2 browser validation failed.' }
    $browserOutput | ForEach-Object { Write-Output $_ }
  }
} finally {
  if ($viteProcess -and -not $viteProcess.HasExited) { Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($startAttempted) { $null = & $supabaseCli stop --workdir $tempRoot --no-backup 2>&1 }
  Remove-Item Env:DATSER_LOCAL_SUPABASE_URL, Env:DATSER_LOCAL_SUPABASE_ANON_KEY, Env:DATSER_LOCAL_SUPABASE_SERVICE_ROLE_KEY, Env:DATSER_LOCAL_SUPABASE_DB_CONTAINER, Env:VITE_SUPABASE_URL, Env:VITE_SUPABASE_ANON_KEY, Env:VITE_DATSER_MEMBER_V2_SHARED_WEB_VALIDATION, Env:PLAYWRIGHT_REAL_MEMBER_V2_URL -ErrorAction SilentlyContinue
  if ((Resolve-Path -LiteralPath $tempRoot).Path.StartsWith((Resolve-Path -LiteralPath $env:TEMP).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
  Pop-Location
}
