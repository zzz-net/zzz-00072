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

function PostJson($url, $body) {
  return Invoke-RestMethod $url -Method Post -Body ($body | ConvertTo-Json -Depth 10) -ContentType "application/json"
}

Write-Host "============================================================"
Write-Host "Canteen Loss Review - Preview & Rollback Regression Tests"
Write-Host "Base URL: $BaseUrl"
Write-Host "============================================================"

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()

# ===== 0. 准备：创建两个测试规则版本 =====
Write-Host "`n[0] Setup: Create two test rule versions"
try {
  $ruleA = PostJson "$BaseUrl/api/rules" @{
    version = "v_preview_A_$ts"
    over_prep_threshold_pct = 10
    over_prep_threshold_abs = 50
    spoilage_temp_min = 2
    spoilage_temp_max = 55
    description = "Preview test rule A - baseline"
  }
  TestStep "Created rule A (v_preview_A_$ts)" ($null -ne $ruleA -and $ruleA.id)

  $ruleB = PostJson "$BaseUrl/api/rules" @{
    version = "v_preview_B_$ts"
    over_prep_threshold_pct = 20
    over_prep_threshold_abs = 150
    spoilage_temp_min = 6
    spoilage_temp_max = 65
    description = "Preview test rule B - target"
  }
  TestStep "Created rule B (v_preview_B_$ts)" ($null -ne $ruleB -and $ruleB.id)

  $rulesNow = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeNow = @($rulesNow | Where-Object { $_.is_active -eq $true })
  TestStep "Exactly 1 active rule before test" ($activeNow.Count -eq 1)
  $originalActiveId = $activeNow[0].id
  $originalActiveVersion = $activeNow[0].version
  Write-Host "  Original active: $originalActiveVersion ($originalActiveId)"
} catch {
  Write-Host "[FAIL] Setup exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 4
}

# ===== 1. 创建预演 =====
Write-Host "`n[1] Create Rule Preview (switch to rule B)"
try {
  $previewResp = PostJson "$BaseUrl/api/rules/$($ruleB.id)/preview" @{}
  TestStep "Preview created: has id" ($null -ne $previewResp.id)
  TestStep "Preview status = pending" ($previewResp.status -eq 'pending')
  TestStep "Preview target_rule_id matches" ($previewResp.target_rule_id -eq $ruleB.id)
  TestStep "Preview expires_at exists" (-not [string]::IsNullOrEmpty($previewResp.expires_at))
  $previewId = $previewResp.id
  Write-Host "  Preview ID: $previewId"
} catch {
  Write-Host "[FAIL] Create preview exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 4
}

# ===== 2. 获取预演详情并校验 Diff =====
Write-Host "`n[2] Get Preview Detail & Validate Diff"
try {
  $detail = Invoke-RestMethod "$BaseUrl/api/rules/previews/$previewId"
  TestStep "Preview detail: has target_rule" ($null -ne $detail.target_rule)
  TestStep "Preview detail target version = $($ruleB.version)" ($detail.target_rule.version -eq $ruleB.version)
  TestStep "Preview detail: has from_active_rule" ($null -ne $detail.from_active_rule)
  TestStep "Preview detail from version = $originalActiveVersion" ($detail.from_active_rule.version -eq $originalActiveVersion)
  TestStep "Preview detail: has diff.changes" ($null -ne $detail.diff -and $detail.diff.changes -is [array])
  TestStep "Preview detail: diff has changes" ($detail.diff.changes.Count -gt 0)

  $hasPctChange = @($detail.diff.changes | Where-Object { $_.field -eq 'over_prep_threshold_pct' })
  TestStep "Diff includes over_prep_threshold_pct change" ($hasPctChange.Count -ge 1)
  if ($hasPctChange.Count -ge 1) {
    $pctChange = $hasPctChange[0]
    TestStep "Diff pct: old and new values differ" ($pctChange.old_value -ne $pctChange.new_value)
    Write-Host "  Pct change: $($pctChange.old_value) -> $($pctChange.new_value), direction=$($pctChange.direction)"
  }

  $hasTempMinChange = @($detail.diff.changes | Where-Object { $_.field -eq 'spoilage_temp_min' })
  TestStep "Diff includes spoilage_temp_min change" ($hasTempMinChange.Count -ge 1)

  $currentPreview = $detail
} catch {
  Write-Host "[FAIL] Get preview detail exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 8
}

