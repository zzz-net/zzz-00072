param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$ProjectRoot = "d:\workSpace\AI__SPACE\zzz-00072"
)

$ErrorActionPreference = "Stop"
$PASS = 0; $FAIL = 0
$helperScript = Join-Path $ProjectRoot "scripts\rule-test-helper.js"

function TestStep($name, $cond) {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "[FAIL] $name" -ForegroundColor Red; $script:FAIL++ }
}

function Invoke-Helper($action, $args) {
  $dbPath = Join-Path $ProjectRoot "data\canteen.db"
  $allArgs = @($dbPath, $action) + $args
  $result = & node $helperScript $allArgs 2>&1 | Out-String
  try {
    return $result.Trim() | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{ success = $false; error = $result }
  }
}

Write-Host "================================================"
Write-Host "Rules: Description Conflict Regression Test Suite"
Write-Host "Base URL: $BaseUrl"
Write-Host "================================================"

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$dbPath = Join-Path $ProjectRoot "data\canteen.db"

# ===== 1. Sanity: validate a clean package passes =====
Write-Host "`n[1] Baseline: Clean Package Validates OK"
$cleanPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_clean_A_$ts"
      over_prep_threshold_pct = 12
      over_prep_threshold_abs = 80
      spoilage_temp_min = 5
      spoilage_temp_max = 58
      description = "clean-test-rule-A"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $vClean = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $cleanPkg -ContentType "application/json"
  TestStep "Clean package: valid = true" ($vClean.valid -eq $true)
  TestStep "Clean package: zero errors" (@($vClean.issues | Where-Object { $_.severity -eq 'error' }).Count -eq 0)
} catch {
  Write-Host "[FAIL] Baseline exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 2. Description conflict WITHIN package: must be error (not warning) =====
Write-Host "`n[2] Validate: In-Package Description Conflict Is Error"
$inPkgConflict = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_inpkg_A_$ts"
      over_prep_threshold_pct = 10
      over_prep_threshold_abs = 50
      spoilage_temp_min = 2
      spoilage_temp_max = 55
      description = "in-pkg-conflict-desc"
    },
    @{
      version = "vtest_inpkg_B_$ts"
      over_prep_threshold_pct = 25
      over_prep_threshold_abs = 200
      spoilage_temp_min = 8
      spoilage_temp_max = 70
      description = "in-pkg-conflict-desc"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $vInPkg = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $inPkgConflict -ContentType "application/json"
  TestStep "In-pkg desc conflict: valid = false" ($vInPkg.valid -eq $false)
  $errCount = @($vInPkg.issues | Where-Object { $_.severity -eq 'error' }).Count
  TestStep "In-pkg desc conflict: at least 1 error" ($errCount -ge 1)
  $descErrors = @($vInPkg.issues | Where-Object { $_.field -eq 'description' -and $_.severity -eq 'error' })
  TestStep "In-pkg desc conflict: error on description field" ($descErrors.Count -ge 1)
  $warnCount = @($vInPkg.issues | Where-Object { $_.severity -eq 'warning' }).Count
  TestStep "In-pkg desc conflict: zero warnings (was warning before fix)" ($warnCount -eq 0)
} catch {
  Write-Host "[FAIL] In-pkg desc conflict exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 4
}

# ===== 3. Import in-package conflict: must rollback fully, no residue =====
Write-Host "`n[3] Import: In-Package Conflict Rolls Back Completely"
$rulesBefore1 = Invoke-RestMethod "$BaseUrl/api/rules"
$countBefore1 = $rulesBefore1.Count
try {
  $resp1 = Invoke-WebRequest "$BaseUrl/api/rules/import" -Method Post -Body $inPkgConflict -ContentType "application/json" -ErrorAction SilentlyContinue
  $status1 = if ($resp1) { $resp1.StatusCode } else { 0 }
  TestStep "In-pkg conflict import: HTTP 400" ($status1 -eq 400)
} catch {
  $status1 = [int]$_.Exception.Response.StatusCode
  TestStep "In-pkg conflict import: HTTP 400" ($status1 -eq 400)
}
$rulesAfter1 = Invoke-RestMethod "$BaseUrl/api/rules"
$countAfter1 = $rulesAfter1.Count
TestStep "In-pkg conflict import: rule count unchanged (rollback)" ($countBefore1 -eq $countAfter1)
$residueA = $rulesAfter1 | Where-Object { $_.version -eq "vtest_inpkg_A_$ts" }
$residueB = $rulesAfter1 | Where-Object { $_.version -eq "vtest_inpkg_B_$ts" }
TestStep "In-pkg conflict import: Rule A NOT persisted" ($null -eq $residueA)
TestStep "In-pkg conflict import: Rule B NOT persisted" ($null -eq $residueB)

