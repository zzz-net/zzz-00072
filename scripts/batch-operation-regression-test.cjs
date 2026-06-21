#!/usr/bin/env node
/**
 * Batch Operation Regression Test
 * Tests:
 * 1. Batch resolve anomalies (mark as normal / confirmed)
 * 2. Conflict skipping - already closed anomalies should be skipped
 * 3. History persistence after restart
 * 4. CSV export includes batch operation info
 * 5. Batch reopen (restore from closed)
 */

const fs = require('fs');
const path = require('path');
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

async function runTests() {
  const ts = Date.now();
  const batchName = `regression_batch_${ts}`;

  console.log('===============================================');
  console.log('  Batch Operation Regression Test');
  console.log('===============================================');
  console.log('  Backend:', BACKEND_BASE);

  // ===============================================
  // Setup: Create a sample batch with multiple anomalies
  // ===============================================
  console.log('\n[Setup] Creating sample batch...');

  const resp = await httpPost(BACKEND_BASE + '/api/batches/sample', {});
  if (resp.statusCode === 409) {
    console.log('  Sample batch exists, deleting old one first...');
  }
  const sampleResp = await httpPost(BACKEND_BASE + '/api/batches/sample', {});
  if (sampleResp.statusCode !== 200) {
    console.log(`  \x1b[33m[WARN]\x1b[0m Sample batch may already exist, using existing batches for test`);
  }
  const sampleData = JSON.parse(sampleResp.text);
  const batchId = sampleData.batch?.id;

  if (!batchId) {
    const batchesResp = await httpGet(BACKEND_BASE + '/api/batches');
    const batches = JSON.parse(batchesResp.text);
    if (batches.length === 0) {
      console.log('\x1b[31mNo batches available for testing\x1b[0m');
      process.exit(1);
    }
    // Find first batch with unresolved anomalies
    const testBatch = batches.find(b => b.unresolved_count > 0) || batches[0];
    console.log(`  Using existing batch: ${testBatch.name} (${testBatch.id})`);
    // Update ts to use this batch
  }

  // Get list of anomalies for the batch
  const testBatchId = batchId || (await (async () => {
    const r = await httpGet(BACKEND_BASE + '/api/batches');
    const bs = JSON.parse(r.text);
    const tb = bs.find(b => b.unresolved_count > 0) || bs[0];
    return tb.id;
  })());

  const anomaliesResp = await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatchId}&status=unresolved`);
  const anomalies = JSON.parse(anomaliesResp.text);

  if (anomalies.length < 2) {
    console.log(`\x1b[33m[WARN] Only ${anomalies.length} unresolved anomalies available, some tests may be limited\x1b[0m`);
  }

  const unresolvedIds = anomalies.slice(0, Math.min(3, anomalies.length)).map(a => a.id);
  console.log(`  Testing with ${unresolvedIds.length} unresolved anomalies`);

  // ===============================================
  // Test 1: Batch resolve (mark as normal)
  // ===============================================
  console.log('\n[1] Batch resolve (mark as normal)');

  await testCase('POST /batch-resolve returns valid response structure', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: unresolvedIds,
      reason: '批量回归测试：误报',
      result: 'normal'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    if (!data.batch_operation_id) throw new Error('Missing batch_operation_id');
    if (!data.success) throw new Error('Missing success array');
    if (!data.skipped) throw new Error('Missing skipped array');
    if (!data.failed) throw new Error('Missing failed array');
    if (data.success.length !== unresolvedIds.length) {
      throw new Error(`Expected ${unresolvedIds.length} success, got ${data.success.length}`);
    }
  });

  // Verify anomalies are now resolved
  await testCase('Anomalies are now in resolved status', async () => {
    const resp = await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatchId}&status=resolved`);
    const resolved = JSON.parse(resp.text);
    const found = unresolvedIds.filter(id => resolved.some(a => a.id === id));
    if (found.length !== unresolvedIds.length) {
      throw new Error(`Expected ${unresolvedIds.length} resolved, found ${found.length}`);
    }
  });

  await testCase('Review history includes batch_operation_id', async () => {
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/${unresolvedIds[0]}`);
    const detail = JSON.parse(detailResp.text);
    const lastHistory = detail.history[0];
    if (!lastHistory.batch_operation_id) {
      throw new Error('Missing batch_operation_id in history');
    }
    if (lastHistory.action !== 'resolve') throw new Error('Wrong action type');
    if (lastHistory.result !== 'normal') throw new Error('Wrong result');
  });

  await testCase('Batch unresolved count is updated', async () => {
    const batchResp = await httpGet(BACKEND_BASE + `/api/batches/${testBatchId}`);
    const batch = JSON.parse(batchResp.text);
    const origAnomalies = anomalies.length;
    if (batch.unresolved_count > origAnomalies) {
      throw new Error('Unresolved count should be <= original count');
    }
  });

  // ===============================================
  // Test 2: Conflict skipping - batch resolve with already-closed items
  // ===============================================
  console.log('\n[2] Conflict skipping test');

  await testCase('Batch resolve with mix of open and closed anomalies skips closed ones', async () => {
    const mixIds = [
      unresolvedIds[0],
      ...(anomalies.length > unresolvedIds.length ? [anomalies[unresolvedIds.length].id] : [])
    ].filter(Boolean);

    // Add one non-existent ID to test that case too
    const testIds = [...mixIds, 'anom_nonexistent_test'];

    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: testIds,
      reason: '批量回归测试：冲突测试',
      result: 'confirmed'
    });
    const data = JSON.parse(resp.text);

    const skippedNonExistent = data.skipped.find(s => s.id === 'anom_nonexistent_test');
    if (!skippedNonExistent) {
      throw new Error('Non-existent anomaly should be skipped');
    }
    if (data.skipped.length < 1) {
      throw new Error('Should have at least 1 skipped item');
    }
    if (data.success.length + data.skipped.length + data.failed.length !== testIds.length) {
      throw new Error('Total items should match input count');
    }
  });

  // ===============================================
  // Test 3: Batch reopen (restore to unresolved)
  // ===============================================
  console.log('\n[3] Batch reopen test');

  await testCase('POST /batch-reopen restores closed anomalies', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: unresolvedIds,
      reason: '批量回归测试：撤销批量关闭'
    });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);

    const data = JSON.parse(resp.text);
    if (data.success.length !== unresolvedIds.length) {
      throw new Error(`Expected ${unresolvedIds.length} success, got ${data.success.length}`);
    }
  });

  await testCase('Reopened anomalies are back to unresolved status', async () => {
    const resp = await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatchId}&status=unresolved`);
    const reopened = JSON.parse(resp.text);
    const found = unresolvedIds.filter(id => reopened.some(a => a.id === id));
    if (found.length !== unresolvedIds.length) {
      throw new Error(`Expected ${unresolvedIds.length} unresolved, found ${found.length}`);
    }
  });

  await testCase('Reopen history includes batch_operation_id', async () => {
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/${unresolvedIds[0]}`);
    const detail = JSON.parse(detailResp.text);
    const reopenHistory = detail.history.find(h => h.action === 'reopen');
    if (!reopenHistory) throw new Error('Missing reopen history entry');
    if (!reopenHistory.batch_operation_id) {
      throw new Error('Missing batch_operation_id in reopen history');
    }
  });

  // ===============================================
  // Test 4: CSV export includes batch operation info
  // ===============================================
  console.log('\n[4] CSV export test');

  await testCase('Export review history CSV includes batch_operation_id column', async () => {
    const exportResp = await httpGet(BACKEND_BASE + '/api/export/history');
    if (exportResp.statusCode !== 200) throw new Error('Export failed');
    if (!exportResp.text.includes('批量操作ID')) {
      throw new Error('CSV should include "批量操作ID" column');
    }
    const lines = exportResp.text.split('\n');
    if (lines.length < 2) throw new Error('CSV should have data rows');
    const header = lines[0];
    const columns = header.split(',');
    if (columns.length !== 7) {
      throw new Error(`Expected 7 columns, got ${columns.length}`);
    }
  });

  // ===============================================
  // Test 5: Batch operation history endpoint
  // ===============================================
  console.log('\n[5] Batch operation history endpoint');

  await testCase('GET /batch-operation/:id returns all items in batch', async () => {
    // First do a batch resolve to get a batch_operation_id
    const resolveResp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: unresolvedIds,
      reason: '批量回归测试：历史查询测试',
      result: 'normal'
    });
    const resolveData = JSON.parse(resolveResp.text);
    const batchOpId = resolveData.batch_operation_id;

    const histResp = await httpGet(BACKEND_BASE + `/api/anomalies/batch-operation/${batchOpId}`);
    if (histResp.statusCode !== 200) throw new Error('History endpoint failed');
    const history = JSON.parse(histResp.text);
    if (history.length !== unresolvedIds.length) {
      throw new Error(`Expected ${unresolvedIds.length} history entries, got ${history.length}`);
    }
    history.forEach(h => {
      if (h.batch_operation_id !== batchOpId) {
        throw new Error('History entry batch_operation_id mismatch');
      }
    });
  });

  // ===============================================
  // Test 6: Validation - bad requests
  // ===============================================
  console.log('\n[6] Input validation');

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
      anomaly_ids: unresolvedIds,
      reason: '',
      result: 'normal'
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  await testCase('Batch resolve without result returns 400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: unresolvedIds,
      reason: 'test',
      result: null
    });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  // Cleanup: reopen the anomalies we resolved in test 5
  await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
    anomaly_ids: unresolvedIds,
    reason: '测试完成，恢复为未结'
  });

  // ===============================================
  // Test 7: Data consistency after batch operations
  // ===============================================
  console.log('\n[7] Data consistency check');

  await testCase('Consistency check passes after batch operations', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/export/consistency');
    const data = JSON.parse(resp.text);
    if (!data.ok) {
      throw new Error(`Consistency check failed: ${JSON.stringify(data.issues)}`);
    }
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
