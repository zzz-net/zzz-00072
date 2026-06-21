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

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
  console.log('===============================================');
  console.log('  Result Center E2E: Filter→Batch→ResultCenter→Export');
  console.log('===============================================');
  console.log('  Backend:', BACKEND_BASE);

  const healthResp = await httpGet(`${BACKEND_BASE}/api/health`);
  assert(healthResp.statusCode === 200, 'Server health check failed');
  console.log('  Server is up.\n');

  let batchId = null;
  let anomalyIds = [];
  let batchOpId = null;
  let idempotencyKey = 'e2e_idem_' + Date.now();

  await testCase('Get or create sample batch', async () => {
    const listResp = await httpGet(`${BACKEND_BASE}/api/batches`);
    const batches = JSON.parse(listResp.text);
    const existing = batches.find(b => b.unresolved_count > 0);
    if (existing) {
      batchId = existing.id;
      console.log('    (using existing batch: ' + existing.name + ')');
    } else {
      const resp = await httpPost(`${BACKEND_BASE}/api/batches/sample`, {});
      const data = JSON.parse(resp.text);
      if (data.error) {
        const anyBatch = batches.length > 0 ? batches[0] : null;
        if (anyBatch) {
          batchId = anyBatch.id;
          console.log('    (falling back to batch: ' + anyBatch.name + ')');
        } else {
          throw new Error('Cannot find or create a batch: ' + data.error);
        }
      } else {
        batchId = data.id;
      }
    }
    assert(batchId, 'No batch ID available');
  });

  await testCase('Fetch unresolved anomalies', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/anomalies?batch_id=${batchId}&status=unresolved`);
    const data = JSON.parse(resp.text);
    assert(Array.isArray(data) && data.length > 0, 'No unresolved anomalies found');
    anomalyIds = data.map(a => a.id).slice(0, 3);
    assert(anomalyIds.length >= 1, 'Need at least 1 anomaly');
  });

  await testCase('Batch preview before resolve', async () => {
    const resp = await httpPost(`${BACKEND_BASE}/api/anomalies/batch-preview`, {
      filter: { batch_ids: [batchId], status: 'unresolved' }
    });
    const data = JSON.parse(resp.text);
    assert(data.matched_count > 0, 'Preview matched_count should be > 0');
    assert(data.estimated_unresolved_actionable > 0, 'Should have actionable unresolved');
  });

  await testCase('Batch resolve with idempotency_key', async () => {
    const resp = await httpPost(`${BACKEND_BASE}/api/anomalies/batch-resolve`, {
      anomaly_ids: anomalyIds,
      reason: 'E2E test: batch resolve',
      result: 'normal',
      idempotency_key: idempotencyKey
    });
    const data = JSON.parse(resp.text);
    assert(!data.error, 'Batch resolve failed: ' + (data.error || ''));
    assert(data.batch_operation_id, 'No batch operation ID');
    assert(data.success.length > 0, 'Should have at least 1 success');
    batchOpId = data.batch_operation_id;
  });

  await testCase('Idempotency: re-submit same key returns cached result', async () => {
    const resp = await httpPost(`${BACKEND_BASE}/api/anomalies/batch-resolve`, {
      anomaly_ids: anomalyIds,
      reason: 'E2E test: duplicate',
      result: 'normal',
      idempotency_key: idempotencyKey
    });
    const data = JSON.parse(resp.text);
    assert(data.batch_operation_id === batchOpId, 'Idempotency should return same operation ID');
    assert(!data.error, 'Idempotency response should not error');
  });

  await testCase('Result center list is not empty', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/list?action=resolve`);
    const data = JSON.parse(resp.text);
    assert(Array.isArray(data) && data.length > 0, 'Result center list should not be empty');
    const found = data.find(op => op.id === batchOpId);
    assert(found, 'Should find the batch operation in result center list');
  });

  await testCase('Result center detail has items and history', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/detail/${batchOpId}`);
    const data = JSON.parse(resp.text);
    assert(data.operation, 'Detail should have operation');
    assert(Array.isArray(data.items) && data.items.length > 0, 'Detail should have result items');
    assert(Array.isArray(data.history) && data.history.length > 0, 'Detail should have history');
    const successItems = data.items.filter(i => i.outcome === 'success');
    assert(successItems.length > 0, 'Should have successful items');
    assert(successItems[0].dish_name !== undefined, 'Items should have dish_name');
    assert(successItems[0].status_before === 'unresolved', 'Status before should be unresolved');
  });

  await testCase('Result center config save and load', async () => {
    const config = {
      action_filter: 'resolve',
      outcome_filter: 'all',
      time_start: '',
      time_end: ''
    };
    const saveResp = await httpPost(`${BACKEND_BASE}/api/result-center/config`, config);
    assert(saveResp.statusCode === 200, 'Config save failed');
    const loadResp = await httpGet(`${BACKEND_BASE}/api/result-center/config`);
    const loaded = JSON.parse(loadResp.text);
    assert(loaded, 'Config should be loaded');
    assert(loaded.action_filter === 'resolve', 'Config action_filter should match');
  });

  await testCase('Result center export returns CSV', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/export/${batchOpId}`);
    assert(resp.statusCode === 200, 'Export should return 200');
    assert(resp.headers['content-type'].includes('text/csv'), 'Should return CSV content type');
    assert(resp.text.includes(batchOpId), 'CSV should contain operation ID');
    assert(resp.text.includes('\ufeff'), 'CSV should have BOM');
    assert(resp.text.includes('批量操作结果导出'), 'CSV should have header');
    assert(resp.text.includes('成功'), 'CSV should have outcome label');
  });

  await testCase('Batch reopen via result center tracking', async () => {
    const resolvedResp = await httpGet(`${BACKEND_BASE}/api/anomalies?status=resolved`);
    const resolved = JSON.parse(resolvedResp.text);
    const resolvedIds = resolved.slice(0, 2).map(a => a.id);
    if (resolvedIds.length === 0) {
      console.log('    (skipped - no resolved anomalies to reopen)');
      return;
    }
    const idemKey2 = 'e2e_reopen_' + Date.now();
    const resp = await httpPost(`${BACKEND_BASE}/api/anomalies/batch-reopen`, {
      anomaly_ids: resolvedIds,
      reason: 'E2E test: batch reopen',
      idempotency_key: idemKey2
    });
    const data = JSON.parse(resp.text);
    assert(!data.error, 'Batch reopen failed: ' + (data.error || ''));
    assert(data.batch_operation_id, 'Reopen should return batch operation ID');

    const detailResp = await httpGet(`${BACKEND_BASE}/api/result-center/detail/${data.batch_operation_id}`);
    const detail = JSON.parse(detailResp.text);
    assert(detail.items.length > 0, 'Reopen detail should have items');
    const successItems = detail.items.filter(i => i.outcome === 'success');
    assert(successItems.length > 0, 'Should have reopened items');
    assert(successItems[0].status_before === 'resolved', 'Status before reopen should be resolved');
  });

  await testCase('Result center outcome filter works', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/list?outcome=success`);
    const data = JSON.parse(resp.text);
    assert(Array.isArray(data), 'Should return array');
  });

  await testCase('Result center time range filter works', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/list?time_start=${today}&time_end=${today}`);
    const data = JSON.parse(resp.text);
    assert(Array.isArray(data), 'Should return array');
  });

  await testCase('Result center recent snapshot', async () => {
    const resp = await httpGet(`${BACKEND_BASE}/api/result-center/recent-snapshot?limit=3`);
    const data = JSON.parse(resp.text);
    assert(Array.isArray(data), 'Should return array');
    if (data.length > 0) {
      assert(data[0].operation, 'Snapshot should have operation');
      assert(Array.isArray(data[0].items), 'Snapshot should have items');
    }
  });

  console.log('\n===============================================');
  console.log(`  Results: ${passCount} passed, ${failCount} failed`);
  console.log('===============================================');

  if (failCount > 0) process.exit(1);
}

runTests().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
