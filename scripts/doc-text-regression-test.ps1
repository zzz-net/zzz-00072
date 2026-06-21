param(
    [string]$BackendBase = "http://localhost:3002",
    [string]$FrontendBase = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:Pass = 0
$script:Fail = 0

# ============================================================
# COMPLETELY encoding-safe matching using UTF-8 byte sequences
# No string encoding issues at all - works on any PowerShell
# ============================================================

# Convert a string to UTF-8 bytes
function ToBytes([string]$s) {
    return [System.Text.Encoding]::UTF8.GetBytes($s)
}

# Check if byte array $haystack contains byte sequence $needle
function HasBytes([byte[]]$haystack, [byte[]]$needle) {
    if ($null -eq $haystack -or $null -eq $needle) { return $false }
    if ($needle.Length -eq 0 -or $haystack.Length -lt $needle.Length) { return $false }
    
    for ($i = 0; $i -le $haystack.Length - $needle.Length; $i++) {
        $match = $true
        for ($j = 0; $j -lt $needle.Length; $j++) {
            if ($haystack[$i + $j] -ne $needle[$j]) { $match = $false; break }
        }
        if ($match) { return $true }
    }
    return $false
}

# Check if byte array $haystack does NOT contain byte sequence $needle
function NotHasBytes([byte[]]$haystack, [byte[]]$needle) {
    return -not (HasBytes $haystack $needle)
}

# Build keyword dictionary (UTF-8 byte sequences)
$K = @{}
function Def([string]$name, [string]$value) {
    $K[$name] = ToBytes $value
}

# Tab and button names
Def "PreviewAndActivate" "预演并启用"
Def "ActivateThisVersion" "启用此版本"
Def "RuleVersionTab" "规则版本 Tab"
Def "PreviewRecordTab" "预演记录 Tab"
Def "ActivationLogTab" "启用日志 Tab"
Def "RollbackPackageTab" "回退包 Tab"
Def "RuleVersion" "规则版本"
Def "PreviewRecord" "预演记录"
Def "ActivationLog" "启用日志"
Def "RollbackPackage" "回退包"
Def "ImportRollback" "导入回退包"
Def "ApplyRollback" "应用回退"
Def "ExportBtn" "导出"

# Flow description
Def "SafeFlowArrow" "预演 → 确认 → 审计 → 回退"
Def "Step1" "1. 预演"
Def "Step2" "2. 确认"
Def "Step3" "3. 审计"
Def "Step4" "4. 回退"
Def "Step5" "5. 失败处理"

# Action types and colors
Def "Direct" "直接启用"
Def "Grey" "(灰)"
Def "Blue" "(蓝)"
Def "Yellow" "(黄)"

# Failure messages
Def "PreviewExpired" "预演已过期"
Def "VersionConflict" "版本冲突"
Def "VersionConflictMsg" "版本号冲突"
Def "ActivationValidation" "激活校验不通过"
Def "DupDescDiffThresh" "与已有规则描述重复但阈值不一致"

# Other text
Def "ActivateOnImport" "导入后立即生效"
Def "AuditFlow" "审计链路"
Def "TenMinutes" "10 分钟"
Def "RestartPersist" "重启后仍可查看"
Def "PreviewConfirmTitle" "变更预演确认"
Def "ConfirmHint1" "确认启用后系统会"
Def "ConfirmHint2" "自动生成一个可导出的回退包"
Def "RollbackConflictText" "回退包内版本号冲突"

# API endpoints
Def "ApiImport" "/api/rules/import"
Def "ApiExport" "/api/rules/export"
Def "ApiPreviews" "/api/rules/previews"
Def "ApiActivationLogs" "/api/rules/activation-logs"
Def "ApiRollbackPackages" "/api/rules/rollback-packages"
Def "ApiRollbackApply" "/api/rules/rollback-packages/apply"

# DB tables
Def "TablePreview" "RULE_PREVIEW"
Def "TableLog" "RULE_ACTIVATION_LOG"
Def "TableRb" "RULE_ROLLBACK_PACKAGE"

# Action type constants
Def "ActDirect" "'direct'"
Def "ActActivate" "'activate'"
Def "ActRollback" "'rollback'"
Def "CommonFunc" "_activateRuleAndAudit"

# English keywords
Def "JSON" "JSON"

function Test-Case {
    param(
        [string]$Name,
        [scriptblock]$Test
    )
    try {
        & $Test
        Write-Host "  [PASS] $Name" -ForegroundColor Green
        $script:Pass++
    } catch {
        Write-Host "  [FAIL] $Name" -ForegroundColor Red
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor DarkGray
        $script:Fail++
    }
}

function CountItems {
    param($obj)
    if ($null -eq $obj) { return 0 }
    if ($obj -is [array]) { return $obj.Length }
    if ($obj.PSObject.Properties["Count"]) { return [int]$obj.Count }
    return 1
}

# Locate files safely
$root = Split-Path -Parent $PSScriptRoot
$docDir = Join-Path $root ".trae\documents"
$archFile = Get-ChildItem -Path $docDir -Filter "*Architecture*" | Select-Object -First 1 -ExpandProperty FullName
$readmeFile = Join-Path $root "README.md"
$rulesTsFile = Join-Path $root "api\rules.ts"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Doc & Text Regression Test" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  README: $readmeFile" -ForegroundColor DarkGray
Write-Host "  ArchDoc: $archFile" -ForegroundColor DarkGray
Write-Host "  Backend: $rulesTsFile" -ForegroundColor DarkGray
Write-Host "  Matching: UTF-8 byte sequence (100% encoding safe)" -ForegroundColor DarkGray

# Read all files as byte arrays (no encoding issues at all)
$readmeBytes = [System.IO.File]::ReadAllBytes($readmeFile)
$archBytes = [System.IO.File]::ReadAllBytes($archFile)
$rulesTsBytes = [System.IO.File]::ReadAllBytes($rulesTsFile)

# ===============================================
# Test Set 1: README key text
# ===============================================
Write-Host "`n[1] README key text check" -ForegroundColor Yellow

Test-Case "README mentions safe flow (preview -> confirm -> audit -> rollback)" {
    if (NotHasBytes $readmeBytes $K["SafeFlowArrow"]) { throw "Missing safe flow description" }
}

Test-Case "README has 'Preview and Activate' button (NOT old 'Activate this version')" {
    if (NotHasBytes $readmeBytes $K["PreviewAndActivate"]) { throw "Missing 'Preview and Activate' button" }
    if (HasBytes $readmeBytes $K["ActivateThisVersion"]) { throw "Still has outdated 'Activate this version'" }
}

Test-Case "README mentions 4 tabs (by 'X Tab' name)" {
    if (NotHasBytes $readmeBytes $K["RuleVersionTab"]) { throw "Missing Rule versions tab" }
    if (NotHasBytes $readmeBytes $K["PreviewRecordTab"]) { throw "Missing Preview records tab" }
    if (NotHasBytes $readmeBytes $K["ActivationLogTab"]) { throw "Missing Activation log tab" }
    if (NotHasBytes $readmeBytes $K["RollbackPackageTab"]) { throw "Missing Rollback package tab" }
}

Test-Case "README mentions 3 action types with color labels" {
    if (NotHasBytes $readmeBytes $K["Direct"]) { throw "Missing 'direct' action type" }
    if (NotHasBytes $readmeBytes $K["Grey"]) { throw "Missing grey label for direct" }
    if (NotHasBytes $readmeBytes $K["Blue"]) { throw "Missing blue label for activate" }
    if (NotHasBytes $readmeBytes $K["Yellow"]) { throw "Missing yellow label for rollback" }
}

Test-Case "README mentions 5-step flow (preview/confirm/audit/rollback/failure)" {
    if (NotHasBytes $readmeBytes $K["Step1"]) { throw "Missing step 1 preview" }
    if (NotHasBytes $readmeBytes $K["Step2"]) { throw "Missing step 2 confirm" }
    if (NotHasBytes $readmeBytes $K["Step3"]) { throw "Missing step 3 audit" }
    if (NotHasBytes $readmeBytes $K["Step4"]) { throw "Missing step 4 rollback" }
    if (NotHasBytes $readmeBytes $K["Step5"]) { throw "Missing step 5 failure handling" }
}

Test-Case "README mentions 3 failure scenarios" {
    if (NotHasBytes $readmeBytes $K["PreviewExpired"]) { throw "Missing preview expired handling" }
    if (NotHasBytes $readmeBytes $K["VersionConflict"]) { throw "Missing version conflict handling" }
    if (NotHasBytes $readmeBytes $K["ActivationValidation"]) { throw "Missing activation validation handling" }
}

Test-Case "README mentions Import rollback package button" {
    if (NotHasBytes $readmeBytes $K["ImportRollback"]) { throw "Missing Import rollback package" }
}

Test-Case "README mentions Apply rollback button" {
    if (NotHasBytes $readmeBytes $K["ApplyRollback"]) { throw "Missing Apply rollback" }
}

Test-Case "README mentions Export rollback package as JSON" {
    if (NotHasBytes $readmeBytes $K["ExportBtn"]) { throw "Missing Export" }
    if (NotHasBytes $readmeBytes $K["JSON"]) { throw "Missing JSON" }
}

Test-Case "README clarifies activate-on-import goes through audit flow" {
    if (NotHasBytes $readmeBytes $K["ActivateOnImport"]) { throw "Missing activate-on-import" }
    if (NotHasBytes $readmeBytes $K["AuditFlow"]) { throw "Missing audit flow" }
}

Test-Case "README mentions preview TTL (10 minutes)" {
    if (NotHasBytes $readmeBytes $K["TenMinutes"]) { throw "Missing 10 minutes TTL" }
}

Test-Case "README mentions persistence across restart" {
    if (NotHasBytes $readmeBytes $K["RestartPersist"]) { throw "Missing restart persistence" }
}

# ===============================================
# Test Set 2: Technical Architecture doc
# ===============================================
Write-Host "`n[2] Technical Architecture doc check" -ForegroundColor Yellow

Test-Case "Architecture doc includes all new API endpoints" {
    if (NotHasBytes $archBytes $K["ApiImport"]) { throw "Missing /api/rules/import" }
    if (NotHasBytes $archBytes $K["ApiExport"]) { throw "Missing /api/rules/export" }
    if (NotHasBytes $archBytes $K["ApiPreviews"]) { throw "Missing /api/rules/previews" }
    if (NotHasBytes $archBytes $K["ApiActivationLogs"]) { throw "Missing /api/rules/activation-logs" }
    if (NotHasBytes $archBytes $K["ApiRollbackPackages"]) { throw "Missing /api/rules/rollback-packages" }
    if (NotHasBytes $archBytes $K["ApiRollbackApply"]) { throw "Missing /api/rules/rollback-packages/apply" }
}

Test-Case "Architecture doc includes 3 new tables" {
    if (NotHasBytes $archBytes $K["TablePreview"]) { throw "Missing RULE_PREVIEW table" }
    if (NotHasBytes $archBytes $K["TableLog"]) { throw "Missing RULE_ACTIVATION_LOG table" }
    if (NotHasBytes $archBytes $K["TableRb"]) { throw "Missing RULE_ROLLBACK_PACKAGE table" }
}

Test-Case "Architecture doc includes 3 action types (direct/activate/rollback)" {
    if (NotHasBytes $archBytes $K["ActDirect"]) { throw "Missing 'direct'" }
    if (NotHasBytes $archBytes $K["ActActivate"]) { throw "Missing 'activate'" }
    if (NotHasBytes $archBytes $K["ActRollback"]) { throw "Missing 'rollback'" }
}

Test-Case "Architecture doc includes version switch rollback on failure" {
    if (NotHasBytes $archBytes $K["VersionConflict"]) { throw "Missing version switch rollback" }
}

Test-Case "Architecture doc includes preview expiry concurrent detection" {
    if (NotHasBytes $archBytes $K["PreviewExpired"]) { throw "Missing preview expiry detection" }
}

Test-Case "Architecture doc includes rollback package conflict validation" {
    if (NotHasBytes $archBytes $K["VersionConflict"]) { throw "Missing rollback conflict validation" }
}

# ===============================================
# Test Set 3: Frontend visible text (via HTML byte fetch)
# ===============================================
Write-Host "`n[3] Frontend visible text check" -ForegroundColor Yellow

Test-Case "Frontend page has 4 tab names" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["RuleVersion"]) { throw "Missing Rule versions tab" }
    if (NotHasBytes $htmlBytes $K["PreviewRecord"]) { throw "Missing Preview records tab" }
    if (NotHasBytes $htmlBytes $K["ActivationLog"]) { throw "Missing Activation log tab" }
    if (NotHasBytes $htmlBytes $K["RollbackPackage"]) { throw "Missing Rollback package tab" }
}