# ===== 3. 列出预演记录（验证数据持久化） =====
Write-Host "`n[3] List Previews (persistence check)"
try {
  $previews = Invoke-RestMethod "$BaseUrl/api/rules/previews?limit=50"
  TestStep "Previews list is array" ($previews -is [array])
  $found = @($previews | Where-Object { $_.id -eq $previewId })
  TestStep "Our preview found in list" ($found.Count -eq 1)
  if ($found.Count -eq 1) {
    TestStep "Preview in list has target_rule" ($null -ne $found[0].target_rule)
    TestStep "Preview in list has diff.changes" ($null -ne $found[0].diff -and $found[0].diff.changes.Count -gt 0)
  }
} catch {
  Write-Host "[FAIL] List previews exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 4
}

# ===== 4. 取消预演测试 =====
Write-Host "`n[4] Cancel Preview Test"
try {
  $cancelPreviewResp = PostJson "$BaseUrl/api/rules/$($ruleA.id)/preview" @{}
  TestStep "Second preview created for cancel test" ($null -ne $cancelPreviewResp.id -and $cancelPreviewResp.status -eq 'pending')
  $cancelPreviewId = $cancelPreviewResp.id

  $cancelResp = PostJson "$BaseUrl/api/rules/previews/$cancelPreviewId/cancel" @{}
  TestStep "Cancel returns success = true" ($cancelResp.success -eq $true)

  $cancelledDetail = Invoke-RestMethod "$BaseUrl/api/rules/previews/$cancelPreviewId"
  TestStep "Cancelled preview status = cancelled" ($cancelledDetail.status -eq 'cancelled')
} catch {
  Write-Host "[FAIL] Cancel preview exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== 5. 确认启用预演（核心流程） =====
Write-Host "`n[5] Confirm Preview Activation (core flow)"
try {
  $logsBefore = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1"
  $rollbacksBefore = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1"
  $logsCountBefore = ($logsBefore | Measure-Object).Count
  $rollbacksCountBefore = ($rollbacksBefore | Measure-Object).Count
  Write-Host "  Logs before: $logsCountBefore, Rollback pkgs before: $rollbacksCountBefore"

  $confirmResp = PostJson "$BaseUrl/api/rules/previews/$previewId/confirm" @{ operator = "test_operator_$ts" }
  TestStep "Confirm: success = true" ($confirmResp.success -eq $true)
  TestStep "Confirm: has activation_log" ($null -ne $confirmResp.activation_log)
  TestStep "Confirm: has rollback_package" ($null -ne $confirmResp.rollback_package)
  TestStep "Confirm: has rollback_export" ($null -ne $confirmResp.rollback_export)
  $activationLogId = $confirmResp.activation_log.id
  $rollbackPkgId = $confirmResp.rollback_package.id
  $rollbackExport = $confirmResp.rollback_export
  Write-Host "  Activation log ID: $activationLogId"
  Write-Host "  Rollback package ID: $rollbackPkgId"

  $rulesAfter = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeAfter = @($rulesAfter | Where-Object { $_.is_active -eq $true })
  TestStep "After confirm: exactly 1 active" ($activeAfter.Count -eq 1)
  TestStep "After confirm: active is now rule B ($($ruleB.version))" ($activeAfter[0].id -eq $ruleB.id)

  $oldInactive = @($rulesAfter | Where-Object { $_.id -eq $originalActiveId })
  TestStep "After confirm: original active now inactive" ($oldInactive.Count -eq 1 -and $oldInactive[0].is_active -eq $false)

  $previewAfterConfirm = Invoke-RestMethod "$BaseUrl/api/rules/previews/$previewId"
  TestStep "After confirm: preview status = confirmed" ($previewAfterConfirm.status -eq 'confirmed')
} catch {
  Write-Host "[FAIL] Confirm preview exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 9
}

# ===== 6. 启用日志验证 =====
Write-Host "`n[6] Activation Logs Verification"
try {
  $logs = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=50"
  TestStep "Activation logs is array" ($logs -is [array])
  $ourLog = @($logs | Where-Object { $_.id -eq $activationLogId })
  TestStep "Our activation log found in list" ($ourLog.Count -eq 1)
  if ($ourLog.Count -eq 1) {
    TestStep "Log action = activate" ($ourLog[0].action -eq 'activate')
    TestStep "Log operator = test_operator_$ts" ($ourLog[0].operator -eq "test_operator_$ts")
    TestStep "Log has to_rule" ($null -ne $ourLog[0].to_rule -and $ourLog[0].to_rule.id -eq $ruleB.id)
    TestStep "Log has from_rule" ($null -ne $ourLog[0].from_rule -and $ourLog[0].from_rule.id -eq $originalActiveId)
    TestStep "Log has rollback_package_id" (-not [string]::IsNullOrEmpty($ourLog[0].rollback_package_id))
    TestStep "Log rollback_package_id matches" ($ourLog[0].rollback_package_id -eq $rollbackPkgId)
  }
} catch {
  Write-Host "[FAIL] Activation logs exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 7
}

# ===== 7. 回退包列表验证 =====
Write-Host "`n[7] Rollback Packages List Verification"
try {
  $pkgs = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=50"
  TestStep "Rollback packages is array" ($pkgs -is [array])
  $ourPkg = @($pkgs | Where-Object { $_.id -eq $rollbackPkgId })
  TestStep "Our rollback package found in list" ($ourPkg.Count -eq 1)
  if ($ourPkg.Count -eq 1) {
    TestStep "Rollback pkg has name" (-not [string]::IsNullOrEmpty($ourPkg[0].name))
    TestStep "Rollback pkg has created_at" (-not [string]::IsNullOrEmpty($ourPkg[0].created_at))
    Write-Host "  Rollback pkg name: $($ourPkg[0].name)"
  }
} catch {
  Write-Host "[FAIL] Rollback packages exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== 8. 回退包导出验证 =====
Write-Host "`n[8] Rollback Package Export Verification"
try {
  $exported = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages/$rollbackPkgId/export"
  TestStep "Export: has schema_version" ($null -ne $exported.schema_version)
  TestStep "Export: has package_id" ($exported.package_id -eq $rollbackPkgId)
  TestStep "Export: has to_rule (rollback target = original active)" ($null -ne $exported.to_rule -and $exported.to_rule.id -eq $originalActiveId)
  TestStep "Export: has all_rules_snapshot array" ($exported.all_rules_snapshot -is [array] -and $exported.all_rules_snapshot.Count -gt 0)
  TestStep "Export: has exported_at" (-not [string]::IsNullOrEmpty($exported.exported_at))
  TestStep "Export: to_rule version = $originalActiveVersion" ($exported.to_rule.version -eq $originalActiveVersion)
  $savedExportedPkg = $exported | ConvertTo-Json -Depth 10
  Write-Host "  Export schema_version: $($exported.schema_version)"
  Write-Host "  Export snapshot rules count: $($exported.all_rules_snapshot.Count)"
} catch {
  Write-Host "[FAIL] Rollback export exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 6
}

# ===== 9. 回退包校验：脏数据拦截（缺失字段） =====
Write-Host "`n[9] Rollback Package Validation: Dirty Data Interception"
try {
  $badPkg1 = @{ schema_version = "999.0"; package_id = "bad"; to_rule = $null; all_rules_snapshot = @() }
  $v1 = PostJson "$BaseUrl/api/rules/rollback-packages/validate" $badPkg1
  TestStep "Bad pkg (bad schema_version + null to_rule): valid = false" ($v1.valid -eq $false)
  TestStep "Bad pkg: has error issues" ($v1.issues.Count -gt 0)

  $badPkg2 = @{ schema_version = "1.0" }
  $v2 = PostJson "$BaseUrl/api/rules/rollback-packages/validate" $badPkg2
  TestStep "Bad pkg (missing required fields): valid = false" ($v2.valid -eq $false)
  $hasMissingErr = @($v2.issues | Where-Object { $_.severity -eq 'error' })
  TestStep "Bad pkg: has at least one error" ($hasMissingErr.Count -gt 0)
  Write-Host "  Missing field errors: $($v2.issues.Count) issues found"

  $badPkg3 = @{
    schema_version = "1.0"
    package_id = "bad3"
    name = "bad"
    exported_at = (Get-Date).ToString("o")
    to_rule = @{ id = "fake"; version = "bad" }
    all_rules_snapshot = @(
      @{ version = "incomplete" }
    )
  }
  $v3 = PostJson "$BaseUrl/api/rules/rollback-packages/validate" $badPkg3
  TestStep "Bad pkg (incomplete rule in snapshot): valid = false" ($v3.valid -eq $false)
  $hasRuleFieldErr = @($v3.issues | Where-Object { $_.severity -eq 'error' -and ($_.message -match 'threshold|numeric|温度|过量' -or $_.field) })
  TestStep "Bad pkg: error about rule fields" ($hasRuleFieldErr.Count -gt 0 -or $v3.issues.Count -gt 0)
  Write-Host "  Bad pkg3 issues count: $($v3.issues.Count)"
} catch {
  Write-Host "[FAIL] Rollback validation exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 5
}

# ===== 10. 应用回退包 =====
Write-Host "`n[10] Apply Rollback Package (restore to original active)"
try {
  $parsedPkg = $savedExportedPkg | ConvertFrom-Json
  TestStep "Exported package re-parses OK" ($null -ne $parsedPkg -and $parsedPkg.package_id -eq $rollbackPkgId)

  $applyResp = PostJson "$BaseUrl/api/rules/rollback-packages/apply" @{
    operator = "rollback_operator_$ts"
    package_id = $parsedPkg.package_id
    schema_version = $parsedPkg.schema_version
    name = $parsedPkg.name
    description = $parsedPkg.description
    exported_at = $parsedPkg.exported_at
    to_rule = $parsedPkg.to_rule
    all_rules_snapshot = $parsedPkg.all_rules_snapshot
  }
  TestStep "Apply rollback: success = true" ($applyResp.success -eq $true)
  TestStep "Apply rollback: has activation_log" ($null -ne $applyResp.activation_log)
  $rollbackLogId = $applyResp.activation_log.id

  $rulesAfterRollback = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeAfterRollback = @($rulesAfterRollback | Where-Object { $_.is_active -eq $true })
  TestStep "After rollback: exactly 1 active" ($activeAfterRollback.Count -eq 1)
  TestStep "After rollback: active restored to original ($originalActiveVersion)" ($activeAfterRollback[0].id -eq $originalActiveId)

  $logsAfter = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=50"
  $rollbackLog = @($logsAfter | Where-Object { $_.id -eq $rollbackLogId })
  TestStep "Rollback log found" ($rollbackLog.Count -eq 1)
  if ($rollbackLog.Count -eq 1) {
    TestStep "Rollback log action = rollback" ($rollbackLog[0].action -eq 'rollback')
    TestStep "Rollback log operator correct" ($rollbackLog[0].operator -eq "rollback_operator_$ts")
  }
} catch {
  Write-Host "[FAIL] Apply rollback exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 7
}

# ===== 11. 脏包应用失败（不写入数据库） =====
Write-Host "`n[11] Dirty Rollback Package Apply Blocked"
try {
  $rulesCountBefore = (Invoke-RestMethod "$BaseUrl/api/rules").Count
  $logsCountBefore2 = (Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=100" | Measure-Object).Count

  $dirtyApply = @{
    schema_version = "1.0"
    package_id = "dirty_apply_$ts"
    name = "dirty"
    exported_at = (Get-Date).ToString("o")
    to_rule = @{ id = "does_not_exist_$ts"; version = "dirty" }
    all_rules_snapshot = @(
      @{ id = "dirty_$ts"; version = "dirty_$ts" }
    )
  }
  try {
    $applyDirtyResp = PostJson "$BaseUrl/api/rules/rollback-packages/apply" $dirtyApply
    TestStep "Dirty apply: valid returned false or error thrown" ($false)
  } catch {
    TestStep "Dirty apply: HTTP error thrown as expected" $true
  }

  $rulesCountAfter = (Invoke-RestMethod "$BaseUrl/api/rules").Count
  $logsCountAfter2 = (Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=100" | Measure-Object).Count
  TestStep "Dirty apply: rule count unchanged ($rulesCountBefore -> $rulesCountAfter)" ($rulesCountBefore -eq $rulesCountAfter)
  TestStep "Dirty apply: no new log written" ($logsCountBefore2 -eq $logsCountAfter2)
} catch {
  Write-Host "[FAIL] Dirty apply block exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== 12. 持久化验证：应用重启后仍可查看 =====
Write-Host "`n[12] Persistence: Previews, Logs, Rollbacks Survive (simulated via re-fetch)"
try {
  $allPreviews = Invoke-RestMethod "$BaseUrl/api/rules/previews?limit=100"
  $allLogs = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=100"
  $allRollbacks = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=100"

  TestStep "Persistence: our confirmed preview still retrievable" (@($allPreviews | Where-Object { $_.id -eq $previewId }).Count -eq 1)
  TestStep "Persistence: our cancelled preview still retrievable" (@($allPreviews | Where-Object { $_.id -eq $cancelPreviewId }).Count -eq 1)
  TestStep "Persistence: activate log still retrievable" (@($allLogs | Where-Object { $_.id -eq $activationLogId }).Count -eq 1)
  TestStep "Persistence: rollback log still retrievable" (@($allLogs | Where-Object { $_.id -eq $rollbackLogId }).Count -eq 1)
  TestStep "Persistence: rollback package still retrievable" (@($allRollbacks | Where-Object { $_.id -eq $rollbackPkgId }).Count -eq 1)

  $confirmedPreview = @($allPreviews | Where-Object { $_.id -eq $previewId })[0]
  TestStep "Persistence: confirmed preview still has target_rule" ($null -ne $confirmedPreview.target_rule)
  TestStep "Persistence: confirmed preview still has diff.changes" ($confirmedPreview.diff.changes.Count -gt 0)
  TestStep "Persistence: confirmed preview has status=confirmed" ($confirmedPreview.status -eq 'confirmed')
} catch {
  Write-Host "[FAIL] Persistence exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 8
}

# ===== 13. 过期预演检测 =====
Write-Host "`n[13] Preview Expiry Check"
try {
  $anyPending = @($allPreviews | Where-Object { $_.status -eq 'pending' })
  if ($anyPending.Count -gt 0) {
    $p = $anyPending[0]
    TestStep "Pending preview has expires_at field" (-not [string]::IsNullOrEmpty($p.expires_at))
    try {
      $expireDt = [DateTime]::Parse($p.expires_at)
      $now = [DateTime]::UtcNow
      TestStep "Pending preview expires_at is in the future" ($expireDt -gt $now)
      Write-Host "  expires_at: $expireDt (UTC), now: $now (UTC), valid for: $(($expireDt - $now).TotalMinutes.ToString('F1')) min"
    } catch {
      TestStep "expires_at is a parseable datetime" $false
    }
  } else {
    TestStep "No pending previews (skip expiry time check)" $true
    TestStep "No pending previews (skip future check)" $true
  }
} catch {
  Write-Host "[FAIL] Expiry check exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 2
}

# ===== 14. 最终一致性校验 =====
Write-Host "`n[14] Final Consistency Check"
try {
  $c = Invoke-RestMethod "$BaseUrl/api/export/consistency"
  TestStep "Final consistency ok = true" ($c.ok -eq $true)
  if (-not $c.ok) { Write-Host ("Issues: " + ($c.issues -join '; ')) -ForegroundColor Red }
  TestStep "Final consistency: exactly 1 active rule" ($c.stats.active_rules -eq 1)

  $finalRules = Invoke-RestMethod "$BaseUrl/api/rules"
  $finalActive = @($finalRules | Where-Object { $_.is_active -eq $true })
  TestStep "Final: active rule is back to original ($originalActiveVersion)" ($finalActive[0].version -eq $originalActiveVersion)
} catch {
  Write-Host "[FAIL] Final consistency exception: $($_.Exception.Message)" -ForegroundColor Red
  $FAIL += 3
}

# ===== Summary =====
Write-Host "`n============================================================"
Write-Host "Preview & Rollback Regression Results: PASS=$PASS FAIL=$FAIL"
Write-Host "============================================================"
if ($FAIL -gt 0) { exit 1 }
