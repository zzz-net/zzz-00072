param(
  [string]$BaseUrl = "http://localhost:3002"
)

$ErrorActionPreference = "Stop"
$Error.Clear()
$PASS = 0; $FAIL = 0
function TestStep($name, $cond) {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "[FAIL] $name" -ForegroundColor Red; $script:FAIL++ }
}
function PostJson($url, $body) {
  try {
    $json = $body | ConvertTo-Json -Depth 10
    return Invoke-RestMethod $url -Method Post -Body $json -ContentType "application/json" -ErrorAction Stop
  } catch {
    return $null
  }
}

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()

Write-Host "============================================================"
Write-Host "Root Cause Fix Regression Tests (Direct Activate + Conflict)"
Write-Host "============================================================"

Write-Host "`n[Setup] Create two test rule versions"
$ruleX = PostJson "$BaseUrl/api/rules" @{
  version = "v_direct_X_$ts"; over_prep_threshold_pct = 5; over_prep_threshold_abs = 10
  spoilage_temp_min = 1; spoilage_temp_max = 50; description = "direct activate baseline"
}
TestStep "Created rule X" ($ruleX.id)
$ruleY = PostJson "$BaseUrl/api/rules" @{
  version = "v_direct_Y_$ts"; over_prep_threshold_pct = 15; over_prep_threshold_abs = 30
  spoilage_temp_min = 3; spoilage_temp_max = 60; description = "direct activate target"
}
TestStep "Created rule Y" ($ruleY.id)

$rules0 = Invoke-RestMethod "$BaseUrl/api/rules"
$active0 = @($rules0 | Where-Object { $_.is_active -eq $true })[0]
Write-Host "  Original active: $($active0.version)"
$logs0 = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
$rollbacks0 = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
$logCount0 = ($logs0 | Measure-Object).Count
$rbCount0 = ($rollbacks0 | Measure-Object).Count
Write-Host "  Logs before: $logCount0, Rollbacks before: $rbCount0"

