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
function CountItems($arr) {
  if ($null -eq $arr) { return 0 }
  if ($arr -is [array]) { return $arr.Length }
  if ($arr -is [System.Collections.ICollection]) { return $arr.Count }
  return 1
}

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()

Write-Host "============================================================"
Write-Host "Import + Activate Regression Tests (导入即生效专项)"
Write-Host "============================================================"

Write-Host "`n[Setup] Baseline snapshot"
$rules0 = Invoke-RestMethod "$BaseUrl/api/rules"
$active0 = @($rules0 | Where-Object { $_.is_active -eq $true })[0]
$logs0List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
$logs0 = CountItems $logs0List
$rb0List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
$rb0 = CountItems $rb0List
Write-Host "  Original active: $($active0.version)"
Write-Host "  Logs before: $logs0, Rollbacks before: $rb0"

# ========== TEST 1 ==========
Write-Host "`n[Test 1] Import + activate=1 -> MUST generate log + rollback pkg"
try {
  $importRule1 = @{
    version = "v_imp_act_A_$ts"
    over_prep_threshold_pct = 7
    over_prep_threshold_abs = 70
    spoilage_temp_min = 2
    spoilage_temp_max = 45
    description = "导入生效测试A $ts"
  }
  $pkg1 = @{
    schema_version = "1.0"
    exported_at = (Get-Date).ToString("o")
    export_source = "test_script"
    rules = @($importRule1)
  }
  $payload1 = @{ operator = "tester_import_$ts" } + $pkg1
  $resp1 = PostJson "$BaseUrl/api/rules/import?activate=1" $payload1
  TestStep "Import+activate returned body" ($null -ne $resp1)
  TestStep "Import count = 1" ($resp1.count -eq 1)
  TestStep "Import activated field present" ($null -ne $resp1.activated)
  TestStep "Import activation_log present" ($null -ne $resp1.activation_log)
  TestStep "Import rollback_package present" ($null -ne $resp1.rollback_package)
  TestStep "Import rollback_export present" ($null -ne $resp1.rollback_export)

  if ($null -ne $resp1.activation_log) {
    $log1 = $resp1.activation_log
    TestStep "Log action = direct (via activateRule)" ($log1.action -eq "direct")
    TestStep "Log to_rule.version = imported" ($log1.to_rule.version -eq $importRule1.version)
    TestStep "Log operator correct" ($log1.operator -eq "tester_import_$ts")
    TestStep "Log has rollback_package_id" ($null -ne $log1.rollback_package_id)
  } else {
    $script:FAIL += 4
  }

  if ($null -ne $resp1.rollback_package) {
    $rp1 = $resp1.rollback_package
    TestStep "Rollback pkg has name" ([string]::IsNullOrEmpty($rp1.name) -eq $false)
    TestStep "Rollback pkg has package_data" ([string]::IsNullOrEmpty($rp1.package_data) -eq $false)
  } else {
    $script:FAIL += 2
  }

  if ($null -ne $resp1.rollback_export) {
    $re1 = $resp1.rollback_export
    TestStep "Rollback export schema_version = 1.0" ($re1.schema_version -eq "1.0")
    TestStep "Rollback export to_rule.version = original active ($($active0.version))" ($re1.to_rule.version -eq $active0.version)
    TestStep "Rollback export snapshot non-empty" ((CountItems $re1.all_rules_snapshot) -gt 0)
  } else {
    $script:FAIL += 3
  }

  $rules1 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active1 = @($rules1 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "After import+activate: active = imported rule" ($active1.version -eq $importRule1.version)
  $logs1List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logs1 = CountItems $logs1List
  $rb1List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rb1 = CountItems $rb1List
  TestStep "Log count +1 ($logs0 -> $logs1)" ($logs1 -eq $logs0 + 1)
  TestStep "Rollback pkg count +1 ($rb0 -> $rb1)" ($rb1 -eq $rb0 + 1)
} catch {
  Write-Host "[FAIL] Test 1 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 18
}

# ========== TEST 2 ==========
Write-Host "`n[Test 2] Normal activate (POST /:id/activate) -> same unified flow"
try {
  $logsBefore2List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logsBefore2 = CountItems $logsBefore2List
  $rbBefore2List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rbBefore2 = CountItems $rbBefore2List

  $importRule2 = @{
    version = "v_imp_act_B_$ts"
    over_prep_threshold_pct = 8
    over_prep_threshold_abs = 80
    spoilage_temp_min = 3
    spoilage_temp_max = 50
    description = "导入不激活B $ts"
  }
  $pkg2 = @{ schema_version = "1.0"; exported_at = (Get-Date).ToString("o"); export_source = "test_script"; rules = @($importRule2) }
  $payload2 = @{ operator = "tester_import_b_$ts" } + $pkg2
  $imported2 = PostJson "$BaseUrl/api/rules/import" $payload2
  TestStep "Test2: import without activate ok" ($imported2.count -eq 1)
  TestStep "Test2: no rollback_export returned" ($null -eq $imported2.rollback_export)

  $ruleBId = $imported2.imported[0].id

  $actResp2 = PostJson "$BaseUrl/api/rules/$ruleBId/activate" @{ operator = "tester_activate_b_$ts" }
  TestStep "Test2: normal activate success" ($actResp2.success -eq $true)
  TestStep "Test2: activation_log present" ($null -ne $actResp2.activation_log)
  TestStep "Test2: rollback_package present" ($null -ne $actResp2.rollback_package)
  if ($null -ne $actResp2.activation_log) {
    TestStep "Test2: log action direct" ($actResp2.activation_log.action -eq "direct")
    TestStep "Test2: log operator correct" ($actResp2.activation_log.operator -eq "tester_activate_b_$ts")
  } else { $script:FAIL += 2 }

  $rules2 = Invoke-RestMethod "$BaseUrl/api/rules"
  $active2 = @($rules2 | Where-Object { $_.is_active -eq $true })[0]
  TestStep "Test2: active switched" ($active2.version -eq $importRule2.version)
  $logsAfter2List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logsAfter2 = CountItems $logsAfter2List
  $rbAfter2List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rbAfter2 = CountItems $rbAfter2List
  TestStep "Test2: log count +1 ($logsBefore2 -> $logsAfter2)" ($logsAfter2 -eq $logsBefore2 + 1)
  TestStep "Test2: rollback count +1 ($rbBefore2 -> $rbAfter2)" ($rbAfter2 -eq $rbBefore2 + 1)
} catch {
  Write-Host "[FAIL] Test 2 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 11
}

# ========== TEST 3 ==========
Write-Host "`n[Test 3] Import+activate validation fails -> FULL ROLLBACK no dirty data"
try {
  $rulesBefore3 = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeBefore3 = @($rulesBefore3 | Where-Object { $_.is_active -eq $true })[0]
  $logsBefore3List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logsBefore3 = CountItems $logsBefore3List
  $rbBefore3List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rbBefore3 = CountItems $rbBefore3List
  $allRuleCountBefore = CountItems $rulesBefore3

  $badRule = @{
    version = "v_imp_act_bad_$ts"
    over_prep_threshold_pct = 99
    over_prep_threshold_abs = 999
    spoilage_temp_min = 1
    spoilage_temp_max = 40
    description = "导入生效测试A $ts"
  }
  $pkg3 = @{ schema_version = "1.0"; exported_at = (Get-Date).ToString("o"); export_source = "test_script"; rules = @($badRule) }
  $payload3 = @{ operator = "tester_bad_$ts" } + $pkg3
  $oldEAP = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  $importStatus = 0
  $importBody = ""
  $resp3 = $null
  try {
    $bodyJson = $payload3 | ConvertTo-Json -Depth 10
    $resp3 = Invoke-RestMethod "$BaseUrl/api/rules/import?activate=1" -Method Post -Body $bodyJson -ContentType "application/json" -ErrorAction Stop
  } catch {
    if ($_.Exception.Response) {
      $importStatus = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $reader.BaseStream.Position = 0
        $importBody = $reader.ReadToEnd()
      } catch { }
    }
  } finally {
    $ErrorActionPreference = $oldEAP
    $Error.Clear()
  }
  $rejected = ($importStatus -eq 400) -or ($null -eq $resp3) -or ((CountItems $resp3.imported) -eq 0)
  TestStep "Bad import+activate rejected (HTTP 400 or empty imported)" $rejected
  if ($importBody.Length -gt 0) {
    Write-Host "  HTTP $importStatus - Body: $importBody"
  }

  $rulesAfter3 = Invoke-RestMethod "$BaseUrl/api/rules"
  $activeAfter3 = @($rulesAfter3 | Where-Object { $_.is_active -eq $true })[0]
  $allRuleCountAfter = CountItems $rulesAfter3
  TestStep "No dirty data: active unchanged ($($activeBefore3.version) -> $($activeAfter3.version))" ($activeBefore3.id -eq $activeAfter3.id)
  TestStep "No dirty data: rule count unchanged ($allRuleCountBefore -> $allRuleCountAfter)" ($allRuleCountBefore -eq $allRuleCountAfter)
  $logsAfter3List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logsAfter3 = CountItems $logsAfter3List
  $rbAfter3List = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rbAfter3 = CountItems $rbAfter3List
  TestStep "No dirty data: log count unchanged ($logsBefore3 -> $logsAfter3)" ($logsBefore3 -eq $logsAfter3)
  TestStep "No dirty data: rollback count unchanged ($rbBefore3 -> $rbAfter3)" ($rbBefore3 -eq $rbAfter3)
} catch {
  Write-Host "[FAIL] Test 3 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 5
}