Test-Case "Frontend has 'Preview and Activate' button (NOT 'Activate this version')" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["PreviewAndActivate"]) { throw "Missing 'Preview and Activate' button" }
    if (HasBytes $htmlBytes $K["ActivateThisVersion"]) { throw "Outdated 'Activate this version' found" }
}

Test-Case "Frontend has 'Import rollback package' button" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["ImportRollback"]) { throw "Missing 'Import rollback package' button" }
}

Test-Case "Frontend has 'Apply rollback' button" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["ApplyRollback"]) { throw "Missing 'Apply rollback' button" }
}

Test-Case "Frontend has 'Preview Confirmation' dialog title" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["PreviewConfirmTitle"]) { throw "Missing preview dialog title" }
}

Test-Case "Frontend has preview confirmation hint text" {
    $resp = Invoke-WebRequest -Uri $FrontendBase/rules -UseBasicParsing
    $htmlBytes = $resp.RawContentStream.ToArray()
    if (NotHasBytes $htmlBytes $K["ConfirmHint1"]) { throw "Missing confirmation hint 1" }
    if (NotHasBytes $htmlBytes $K["ConfirmHint2"]) { throw "Missing confirmation hint 2" }
}

# ===============================================
# Test Set 4: API error messages & response fields
# ===============================================
Write-Host "`n[4] API error messages & response check" -ForegroundColor Yellow

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$rule1 = @{
    version = "v_doc_test1_$ts"
    over_prep_threshold_pct = 6
    over_prep_threshold_abs = 60
    spoilage_temp_min = 2
    spoilage_temp_max = 48
    description = "doc test same desc $ts"
}
$rule2 = @{
    version = "v_doc_test2_$ts"
    over_prep_threshold_pct = 99
    over_prep_threshold_abs = 999
    spoilage_temp_min = 2
    spoilage_temp_max = 48
    description = "doc test same desc $ts"
}