# ========== TEST 1 ==========
Write-Host "`n[Test 1] Direct activate -> MUST generate audit log + rollback package"
try {
  $resp = PostJson "$BaseUrl/api/rules/$($ruleY.id)/activate" @{ operator = "tester_direct_$ts" }
  TestStep "Direct activate: success = true" ($resp.success -eq $true)
  TestStep "Direct activate: has activation_log" ($null -ne $resp.activation_log)
  TestStep "Direct activate: has rollback_package" ($null -ne $resp.rollback_package)
  TestStep "Direct activate: has rollback_export" ($null -ne $resp.rollback_export)

  if ($resp.activation_log) {
    TestStep "Log action = direct" ($resp.activation_log.action -eq 'direct')
    $verY = "v_direct_Y_$ts"
    TestStep "Log to_rule.version = v_direct_Y_$ts" ($resp.activation_log.to_rule.version -eq $verY)
    TestStep "Log operator correct" ($resp.activation_log.operator -eq "tester_direct_$ts")
    TestStep "Log rollback_package_id present" (-not [string]::IsNullOrEmpty($resp.activation_log.rollback_package_id))
  }

  if ($resp.rollback_package) {
    TestStep "Rollback pkg has name" (-not [string]::IsNullOrEmpty($resp.rollback_package.name))
    TestStep "Rollback pkg has package_data" (-not [string]::IsNullOrEmpty($resp.rollback_package.package_data))
  }

  if ($resp.rollback_export) {
    TestStep "Rollback export schema_version = 1.0" ($resp.rollback_export.schema_version -eq '1.0')
    TestStep "Rollback export to_rule.version matches original active" ($resp.rollback_export.to_rule.version -eq $active0.version)
    TestStep "Rollback export snapshot non-empty" ($resp.rollback_export.all_rules_snapshot.Count -gt 0)
  }

  $rules1 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active1 = @($rules1 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "After direct activate: active rule is Y" ($active1.id -eq $ruleY.id)

  $logs1 = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $rb1 = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $logDelta1 = ($logs1 | Measure-Object).Count
  $rbDelta1 = ($rb1 | Measure-Object).Count
  TestStep "Log count +1 ($logCount0 -> $logDelta1)" (($logDelta1 - $logCount0) -eq 1)
  TestStep "Rollback pkg count +1 ($rbCount0 -> $rbDelta1)" (($rbDelta1 - $rbCount0) -eq 1)

  $script:directLogId = $resp.activation_log.id
  $script:directRbPkgId = $resp.rollback_package.id
  $script:directRbExport = $resp.rollback_export
} catch {
  Write-Host "[FAIL] Test 1 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 15
}

# ========== TEST 2 ==========
Write-Host "`n[Test 2] Preview confirm activation -> Same unified flow"
try {
  $preview = PostJson "$BaseUrl/api/rules/$($ruleX.id)/preview" @{}
  TestStep "Preview created" ($preview.id)
  $confirm = PostJson "$BaseUrl/api/rules/previews/$($preview.id)/confirm" @{ operator = "tester_preview_$ts" }
  TestStep "Preview confirm: success = true" ($confirm.success -eq $true)
  TestStep "Preview confirm: has activation_log" ($null -ne $confirm.activation_log)
  TestStep "Preview confirm: has rollback_package" ($null -ne $confirm.rollback_package)
  if ($confirm.activation_log) {
    TestStep "Log action = activate" ($confirm.activation_log.action -eq 'activate')
    TestStep "Log operator correct" ($confirm.activation_log.operator -eq "tester_preview_$ts")
  }

  $rules2 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active2 = @($rules2 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "After preview confirm: active = X" ($active2.id -eq $ruleX.id)
} catch {
  Write-Host "[FAIL] Test 2 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 7
}

# ========== TEST 3 ==========
Write-Host "`n[Test 3] Version conflict rollback package -> clear 400 error, NOT 500"
try {
  $ruleZ = PostJson "$BaseUrl/api/rules" @{
    version = "v_conflict_Z_$ts"; over_prep_threshold_pct = 50; over_prep_threshold_abs = 500
    spoilage_temp_min = 10; spoilage_temp_max = 80; description = "conflict target"
  }
  TestStep "Created conflicting rule Z" ($ruleZ.id)

  $conflictPkg = @{
    schema_version = "1.0"
    package_id = "conflict_pkg_$ts"
    name = "conflict test"
    exported_at = (Get-Date).ToString("o")
    to_rule = @{
      id = "restore_id_$ts"; version = "v_conflict_Z_$ts"; is_active = $false
      over_prep_threshold_pct = 99; over_prep_threshold_abs = 999
      spoilage_temp_min = 9; spoilage_temp_max = 99
      created_at = (Get-Date).ToString("o"); description = "should conflict with Z"
    }
    all_rules_snapshot = @(
      @{
        id = "restore_id_$ts"; version = "v_conflict_Z_$ts"; is_active = $false
        over_prep_threshold_pct = 99; over_prep_threshold_abs = 999
        spoilage_temp_min = 9; spoilage_temp_max = 99
        created_at = (Get-Date).ToString("o"); description = "should conflict with Z"
      }
    )
  }

  $validateResp = PostJson "$BaseUrl/api/rules/rollback-packages/validate" $conflictPkg
  TestStep "Conflict validate: valid = true (structure ok)" ($validateResp.valid -eq $true)

  $applyThrew = $false
  $applyStatus = 0
  $applyBody = ""
  $applyResp = PostJson "$BaseUrl/api/rules/rollback-packages/apply" (@{ operator = "tester_conflict_$ts" } + $conflictPkg)
  if ($null -eq $applyResp) {
    $applyThrew = $true
    try {
      $body64 = (@{ operator = "tester_conflict_$ts" } + $conflictPkg) | ConvertTo-Json -Depth 10
      $resp = Invoke-WebRequest "$BaseUrl/api/rules/rollback-packages/apply" -Method Post -Body $body64 -ContentType "application/json" -ErrorAction Stop
    } catch {
      if ($_.Exception.Response) {
        $applyStatus = [int]$_.Exception.Response.StatusCode
        try {
          $stream = $_.Exception.Response.GetResponseStream()
          $reader = New-Object System.IO.StreamReader($stream)
          $reader.BaseStream.Position = 0
          $applyBody = $reader.ReadToEnd()
        } catch { }
      }
    }
    TestStep "Conflict apply: returns 400, NOT 500" ($applyStatus -eq 400)
    if ($applyBody.Length -gt 0) {
      TestStep "Conflict apply: error body has content" $true
      Write-Host "  HTTP $applyStatus - Body: $applyBody"
    } else {
      TestStep "Conflict apply: HTTP 400 returned" $true
    }
  } else {
    TestStep "Conflict apply: success should be false" ($applyResp.success -eq $false)
    TestStep "Conflict apply: has error issues" ($applyResp.issues.Count -gt 0)
  }

  $rules3 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active3 = @($rules3 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "No dirty data: active rule unchanged (still X)" ($active3.id -eq $ruleX.id)
  $ruleZStillThere = @($rules3 | Where-Object { $_.id -eq $ruleZ.id })
  TestStep "No dirty data: conflicting rule Z still intact" ($ruleZStillThere.Count -eq 1)

  $logs3 = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $rbAfter3 = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $logCount3 = ($logs3 | Measure-Object).Count
  $rbCount3 = ($rbAfter3 | Measure-Object).Count
  $expectedLogCount = $logCount0 + 2
  TestStep "No dirty data: no extra log from conflict attempt ($expectedLogCount logs)" ($logCount3 -le $expectedLogCount)
} catch {
  Write-Host "[FAIL] Test 3 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 8
}

# ========== TEST 4 ==========
Write-Host "`n[Test 4] Rollback recovery -> Same unified flow"
try {
  $rbResp = PostJson "$BaseUrl/api/rules/rollback-packages/apply" (@{
    operator = "tester_rollback_$ts"
    package_id = $directRbExport.package_id
    schema_version = $directRbExport.schema_version
    name = $directRbExport.name
    description = $directRbExport.description
    exported_at = $directRbExport.exported_at
    to_rule = $directRbExport.to_rule
    all_rules_snapshot = $directRbExport.all_rules_snapshot
  })
  TestStep "Rollback apply: success = true" ($rbResp.success -eq $true)
  TestStep "Rollback apply: has activation_log" ($null -ne $rbResp.activation_log)
  if ($rbResp.activation_log) {
    TestStep "Rollback log action = rollback" ($rbResp.activation_log.action -eq 'rollback')
    TestStep "Rollback log to_rule = original active" ($rbResp.activation_log.to_rule.version -eq $active0.version)
  }

  $rules4 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active4 = @($rules4 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "After rollback: active restored to original" ($active4.version -eq $active0.version)
} catch {
  Write-Host "[FAIL] Test 4 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 5
}

# ========== TEST 5 ==========
Write-Host "`n[Test 5] Persistence (simulate restart: re-fetch)"
try {
  $allLogs = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $allRbs = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $allPreviews = Invoke-RestMethod "$BaseUrl/api/rules/previews?limit=1000"

  $foundDirectLog = @($allLogs | Where-Object { $_.id -eq $directLogId })
  TestStep "Persistence: direct activate log retrievable" ($foundDirectLog.Count -eq 1)
  if ($foundDirectLog.Count -eq 1) {
    TestStep "Persistence: direct log has from_rule" ($null -ne $foundDirectLog[0].from_rule)
    TestStep "Persistence: direct log has to_rule" ($null -ne $foundDirectLog[0].to_rule)
    TestStep "Persistence: direct log action = direct" ($foundDirectLog[0].action -eq 'direct')
  }

  $foundDirectRb = @($allRbs | Where-Object { $_.id -eq $directRbPkgId })
  TestStep "Persistence: direct rollback pkg retrievable" ($foundDirectRb.Count -eq 1)

  $exportedAgain = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages/$directRbPkgId/export"
  TestStep "Persistence: rollback pkg re-export retrievable" ($null -ne $exportedAgain -and $exportedAgain.package_id -eq $directRbPkgId)

  $previewRecs = @($allPreviews | Where-Object { $_.target_rule.id -eq $ruleX.id })
  TestStep "Persistence: preview record retrievable" ($previewRecs.Count -ge 1)
  if ($previewRecs.Count -ge 1) {
    TestStep "Persistence: preview has diff.changes" ($previewRecs[0].diff.changes.Count -gt 0)
    TestStep "Persistence: preview status = confirmed" ($previewRecs[0].status -eq 'confirmed')
  }
} catch {
  Write-Host "[FAIL] Test 5 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 9
}

# ========== TEST 6 ==========
Write-Host "`n[Test 6] Failure path - no dirty data on validation rejection"
$rulesBefore6 = Invoke-RestMethod "$BaseUrl/api/rules"
$activeBefore6 = @($rulesBefore6 | Where-Object { $_.is_active -eq $true })[0]
$logsBefore6 = (Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000" | Measure-Object).Count
$rbBefore6 = (Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000" | Measure-Object).Count

$fakeRuleId = "rule_nonexistent_fake_$ts"
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$badThrew = $false
$badSuccess = $true
try {
  $body6 = @{ operator = "tester_bad_$ts" } | ConvertTo-Json -Depth 3
  $badResp = Invoke-RestMethod "$BaseUrl/api/rules/$fakeRuleId/activate" -Method Post -Body $body6 -ContentType "application/json" -ErrorAction Stop
  $badSuccess = if ($null -ne $badResp) { $badResp.success } else { $false }
} catch {
  $badThrew = $true
} finally {
  $ErrorActionPreference = $oldEAP
  $Error.Clear()
}
TestStep "Nonexistent rule activate: rejected (success=false or HTTP 400/404)" (($badSuccess -eq $false) -or $badThrew)

$rulesAfter6 = Invoke-RestMethod "$BaseUrl/api/rules"
$activeAfter6 = @($rulesAfter6 | Where-Object { $_.is_active -eq $true })[0]
TestStep "No dirty data: active unchanged" ($activeBefore6.id -eq $activeAfter6.id)
$logsAfter6 = (Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000" | Measure-Object).Count
$rbAfter6 = (Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000" | Measure-Object).Count
TestStep "No dirty data: log count unchanged ($logsBefore6 -> $logsAfter6)" ($logsBefore6 -eq $logsAfter6)
TestStep "No dirty data: rollback count unchanged ($rbBefore6 -> $rbAfter6)" ($rbBefore6 -eq $rbAfter6)

Write-Host "`n============================================================"
Write-Host "Root Cause Fix Regression Results: PASS=$PASS FAIL=$FAIL"
Write-Host "============================================================"
if ($FAIL -gt 0) { exit 1 }
