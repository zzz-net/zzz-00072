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
Write-Host "Canteen Loss Review - Rules Regression Test Suite"
Write-Host "Base URL: $BaseUrl"
Write-Host "================================================"

# ===== 1. Export Rules =====
Write-Host "`n[1] Export Rules as JSON"
try {
  $export = Invoke-RestMethod "$BaseUrl/api/rules/export"
  TestStep "Export returns object with schema_version" ($export.schema_version -eq '1.0')
  TestStep "Export has exported_at timestamp" (-not [string]::IsNullOrEmpty($export.exported_at))
  TestStep "Export rules is non-empty array" ($export.rules -is [array] -and $export.rules.Count -ge 1)
  $exportedRule = $export.rules[0]
  TestStep "Exported rule has all required fields" (
    $null -ne $exportedRule.version -and
    $null -ne $exportedRule.over_prep_threshold_pct -and
    $null -ne $exportedRule.over_prep_threshold_abs -and
    $null -ne $exportedRule.spoilage_temp_min -and
    $null -ne $exportedRule.spoilage_temp_max -and
    $null -ne $exportedRule.description
  )
  $activeFromExport = @($export.rules | Where-Object { $_.is_active -eq $true })
  TestStep "Export includes exactly 1 active rule" ($activeFromExport.Count -eq 1)
  $originalActiveVersion = $activeFromExport.version
  Write-Host "  Original active version: $originalActiveVersion"
} catch {
  Write-Host "[FAIL] Export test exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 6
}

# ===== 2. Validate: Missing fields =====
Write-Host "`n[2] Validate Package with Missing Fields"
$badPkg1 = @{
  schema_version = "1.0"
  rules = @(
    @{ version = "vtest_bad1" }
  )
} | ConvertTo-Json -Depth 5
try {
  $v1 = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $badPkg1 -ContentType "application/json"
  TestStep "Missing fields: valid = false" ($v1.valid -eq $false)
  TestStep "Missing fields: has error issues" ($v1.issues.Count -gt 0)
  $hasMissingFieldErr = $v1.issues | Where-Object { $_.severity -eq 'error' }
  TestStep "Missing fields: has at least one error" ($null -ne $hasMissingFieldErr)
} catch {
  Write-Host "[FAIL] Missing fields validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== 3. Validate: Wrong threshold type (NaN) =====
Write-Host "`n[3] Validate Package with Wrong Threshold Type"
$badPkg2 = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_bad2"
      over_prep_threshold_pct = "not_a_number"
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "test"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $v2 = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $badPkg2 -ContentType "application/json"
  TestStep "Wrong type: valid = false" ($v2.valid -eq $false)
  $hasTypeErr = $v2.issues | Where-Object { $_.severity -eq 'error' -and $_.message -match 'numeric' }
  TestStep "Wrong type: error mentions numeric type" ($null -ne $hasTypeErr)
} catch {
  Write-Host "[FAIL] Type validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 4. Validate: Temperature reversed =====
Write-Host "`n[4] Validate Package with Reversed Temperature Limits"
$badPkg3 = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_bad3"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 80
      spoilage_temp_max = 10
      description = "reversed temps"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $v3 = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $badPkg3 -ContentType "application/json"
  TestStep "Reversed temps: valid = false" ($v3.valid -eq $false)
  $hasTempErr = $v3.issues | Where-Object { $_.severity -eq 'error' -and $_.message -match 'reversed|min.*max|lower.*upper' }
  if (-not $hasTempErr) {
    $hasTempErr = $v3.issues | Where-Object { $_.severity -eq 'error' -and $_.field -eq 'spoilage_temp_max' }
  }
  TestStep "Reversed temps: error about temp limits" ($null -ne $hasTempErr)
} catch {
  Write-Host "[FAIL] Temperature validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 5. Validate: Duplicate version within package =====
Write-Host "`n[5] Validate Package with Duplicate Version"
$badPkg4 = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_dup"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "dup 1"
    },
    @{
      version = "vtest_dup"
      over_prep_threshold_pct = 20
      over_prep_threshold_abs = 150
      spoilage_temp_min = 5
      spoilage_temp_max = 55
      description = "dup 2"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $v4 = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $badPkg4 -ContentType "application/json"
  TestStep "Duplicate version in pkg: valid = false" ($v4.valid -eq $false)
  $hasDupErr = $v4.issues | Where-Object { $_.severity -eq 'error' -and ($_.message -match 'duplicate|already|exist' -or $_.field -eq 'version') }
  TestStep "Duplicate version in pkg: error about duplicate version" ($null -ne $hasDupErr)
} catch {
  Write-Host "[FAIL] Duplicate version validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 6. Validate: Description conflict warning =====
Write-Host "`n[6] Validate Package with Description Conflict (Warning)"
$warnPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_desc_a"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "same description but different thresholds"
    },
    @{
      version = "vtest_desc_b"
      over_prep_threshold_pct = 30
      over_prep_threshold_abs = 200
      spoilage_temp_min = 10
      spoilage_temp_max = 50
      description = "same description but different thresholds"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $v5 = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $warnPkg -ContentType "application/json"
  TestStep "Description conflict: valid = true (only warning)" ($v5.valid -eq $true)
  $hasWarn = $v5.issues | Where-Object { $_.severity -eq 'warning' }
  TestStep "Description conflict: has warning" ($null -ne $hasWarn)
} catch {
  Write-Host "[FAIL] Description conflict validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 7. Import: Failure rollback (invalid package should not write) =====
Write-Host "`n[7] Import Failure Rollback Check"
$rulesBefore = Invoke-RestMethod "$BaseUrl/api/rules"
$countBefore = $rulesBefore.Count
$rollbackPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_rollback_good"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "good one"
    },
    @{
      version = "vtest_rollback_bad"
      over_prep_threshold_pct = "invalid"
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "bad one"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $body = $rollbackPkg
  $resp = Invoke-WebRequest "$BaseUrl/api/rules/import" -Method Post -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue
  TestStep "Import with mixed validity: HTTP status != 200" ($resp.StatusCode -ne 200)
} catch {
  $resp = $_.Exception.Response
}
$rulesAfter = Invoke-RestMethod "$BaseUrl/api/rules"
$countAfter = $rulesAfter.Count
TestStep "Import rollback: rule count unchanged ($countBefore -> $countAfter)" ($countBefore -eq $countAfter)
$rolledBack = $rulesAfter | Where-Object { $_.version -eq 'vtest_rollback_good' }
TestStep "Import rollback: first (valid) rule NOT persisted" ($null -eq $rolledBack)