Test-Case "POST /import activate failure: 400 + readable error + issues array" {
    $pkg1 = @{ schema_version = "1.0"; exported_at = (Get-Date).ToString("o"); export_source = "doc_test"; rules = @($rule1) }
    $pkg2 = @{ schema_version = "1.0"; exported_at = (Get-Date).ToString("o"); export_source = "doc_test"; rules = @($rule2) }
    $json1 = $pkg1 | ConvertTo-Json -Depth 10
    $json2 = $pkg2 | ConvertTo-Json -Depth 10

    $resp1 = Invoke-RestMethod "$BackendBase/api/rules/import?activate=1" -Method Post -Body $json1 -ContentType "application/json"
    if (-not $resp1.activated) { throw "First import did not activate" }

    try {
        $resp2 = Invoke-RestMethod "$BackendBase/api/rules/import?activate=1" -Method Post -Body $json2 -ContentType "application/json" -ErrorAction Stop
        throw "Expected 400 but succeeded"
    } catch {
        $status = [int]$_.Exception.Response.StatusCode
        if ($status -ne 400) { throw "Expected HTTP 400, got $status" }
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $reader.BaseStream.Position = 0
        $bodyRaw = $reader.ReadToEnd()
        $body = $bodyRaw | ConvertFrom-Json
        if (-not $body.error) { throw "Missing error field" }
        if ((CountItems $body.issues) -lt 1) { throw "Missing issues array" }
        $msgBytes = ToBytes $body.issues[0].message
        if (NotHasBytes $msgBytes $K["DupDescDiffThresh"]) {
            throw "Error message not clear: $($body.issues[0].message)"
        }
    }
}

