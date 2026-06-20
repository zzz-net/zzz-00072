# 食堂损耗复核台 - UI 状态闭环测试脚本
# 覆盖：关闭异常后列表/详情/头部计数同步更新，撤销后同步恢复
# 运行方式：在浏览器打开应用后，将脚本中的 JS 代码段复制到浏览器控制台执行
# 或者用 `browser_evaluate` 工具执行

param(
  [string]$BaseUrl = "http://localhost:3002"
)

$ErrorActionPreference = "Stop"
$PASS = 0; $FAIL = 0

function TestStep($name, $cond) {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; $script:PASS++ }
  else { Write-Host "[FAIL] $name" -ForegroundColor Red; $script:FAIL++ }
}

Write-Host "================================================"
Write-Host "UI State Closure Regression Test"
Write-Host "Base URL: $BaseUrl"
Write-Host "================================================"

Write-Host "`n=== Step 1: 准备测试数据 ===" -ForegroundColor Cyan
# 尝试创建一个新的测试批次，如已存在则使用现有批次
try {
  $resp = Invoke-RestMethod "$BaseUrl/api/batches/sample" -Method Post
} catch {
  Write-Host "样例批次已存在，使用现有批次测试" -ForegroundColor Yellow
}
$batches = Invoke-RestMethod "$BaseUrl/api/batches"
$batch = $batches | Where-Object { $_.name -like "*样例*" } | Select-Object -First 1
$initialUnresolved = $batch.unresolved_count
$initialAnomalyCount = $batch.anomaly_count
Write-Host "测试批次: $($batch.name)"
Write-Host "初始未结异常: $initialUnresolved"

# 获取一条未结异常
$anomalies = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=unresolved"
$testAnomaly = $anomalies[0]
Write-Host "测试异常: id=$($testAnomaly.id), type=$($testAnomaly.anomaly_type)"
TestStep "初始异常处于未结状态" ($testAnomaly.status -eq "unresolved")

Write-Host "`n=== Step 2: 关闭异常，验证后端状态（修复前导出/改判链路） ===" -ForegroundColor Cyan
$resolveBody = @{
  reason = "UI状态闭环测试-关闭";
  result = "confirmed"
} | ConvertTo-Json
$closed = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testAnomaly.id)/resolve" -Method Post -Body $resolveBody -ContentType "application/json"
TestStep "关闭后异常状态 = resolved" ($closed.status -eq "resolved")
TestStep "关闭后 manual_result = confirmed" ($closed.manual_result -eq "confirmed")

# 验证批次计数已更新
$batches2 = Invoke-RestMethod "$BaseUrl/api/batches"
$batch2 = $batches2 | Where-Object { $_.id -eq $batch.id }
TestStep "批次未结数量已减少 1" ($batch2.unresolved_count -eq ($initialUnresolved - 1))

# 验证从"未结"列表消失
$unresolvedAfter = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=unresolved"
$stillInUnresolved = $unresolvedAfter | Where-Object { $_.id -eq $testAnomaly.id }
TestStep "未结筛选列表中不再包含此异常" ($null -eq $stillInUnresolved)

# 验证在"已关闭"列表出现
$resolvedAfter = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=resolved"
$inResolved = $resolvedAfter | Where-Object { $_.id -eq $testAnomaly.id }
TestStep "已关闭列表包含此异常" ($null -ne $inResolved)

# 验证详情接口返回已关闭状态
$detail1 = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testAnomaly.id)"
TestStep "异常详情 status = resolved" ($detail1.status -eq "resolved")
TestStep "异常详情 manual_reason 正确" ($detail1.manual_reason -eq "UI状态闭环测试-关闭")

Write-Host "`n=== Step 3: 撤销关闭，验证后端状态恢复 ===" -ForegroundColor Cyan
$reopenBody = @{ reason = "UI状态闭环测试-撤销" } | ConvertTo-Json
$reopened = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testAnomaly.id)/reopen" -Method Post -Body $reopenBody -ContentType "application/json"
TestStep "撤销后异常状态 = unresolved" ($reopened.status -eq "unresolved")
TestStep "撤销后 manual_result 清空" ($null -eq $reopened.manual_result)
TestStep "撤销后 resolved_at 清空" ([string]::IsNullOrEmpty($reopened.resolved_at))