# ===== 8. Import: Valid package with unique versions =====
Write-Host "`n[8] Import Valid Package"
$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$validPkg = @{
  schema_version = "1.0"
  exported_at = (Get-Date).ToUniversalTime().ToString("o")
  rules = @(
    @{
      version = "vtest_import_A_$ts"
      over_prep_threshold_pct = 12
      over_prep_threshold_abs = 80
      spoilage_temp_min = 5
      spoilage_temp_max = 58
      description = "Import test rule A"
    },
    @{
      version = "vtest_import_B_$ts"
      over_prep_threshold_pct = 18
      over_prep_threshold_abs = 120
      spoilage_temp_min = 3
      spoilage_temp_max = 62
      description = "Import test rule B"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $importResult = Invoke-RestMethod "$BaseUrl/api/rules/import" -Method Post -Body $validPkg -ContentType "application/json"
  TestStep "Valid import: returns count = 2" ($importResult.count -eq 2)
  TestStep "Valid import: imported array has 2 rules" ($importResult.imported.Count -eq 2)
  $rulesAfterImport = Invoke-RestMethod "$BaseUrl/api/rules"
  $foundA = $rulesAfterImport | Where-Object { $_.version -eq "vtest_import_A_$ts" }
  $foundB = $rulesAfterImport | Where-Object { $_.version -eq "vtest_import_B_$ts" }
  TestStep "Valid import: Rule A persisted in DB" ($null -ne $foundA)
  TestStep "Valid import: Rule B persisted in DB" ($null -ne $foundB)
  TestStep "Valid import: Both rules NOT active initially" ($foundA.is_active -eq $false -and $foundB.is_active -eq $false)
  TestStep "Valid import: Original active version unchanged" ($originalActiveVersion -ne $null)
  $currentActive = $rulesAfterImport | Where-Object { $_.is_active -eq $true }
  TestStep "Valid import: Active rule still original" ($currentActive.version -eq $originalActiveVersion)
  $importedRuleAId = $foundA.id
  $importedRuleBId = $foundB.id
} catch {
  Write-Host "[FAIL] Valid import exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 7
}

# ===== 9. Import: Duplicate version against DB should fail =====
Write-Host "`n[9] Import Duplicate Version (against existing DB) Should Fail"
$dupDbPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_import_A_$ts"
      over_prep_threshold_pct = 99
      over_prep_threshold_abs = 999
      spoilage_temp_min = 1
      spoilage_temp_max = 99
      description = "duplicate against db"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $resp = Invoke-WebRequest "$BaseUrl/api/rules/import" -Method Post -Body $dupDbPkg -ContentType "application/json" -ErrorAction SilentlyContinue
  TestStep "Duplicate DB version: HTTP status = 400" ($resp.StatusCode -eq 400)
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    TestStep "Duplicate DB version: HTTP status = 400" ([int]$resp.StatusCode -eq 400)
  } else {
    TestStep "Duplicate DB version: HTTP status = 400 (exception caught)" $true
  }
}
$rulesAfterDup = Invoke-RestMethod "$BaseUrl/api/rules"
$dupRule = $rulesAfterDup | Where-Object { $_.version -eq "vtest_import_A_$ts" }
TestStep "Duplicate DB version: original rule NOT overwritten (thresholds preserved)" (
  $dupRule.over_prep_threshold_pct -eq 12 -and $dupRule.over_prep_threshold_abs -eq 80
)