# ========== TEST 4 ==========
Write-Host "`n[Test 4] Persistence (simulate restart: re-fetch)"
try {
  $logs4List = Invoke-RestMethod "$BaseUrl/api/rules/activation-logs?limit=1000"
  $logs4 = @($logs4List)
  $importLog = @($logs4 | Where-Object { $_.operator -like "*tester_import*" })[0]
  TestStep "Persistence: import+activate log retrievable" ($null -ne $importLog)
  if ($importLog) {
    TestStep "Persistence: log has from_rule" ($null -ne $importLog.from_rule)
    TestStep "Persistence: log has to_rule" ($null -ne $importLog.to_rule)
    TestStep "Persistence: log action = direct" ($importLog.action -eq "direct")
    TestStep "Persistence: log operator contains tester_import" ($importLog.operator -like "*tester_import*")
  } else { $script:FAIL += 4 }

  $rbList4Raw = Invoke-RestMethod "$BaseUrl/api/rules/rollback-packages?limit=1000"
  $rbList4 = @($rbList4Raw)
  $latestRb = $rbList4[0]
  TestStep "Persistence: import+activate rollback pkg retrievable" ($null -ne $latestRb)
  if ($latestRb -and $latestRb.PSObject.Properties["id"]) {
    $rbId = $latestRb.id
    $reexportUrl = "$BaseUrl/api/rules/rollback-packages/$rbId/export"
    $reexport4 = $null
    try {
      $reexport4 = Invoke-RestMethod $reexportUrl
    } catch { }
    TestStep "Persistence: rollback pkg re-export retrievable ($reexportUrl)" ($null -ne $reexport4 -and $reexport4.schema_version -eq "1.0")
  } else { $script:FAIL += 1 }
} catch {
  Write-Host "[FAIL] Test 4 exception: $($_.Exception.Message)" -ForegroundColor Red
  $script:FAIL += 6
}

Write-Host "`n============================================================"
Write-Host "Import+Activate Regression Results: PASS=$PASS FAIL=$FAIL"
Write-Host "============================================================"
if ($FAIL -gt 0) { exit 1 }
exit 0
