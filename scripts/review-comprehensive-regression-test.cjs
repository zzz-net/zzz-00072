#!/usr/bin/env node
/**
 * Comprehensive Review Regression Test
 * Tests:
 * 1. Single resolve and batch resolve don't conflict
 * 2. Mixed status batch operations (some open, some closed)
 * 3. Data persistence verification (SQLite)
 * 4. Export CSV includes batch operation info
 * 5. Consistency check after various operations
 * 6. Batch reopen with mixed status
 * 7. Non-existent anomaly IDs handling
 * 8. Empty batch operations validation
 */

const http = require('http');

const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:3002';

let passCount = 0;
let failCount = 0;

async function testCase(name, fn) {
  try {
    await fn();
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
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = http.request({
      method: 'POST',
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function getBatch(batchId) {
  const resp = await httpGet(BACKEND_BASE + `/api/batches/${batchId}`);
  return JSON.parse(resp.text);
}

async function getAnomalies(batchId, status) {
  const url = status
    ? `${BACKEND_BASE}/api/anomalies?batch_id=${batchId}&status=${status}`
    : `${BACKEND_BASE}/api/anomalies?batch_id=${batchId}`;
  const resp = await httpGet(url);
  return JSON.parse(resp.text);
}

async function getAnomalyDetail(anomalyId) {
  const resp = await httpGet(BACKEND_BASE + `/api/anomalies/${anomalyId}`);
  return JSON.parse(resp.text);
}

async function runTests() {
  console.log('===============================================');
  console.log('  Comprehensive Review Regression Test');
  console.log('===============================================');
  console.log('  Backend:', BACKEND_BASE);

  // ===============================================
  // Setup: Find a suitable test batch
  // ===============================================
  console.log('\n[Setup] Finding test batch...');

  const batchesResp = await httpGet(BACKEND_BASE + '/api/batches');
  const batches = JSON.parse(batchesResp.text);
  if (batches.length === 0) {
    console.log('\x1b[31mNo batches available for testing\x1b[0m');
    process.exit(1);
  }

  const testBatch = batches.find(b => b.unresolved_count >= 3) || batches.find(b => b.unresolved_count >= 2) || batches[0];
  const testBatchId = testBatch.id;
  console.log(`  Using batch: ${testBatch.name} (${testBatchId})`);
  console.log(`  Initial unresolved: ${testBatch.unresolved_count}, total: ${testBatch.anomaly_count}`);

  if (testBatch.unresolved_count < 2) {
    console.log('\x1b[33m[WARN] Need at least 2 unresolved anomalies for full test coverage\x1b[0m');
  }

  // ===============================================
  // Test 1: Single resolve works correctly
  // ===============================================
  console.log('\n[1] Single anomaly resolve');

  let singleResolveId = null;
  let initialUnresolvedCount = 0;

  await testCase('Single resolve updates status and fields correctly', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    if (unresolved.length < 1) throw new Error('No unresolved anomalies available');
    singleResolveId = unresolved[0].id;
    initialUnresolvedCount = unresolved.length;

    const resp = await httpPost(BACKEND_BASE + `/api/anomalies/${singleResolveId}/resolve`, {
      reason: '单条回归测试：确认异常',
      result: 'confirmed'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    if (data.status !== 'resolved') throw new Error('Status should be resolved');
    if (data.manual_result !== 'confirmed') throw new Error('Manual result should be confirmed');
    if (!data.resolved_at) throw new Error('Missing resolved_at timestamp');
    if (!data.manual_reason) throw new Error('Missing manual_reason');
  });

  await testCase('Single resolve creates proper history entry', async () => {
    if (!singleResolveId) throw new Error('No resolved anomaly');

    const detail = await getAnomalyDetail(singleResolveId);
    const resolveHistory = detail.history.find(h => h.action === 'resolve');
    if (!resolveHistory) throw new Error('Missing resolve history entry');
    if (resolveHistory.result !== 'confirmed') throw new Error('Wrong result in history');
    if (!resolveHistory.reason) throw new Error('Missing reason in history');
    if (resolveHistory.operator !== 'admin') throw new Error('Wrong operator');
    if (!resolveHistory.timestamp) throw new Error('Missing timestamp');
  });

  await testCase('Single resolve decrements batch unresolved_count', async () => {
    const batch = await getBatch(testBatchId);
    const expected = initialUnresolvedCount - 1;
    if (batch.unresolved_count !== expected) {
      throw new Error(`Expected unresolved_count=${expected}, got ${batch.unresolved_count}`);
    }
  });

  // ===============================================
  // Test 2: Batch resolve with mix of open and already-closed
  // ===============================================
  console.log('\n[2] Batch resolve with mixed status (conflict handling)');

  let batchResolveResult = null;

  await testCase('Batch resolve with mixed status returns correct skip/success/fail counts', async () => {
    const remainingUnresolved = await getAnomalies(testBatchId, 'unresolved');
    if (remainingUnresolved.length < 1) throw new Error('No remaining unresolved anomalies');

    const mixIds = [
      singleResolveId,
      remainingUnresolved[0].id,
      'anom_nonexistent_test_id_123'
    ];

    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: mixIds,
      reason: '批量回归测试：混合状态测试',
      result: 'normal'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    batchResolveResult = data;

    if (!data.batch_operation_id) throw new Error('Missing batch_operation_id');
    if (data.success.length !== 1) throw new Error(`Expected 1 success, got ${data.success.length}`);
    if (data.skipped.length !== 2) throw new Error(`Expected 2 skipped, got ${data.skipped.length}`);
    if (data.failed.length !== 0) throw new Error(`Expected 0 failed, got ${data.failed.length}`);
    if (data.success.length + data.skipped.length + data.failed.length !== mixIds.length) {
      throw new Error('Total items should match input count');
    }

    const skippedClosed = data.skipped.find(s => s.id === singleResolveId);
    if (!skippedClosed) throw new Error('Should skip already-closed anomaly');
    if (!skippedClosed.error) throw new Error('Skipped item should have error message');

    const skippedNonExistent = data.skipped.find(s => s.id === 'anom_nonexistent_test_id_123');
    if (!skippedNonExistent) throw new Error('Should skip non-existent anomaly');
  });

  await testCase('Batch-resolved anomaly has batch_operation_id in history', async () => {
    if (!batchResolveResult || batchResolveResult.success.length === 0) {
      throw new Error('No successful batch resolve to verify');
    }
    const anomalyId = batchResolveResult.success[0].id;
    const detail = await getAnomalyDetail(anomalyId);
    const lastHistory = detail.history[0];
    if (!lastHistory.batch_operation_id) {
      throw new Error('Batch-resolved anomaly should have batch_operation_id in history');
    }
    if (lastHistory.batch_operation_id !== batchResolveResult.batch_operation_id) {
      throw new Error('batch_operation_id mismatch');
    }
    if (lastHistory.action !== 'resolve') throw new Error('Wrong action type');
    if (lastHistory.result !== 'normal') throw new Error('Wrong result');
  });

  // ===============================================
  // Test 3: Single reopen works correctly
  // ===============================================
  console.log('\n[3] Single anomaly reopen');

  let countBeforeReopen = 0;

  await testCase('Single reopen restores unresolved status and clears fields', async () => {
    if (!singleResolveId) throw new Error('No resolved anomaly to reopen');

    const batchBefore = await getBatch(testBatchId);
    countBeforeReopen = batchBefore.unresolved_count;

    const resp = await httpPost(BACKEND_BASE + `/api/anomalies/${singleResolveId}/reopen`, {
      reason: '单条回归测试：撤销关闭'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    if (data.status !== 'unresolved') throw new Error('Status should be unresolved');
    if (data.manual_result !== null) throw new Error('manual_result should be null after reopen');
    if (data.manual_reason !== null) throw new Error('manual_reason should be null after reopen');
    if (data.resolved_at !== null) throw new Error('resolved_at should be null after reopen');
  });

  await testCase('Single reopen creates history entry', async () => {
    if (!singleResolveId) throw new Error('No anomaly');

    const detail = await getAnomalyDetail(singleResolveId);
    const reopenHistory = detail.history.find(h => h.action === 'reopen');
    if (!reopenHistory) throw new Error('Missing reopen history entry');
  });

  await testCase('Single reopen increments batch unresolved_count', async () => {
    const batch = await getBatch(testBatchId);
    const expected = countBeforeReopen + 1;
    if (batch.unresolved_count !== expected) {
      throw new Error(`Expected unresolved_count=${expected}, got ${batch.unresolved_count}`);
    }
  });

  // ===============================================
  // Test 4: Batch and single operations work together
  // ===============================================
  console.log('\n[4] Batch and single operations coexist correctly');

  await testCase('Batch resolve then single resolve on different items works', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    if (unresolved.length < 2) throw new Error('Need at least 2 unresolved anomalies');

    const batchIds = [unresolved[0].id];
    const singleId = unresolved[1].id;

    const batchResp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: batchIds,
      reason: '批量回归测试：与单条共存',
      result: 'confirmed'
    });
    const batchData = JSON.parse(batchResp.text);
    if (batchData.success.length !== 1) {
      throw new Error(`Expected 1 batch success, got ${batchData.success.length}`);
    }

    const singleResp = await httpPost(BACKEND_BASE + `/api/anomalies/${singleId}/resolve`, {
      reason: '单条回归测试：与批量共存',
      result: 'normal'
    });
    if (singleResp.statusCode !== 200) {
      throw new Error('Single resolve after batch resolve should work');
    }

    const singleDetail = await getAnomalyDetail(singleId);
    const singleHistory = singleDetail.history.find(h => h.action === 'resolve' && !h.batch_operation_id);
    if (!singleHistory) {
      throw new Error('Single-resolved anomaly should NOT have batch_operation_id');
    }
  });

  await testCase('Batch reopen and single reopen can coexist', async () => {
    const resolved = await getAnomalies(testBatchId, 'resolved');
    if (resolved.length < 2) throw new Error('Need at least 2 resolved anomalies');

    const batchIds = [resolved[0].id];
    const singleId = resolved[1].id;

    const batchResp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: batchIds,
      reason: '批量回归测试：批量撤销'
    });
    const batchData = JSON.parse(batchResp.text);
    if (batchData.success.length !== 1) {
      throw new Error(`Expected 1 batch success, got ${batchData.success.length}`);
    }

    const singleResp = await httpPost(BACKEND_BASE + `/api/anomalies/${singleId}/reopen`, {
      reason: '单条回归测试：单条撤销'
    });
    if (singleResp.statusCode !== 200) {
      throw new Error('Single reopen after batch reopen should work');
    }
  });

  // ===============================================
  // Test 5: Export CSV includes expected information
  // ===============================================
  console.log('\n[5] Export CSV verification');

  await testCase('Summary export has expected columns', async () => {
    const exportResp = await httpGet(BACKEND_BASE + `/api/export/summary?batch_ids=${testBatchId}`);
    if (exportResp.statusCode !== 200) throw new Error('Export failed');

    const csv = exportResp.text;
    if (!csv.includes('批次名称')) throw new Error('CSV should include 批次名称 column');
    if (!csv.includes('未结异常')) throw new Error('CSV should include 未结异常 column');
    if (!csv.includes('异常总数')) throw new Error('CSV should include 异常总数 column');
  });

  await testCase('Detail export includes manual review info', async () => {
    const exportResp = await httpGet(BACKEND_BASE + `/api/export/detail?batch_ids=${testBatchId}`);
    if (exportResp.statusCode !== 200) throw new Error('Export failed');

    const csv = exportResp.text;
    if (!csv.includes('人工判定')) throw new Error('CSV should include 人工判定 column');
    if (!csv.includes('人工原因')) throw new Error('CSV should include 人工原因 column');
    if (!csv.includes('状态')) throw new Error('CSV should include 状态 column');
    if (!csv.includes('关闭时间')) throw new Error('CSV should include 关闭时间 column');
  });

  await testCase('History export includes batch_operation_id', async () => {
    const exportResp = await httpGet(BACKEND_BASE + '/api/export/history');
    if (exportResp.statusCode !== 200) throw new Error('Export failed');

    const csv = exportResp.text;
    if (!csv.includes('批量操作ID')) throw new Error('CSV should include 批量操作ID column');
    if (!csv.includes('操作')) throw new Error('CSV should include 操作 column');
    if (!csv.includes('判定结果')) throw new Error('CSV should include 判定结果 column');
  });

  // ===============================================
  // Test 6: Data consistency after all operations
  // ===============================================
  console.log('\n[6] Data consistency verification');

  await testCase('Consistency check passes after mixed operations', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/export/consistency');
    const data = JSON.parse(resp.text);
    if (!data.ok) {
      throw new Error(`Consistency check failed: ${JSON.stringify(data.issues)}`);
    }
    if (!data.stats || typeof data.stats.anomaly_count !== 'number') {
      throw new Error('Missing anomaly_count in stats');
    }
    if (!data.stats || typeof data.stats.history_count !== 'number') {
      throw new Error('Missing history_count in stats');
    }
  });

  await testCase('Batch unresolved count matches actual unresolved anomalies', async () => {
    const batch = await getBatch(testBatchId);
    const unresolved = await getAnomalies(testBatchId, 'unresolved');

    if (batch.unresolved_count !== unresolved.length) {
      throw new Error(`Batch unresolved_count (${batch.unresolved_count}) != actual count (${unresolved.length})`);
    }
  });

  await testCase('Each resolved anomaly has at least one resolve history entry', async () => {
    const resolved = await getAnomalies(testBatchId, 'resolved');
    if (resolved.length === 0) {
      console.log('    (skipped - no resolved anomalies)');
      return;
    }

    for (const a of resolved.slice(0, 3)) {
      const detail = await getAnomalyDetail(a.id);
      const hasResolveHistory = detail.history.some(h => h.action === 'resolve');
      if (!hasResolveHistory) {
        throw new Error(`Resolved anomaly ${a.id} has no resolve history`);
      }
    }
  });

  // ===============================================
  // Test 7: Batch operation history endpoint
  // ===============================================
  console.log('\n[7] Batch operation history query');

  await testCase('Can query batch operation history by batch_operation_id', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    if (unresolved.length < 1) throw new Error('No unresolved anomalies');

    const resolveResp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: [unresolved[0].id],
      reason: '批量回归测试：历史查询验证',
      result: 'normal'
    });
    const resolveData = JSON.parse(resolveResp.text);
    const batchOpId = resolveData.batch_operation_id;

    const histResp = await httpGet(BACKEND_BASE + `/api/anomalies/batch-operation/${batchOpId}`);
    if (histResp.statusCode !== 200) throw new Error('History query failed');

    const history = JSON.parse(histResp.text);
    if (history.length !== 1) throw new Error(`Expected 1 history entry, got ${history.length}`);
    if (history[0].batch_operation_id !== batchOpId) {
      throw new Error('batch_operation_id mismatch in history');
    }
  });

  // ===============================================
  // Test 8: Validation edge cases
  // ===============================================
  console.log('\n[8] Validation edge cases');

  await testCase('Batch resolve with empty array returns 400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: [],
      reason: 'test',
      result: 'normal'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Batch resolve without reason returns 400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['test'],
      reason: '',
      result: 'normal'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Batch resolve with invalid anomaly_type returns 400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['test'],
      reason: 'test',
      result: 'normal',
      anomaly_type: 'invalid_type'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Single resolve with invalid anomaly_type returns 400', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    if (unresolved.length < 1) throw new Error('No unresolved anomalies');

    const resp = await httpPost(BACKEND_BASE + `/api/anomalies/${unresolved[0].id}/resolve`, {
      reason: 'test',
      result: 'normal',
      anomaly_type: 'invalid_type'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Reopen already-unresolved anomaly returns 400', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    if (unresolved.length < 1) throw new Error('No unresolved anomalies');

    const resp = await httpPost(BACKEND_BASE + `/api/anomalies/${unresolved[0].id}/reopen`, {
      reason: 'test'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Resolve already-resolved anomaly returns 400', async () => {
    const resolved = await getAnomalies(testBatchId, 'resolved');
    if (resolved.length < 1) throw new Error('No resolved anomalies');

    const resp = await httpPost(BACKEND_BASE + `/api/anomalies/${resolved[0].id}/resolve`, {
      reason: 'test',
      result: 'normal'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Get non-existent anomaly returns 404', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/anom_nonexistent_123');
    if (resp.statusCode !== 404) throw new Error(`Expected 404, got ${resp.statusCode}`);
  });

  await testCase('Resolve non-existent anomaly returns 404', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/anom_nonexistent_123/resolve', {
      reason: 'test',
      result: 'normal'
    });
    if (resp.statusCode !== 404) throw new Error(`Expected 404, got ${resp.statusCode}`);
  });

  await testCase('Reopen non-existent anomaly returns 404', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/anom_nonexistent_123/reopen', {
      reason: 'test'
    });
    if (resp.statusCode !== 404) throw new Error(`Expected 404, got ${resp.statusCode}`);
  });

  // ===============================================
  // Test 9: Batch reopen with mixed status
  // ===============================================
  console.log('\n[9] Batch reopen with mixed status');

  await testCase('Batch reopen with mix of resolved and unresolved skips correctly', async () => {
    const unresolved = await getAnomalies(testBatchId, 'unresolved');
    const resolved = await getAnomalies(testBatchId, 'resolved');

    if (unresolved.length < 1 || resolved.length < 1) {
      console.log('    (skipped - need both resolved and unresolved)');
      return;
    }

    const mixIds = [
      resolved[0].id,
      unresolved[0].id,
      'anom_nonexistent_reopen_test'
    ];

    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: mixIds,
      reason: '批量回归测试：混合撤销测试'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    if (data.success.length !== 1) throw new Error(`Expected 1 success, got ${data.success.length}`);
    if (data.skipped.length !== 2) throw new Error(`Expected 2 skipped, got ${data.skipped.length}`);
  });

  // ===============================================
  // Summary
  // ===============================================
  console.log('\n===============================================');
  console.log(`  Results: PASS=${passCount}  FAIL=${failCount}`);
  console.log('===============================================');

  if (failCount > 0) {
    console.log(`\n\x1b[31mFAILED: ${failCount} tests\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32mALL ${passCount} TESTS PASSED\x1b[0m`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
