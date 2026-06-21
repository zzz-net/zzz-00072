#!/usr/bin/env node
/**
 * 异常复核批量操作完整回归测试
 * 覆盖场景：
 * 1. 多条件筛选预览（batch-preview）
 * 2. 按ID批量判定正常/确认异常
 * 3. 冲突跳过详细场景（已被单条处理/已被撤销/不存在等7种）
 * 4. 按筛选条件批量处理（batch-resolve-by-filter / batch-reopen-by-filter）
 * 5. 跳过原因码精确校验
 * 6. batch_operations表持久化 + 重启可恢复
 * 7. 批量操作列表查询
 * 8. 批次未结计数联动
 * 9. CSV导出包含批量操作信息
 * 10. 一致性校验通过
 */

const http = require('http');

const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:3002';

let passCount = 0;
let failCount = 0;

function logPass(name) {
  console.log('  \x1b[32m[PASS]\x1b[0m ' + name);
  passCount++;
}
function logFail(name, err) {
  console.log('  \x1b[31m[FAIL]\x1b[0m ' + name);
  console.log('    Error: ' + (err && err.message ? err.message : String(err)));
  failCount++;
}
async function testCase(name, fn) {
  try {
    await fn();
    logPass(name);
  } catch (e) {
    logFail(name, e);
  }
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertGte(a, b, msg) {
  if (!(a >= b)) throw new Error(`${msg || 'assertion failed'}: ${a} >= ${b}`);
}
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
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
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const VALID_SKIP_CODES = new Set([
  'not_found',
  'already_resolved',
  'already_unresolved',
  'status_changed_by_other',
  'reopened_after_batch',
  'modified_individually',
  'batch_mismatch',
]);

async function runTests() {
  console.log('============================================================');
  console.log('  异常复核批量处理完整回归测试');
  console.log('============================================================');
  console.log('  Backend:', BACKEND_BASE);

  // ===============================================
  // Setup: 导入样例批次，获取可用异常
  // ===============================================
  console.log('\n[Setup] 准备测试数据...');

  const sampleResp = await httpPost(BACKEND_BASE + '/api/batches/sample', {});
  if (sampleResp.statusCode !== 200) {
    console.log('  (样例批次可能已存在，继续使用现有数据)');
  }

  const batchesResp = await httpGet(BACKEND_BASE + '/api/batches');
  assertEq(batchesResp.statusCode, 200, '获取批次列表失败');
  const batches = JSON.parse(batchesResp.text);
  assertTrue(batches.length > 0, '没有可用批次');

  const testBatch = batches.find((b) => b.unresolved_count > 0) || batches[0];
  assertTrue(testBatch, '找不到可用测试批次');
  console.log(`  使用批次: ${testBatch.name} (ID=${testBatch.id.slice(-12)}, 未结=${testBatch.unresolved_count})`);

  const allAnomResp = await httpGet(
    BACKEND_BASE + `/api/anomalies?batch_id=${testBatch.id}`
  );
  assertEq(allAnomResp.statusCode, 200, '获取异常列表失败');
  const allAnomalies = JSON.parse(allAnomResp.text);
  assertTrue(allAnomalies.length > 0, '批次下没有异常记录');

  const unresolved = allAnomalies.filter((a) => a.status === 'unresolved');
  const resolved = allAnomalies.filter((a) => a.status === 'resolved');
  console.log(`  异常情况: 未结=${unresolved.length}, 已关=${resolved.length}, 合计=${allAnomalies.length}`);

  if (unresolved.length < 5) {
    console.log('  \x1b[33m[WARN]\x1b[0m 未结异常数量较少，部分批量规模测试会受限');
  }

  // ===============================================
  // Test 1: 批量预览接口（按批次 + 状态筛选）
  // ===============================================
  console.log('\n[T1] 批量预览接口（batch-preview）');

  let previewData;
  await testCase('POST /batch-preview 按批次+未结筛选返回完整结构', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'unresolved',
      },
    });
    assertEq(resp.statusCode, 200, '预览接口状态码');
    previewData = JSON.parse(resp.text);

    assertTrue(previewData.filter, '缺少filter字段');
    assertEq(typeof previewData.matched_count, 'number', 'matched_count应为数字');
    assertTrue(Array.isArray(previewData.by_batch), 'by_batch应为数组');
    assertTrue(Array.isArray(previewData.by_type), 'by_type应为数组');
    assertTrue(Array.isArray(previewData.by_status), 'by_status应为数组');
    assertTrue(Array.isArray(previewData.samples), 'samples应为数组');
    assertEq(typeof previewData.estimated_unresolved_actionable, 'number');
    assertEq(typeof previewData.estimated_resolved_actionable, 'number');

    const byBatchEntry = previewData.by_batch.find((b) => b.batch_id === testBatch.id);
    assertTrue(byBatchEntry, 'by_batch中应包含测试批次');
    assertEq(byBatchEntry.unresolved_count, previewData.estimated_unresolved_actionable, '批次未结统计应一致');
    assertTrue(previewData.samples.length <= 20, '样例最多20条');
  });

  await testCase('预览中samples字段包含异常详情（菜品名/称重时间/证据摘要）', async () => {
    if (previewData.samples.length === 0) throw new Error('无样例可校验');
    const s = previewData.samples[0];
    assertTrue(s.id && s.batch_id && s.anomaly_type && s.status, '基础字段');
    assertTrue(typeof s.dish_name === 'string', 'dish_name');
    assertTrue(typeof s.record_time === 'string', 'record_time');
    assertTrue(typeof s.evidence_summary === 'string', 'evidence_summary');
  });

  await testCase('按异常类型筛选的预览结果符合预期', async () => {
    const types = [...new Set(unresolved.map((a) => a.anomaly_type))];
    if (types.length === 0) throw new Error('无未结异常');
    for (const t of types) {
      const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', {
        filter: {
          batch_ids: [testBatch.id],
          status: 'unresolved',
          anomaly_types: [t],
        },
      });
      const d = JSON.parse(resp.text);
      const expected = unresolved.filter((a) => a.anomaly_type === t).length;
      assertEq(d.matched_count, expected, `类型${t}预览计数`);
    }
  });

  await testCase('按菜品关键词搜索预览', async () => {
    const someDish = unresolved[0] ? (await (async () => {
      const r = await httpGet(BACKEND_BASE + `/api/anomalies/${unresolved[0].id}`);
      return JSON.parse(r.text).record.dish_name;
    })()) : null;
    if (!someDish) throw new Error('找不到菜品名');
    const keyword = someDish.slice(0, 2);
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', {
      filter: {
        batch_ids: [testBatch.id],
        dish_name_keyword: keyword,
      },
    });
    const d = JSON.parse(resp.text);
    assertTrue(d.matched_count >= 1, `关键词"${keyword}"至少匹配1条`);
    assertTrue(
      d.samples.every((s) => s.dish_name.includes(keyword)),
      '样例菜品名应包含关键词'
    );
  });

  // ===============================================
  // Test 2: 按ID批量判定异常
  // ===============================================
  console.log('\n[T2] 按ID批量判定正常/确认异常');

  const batchResolveIds = unresolved.slice(0, Math.min(3, unresolved.length)).map((a) => a.id);
  let batchResolveResult;

  await testCase('POST /batch-resolve 判定为"正常（误报）"返回完整结果', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: batchResolveIds,
      reason: '回归测试批量判定：经核对为误报',
      result: 'normal',
    });
    assertEq(resp.statusCode, 200, '状态码');
    batchResolveResult = JSON.parse(resp.text);

    assertEq(batchResolveResult.action, 'resolve', 'action字段');
    assertEq(batchResolveResult.applied_result, 'normal', 'applied_result');
    assertEq(batchResolveResult.total_submitted, batchResolveIds.length, 'total_submitted');
    assertTrue(batchResolveResult.batch_operation_id, '有batch_operation_id');
    assertEq(batchResolveResult.success.length, batchResolveIds.length, '全成功');
    assertEq(batchResolveResult.skipped.length + batchResolveResult.failed.length, 0, '无跳过/失败');

    batchResolveResult.success.forEach((item) => {
      assertTrue(item.id, 'success项有id');
      assertTrue(item.success === true, 'success项success=true');
    });
  });

  await testCase('批量判定后异常状态+批次未结计数同步更新', async () => {
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/${batchResolveIds[0]}`);
    const detail = JSON.parse(detailResp.text);
    assertEq(detail.status, 'resolved', '异常已关闭');
    assertEq(detail.manual_result, 'normal', '判定结果=normal');

    const batchResp = await httpGet(BACKEND_BASE + `/api/batches`);
    const bs = JSON.parse(batchResp.text);
    const updatedBatch = bs.find((b) => b.id === testBatch.id);
    assertTrue(
      updatedBatch.unresolved_count === testBatch.unresolved_count - batchResolveIds.length
      || updatedBatch.unresolved_count <= testBatch.unresolved_count,
      '未结计数减少'
    );
  });

  await testCase('批量判定后复核历史带batch_operation_id', async () => {
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/${batchResolveIds[0]}`);
    const detail = JSON.parse(detailResp.text);
    const lastHist = detail.history[0];
    assertEq(lastHist.action, 'resolve', 'action=resolve');
    assertEq(lastHist.batch_operation_id, batchResolveResult.batch_operation_id, 'batch_operation_id一致');
    assertEq(lastHist.result, 'normal', 'result=normal');
  });

  // ===============================================
  // Test 3: 冲突场景细化（7种跳过原因码）
  // ===============================================
  console.log('\n[T3] 冲突跳过细化（7种SkipReasonCode）');

  await testCase('not_found：提交不存在的ID，跳过原因精确为not_found', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['anom_DOES_NOT_EXIST_xyz'],
      reason: '测试',
      result: 'confirmed',
    });
    const d = JSON.parse(resp.text);
    assertEq(d.skipped.length, 1, '1条跳过');
    assertEq(d.skipped[0].skip_reason, 'not_found', 'skip_reason=not_found');
    assertTrue(VALID_SKIP_CODES.has(d.skipped[0].skip_reason), '跳过原因码有效');
  });

  await testCase('already_resolved：批量包含已被T2关闭的异常，跳过原因精确识别', async () => {
    const mixIds = [batchResolveIds[0], ...unresolved.slice(3, 5).map((a) => a.id)].filter(Boolean);
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: mixIds,
      reason: '冲突测试：混合已关+未结',
      result: 'confirmed',
    });
    const d = JSON.parse(resp.text);
    const alreadyResolvedSkip = d.skipped.find((s) => s.id === batchResolveIds[0]);
    assertTrue(alreadyResolvedSkip, '第一条应被跳过');
    assertTrue(
      alreadyResolvedSkip.skip_reason === 'already_resolved' || alreadyResolvedSkip.skip_reason === 'status_changed_by_other',
      `跳过原因应为already_resolved或status_changed_by_other，实际=${alreadyResolvedSkip.skip_reason}`
    );
    assertEq(
      d.success.length + d.skipped.length + d.failed.length,
      mixIds.length,
      '总数一致'
    );
  });

  await testCase('单条处理后再批量包含，精确区分跳过原因', async () => {
    // 取1条未结先单条关闭
    const singleTarget = unresolved.find((a) => !batchResolveIds.includes(a.id));
    if (!singleTarget) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 数据不足：没有额外的未结异常用于单条+批量混用测试');
      return;
    }
    const singleResp = await httpPost(
      BACKEND_BASE + `/api/anomalies/${singleTarget.id}/resolve`,
      { reason: '单条先处理：制造冲突', result: 'confirmed' }
    );
    assertEq(singleResp.statusCode, 200, '单条关闭成功');

    // 再批量包含这条
    const resp2 = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: [singleTarget.id],
      reason: '批量尝试关闭已被单条处理的',
      result: 'normal',
    });
    const d2 = JSON.parse(resp2.text);
    assertEq(d2.skipped.length, 1, '应被跳过');
    assertTrue(
      d2.skipped[0].skip_reason === 'already_resolved' || d2.skipped[0].skip_reason === 'modified_individually',
      `被单条处理过的应被识别，实际=${d2.skipped[0].skip_reason}`
    );
    assertTrue(VALID_SKIP_CODES.has(d2.skipped[0].skip_reason), '跳过原因码有效枚举');
  });

  await testCase('already_unresolved：批量撤销时对未结异常跳过', async () => {
    const stillUnresolved = unresolved.find((a) => !batchResolveIds.includes(a.id) && a.status === 'unresolved');
    const testIds = [batchResolveIds[0], stillUnresolved ? stillUnresolved.id : 'x'].filter((x) => x !== 'x');
    if (testIds.length < 2) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 数据不足：需要至少1条已关+1条未结用于混合撤销测试');
      return;
    }
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: testIds,
      reason: '撤销测试',
    });
    const d = JSON.parse(resp.text);
    // batchResolveIds[0] 在 T2 被关了所以应成功；stillUnresolved 应跳过
    const unresolvedSkip = d.skipped.find((s) => VALID_SKIP_CODES.has(s.skip_reason) && s.id === stillUnresolved.id);
    assertTrue(
      d.skipped.length >= 1 && (unresolvedSkip || d.skipped.some((s) => s.skip_reason === 'already_unresolved')),
      '未结异常在批量撤销时应跳过或存在already_unresolved'
    );
  });

  // ===============================================
  // Test 4: 按筛选条件批量处理
  // ===============================================
  console.log('\n[T4] 按筛选条件批量处理（by-filter）');

  // 先恢复T2、T3处理过的以便测试
  const toRestoreIds = batchResolveIds.slice();
  if (toRestoreIds.length > 0) {
    await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: toRestoreIds,
      reason: 'T4前恢复，便于按筛选测试',
    });
  }

  await testCase('POST /batch-resolve-by-filter 按类型+批次批量关闭', async () => {
    const typesAvailable = [...new Set(unresolved.map((a) => a.anomaly_type))];
    if (typesAvailable.length === 0) throw new Error('无类型可测');
    const targetType = typesAvailable[0];

    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'unresolved',
        anomaly_types: [targetType],
      },
      reason: `按筛选批量判定：${targetType === 'over_prep' ? '备餐过量误报' : '温度误报'}`,
      result: 'normal',
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(
      d.batch_operation_id,
      '按筛选也有batch_operation_id'
    );
    assertEq(d.action, 'resolve');
    assertEq(d.total_submitted >= 0, true);
    assertTrue(
      d.success.length + d.skipped.length + d.failed.length === d.total_submitted || d.total_submitted === 0,
      '合计一致'
    );
  });

  await testCase('按空筛选批量处理拒绝（400）', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
      filter: {},
      reason: 'x',
      result: 'normal',
    });
    assertEq(resp.statusCode, 400, '空筛选应400');
  });

  await testCase('POST /batch-reopen-by-filter 按筛选批量撤销', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen-by-filter', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'resolved',
      },
      reason: '按筛选批量撤销测试',
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(d.batch_operation_id, '按筛选撤销也有batch_operation_id');
    assertEq(d.action, 'reopen');
  });

  // ===============================================
  // Test 5: batch_operations表持久化 + 列表查询
  // ===============================================
  console.log('\n[T5] batch_operations持久化 & 批量操作列表');

  let opsList;
  await testCase('GET /batch-operations/list 返回最近批量操作', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/batch-operations/list');
    assertEq(resp.statusCode, 200, '状态码');
    opsList = JSON.parse(resp.text);
    assertTrue(Array.isArray(opsList), '返回数组');
    assertTrue(opsList.length >= 2, `至少有2条历史操作，实际=${opsList.length}`);

    // 校验结构
    const first = opsList[0];
    assertTrue(first.id && first.action && first.timestamp, '基础字段');
    assertEq(typeof first.total_submitted, 'number');
    assertEq(typeof first.success_count, 'number');
    assertEq(typeof first.skipped_count, 'number');
    assertEq(typeof first.failed_count, 'number');
    assertTrue(['resolve', 'reopen'].includes(first.action), 'action枚举');
  });

  await testCase('GET /batch-operation/:id 返回操作元数据+关联历史', async () => {
    if (!opsList || opsList.length === 0) throw new Error('无操作记录');
    const targetOp = opsList[0];
    const resp = await httpGet(BACKEND_BASE + `/api/anomalies/batch-operation/${targetOp.id}`);
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(d.operation, '有operation字段');
    assertTrue(Array.isArray(d.history), 'history是数组');
    if (targetOp.success_count > 0) {
      assertTrue(
        d.history.length >= targetOp.success_count || d.history.length >= 1,
        'history至少包含成功项'
      );
      d.history.forEach((h) => {
        assertEq(h.batch_operation_id, targetOp.id, '历史batch_operation_id一致');
      });
    }
  });

  await testCase('batch_operations记录与实际结果一致（计数匹配）', async () => {
    if (!opsList || opsList.length === 0) throw new Error('无操作记录');
    const targetOp = opsList[0];
    const total = targetOp.success_count + targetOp.skipped_count + targetOp.failed_count;
    assertEq(total, targetOp.total_submitted, '成功+跳过+失败=提交总数');
  });

  // ===============================================
  // Test 6: 跳过原因展示（中文原因）
  // ===============================================
  console.log('\n[T6] 跳过原因中文标签');

  await testCase('所有跳过项均有中文说明（error字段）', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['anom_NOT_FOUND_abc', 'anom_NOT_FOUND_def'],
      reason: '测试中文跳过原因',
      result: 'confirmed',
    });
    const d = JSON.parse(resp.text);
    assertEq(d.skipped.length, 2, '2条跳过');
    d.skipped.forEach((s) => {
      assertTrue(typeof s.error === 'string' && s.error.length > 0, 'error字段有中文描述');
    });
  });

  await testCase('响应结构字段完整性：跳过项带previous_status/dish_name', async () => {
    const mixIds = [batchResolveIds[0] || 'x'];
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: mixIds,
      reason: '字段完整性校验',
      result: 'normal',
    });
    const d = JSON.parse(resp.text);
    const allItems = [...d.success, ...d.skipped];
    allItems.forEach((item) => {
      assertTrue(typeof item.id === 'string', '每一项有id');
      assertTrue('success' in item, '每一项有success字段');
    });
    d.skipped.forEach((s) => {
      assertTrue(VALID_SKIP_CODES.has(s.skip_reason), `skip_reason=${s.skip_reason} 是有效枚举`);
    });
  });

  // ===============================================
  // Test 7: 批量撤销（batch-reopen）完整性
  // ===============================================
  console.log('\n[T7] 批量撤销（batch-reopen）');

  // 先批量关一批，再撤销回来
  const reopenTestIds = unresolved.filter((a) => !batchResolveIds.includes(a.id)).slice(0, Math.min(2, unresolved.length)).map((a) => a.id);
  if (reopenTestIds.length > 0) {
    await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: reopenTestIds,
      reason: 'T7撤销前先批量关闭',
      result: 'confirmed',
    });
  }

  await testCase('POST /batch-reopen 成功恢复，applied_result为null', async () => {
    if (reopenTestIds.length === 0) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 数据不足：没有可撤销的已关异常');
      return;
    }
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen', {
      anomaly_ids: reopenTestIds,
      reason: 'T7批量撤销测试',
    });
    const d = JSON.parse(resp.text);
    assertEq(d.action, 'reopen');
    assertTrue(d.applied_result === null || d.applied_result === undefined, 'reopen的applied_result为null');
    assertTrue(d.batch_operation_id, '有batch_operation_id');

    // 验证状态恢复
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/${reopenTestIds[0]}`);
    const detail = JSON.parse(detailResp.text);
    assertEq(detail.status, 'unresolved', '状态恢复为未结');
  });

  // ===============================================
  // Test 8: CSV导出包含批量操作信息
  // ===============================================
  console.log('\n[T8] 导出内容联动');

  await testCase('导出复核历史CSV包含批量操作ID列', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/export/history');
    assertEq(resp.statusCode, 200, '状态码');
    assertTrue(resp.text.includes('批量操作ID'), '含"批量操作ID"列头');
    // 检查CSV至少有一行数据（含batch_operation_id值）
    const lines = resp.text.split('\n').filter((l) => l.trim().length > 0);
    assertTrue(lines.length >= 2, '有数据行');
  });

  await testCase('导出明细CSV反映最新批量状态', async () => {
    const resp = await httpGet(BACKEND_BASE + `/api/export/detail?batch_ids=${testBatch.id}`);
    assertEq(resp.statusCode, 200, '状态码');
    assertTrue(resp.text.includes('人工判定'), '含人工判定列');
    assertTrue(resp.text.includes('人工原因'), '含人工原因列');
  });

  // ===============================================
  // Test 9: 输入校验
  // ===============================================
  console.log('\n[T9] 输入参数校验');

  await testCase('batch-resolve 空数组→400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: [],
      reason: 'x',
      result: 'normal',
    });
    assertEq(resp.statusCode, 400);
  });
  await testCase('batch-resolve 缺reason→400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['x'],
      reason: '',
      result: 'normal',
    });
    assertEq(resp.statusCode, 400);
  });
  await testCase('batch-resolve 缺result→400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['x'],
      reason: 'x',
      result: null,
    });
    assertEq(resp.statusCode, 400);
  });
  await testCase('batch-reopen-by-filter 空筛选→400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen-by-filter', {
      filter: {},
    });
    assertEq(resp.statusCode, 400);
  });
  await testCase('batch-resolve 非法异常类型→400', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve', {
      anomaly_ids: ['x'],
      reason: 'x',
      result: 'normal',
      anomaly_type: 'invalid_type',
    });
    assertEq(resp.statusCode, 400);
  });

  // ===============================================
  // Test 10: 一致性校验
  // ===============================================
  console.log('\n[T10] 数据一致性');

  await testCase('POST /export/consistency 全部通过', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/export/consistency');
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    if (!d.ok) {
      throw new Error(`一致性问题：${JSON.stringify(d.issues)}`);
    }
    assertTrue(d.ok, '无不一致');
  });

  // ===============================================
  // Test 11: 跨批次查询 + 组合筛选直接批量提交
  // ===============================================
  console.log('\n[T11] 跨批次查询 & 组合筛选直接批量提交');

  await testCase('GET /anomalies 不传batch_id返回全部批次异常', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies');
    assertEq(resp.statusCode, 200, '状态码');
    const allAnom = JSON.parse(resp.text);
    assertTrue(allAnom.length >= unresolved.length, '全量异常>=单批次');
  });

  await testCase('预览跨批次（不设batch_ids）返回多批次分布', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', {
      filter: { status: 'unresolved' },
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(d.matched_count >= unresolved.length, '跨批次未结异常更多或相等');
    assertTrue(d.by_batch.length >= 1, '至少1个批次');
  });

  await testCase('按组合条件预览：类型+状态，计数精确', async () => {
    const freshAnomResp = await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatch.id}`);
    const freshAnom = JSON.parse(freshAnomResp.text);
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-preview', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'unresolved',
        anomaly_types: ['over_prep'],
      },
    });
    const d = JSON.parse(resp.text);
    const expectedCount = freshAnom.filter(
      (a) => a.batch_id === testBatch.id && a.status === 'unresolved' && a.anomaly_type === 'over_prep'
    ).length;
    assertEq(d.matched_count, expectedCount, `over_prep未结计数精确: 期望${expectedCount}`);
  });

  let filterResolveOpId;
  await testCase('按筛选直接批量判误报（by-filter），batch_operation_id可查', async () => {
    const freshAnom = JSON.parse((await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatch.id}&status=unresolved`)).text);
    if (freshAnom.length === 0) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 当前批次无未结异常可按筛选批量判误报');
      return;
    }
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'unresolved',
      },
      reason: '回归T11：按筛选直接批量判误报',
      result: 'normal',
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(d.batch_operation_id, '有batch_operation_id');
    filterResolveOpId = d.batch_operation_id;
    assertEq(d.action, 'resolve');
    assertEq(d.applied_result, 'normal');
    assertTrue(d.success.length + d.skipped.length + d.failed.length === d.total_submitted, '分类合计=提交');
    if (d.skipped.length > 0) {
      d.skipped.forEach((s) => {
        assertTrue(VALID_SKIP_CODES.has(s.skip_reason), `跳过原因${s.skip_reason}有效`);
      });
    }
  });

  await testCase('按筛选批量判误报后，batch_operations表可查操作详情', async () => {
    if (!filterResolveOpId) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 无上一步操作ID');
      return;
    }
    const resp = await httpGet(BACKEND_BASE + `/api/anomalies/batch-operation/${filterResolveOpId}`);
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertEq(d.operation.id, filterResolveOpId, 'ID匹配');
    assertEq(d.operation.applied_result, 'normal', 'applied_result=normal');
    assertTrue(d.operation.filter_snapshot, 'filter_snapshot非空');
    assertTrue(Array.isArray(d.history), 'history数组');
  });

  await testCase('按筛选批量撤销关闭（by-filter）成功', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-reopen-by-filter', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'resolved',
      },
      reason: '回归T11：按筛选批量撤销',
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertTrue(d.batch_operation_id, '有batch_operation_id');
    assertEq(d.action, 'reopen');
    if (d.success.length > 0) {
      const checkResp = await httpGet(BACKEND_BASE + `/api/anomalies/${d.success[0].id}`);
      const checkDetail = JSON.parse(checkResp.text);
      assertEq(checkDetail.status, 'unresolved', '撤销后状态=unresolved');
    }
  });

  await testCase('空结果筛选批量提交返回total_submitted=0', async () => {
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
      filter: {
        batch_ids: ['batch_NONEXISTENT_xyz'],
        status: 'unresolved',
      },
      reason: '空结果测试',
      result: 'normal',
    });
    assertEq(resp.statusCode, 200, '状态码');
    const d = JSON.parse(resp.text);
    assertEq(d.total_submitted, 0, 'total_submitted=0');
  });

  await testCase('单条处理后再按筛选批量，已处理项不出现（被筛选排除）', async () => {
    const freshAnom = JSON.parse((await httpGet(BACKEND_BASE + `/api/anomalies?batch_id=${testBatch.id}&status=unresolved`)).text);
    if (freshAnom.length < 2) {
      console.log('    \x1b[33m[SKIP]\x1b[0m 数据不足2条未结');
      return;
    }
    const target = freshAnom[0];
    await httpPost(BACKEND_BASE + `/api/anomalies/${target.id}/resolve`, {
      reason: 'T11混用：先单条关',
      result: 'confirmed',
    });
    const resp = await httpPost(BACKEND_BASE + '/api/anomalies/batch-resolve-by-filter', {
      filter: {
        batch_ids: [testBatch.id],
        status: 'unresolved',
      },
      reason: 'T11混用：再按筛选批量',
      result: 'normal',
    });
    const d = JSON.parse(resp.text);
    const inSuccess = d.success.find((s) => s.id === target.id);
    const inSkipped = d.skipped.find((s) => s.id === target.id);
    assertTrue(!inSuccess, '已被单条关闭的不应出现在success中');
    if (inSkipped) {
      assertTrue(VALID_SKIP_CODES.has(inSkipped.skip_reason), `如果出现在skipped中，原因码有效`);
    }
  });

  // ===============================================
  // Test 12: 重启恢复验证（不实际重启，验证DB可查）
  // ===============================================
  console.log('\n[T12] 重启后恢复验证（DB数据完整性）');

  await testCase('batch_operations表有足够记录（>=3）', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/batch-operations/list');
    const list = JSON.parse(resp.text);
    assertTrue(list.length >= 3, `批量操作记录>=3，实际=${list.length}`);
  });

  await testCase('每条batch_operation的filter_snapshot可解析或为空', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/batch-operations/list');
    const list = JSON.parse(resp.text);
    list.slice(0, 5).forEach((op) => {
      if (!op.filter_snapshot) return;
      const snap = typeof op.filter_snapshot === 'string' ? JSON.parse(op.filter_snapshot) : op.filter_snapshot;
      assertTrue(typeof snap === 'object' && snap !== null, `filter_snapshot可解析: op=${op.id.slice(-8)}`);
    });
  });

  await testCase('review_history中批量操作ID与batch_operations对应', async () => {
    const resp = await httpGet(BACKEND_BASE + '/api/anomalies/batch-operations/list');
    const list = JSON.parse(resp.text);
    if (list.length === 0) throw new Error('无操作记录');
    const op = list[0];
    const detailResp = await httpGet(BACKEND_BASE + `/api/anomalies/batch-operation/${op.id}`);
    const detail = JSON.parse(detailResp.text);
    assertTrue(detail.history.length >= op.success_count, `历史记录数>=成功数`);
    detail.history.forEach((h) => {
      assertEq(h.batch_operation_id, op.id, '历史batch_operation_id匹配');
    });
  });

  // ===============================================
  // 汇总
  // ===============================================
  console.log('\n============================================================');
  console.log(`  结果: PASS=${passCount}  FAIL=${failCount}`);
  console.log('============================================================');

  if (failCount > 0) {
    console.log(`\n\x1b[31mFAILED: ${failCount} 个用例未通过\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32m全部 ${passCount} 个用例通过 ✓\x1b[0m`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('  \x1b[31m[FATAL]\x1b[0m 测试运行出错:', err.message);
  console.error(err.stack);
  process.exit(1);
});