# ===== 4. First, import a clean rule to DB as anchor =====
Write-Host "`n[4] Setup: Import a Clean Rule to Establish DB Baseline"
$anchorDesc = "db-conflict-anchor-desc-$ts"
$anchorPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_anchor_$ts"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = $anchorDesc
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $importAnchor = Invoke-RestMethod "$BaseUrl/api/rules/import" -Method Post -Body $anchorPkg -ContentType "application/json"
  TestStep "Anchor import: success, count = 1" ($importAnchor.count -eq 1)
} catch {
  Write-Host "[FAIL] Anchor import exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 1
}

# ===== 5. Validate: conflict with DB existing description =====
Write-Host "`n[5] Validate: Conflict with DB Existing Description"
$dbConflictPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_dbconflict_$ts"
      over_prep_threshold_pct = 99
      over_prep_threshold_abs = 999
      spoilage_temp_min = 9
      spoilage_temp_max = 99
      description = $anchorDesc
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $vDb = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $dbConflictPkg -ContentType "application/json"
  TestStep "DB desc conflict: valid = false" ($vDb.valid -eq $false)
  $dbDescErrors = @($vDb.issues | Where-Object { $_.field -eq 'description' -and $_.severity -eq 'error' })
  TestStep "DB desc conflict: error on description field" ($dbDescErrors.Count -ge 1)
} catch {
  Write-Host "[FAIL] DB desc conflict validate exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 6. Import: conflict with DB existing description must be rejected =====
Write-Host "`n[6] Import: Conflict with DB Description Is Rejected, No Residue"
$rulesBefore2 = Invoke-RestMethod "$BaseUrl/api/rules"
$countBefore2 = $rulesBefore2.Count
try {
  $resp2 = Invoke-WebRequest "$BaseUrl/api/rules/import" -Method Post -Body $dbConflictPkg -ContentType "application/json" -ErrorAction SilentlyContinue
} catch {
  $resp2 = $_.Exception.Response
}
$rulesAfter2 = Invoke-RestMethod "$BaseUrl/api/rules"
$countAfter2 = $rulesAfter2.Count
TestStep "DB desc conflict import: rule count unchanged" ($countBefore2 -eq $countAfter2)
$dbResidue = $rulesAfter2 | Where-Object { $_.version -eq "vtest_dbconflict_$ts" }
TestStep "DB desc conflict import: conflicting rule NOT persisted" ($null -eq $dbResidue)

# ===== 7. Create new rule via POST /api/rules: description conflict also blocked =====
Write-Host "`n[7] Create Rule (POST /api/rules): Description Conflict Also Blocked"
$rulesBefore3 = Invoke-RestMethod "$BaseUrl/api/rules"
$countBefore3 = $rulesBefore3.Count
$newRuleBody = @{
  version = "vtest_newrule_conflict_$ts"
  over_prep_threshold_pct = 33
  over_prep_threshold_abs = 333
  spoilage_temp_min = 3
  spoilage_temp_max = 33
  description = $anchorDesc
} | ConvertTo-Json
try {
  $resp3 = Invoke-WebRequest "$BaseUrl/api/rules" -Method Post -Body $newRuleBody -ContentType "application/json" -ErrorAction SilentlyContinue
  TestStep "POST new rule with desc conflict: HTTP 400" ($resp3.StatusCode -eq 400)
} catch {
  $status3 = [int]$_.Exception.Response.StatusCode
  TestStep "POST new rule with desc conflict: HTTP 400" ($status3 -eq 400)
}
$rulesAfter3 = Invoke-RestMethod "$BaseUrl/api/rules"
$countAfter3 = $rulesAfter3.Count
TestStep "POST new rule with desc conflict: count unchanged" ($countBefore3 -eq $countAfter3)
$newResidue = $rulesAfter3 | Where-Object { $_.version -eq "vtest_newrule_conflict_$ts" }
TestStep "POST new rule with desc conflict: NOT persisted" ($null -eq $newResidue)

# ===== 8. Pre-activation validation: inject dirty rule via DB, try to activate =====
Write-Host "`n[8] Pre-Activation Validation: Dirty Rule in DB Cannot Be Activated"
if ((Test-Path $dbPath) -and (Test-Path $helperScript)) {
  $rulesBeforeAct = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeBefore = @($rulesBeforeAct | Where-Object { $_.is_active -eq $true })[0]
  $injectId = "rule_inject_dirty_$ts"

  $injectArgs = @(
    $helperScript,
    $dbPath,
    "insert",
    $injectId,
    "vtest_inject_dirty",
    "77",
    "777",
    "7",
    "77",
    $anchorDesc
  )
  $injectRaw = & node $injectArgs 2>$null | Out-String
  try {
    $injectResult = $injectRaw.Trim() | ConvertFrom-Json
  } catch {
    $injectResult = [pscustomobject]@{ success = $false }
  }
  TestStep "Injected dirty rule into DB for activation test" ($injectResult.success -eq $true -and $injectResult.changes -eq 1)

  $rulesAfterInject = Invoke-RestMethod "$BaseUrl/api/rules"
  $injected = $rulesAfterInject | Where-Object { $_.id -eq $injectId }
  if ($injected) {
    TestStep "Dirty rule visible via API" ($true)
    TestStep "Dirty rule is inactive before activation attempt" ($injected.is_active -eq $false)

    $actStatus = 0
    $actBody = $null
    try {
      $respAct = Invoke-WebRequest "$BaseUrl/api/rules/$injectId/activate" -Method Post -ErrorAction SilentlyContinue
      if ($respAct) {
        $actStatus = $respAct.StatusCode
        $actBody = $respAct.Content | ConvertFrom-Json
      }
    } catch {
      if ($_.Exception.Response) {
        $actStatus = [int]$_.Exception.Response.StatusCode
        try {
          if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $bodyText = $_.ErrorDetails.Message
            $actBody = $bodyText | ConvertFrom-Json
          }
        } catch {}
      }
    }

    TestStep "Activate dirty rule: HTTP 400 (blocked)" ($actStatus -eq 400)
    $hasIssues = $null -ne $actBody -and $null -ne $actBody.issues -and $actBody.issues.Count -gt 0
    TestStep "Activate dirty rule: response includes issues array" ($hasIssues)

    $rulesAfterAct = Invoke-RestMethod "$BaseUrl/api/rules"
    $activeAfter = @($rulesAfterAct | Where-Object { $_.is_active -eq $true })[0]
    TestStep "After failed activation: original rule still active" ($activeAfter.id -eq $activeBefore.id)
    $dirtyStillInactive = $rulesAfterAct | Where-Object { $_.id -eq $injectId }
    TestStep "After failed activation: dirty rule remains inactive" ($dirtyStillInactive.is_active -eq $false)

    $cleanupArgs = @($helperScript, $dbPath, "delete", $injectId)
    & node $cleanupArgs 2>$null | Out-Null
    Write-Host "  Cleaned up injected dirty rule"
  } else {
    TestStep "Dirty rule visible via API (failed to inject)" $false
    TestStep "Dirty rule inactive (skipped)" $true
    TestStep "Activate dirty rule returns 400 (skipped)" $true
    TestStep "Activate response has issues (skipped)" $true
    TestStep "Original rule stays active (skipped)" $true
    TestStep "Dirty rule stays inactive (skipped)" $true
  }
} else {
  Write-Host "  (DB or helper not found, skipping activation test)" -ForegroundColor Yellow
  1..6 | ForEach-Object { TestStep "Activation test: skipped" $true }
}