# 验证批次计数恢复
$batches3 = Invoke-RestMethod "$BaseUrl/api/batches"
$batch3 = $batches3 | Where-Object { $_.id -eq $batch.id }
TestStep "批次未结数量恢复为原值" ($batch3.unresolved_count -eq $initialUnresolved)

# 验证回到"未结"列表
$unresolvedAfter2 = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=unresolved"
$backInUnresolved = $unresolvedAfter2 | Where-Object { $_.id -eq $testAnomaly.id }
TestStep "未结列表重新包含此异常" ($null -ne $backInUnresolved)

# 验证详情接口返回未结状态
$detail2 = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testAnomaly.id)"
TestStep "撤销后详情 status = unresolved" ($detail2.status -eq "unresolved")

Write-Host "`n=== Step 4: 完整状态一致性校验 ===" -ForegroundColor Cyan
$cons = Invoke-RestMethod "$BaseUrl/api/export/consistency"
TestStep "数据一致性 ok=true" ($cons.ok -eq $true)
if (-not $cons.ok) { Write-Host ("Issues: " + ($cons.issues -join '; ')) -ForegroundColor Red }

Write-Host "`n=== Step 5: 历史记录完整性 ===" -ForegroundColor Cyan
$detail3 = Invoke-RestMethod "$BaseUrl/api/anomalies/$($testAnomaly.id)"
TestStep "异常至少有2条历史记录（关闭+撤销）" ($detail3.history.Count -ge 2)
$histActions = $detail3.history | ForEach-Object { $_.action }
TestStep "历史包含 resolve 动作" ($histActions -contains "resolve")
TestStep "历史包含 reopen 动作" ($histActions -contains "reopen")
$histReasons = $detail3.history | ForEach-Object { $_.reason }
TestStep "历史原因包含关闭原因" ($histReasons -like "*UI状态闭环测试-关闭*")
TestStep "历史原因包含撤销原因" ($histReasons -like "*UI状态闭环测试-撤销*")

Write-Host "`n=== Step 6: 类型切换完整链路 ===" -ForegroundColor Cyan
$anomaliesAll = Invoke-RestMethod "$BaseUrl/api/anomalies?batch_id=$($batch.id)&status=unresolved"
$typeTestAnomaly = $anomaliesAll | Where-Object { $_.id -ne $testAnomaly.id } | Select-Object -First 1
$originalType = $typeTestAnomaly.anomaly_type
$otherType = if ($originalType -eq 'over_prep') { 'spoilage_suspect' } else { 'over_prep' }
Write-Host "类型切换测试: 原类型=$originalType, 目标类型=$otherType"

$typeChangeBody = @{
  reason = "UI状态闭环测试-改类型";
  result = "confirmed";
  anomaly_type = $otherType
} | ConvertTo-Json
$typeChanged = Invoke-RestMethod "$BaseUrl/api/anomalies/$($typeTestAnomaly.id)/resolve" -Method Post -Body $typeChangeBody -ContentType "application/json"
TestStep "类型切换成功: anomaly_type = $otherType" ($typeChanged.anomaly_type -eq $otherType)
TestStep "状态已关闭" ($typeChanged.status -eq "resolved")

# 验证撤销后类型保留
$typeReopenBody = @{ reason = "UI状态闭环测试-撤销类型测试" } | ConvertTo-Json
$typeReopened = Invoke-RestMethod "$BaseUrl/api/anomalies/$($typeTestAnomaly.id)/reopen" -Method Post -Body $typeReopenBody -ContentType "application/json"
TestStep "撤销后类型仍为 $otherType（保留人工改判结果）" ($typeReopened.anomaly_type -eq $otherType)
TestStep "撤销后状态为未结" ($typeReopened.status -eq "unresolved")

# 最终一致性校验
$cons2 = Invoke-RestMethod "$BaseUrl/api/export/consistency"
TestStep "最终数据一致性 ok=true" ($cons2.ok -eq $true)

# Summary
Write-Host "`n================================================"
Write-Host "Results: PASS=$PASS FAIL=$FAIL"
Write-Host "================================================"
if ($FAIL -gt 0) { exit 1 }