Test-Case "POST /:id/activate returns activation_log + rollback_package + rollback_export" {
    $pkg3 = @{ schema_version = "1.0"; exported_at = (Get-Date).ToString("o"); export_source = "doc_test"; rules = @(@{
        version = "v_doc_test3_$ts"
        over_prep_threshold_pct = 7
        over_prep_threshold_abs = 70
        spoilage_temp_min = 2
        spoilage_temp_max = 48
        description = "doc test unique $ts"
    })}
    $json3 = $pkg3 | ConvertTo-Json -Depth 10
    $resp3 = Invoke-RestMethod "$BackendBase/api/rules/import" -Method Post -Body $json3 -ContentType "application/json"
    $id = $resp3.imported[0].id

    $activateResp = Invoke-RestMethod "$BackendBase/api/rules/$id/activate" -Method Post -Body (@{operator="doc_test"} | ConvertTo-Json) -ContentType "application/json"
    if (-not $activateResp.activation_log) { throw "Missing activation_log" }
    if (-not $activateResp.rollback_package) { throw "Missing rollback_package" }
    if (-not $activateResp.rollback_export) { throw "Missing rollback_export" }
    if ($activateResp.activation_log.action -ne "direct") { throw "Wrong action: $($activateResp.activation_log.action)" }
}