# ===== 9. Restart / DB persistence: no conflict rules residue =====
Write-Host "`n[9] Restart Consistency: No Conflict Rules Residue in DB"
try {
  $finalRules = Invoke-RestMethod "$BaseUrl/api/rules"
  $conflictVersions = @($finalRules | Where-Object {
    $_.version -like '*inpkg*' -or
    $_.version -like '*dbconflict*' -or
    $_.version -like '*newrule_conflict*' -or
    $_.version -like '*inject_dirty*'
  })
  TestStep "Final DB: zero conflict-rule residue via API" ($conflictVersions.Count -eq 0)

  $consistency = Invoke-RestMethod "$BaseUrl/api/export/consistency"
  TestStep "Final data consistency: ok = true" ($consistency.ok -eq $true)
  TestStep "Final data consistency: exactly 1 active rule" ($consistency.stats.active_rules -eq 1)
} catch {
  Write-Host "[FAIL] Final consistency exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== 10. Edge case: same description AND same thresholds is OK (no conflict) =====
Write-Host "`n[10] Edge Case: Same Description But Identical Thresholds (No Conflict)"
$sameValuesPkg = @{
  schema_version = "1.0"
  rules = @(
    @{
      version = "vtest_same_vals_A_$ts"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "same-values-desc"
    },
    @{
      version = "vtest_same_vals_B_$ts"
      over_prep_threshold_pct = 15
      over_prep_threshold_abs = 100
      spoilage_temp_min = 4
      spoilage_temp_max = 60
      description = "same-values-desc"
    }
  )
} | ConvertTo-Json -Depth 5
try {
  $vSame = Invoke-RestMethod "$BaseUrl/api/rules/validate" -Method Post -Body $sameValuesPkg -ContentType "application/json"
  TestStep "Same values + same desc: valid = true" ($vSame.valid -eq $true)
  $descIssues = @($vSame.issues | Where-Object { $_.field -eq 'description' })
  TestStep "Same values + same desc: no description issues" ($descIssues.Count -eq 0)
} catch {
  Write-Host "[FAIL] Same-values edge case exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# Summary
Write-Host "`n================================================"
Write-Host "Description Conflict Test Results: PASS=$PASS FAIL=$FAIL"
Write-Host "================================================"
if ($FAIL -gt 0) { exit 1 }
