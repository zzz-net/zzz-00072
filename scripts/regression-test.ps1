param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$ProjectRoot = "d:\workSpace\AI__SPACE\zzz-00072"
)

$ErrorActionPreference = "Stop"
$PASS = 0; $FAIL = 0
function TestStep($name, $cond) {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "[FAIL] $name" -ForegroundColor Red; $script:FAIL++ }
}

Write-Host "================================================"
Write-Host "Canteen Loss Review - API Regression Test Suite"
Write-Host "Base URL: $BaseUrl"
Write-Host "================================================"

# 1. Health
Write-Host "`n[1] Health Check"
$h = Invoke-RestMethod "$BaseUrl/api/health"
TestStep "GET /api/health returns success" ($h.success -eq $true)

# 2. Batches
Write-Host "`n[2] Batch List"
$batches = Invoke-RestMethod "$BaseUrl/api/batches"
TestStep "GET /api/batches returns array" ($batches -is [array])
$batch = $batches | Where-Object { $_.anomaly_count -gt 0 } | Select-Object -First 1
if (-not $batch) {
  Write-Host "Creating sample batch for testing..." -ForegroundColor Yellow
  Invoke-RestMethod "$BaseUrl/api/batches/sample" -Method Post | Out-Null
  $batches = Invoke-RestMethod "$BaseUrl/api/batches"
  $batch = $batches | Where-Object { $_.anomaly_count -gt 0 } | Select-Object -First 1
}
TestStep "Found batch with anomalies" ($null -ne $batch)
Write-Host "  Using batch: $($batch.name) ($($batch.id))"

# 3-5. Three exports
Write-Host "`n[3] Export Summary"
$s = Invoke-WebRequest "$BaseUrl/api/export/summary?batch_ids=$($batch.id)"
TestStep "Summary HTTP 200" ($s.StatusCode -eq 200)
TestStep "Summary Content-Disposition has RFC5987 filename*" ($s.Headers['Content-Disposition'] -match "filename\*=UTF-8''")
TestStep "Summary CSV has header row" ($s.Content -match "批次ID")

Write-Host "`n[4] Export Detail"
$d = Invoke-WebRequest "$BaseUrl/api/export/detail?batch_ids=$($batch.id)"
TestStep "Detail HTTP 200" ($d.StatusCode -eq 200)
TestStep "Detail Content-Disposition has RFC5987 filename*" ($d.Headers['Content-Disposition'] -match "filename\*=UTF-8''")
TestStep "Detail CSV has header row with anomaly type" ($d.Content -match "异常类型")

Write-Host "`n[5] Export History"
$hi = Invoke-WebRequest "$BaseUrl/api/export/history"
TestStep "History HTTP 200" ($hi.StatusCode -eq 200)
TestStep "History Content-Disposition has RFC5987 filename*" ($hi.Headers['Content-Disposition'] -match "filename\*=UTF-8''")
TestStep "History CSV has header row" ($hi.Content -match "异常ID,操作,原因")

# 6-9. Review workflow: Resolve + Type Change + Reopen
Write-Host "`n[6] Resolve anomaly WITH type change"
$anoms = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=unresolved"
$testA = $anoms[0]
TestStep "Have unresolved anomaly" ($null -ne $testA)
$otherType = if ($testA.anomaly_type -eq 'over_prep') { 'spoilage_suspect' } else { 'over_prep' }
$resolveBody = @{ reason = "回归测试改判"; result = "confirmed"; anomaly_type = $otherType } | ConvertTo-Json
$resolved = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testA.id)/resolve" -Method Post -Body $resolveBody -ContentType "application/json"
TestStep "Resolve: status = resolved" ($resolved.status -eq 'resolved')
TestStep "Resolve: manual_result = confirmed" ($resolved.manual_result -eq 'confirmed')
TestStep "Resolve: anomaly_type CHANGED to $otherType" ($resolved.anomaly_type -eq $otherType)
TestStep "Resolve: resolved_at filled" (-not [string]::IsNullOrEmpty($resolved.resolved_at))

Write-Host "`n[7] Verify history record has type-change annotation"
$dtl = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testA.id)"
$last = $dtl.history[0]
TestStep "History action = resolve" ($last.action -eq 'resolve')
TestStep "History result = confirmed" ($last.result -eq 'confirmed')
TestStep "History reason contains 人工改判类型" ($last.reason -like "*改判类型*")

Write-Host "`n[8] Reopen (status cleared, type preserved)"
$reopenBody = @{ reason = "回归测试撤销" } | ConvertTo-Json
$reopened = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testA.id)/reopen" -Method Post -Body $reopenBody -ContentType "application/json"
TestStep "Reopen: status = unresolved" ($reopened.status -eq 'unresolved')
TestStep "Reopen: manual_result cleared" ($null -eq $reopened.manual_result)
TestStep "Reopen: anomaly_type preserved as $otherType" ($reopened.anomaly_type -eq $otherType)
TestStep "Reopen: resolved_at cleared" ([string]::IsNullOrEmpty($reopened.resolved_at))

Write-Host "`n[9] Data Consistency Check"
$c = Invoke-RestMethod "$BaseUrl/api/export/consistency"
TestStep "Consistency ok=true" ($c.ok -eq $true)
if (-not $c.ok) { Write-Host ("Issues: " + ($c.issues -join '; ')) -ForegroundColor Red }

# 10. Port config consistency
Write-Host "`n[10] Port Configuration Consistency (3002 across files)"
$vite = Get-Content (Join-Path $ProjectRoot "vite.config.ts") -Raw
$srv = Get-Content (Join-Path $ProjectRoot "api/server.ts") -Raw
$readme = Get-Content (Join-Path $ProjectRoot "README.md") -Raw
TestStep "vite.config.ts uses 3002" ($vite -match "localhost:3002")
TestStep "api/server.ts default port = 3002" ($srv -match "\|\| 3002")
TestStep "README documents port 3002" ($readme -match "端口 3002")

# Summary
Write-Host "`n================================================"
Write-Host "Results: PASS=$PASS FAIL=$FAIL"
Write-Host "================================================"
if ($FAIL -gt 0) { exit 1 }