Test-Case "GET /previews returns status field" {
    $resp = Invoke-RestMethod "$BackendBase/api/rules/previews" -UseBasicParsing
    $statuses = @($resp | ForEach-Object { $_.status })
    if ((CountItems $statuses) -lt 1 -and (CountItems $resp) -gt 0) { throw "Previews missing status field" }
}

Test-Case "GET /activation-logs returns action field" {
    $resp = Invoke-RestMethod "$BackendBase/api/rules/activation-logs" -UseBasicParsing
    $actions = @($resp | ForEach-Object { $_.action })
    $unique = $actions | Select-Object -Unique
    if ((CountItems $unique) -lt 1 -and (CountItems $resp) -gt 0) { throw "Activation logs missing action field" }
}

Test-Case "POST /rollback-packages/apply conflict returns 400 not 500" {
    $rbList = Invoke-RestMethod "$BackendBase/api/rules/rollback-packages" -UseBasicParsing
    if ((CountItems $rbList) -lt 1) { throw "No rollback packages available" }
    $rb = $rbList[0]
    $export = Invoke-RestMethod "$BackendBase/api/rules/rollback-packages/$($rb.id)/export" -UseBasicParsing

    $export.all_rules_snapshot[0].version = $export.to_rule.version
    $badJson = $export | ConvertTo-Json -Depth 10

    try {
        $applyResp = Invoke-RestMethod "$BackendBase/api/rules/rollback-packages/apply" -Method Post -Body $badJson -ContentType "application/json" -ErrorAction Stop
        throw "Expected 400 but succeeded"
    } catch {
        $status = [int]$_.Exception.Response.StatusCode
        if ($status -eq 500) { throw "Got 500 instead of 400" }
        if ($status -ne 400) { throw "Expected 400, got $status" }
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $reader.BaseStream.Position = 0
        $bodyRaw = $reader.ReadToEnd()
        $body = $bodyRaw | ConvertFrom-Json
        if (-not $body.error) { throw "Missing error field" }
        $msgBytes = ToBytes $body.issues[0].message
        if (NotHasBytes $msgBytes $K["RollbackConflictText"]) {
            throw "Error message doesn't mention conflict: $($body.issues[0].message)"
        }
    }
}

# ===============================================
# Test Set 5: Backend code constants
# ===============================================
Write-Host "`n[5] Backend code constants check" -ForegroundColor Yellow

Test-Case "Backend defines 3 action types: 'direct' / 'activate' / 'rollback'" {
    if (NotHasBytes $rulesTsBytes $K["ActDirect"]) { throw "Missing 'direct' in code" }
    if (NotHasBytes $rulesTsBytes $K["ActActivate"]) { throw "Missing 'activate' in code" }
    if (NotHasBytes $rulesTsBytes $K["ActRollback"]) { throw "Missing 'rollback' in code" }
}

Test-Case "Backend has _activateRuleAndAudit common function" {
    if (NotHasBytes $rulesTsBytes $K["CommonFunc"]) { throw "Missing common function" }
}

Test-Case "Backend has 'preview expired' error message" {
    if (NotHasBytes $rulesTsBytes $K["PreviewExpired"]) { throw "Missing preview expired error" }
}

Test-Case "Backend has 'duplicate description different thresholds' error message" {
    if (NotHasBytes $rulesTsBytes $K["DupDescDiffThresh"]) { throw "Missing validation error message" }
}

# ===============================================
# Summary
# ===============================================
Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "  Results: PASS=$script:Pass  FAIL=$script:Fail" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if ($script:Fail -gt 0) {
    Write-Host "`nFAILED: $script:Fail tests, check doc/code consistency" -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nALL $script:Pass TESTS PASSED - docs consistent with code" -ForegroundColor Green
    exit 0
}