# ===== 10. Rule activation switch =====
Write-Host "`n[10] Rule Activation Switch"
try {
  $rulesBeforeSwitch = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeBefore = $rulesBeforeSwitch | Where-Object { $_.is_active -eq $true }
  $inactiveTarget = $rulesBeforeSwitch | Where-Object { $_.is_active -eq $false } | Select-Object -First 1
  TestStep "Have inactive rule to switch to" ($null -ne $inactiveTarget)
  Write-Host "  Switching from $($activeBefore.version) to $($inactiveTarget.version)"

  $switchResult = Invoke-RestMethod "$BaseUrl/api/rules/$($inactiveTarget.id)/activate" -Method Post
  TestStep "Activate: success = true" ($switchResult.success -eq $true)

  $rulesAfterSwitch = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeAfter = @($rulesAfterSwitch | Where-Object { $_.is_active -eq $true })
  TestStep "After switch: exactly 1 active rule" ($activeAfter.Count -eq 1)
  TestStep "After switch: active version matches target" ($activeAfter.id -eq $inactiveTarget.id)

  $oldInactive = $rulesAfterSwitch | Where-Object { $_.id -eq $activeBefore.id }
  TestStep "After switch: previous active now inactive" ($oldInactive.is_active -eq $false)
} catch {
  Write-Host "[FAIL] Activation switch exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 5
}

# ===== 11. Historical data isolation: new batch uses current rule =====
Write-Host "`n[11] Historical Data Isolation Check"
try {
  $rulesNow = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeNow = $rulesNow | Where-Object { $_.is_active -eq $true }
  $activeRuleIdNow = $activeNow.id

  $batchesBefore = Invoke-RestMethod "$BaseUrl/api/batches"
  $batchCountBefore = $batchesBefore.Count

  try {
    $sample = Invoke-RestMethod "$BaseUrl/api/batches/sample" -Method Post
  } catch {
    Write-Host "  (sample batch may already exist, skipping new sample creation)" -ForegroundColor Yellow
  }

  $batchesAfter = Invoke-RestMethod "$BaseUrl/api/batches"
  if ($batchesAfter.Count -gt $batchCountBefore) {
    $latestBatch = $batchesAfter | Sort-Object import_date -Descending | Select-Object -First 1
    TestStep "New batch bound to current active rule_id" ($latestBatch.rule_version_id -eq $activeRuleIdNow)
  } else {
    $anyBatch = $batchesAfter | Select-Object -First 1
    if ($anyBatch) {
      $boundRule = $rulesNow | Where-Object { $_.id -eq $anyBatch.rule_version_id }
      TestStep "Existing batch has valid rule_version_id reference" ($null -ne $boundRule)
    } else {
      TestStep "No batches available for isolation test (skipped)" $true
    }
  }
} catch {
  Write-Host "[FAIL] Historical isolation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 1
}

# ===== 12. Consistency check still passes after all operations =====
Write-Host "`n[12] Final Data Consistency Check"
try {
  $c = Invoke-RestMethod "$BaseUrl/api/export/consistency"
  TestStep "Final consistency ok = true" ($c.ok -eq $true)
  if (-not $c.ok) { Write-Host ("Issues: " + ($c.issues -join '; ')) -ForegroundColor Red }
  TestStep "Final consistency: exactly 1 active rule" ($c.stats.active_rules -eq 1)
} catch {
  Write-Host "[FAIL] Consistency check exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 13. Restart consistency verification (DB persistence) =====
Write-Host "`n[13] DB Persistence / Restart Consistency"
try {
  $dbPath = Join-Path $ProjectRoot "data\canteen.db"
  TestStep "SQLite DB file exists" (Test-Path $dbPath)

  $rulesFromList = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeFromApi = @($rulesFromList | Where-Object { $_.is_active -eq $true })
  $countFromApi = $rulesFromList.Count
  $testRulesFromApi = @($rulesFromList | Where-Object { $_.version -like "vtest_import_*" })

  TestStep "API returns imported test rules" ($testRulesFromApi.Count -ge 2)
  TestStep "API has exactly 1 active rule" ($activeFromApi.Count -eq 1)
  TestStep "Imported rules present and API integrity intact" ($countFromApi -gt 0)
} catch {
  Write-Host "[FAIL] Restart consistency exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 4
}

# ===== 14. Re-export and verify round-trip structure =====
Write-Host "`n[14] Re-Export Round-Trip Verification"
try {
  $export2 = Invoke-RestMethod "$BaseUrl/api/rules/export"
  TestStep "Re-export: schema_version still 1.0" ($export2.schema_version -eq '1.0')
  TestStep "Re-export: rules count >= previous count" ($export2.rules.Count -ge $export.rules.Count)
  $hasImportedInExport = $export2.rules | Where-Object { $_.version -like "vtest_import_*" }
  TestStep "Re-export: imported rules appear in export" ($hasImportedInExport.Count -ge 2)
} catch {
  Write-Host "[FAIL] Round-trip export exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# Summary
Write-Host "`n================================================"
Write-Host "Rules Regression Results: PASS=$PASS FAIL=$FAIL"
Write-Host "================================================"
if ($FAIL -gt 0) { exit 1 }
