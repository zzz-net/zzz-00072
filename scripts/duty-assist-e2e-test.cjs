#!/usr/bin/env node

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

async function getAnomalies(batchId, status, type) {
  let url = `${BACKEND_BASE}/api/anomalies?batch_id=${batchId}`;
  if (status) url += `&status=${status}`;
  if (type) url += `&type=${type}`;
  const resp = await httpGet(url);
  return JSON.parse(resp.text);
}

async function getAnomalyDetail(anomalyId) {
  const resp = await httpGet(`${BACKEND_BASE}/api/anomalies/${anomalyId}`);
  return JSON.parse(resp.text);
}

async function getBatch(batchId) {
  const resp = await httpGet(`${BACKEND_BASE}/api/batches/${batchId}`);
  return JSON.parse(resp.text);
}

async function runTests() {
  console.log('===============================================');
  console.log('  Duty-Assist E2E: Filter → Preview → Batch → Export');
  console.log('===============================================');
  console.log('  Backend:', BACKEND_BASE);

  // ===============================================
  // Setup
  // ===============================================
  console.log('\n[Setup] Finding test batch...');
  const batchesResp = await httpGet(BACKEND_BASE + '/api/batches');
  const batches = JSON.parse(batchesResp.text);
  if (batches.length === 0) {
    console.log('\x1b[31mNo batches available\x1b[0m');
    process.exit(1);
  }
  const testBatch = batches.find(b => b.anomaly_count >= 4) || batches[0];
  const testBatchId = testBatch.id;
  console.log(`  Using: ${testBatch.name} (${testBatch.anomaly_count} anomalies, ${testBatch.unresolved_count} unresolved)`);

  // ===============================================
  // 1. Filter + Preview
  // ===============================================
  console.log('\n[1] Filter → Preview flow');

  await testCase('Batch preview with batch_ids filter returns matched results', async () => {
    const filter = { batch_ids: [testBatchId] };
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', { filter });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
    const data = JSON.parse(resp.text);
    if (data.matched_count < 1) throw new Error('Should match at least 1 anomaly');
    if (!data.by_batch || data.by_batch.length === 0) throw new Error('Missing by_batch breakdown');
    if (!data.by_status || data.by_status.length === 0) throw new Error('Missing by_status breakdown');
    if (!data.by_type) throw new Error('Missing by_type');
    if (data.samples.length > 20) throw new Error('Samples should be capped at 20');
  });

  await testCase('Batch preview with status=unresolved filter shows only unresolved', async () => {
    const filter = { batch_ids: [testBatchId], status: 'unresolved' };
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', { filter });
    const data = JSON.parse(resp.text);
    const allUnresolved = data.by_status.every(s => s.status === 'unresolved' || s.count === 0);
    if (!allUnresolved) throw new Error('Should only show unresolved when filtered');
  });

  await testCase('Batch preview with type filter works', async () => {
    const filter = { batch_ids: [testBatchId], anomaly_types: ['over_prep'] };
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', { filter });
    const data = JSON.parse(resp.text);
    if (data.by_type.length > 1) {
      const hasOther = data.by_type.some(t => t.type !== 'over_prep' && t.count > 0);
      if (hasOther) throw new Error('Should only show over_prep when filtered');
    }
  });

  // ===============================================
  // 2. Batch Resolve by Filter
  // ===============================================
  console.log('\n[2] Batch resolve by filter');

  const unresolvedBefore = await getAnomalies(testBatchId, 'unresolved');
  if (unresolvedBefore.length < 2) {
    console.log('  \x1b[33m[SKIP] Need at least 2 unresolved for batch test\x1b[0m');
  }

  let batchOpId = null;
  if (unresolvedBefore.length >= 1) {
    await testCase('Batch resolve by filter closes unresolved anomalies', async () => {
      const filter = { batch_ids: [testBatchId], status: 'unresolved' };
      const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
        filter,
        reason: 'E2E值班辅助测试：按筛选批量判误报',
        result: 'normal'
      });
      if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
      const data = JSON.parse(resp.text);
      batchOpId = data.batch_operation_id;
      if (!batchOpId) throw new Error('Missing batch_operation_id');
      if (data.success.length < 1) throw new Error('Should have at least 1 success');
      if (data.action !== 'resolve') throw new Error('Action should be resolve');
    });

    await testCase('After batch resolve, batch unresolved_count decremented', async () => {
      const batch = await getBatch(testBatchId);
      const actualUnresolved = (await getAnomalies(testBatchId, 'unresolved')).length;
      if (batch.unresolved_count !== actualUnresolved) {
        throw new Error(`Batch unresolved_count (${batch.unresolved_count}) != actual (${actualUnresolved})`);
      }
    });

    await testCase('Batch-resolved anomaly has history with batch_operation_id', async () => {
      if (!batchOpId) throw new Error('No batch op id');
      const opsResp = await httpGet(`${BACKEND_BASE}/api/anomalies/batch-operation/${batchOpId}`);
      const opsData = JSON.parse(opsResp.text);
      if (!opsData.history || opsData.history.length === 0) throw new Error('No history entries');
      const hasBatchOpId = opsData.history.every(h => h.batch_operation_id === batchOpId);
      if (!hasBatchOpId) throw new Error('Not all history entries have correct batch_operation_id');
    });

    await testCase('Batch operation record exists in list', async () => {
      const resp = await httpGet(BACKEND_BASE + '/api/anomalies/batch-operations/list');
      const list = JSON.parse(resp.text);
      const found = list.some(op => op.id === batchOpId);
      if (!found) throw new Error('Batch operation not found in list');
    });
  }

  // ===============================================
  // 3. Single resolve interleaves with batch
  // ===============================================
  console.log('\n[3] Single + batch interleaving');

  const remainingUnresolved = await getAnomalies(testBatchId, 'unresolved');
  if (remainingUnresolved.length >= 2) {
    await testCase('Single resolve works after batch resolve', async () => {
      const targetId = remainingUnresolved[0].id;
      const resp = await httpPost(`${BACKEND_BASE}/api/anomalies/${targetId}/resolve`, {
        reason: 'E2E单条处理穿插测试',
        result: 'confirmed'
      });
      if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
      const data = JSON.parse(resp.text);
      if (data.status !== 'resolved') throw new Error('Should be resolved');
    });

    await testCase('After single resolve, unresolved count still consistent', async () => {
      const batch = await getBatch(testBatchId);
      const actualUnresolved = (await getAnomalies(testBatchId, 'unresolved')).length;
      if (batch.unresolved_count !== actualUnresolved) {
        throw new Error(`Inconsistent: batch=${batch.unresolved_count}, actual=${actualUnresolved}`);
      }
    });

    const stillResolved = await getAnomalies(testBatchId, 'resolved');
    if (stillResolved.length >= 2) {
      await testCase('Batch reopen with mixed status skips already-unresolved', async () => {
        const justResolved = stillResolved[0];
        const alreadyReopened = remainingUnresolved[1] || remainingUnresolved[0];
        const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
          anomaly_ids: [justResolved.id, alreadyReopened.id],
          reason: 'E2E混合撤销测试'
        });
        const data = JSON.parse(resp.text);
        if (data.success.length < 1) throw new Error('Should have at least 1 success');
        if (data.skipped.length < 1) throw new Error('Should skip already-unresolved');
      });
    }
  }

  // ===============================================
  // 4. Operation logs
  // ===============================================
  console.log('\n[4] Operation logs');

  await testCase('Operation logs endpoint returns records', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/operation-logs/list?limit=20');
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
    const data = JSON.parse(resp.text);
    if (!Array.isArray(data)) throw new Error('Should return array');
    if (data.length > 0) {
      const first = data[0];
      if (!first.id || !first.action || !first.timestamp) {
        throw new Error('Missing required fields in operation log');
      }
    }
  });

  await testCase('Operation logs include recent operations', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/operation-logs/list?limit=50');
    const data = JSON.parse(resp.text);
    const hasBatchResolve = data.some(log => log.action.includes('resolve'));
    if (!hasBatchResolve && unresolvedBefore.length > 0) {
      throw new Error('Should have batch resolve logs after our operations');
    }
  });

  // ===============================================
  // 5. Export filtered detail
  // ===============================================
  console.log('\n[5] Export filtered detail');

  await testCase('Filtered export with batch_ids returns CSV', async () => {
    const filter = { batch_ids: [testBatchId] };
    const resp = await httpPost(BACKEND_BASE + '/api/export/filtered-detail', { filter });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
    const csv = resp.text;
    if (!csv.includes('异常ID')) throw new Error('CSV should include header');
    if (!csv.includes('人工判定')) throw new Error('CSV should include manual result column');
  });

  await testCase('Filtered export with status=resolved returns only resolved', async () => {
    const filter = { batch_ids: [testBatchId], status: 'resolved' };
    const resp = await httpPost(BACKEND_BASE + '/api/export/filtered-detail', { filter });
    if (resp.statusCode !== 200) throw new Error(`Expected 200, got ${resp.statusCode}`);
    const csv = resp.text;
    const lines = csv.split('\n').filter(l => l.trim());
    const dataLines = lines.slice(1);
    if (dataLines.length > 0) {
      const hasUnresolved = dataLines.some(l => l.includes('未结'));
      if (hasUnresolved) throw new Error('Should not contain unresolved anomalies');
    }
  });

  await testCase('Filtered export with empty filter returns 400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/export/filtered-detail', { filter: {} });
    if (resp.statusCode !== 400) throw new Error(`Expected 400, got ${resp.statusCode}`);
  });

  // ===============================================
  // 6. Full data consistency after all operations
  // ===============================================
  console.log('\n[6] Final data consistency');

  await testCase('Consistency check passes after all operations', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/export/consistency');
    const data = JSON.parse(resp.text);
    if (!data.ok) {
      throw new Error(`Consistency failed: ${JSON.stringify(data.issues)}`);
    }
  });

  await testCase('Batch unresolved_count matches actual for all batches', async () => {
    const batchResp = await httpGet(BACKEND_BASE + '/api/batches');
    const allBatches = JSON.parse(batchResp.text);
    for (const b of allBatches) {
      const actual = (await getAnomalies(b.id, 'unresolved')).length;
      if (b.unresolved_count !== actual) {
        throw new Error(`Batch ${b.name}: unresolved_count=${b.unresolved_count}, actual=${actual}`);
      }
    }
  });

  await testCase('Every resolved anomaly has resolve history', async () => {
    const resolved = await getAnomalies(testBatchId, 'resolved');
    for (const a of resolved.slice(0, 5)) {
      const detail = await getAnomalyDetail(a.id);
      const hasResolve = detail.history.some(h => h.action === 'resolve');
      if (!hasResolve) throw new Error(`Resolved anomaly ${a.id} missing resolve history`);
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
