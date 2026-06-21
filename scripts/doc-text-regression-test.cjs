#!/usr/bin/env node
/**
 * Documentation & Text Regression Test
 * Verifies that docs, UI text, API messages, and code constants are consistent
 * with actual implementation. Uses UTF-8 byte-level matching to avoid
 * any encoding issues.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:3002';
const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://localhost:5173';

let passCount = 0;
let failCount = 0;

// ========== UTF-8 byte sequence matching (100% encoding safe) ==========

function toBytes(str) {
  return Buffer.from(str, 'utf8');
}

function hasBytes(haystackBuf, needleBytes) {
  if (!haystackBuf || !needleBytes) return false;
  if (needleBytes.length === 0 || haystackBuf.length < needleBytes.length) return false;
  
  for (let i = 0; i <= haystackBuf.length - needleBytes.length; i++) {
    let match = true;
    for (let j = 0; j < needleBytes.length; j++) {
      if (haystackBuf[i + j] !== needleBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function notHasBytes(haystackBuf, needleBytes) {
  return !hasBytes(haystackBuf, needleBytes);
}

// Build keyword dictionary
const K = {};
function def(name, value) {
  K[name] = toBytes(value);
}

// Tab and button names
def('PreviewAndActivate', '预演并启用');
def('ActivateThisVersion', '启用此版本');
def('RuleVersionTab', '规则版本 Tab');
def('PreviewRecordTab', '预演记录 Tab');
def('ActivationLogTab', '启用日志 Tab');
def('RollbackPackageTab', '回退包 Tab');
def('RuleVersion', '规则版本');
def('PreviewRecord', '预演记录');
def('ActivationLog', '启用日志');
def('RollbackPackage', '回退包');
def('ImportRollback', '导入回退包');
def('ApplyRollback', '应用回退');
def('ExportBtn', '导出');

// Flow description
def('SafeFlowArrow', '预演 → 确认 → 审计 → 回退');
def('Step1', '1. **预演**');
def('Step2', '2. **确认**');
def('Step3', '3. **审计**');
def('Step4', '4. **回退**');
def('Step5', '5. **失败处理**');

// Action types and colors
def('Direct', '直接启用');
def('Grey', '(灰)');
def('Blue', '(蓝)');
def('Yellow', '(黄)');

// Failure messages
def('PreviewExpired', '预演已过期');
def('VersionConflict', '版本冲突');
def('VersionConflictMsg', '版本号冲突');
def('ActivationValidation', '激活校验不通过');
def('DupDescDiffThresh', '与已有规则描述重复但阈值不一致');

// Other text
def('ActivateOnImport', '导入后将第一条规则设为生效版本');
def('AuditFlow', '审计链路');
def('TenMinutes', '10 分钟');
def('RestartPersist', '重启后仍可');
def('PreviewConfirmTitle', '变更预演确认');
def('ConfirmHint1', '确认启用后系统会');
def('ConfirmHint2', '自动生成一个可导出的回退包');
def('RollbackConflictText', '回退包内版本号冲突');

// API endpoints (ASCII only - no encoding issues)
def('ApiImport', '/api/rules/import');
def('ApiExport', '/api/rules/export');
def('ApiPreviews', '/api/rules/previews');
def('ApiActivationLogs', '/api/rules/activation-logs');
def('ApiRollbackPackages', '/api/rules/rollback-packages');
def('ApiRollbackApply', '/api/rules/rollback-packages/apply');

// DB tables
def('TablePreview', 'RULE_PREVIEW');
def('TableLog', 'RULE_ACTIVATION_LOG');
def('TableRb', 'RULE_ROLLBACK_PACKAGE');

// Action type constants (in arch doc they appear as "direct(...)" without quotes)
def('ActDirectNoQuote', 'direct');
def('ActActivateNoQuote', 'activate');
def('ActRollbackNoQuote', 'rollback');
// In backend source, action types appear as string literals with quotes
def('ActDirectQuoted', "'direct'");
def('ActActivateQuoted', "'activate'");
def('ActRollbackQuoted', "'rollback'");
def('CommonFunc', '_activateRuleAndAudit');

// English
def('JSON', 'JSON');

// ========== Test helpers ==========

function testCase(name, fn) {
  try {
    fn();
    console.log('  \x1b[32m[PASS]\x1b[0m ' + name);
    passCount++;
  } catch (e) {
    console.log('  \x1b[31m[FAIL]\x1b[0m ' + name);
    console.log('    Error: ' + e.message);
    failCount++;
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        text: Buffer.concat(chunks).toString('utf8')
      }));
    }).on('error', reject);
  });
}

function httpPost(url, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = client.request({
      method: 'POST',
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function countItems(obj) {
  if (obj == null) return 0;
  if (Array.isArray(obj)) return obj.length;
  if (typeof obj === 'object' && 'Count' in obj) return obj.Count;
  return 1;
}

// ========== Locate files ==========

const root = path.resolve(__dirname, '..');
const docDir = path.join(root, '.trae', 'documents');
const archFile = fs.readdirSync(docDir).find(f => f.includes('Architecture'));
const archPath = path.join(docDir, archFile);
const readmePath = path.join(root, 'README.md');
const rulesTsPath = path.join(root, 'api', 'rules.ts');

console.log('===============================================');
console.log('  Doc & Text Regression Test');
console.log('===============================================');
console.log('  README:', readmePath);
console.log('  ArchDoc:', archPath);
console.log('  Backend:', rulesTsPath);
console.log('  Matching: UTF-8 byte sequence (100% encoding safe)');

// Read all files as raw buffers
const readmeBytes = fs.readFileSync(readmePath);
const archBytes = fs.readFileSync(archPath);
const rulesTsBytes = fs.readFileSync(rulesTsPath);

// ========== Run tests ==========

async function runTests() {

  // ===============================================
  // Test Set 1: README key text
  // ===============================================
  console.log('\n[1] README key text check');

  testCase('README mentions safe flow (preview -> confirm -> audit -> rollback)', () => {
    if (notHasBytes(readmeBytes, K.SafeFlowArrow)) throw new Error('Missing safe flow description');
  });

  testCase('README has Preview and Activate button (NOT old Activate this version)', () => {
    if (notHasBytes(readmeBytes, K.PreviewAndActivate)) throw new Error('Missing PreviewAndActivate');
    if (hasBytes(readmeBytes, K.ActivateThisVersion)) throw new Error('Still has outdated ActivateThisVersion');
  });

  testCase('README mentions 4 tabs (by "X Tab" name)', () => {
    if (notHasBytes(readmeBytes, K.RuleVersionTab)) throw new Error('Missing RuleVersionTab');
    if (notHasBytes(readmeBytes, K.PreviewRecordTab)) throw new Error('Missing PreviewRecordTab');
    if (notHasBytes(readmeBytes, K.ActivationLogTab)) throw new Error('Missing ActivationLogTab');
    if (notHasBytes(readmeBytes, K.RollbackPackageTab)) throw new Error('Missing RollbackPackageTab');
  });

  testCase('README mentions 3 action types with color labels', () => {
    if (notHasBytes(readmeBytes, K.Direct)) throw new Error('Missing Direct');
    if (notHasBytes(readmeBytes, K.Grey)) throw new Error('Missing Grey');
    if (notHasBytes(readmeBytes, K.Blue)) throw new Error('Missing Blue');
    if (notHasBytes(readmeBytes, K.Yellow)) throw new Error('Missing Yellow');
  });

  testCase('README mentions 5-step flow', () => {
    if (notHasBytes(readmeBytes, K.Step1)) throw new Error('Missing Step1');
    if (notHasBytes(readmeBytes, K.Step2)) throw new Error('Missing Step2');
    if (notHasBytes(readmeBytes, K.Step3)) throw new Error('Missing Step3');
    if (notHasBytes(readmeBytes, K.Step4)) throw new Error('Missing Step4');
    if (notHasBytes(readmeBytes, K.Step5)) throw new Error('Missing Step5');
  });

  testCase('README mentions 3 failure scenarios', () => {
    if (notHasBytes(readmeBytes, K.PreviewExpired)) throw new Error('Missing PreviewExpired');
    if (notHasBytes(readmeBytes, K.VersionConflict)) throw new Error('Missing VersionConflict');
    if (notHasBytes(readmeBytes, K.ActivationValidation)) throw new Error('Missing ActivationValidation');
  });

  testCase('README mentions Import rollback package button', () => {
    if (notHasBytes(readmeBytes, K.ImportRollback)) throw new Error('Missing ImportRollback');
  });

  testCase('README mentions Apply rollback button', () => {
    if (notHasBytes(readmeBytes, K.ApplyRollback)) throw new Error('Missing ApplyRollback');
  });

  testCase('README mentions Export rollback package as JSON', () => {
    if (notHasBytes(readmeBytes, K.ExportBtn)) throw new Error('Missing ExportBtn');
    if (notHasBytes(readmeBytes, K.JSON)) throw new Error('Missing JSON');
  });

  testCase('README clarifies activate-on-import goes through audit flow', () => {
    if (notHasBytes(readmeBytes, K.ActivateOnImport)) throw new Error('Missing ActivateOnImport');
    if (notHasBytes(readmeBytes, K.AuditFlow)) throw new Error('Missing AuditFlow');
  });

  testCase('README mentions preview TTL (10 minutes)', () => {
    if (notHasBytes(readmeBytes, K.TenMinutes)) throw new Error('Missing TenMinutes');
  });

  testCase('README mentions persistence across restart', () => {
    if (notHasBytes(readmeBytes, K.RestartPersist)) throw new Error('Missing RestartPersist');
  });

  // ===============================================
  // Test Set 2: Technical Architecture doc
  // ===============================================
  console.log('\n[2] Technical Architecture doc check');

  testCase('Architecture doc includes all new API endpoints', () => {
    if (notHasBytes(archBytes, K.ApiImport)) throw new Error('Missing ApiImport');
    if (notHasBytes(archBytes, K.ApiExport)) throw new Error('Missing ApiExport');
    if (notHasBytes(archBytes, K.ApiPreviews)) throw new Error('Missing ApiPreviews');
    if (notHasBytes(archBytes, K.ApiActivationLogs)) throw new Error('Missing ApiActivationLogs');
    if (notHasBytes(archBytes, K.ApiRollbackPackages)) throw new Error('Missing ApiRollbackPackages');
    if (notHasBytes(archBytes, K.ApiRollbackApply)) throw new Error('Missing ApiRollbackApply');
  });

  testCase('Architecture doc includes 3 new tables', () => {
    if (notHasBytes(archBytes, K.TablePreview)) throw new Error('Missing TablePreview');
    if (notHasBytes(archBytes, K.TableLog)) throw new Error('Missing TableLog');
    if (notHasBytes(archBytes, K.TableRb)) throw new Error('Missing TableRb');
  });

  testCase('Architecture doc includes 3 action types', () => {
    if (notHasBytes(archBytes, K.ActDirectNoQuote)) throw new Error('Missing ActDirectNoQuote');
    if (notHasBytes(archBytes, K.ActActivateNoQuote)) throw new Error('Missing ActActivateNoQuote');
    if (notHasBytes(archBytes, K.ActRollbackNoQuote)) throw new Error('Missing ActRollbackNoQuote');
  });

  testCase('Architecture doc includes version switch rollback', () => {
    if (notHasBytes(archBytes, K.VersionConflict)) throw new Error('Missing VersionConflict');
  });

  testCase('Architecture doc includes preview expiry detection', () => {
    if (notHasBytes(archBytes, K.PreviewExpired)) throw new Error('Missing PreviewExpired');
  });

  testCase('Architecture doc includes rollback conflict validation', () => {
    if (notHasBytes(archBytes, K.VersionConflict)) throw new Error('Missing VersionConflict');
  });

  // ===============================================
  // Test Set 3: Frontend visible text (via source code)
  // React SPA initial HTML does not contain rendered text,
  // so we check the React component source directly
  // ===============================================
  console.log('\n[3] Frontend visible text check');

  const frontendTsxPath = path.join(root, 'src', 'pages', 'RuleConfig.tsx');
  const frontendTsxBytes = fs.readFileSync(frontendTsxPath);
  console.log('  Frontend source:', frontendTsxPath);

  testCase('Frontend page has 4 tab names', () => {
    if (notHasBytes(frontendTsxBytes, K.RuleVersion)) throw new Error('Missing RuleVersion');
    if (notHasBytes(frontendTsxBytes, K.PreviewRecord)) throw new Error('Missing PreviewRecord');
    if (notHasBytes(frontendTsxBytes, K.ActivationLog)) throw new Error('Missing ActivationLog');
    if (notHasBytes(frontendTsxBytes, K.RollbackPackage)) throw new Error('Missing RollbackPackage');
  });

  testCase('Frontend has Preview and Activate button (NOT Activate this version)', () => {
    if (notHasBytes(frontendTsxBytes, K.PreviewAndActivate)) throw new Error('Missing PreviewAndActivate');
    if (hasBytes(frontendTsxBytes, K.ActivateThisVersion)) throw new Error('Still has outdated ActivateThisVersion');
  });

  testCase('Frontend has Import rollback package button', () => {
    if (notHasBytes(frontendTsxBytes, K.ImportRollback)) throw new Error('Missing ImportRollback');
  });

  testCase('Frontend has Apply rollback button', () => {
    if (notHasBytes(frontendTsxBytes, K.ApplyRollback)) throw new Error('Missing ApplyRollback');
  });

  testCase('Frontend has Preview Confirmation dialog title', () => {
    if (notHasBytes(frontendTsxBytes, K.PreviewConfirmTitle)) throw new Error('Missing PreviewConfirmTitle');
  });

  testCase('Frontend has preview confirmation hint text', () => {
    if (notHasBytes(frontendTsxBytes, K.ConfirmHint1)) throw new Error('Missing ConfirmHint1');
    if (notHasBytes(frontendTsxBytes, K.ConfirmHint2)) throw new Error('Missing ConfirmHint2');
  });

  // ===============================================
  // Test Set 4: API error messages & response fields
  // ===============================================
  console.log('\n[4] API error messages & response check');

  const ts = Date.now();

  // Test 4.1: Import activation failure returns 400 + readable error
  testCase('POST /import activate failure: 400 + readable error + issues array', async () => {
    const rule1 = {
      version: `v_doc_test1_${ts}`,
      over_prep_threshold_pct: 6,
      over_prep_threshold_abs: 60,
      spoilage_temp_min: 2,
      spoilage_temp_max: 48,
      description: `doc test same desc ${ts}`
    };
    const rule2 = {
      version: `v_doc_test2_${ts}`,
      over_prep_threshold_pct: 99,
      over_prep_threshold_abs: 999,
      spoilage_temp_min: 2,
      spoilage_temp_max: 48,
      description: `doc test same desc ${ts}`
    };

    const pkg1 = { schema_version: '1.0', exported_at: new Date().toISOString(), export_source: 'doc_test', rules: [rule1] };
    const pkg2 = { schema_version: '1.0', exported_at: new Date().toISOString(), export_source: 'doc_test', rules: [rule2] };

    const resp1 = await httpPost(BACKEND_BASE + '/api/rules/import?activate=1', pkg1);
    const json1 = JSON.parse(resp1.text);
    if (!json1.activated) throw new Error('First import did not activate');

    const resp2 = await httpPost(BACKEND_BASE + '/api/rules/import?activate=1', pkg2);
    if (resp2.statusCode !== 400) throw new Error(`Expected HTTP 400, got ${resp2.statusCode}`);
    const json2 = JSON.parse(resp2.text);
    if (!json2.error) throw new Error('Missing error field');
    if (countItems(json2.issues) < 1) throw new Error('Missing issues array');
    const msgBytes = toBytes(json2.issues[0].message);
    if (notHasBytes(msgBytes, K.DupDescDiffThresh)) throw new Error(`Error message not clear: ${json2.issues[0].message}`);
  });

  // Test 4.2: Direct activate returns all fields
  testCase('POST /:id/activate returns activation_log + rollback_package + rollback_export', async () => {
    const rule3 = {
      version: `v_doc_test3_${ts}`,
      over_prep_threshold_pct: 7,
      over_prep_threshold_abs: 70,
      spoilage_temp_min: 2,
      spoilage_temp_max: 48,
      description: `doc test unique ${ts}`
    };
    const pkg3 = { schema_version: '1.0', exported_at: new Date().toISOString(), export_source: 'doc_test', rules: [rule3] };
    const resp3 = await httpPost(BACKEND_BASE + '/api/rules/import', pkg3);
    const json3 = JSON.parse(resp3.text);
    const id = json3.imported[0].id;

    const activateResp = await httpPost(BACKEND_BASE + `/api/rules/${id}/activate`, { operator: 'doc_test' });
    const activateJson = JSON.parse(activateResp.text);
    if (!activateJson.activation_log) throw new Error('Missing activation_log');
    if (!activateJson.rollback_package) throw new Error('Missing rollback_package');
    if (!activateJson.rollback_export) throw new Error('Missing rollback_export');
    if (activateJson.activation_log.action !== 'direct') throw new Error(`Wrong action: ${activateJson.activation_log.action}`);
  });

  // Test 4.3: Previews have status field
  testCase('GET /previews returns status field', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/rules/previews');
    const json = JSON.parse(resp.text);
    if (countItems(json) > 0) {
      if (json[0].status === undefined) throw new Error('Missing status field');
    }
  });

  // Test 4.4: Activation logs have action field
  testCase('GET /activation-logs returns action field', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/rules/activation-logs');
    const json = JSON.parse(resp.text);
    if (countItems(json) > 0) {
      if (json[0].action === undefined) throw new Error('Missing action field');
    }
  });

  // Test 4.5: Rollback package conflict returns 400 not 500
  testCase('POST /rollback-packages/apply conflict returns 400 not 500', async () => {
    const rbListResp = await httpGet(BACKEND_BASE + '/api/rules/rollback-packages');
    const rbList = JSON.parse(rbListResp.text);
    if (countItems(rbList) < 1) throw new Error('No rollback packages available');

    const rb = rbList[0];
    const exportResp = await httpGet(BACKEND_BASE + `/api/rules/rollback-packages/${rb.id}/export`);
    const exportObj = JSON.parse(exportResp.text);

    // Create a version conflict
    exportObj.all_rules_snapshot[0].version = exportObj.to_rule.version;

    const applyResp = await httpPost(BACKEND_BASE + '/api/rules/rollback-packages/apply', exportObj);
    if (applyResp.statusCode === 500) throw new Error('Got 500 instead of 400');
    if (applyResp.statusCode !== 400) throw new Error(`Expected 400, got ${applyResp.statusCode}`);

    const applyJson = JSON.parse(applyResp.text);
    if (!applyJson.error) throw new Error('Missing error field');
    const msgBytes = toBytes(applyJson.issues[0].message);
    if (notHasBytes(msgBytes, K.RollbackConflictText) && notHasBytes(msgBytes, K.VersionConflictMsg)) {
      throw new Error(`Error message doesn't mention conflict: ${applyJson.issues[0].message}`);
    }
  });

  // ===============================================
  // Test Set 5: Backend code constants
  // ===============================================
  console.log('\n[5] Backend code constants check');

  testCase('Backend defines 3 action types', () => {
    if (notHasBytes(rulesTsBytes, K.ActDirectQuoted)) throw new Error('Missing ActDirectQuoted');
    if (notHasBytes(rulesTsBytes, K.ActActivateQuoted)) throw new Error('Missing ActActivateQuoted');
    if (notHasBytes(rulesTsBytes, K.ActRollbackQuoted)) throw new Error('Missing ActRollbackQuoted');
  });

  testCase('Backend has _activateRuleAndAudit common function', () => {
    if (notHasBytes(rulesTsBytes, K.CommonFunc)) throw new Error('Missing CommonFunc');
  });

  testCase('Backend has preview expired error message', () => {
    if (notHasBytes(rulesTsBytes, K.PreviewExpired)) throw new Error('Missing PreviewExpired');
  });

  testCase('Backend has duplicate description different thresholds error', () => {
    if (notHasBytes(rulesTsBytes, K.DupDescDiffThresh)) throw new Error('Missing DupDescDiffThresh');
  });

  // ===============================================
  // Summary
  // ===============================================
  console.log('\n===============================================');
  console.log(`  Results: PASS=${passCount}  FAIL=${failCount}`);
  console.log('===============================================');

  if (failCount > 0) {
    console.log(`\n\x1b[31mFAILED: ${failCount} tests, check doc/code consistency\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32mALL ${passCount} TESTS PASSED - docs consistent with code\x1b[0m`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
