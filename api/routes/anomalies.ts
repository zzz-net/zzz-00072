import { Router, Request, Response } from 'express';
import { db, genId } from '../db';
import type {
  Anomaly,
  AnomalyDetail,
  AnomalyStatus,
  AnomalyType,
  BatchFilterCriteria,
  BatchOperationRecord,
  BatchOperationResponse,
  BatchOperationResultItem,
  BatchPreviewAnomaly,
  BatchPreviewResponse,
  ManualResult,
  OperationLog,
  ReviewHistory,
  Rule,
  SkipReasonCode,
  WeighingRecord,
} from '../../shared/types';

const router = Router();

function logInfo(msg: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [ANOMALIES] [INFO]`;
  if (data) {
    console.log(prefix, msg, JSON.stringify(data));
  } else {
    console.log(prefix, msg);
  }
}

function logWarn(msg: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [ANOMALIES] [WARN]`;
  if (data) {
    console.warn(prefix, msg, JSON.stringify(data));
  } else {
    console.warn(prefix, msg);
  }
}

function logError(msg: string, err?: Error, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [ANOMALIES] [ERROR]`;
  if (err && data) {
    console.error(prefix, msg, err.message, JSON.stringify(data));
  } else if (err) {
    console.error(prefix, msg, err.message);
  } else if (data) {
    console.error(prefix, msg, JSON.stringify(data));
  } else {
    console.error(prefix, msg);
  }
}

function skipReasonToLabel(code: SkipReasonCode): string {
  const map: Record<SkipReasonCode, string> = {
    not_found: '异常记录不存在',
    already_resolved: '已被单条或其他批量操作关闭',
    already_unresolved: '已处于未结状态（可能已被撤销）',
    status_changed_by_other: '提交后状态已发生变化',
    reopened_after_batch: '该记录已被其他批量撤销操作恢复',
    modified_individually: '已被单条复核处理',
    batch_mismatch: '筛选条件与当前记录不匹配',
  };
  return map[code] || '未知原因';
}

function logOperation(
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string | null,
  filterSnapshot?: BatchFilterCriteria | null
): void {
  try {
    const id = genId('oplog');
    db.prepare(`
      INSERT INTO operation_logs (id, action, target_type, target_id, detail, operator, filter_snapshot, timestamp)
      VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)
    `).run(
      id,
      action,
      targetType,
      targetId,
      detail,
      filterSnapshot ? JSON.stringify(filterSnapshot) : null,
      new Date().toISOString()
    );
  } catch (err) {
    logError('Failed to write operation log', err as Error, { action, targetId });
  }
}

function buildFilterSql(filter: BatchFilterCriteria): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];

  if (filter.batch_ids && filter.batch_ids.length > 0) {
    const placeholders = filter.batch_ids.map(() => '?').join(',');
    parts.push(`a.batch_id IN (${placeholders})`);
    params.push(...filter.batch_ids);
  }

  if (filter.status) {
    parts.push('a.status = ?');
    params.push(filter.status);
  }

  if (filter.anomaly_types && filter.anomaly_types.length > 0) {
    const placeholders = filter.anomaly_types.map(() => '?').join(',');
    parts.push(`a.anomaly_type IN (${placeholders})`);
    params.push(...filter.anomaly_types);
  }

  if (filter.manual_results && filter.manual_results.length > 0) {
    const nonNull = filter.manual_results.filter((r) => r !== null) as string[];
    const hasNull = filter.manual_results.some((r) => r === null);
    const placeholders = nonNull.map(() => '?').join(',');
    if (nonNull.length > 0 && hasNull) {
      parts.push(`(a.manual_result IN (${placeholders}) OR a.manual_result IS NULL)`);
      params.push(...nonNull);
    } else if (nonNull.length > 0) {
      parts.push(`a.manual_result IN (${placeholders})`);
      params.push(...nonNull);
    } else if (hasNull) {
      parts.push(`a.manual_result IS NULL`);
    }
  }

  if (filter.time_start) {
    parts.push('r.timestamp >= ?');
    params.push(filter.time_start);
  }
  if (filter.time_end) {
    parts.push('r.timestamp <= ?');
    params.push(filter.time_end);
  }

  if (filter.created_start) {
    parts.push('a.created_at >= ?');
    params.push(filter.created_start);
  }
  if (filter.created_end) {
    parts.push('a.created_at <= ?');
    params.push(filter.created_end);
  }

  if (filter.dish_name_keyword) {
    parts.push('r.dish_name LIKE ?');
    params.push(`%${filter.dish_name_keyword}%`);
  }

  const sql = parts.length > 0 ? ' WHERE ' + parts.join(' AND ') : '';
  return { sql, params };
}

function evidenceToSummary(evidence: string | null): string {
  if (!evidence) return '命中规则';
  try {
    const ev = JSON.parse(evidence);
    return ev.formula || ev.description || evidence;
  } catch {
    return evidence.length > 80 ? evidence.slice(0, 77) + '...' : evidence;
  }
}

function checkAnomalyForConflict(
  anomaly: Anomaly,
  expectedStatus: AnomalyStatus,
  action: 'resolve' | 'reopen',
  batchOperationId: string
): { ok: boolean; skipReason?: SkipReasonCode } {
  if (action === 'resolve') {
    if (anomaly.status !== 'unresolved') {
      if (anomaly.status === 'resolved') {
        return { ok: false, skipReason: 'already_resolved' };
      }
      return { ok: false, skipReason: 'status_changed_by_other' };
    }
  } else {
    if (anomaly.status !== 'resolved') {
      if (anomaly.status === 'unresolved') {
        return { ok: false, skipReason: 'already_unresolved' };
      }
      return { ok: false, skipReason: 'status_changed_by_other' };
    }
  }
  void expectedStatus;
  void batchOperationId;
  return { ok: true };
}

function insertBatchOperationRecord(
  id: string,
  action: 'resolve' | 'reopen',
  appliedResult: ManualResult,
  appliedReason: string,
  appliedAnomalyType: AnomalyType | undefined,
  filterSnapshot: BatchFilterCriteria | undefined,
  totalSubmitted: number,
  successCount: number,
  skippedCount: number,
  failedCount: number,
  timestamp: string
): void {
  db.prepare(`
    INSERT INTO batch_operations (
      id, action, applied_result, applied_reason, applied_anomaly_type,
      filter_snapshot, total_submitted, success_count, skipped_count,
      failed_count, operator, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?)
  `).run(
    id,
    action,
    appliedResult,
    appliedReason,
    appliedAnomalyType || null,
    filterSnapshot ? JSON.stringify(filterSnapshot) : null,
    totalSubmitted,
    successCount,
    skippedCount,
    failedCount,
    timestamp
  );
}

function processBatchResolve(
  anomalyIds: string[],
  reason: string,
  result: ManualResult,
  anomalyType?: AnomalyType,
  filter?: BatchFilterCriteria
): BatchOperationResponse {
  const batchOperationId = genId('batch');
  const now = new Date().toISOString();
  const success: BatchOperationResultItem[] = [];
  const skipped: BatchOperationResultItem[] = [];
  const failed: BatchOperationResultItem[] = [];
  const uniqueIds = Array.from(new Set(anomalyIds));

  logInfo('Batch resolve starting (core)', {
    batchOperationId,
    uniqueCount: uniqueIds.length,
    result,
  });

  for (const id of uniqueIds) {
    try {
      const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(id) as Anomaly | undefined;
      if (!anomaly) {
        logWarn('Batch resolve skipped: anomaly not found', { batchOperationId, anomalyId: id });
        skipped.push({
          id,
          success: false,
          error: '异常不存在',
          skip_reason: 'not_found',
        });
        continue;
      }

      const dishName = (
        db.prepare('SELECT dish_name FROM weighing_records WHERE id = ?').get(anomaly.record_id) as
          | { dish_name: string }
          | undefined
      )?.dish_name;

      const conflict = checkAnomalyForConflict(anomaly, 'unresolved', 'resolve', batchOperationId);
      if (!conflict.ok) {
        const srCode = conflict.skipReason!;
        logWarn('Batch resolve skipped: conflict detected', {
          batchOperationId,
          anomalyId: id,
          skipReason: srCode,
          currentStatus: anomaly.status,
        });
        skipped.push({
          id,
          success: false,
          error: skipReasonToLabel(srCode),
          skip_reason: srCode,
          previous_status: anomaly.status,
          previous_result: anomaly.manual_result,
          dish_name: dishName,
        });
        continue;
      }

      const typeChanged = anomalyType && anomalyType !== anomaly.anomaly_type;
      const finalType = anomalyType || anomaly.anomaly_type;
      const histReason = typeChanged
        ? `${reason}（人工改判类型：${anomaly.anomaly_type} → ${anomalyType}）`
        : reason;

      const tx = db.transaction(() => {
        db.prepare(`
          UPDATE anomalies SET status = 'resolved', manual_reason = ?, manual_result = ?, resolved_at = ?, anomaly_type = ? WHERE id = ? AND status = 'unresolved'
        `).run(reason, result, now, finalType, id);

        const changes = db.prepare('SELECT changes() as ch').get() as { ch: number };
        if (changes.ch === 0) {
          throw new Error('状态更新失败：记录可能已被并发修改');
        }

        db.prepare(`
          UPDATE batches SET unresolved_count = unresolved_count - 1 WHERE id = ?
        `).run(anomaly.batch_id);

        const historyId = genId('hist');
        db.prepare(`
          INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp, batch_operation_id)
          VALUES (?, ?, 'resolve', ?, ?, 'admin', ?, ?)
        `).run(historyId, id, histReason, result, now, batchOperationId);
      });
      try {
        tx();
        success.push({ id, success: true, dish_name: dishName });
        logInfo('Batch resolve item success', { batchOperationId, anomalyId: id, dishName });
      } catch (txErr) {
        logWarn('Batch resolve item skipped after tx conflict', {
          batchOperationId,
          anomalyId: id,
          error: (txErr as Error).message,
        });
        skipped.push({
          id,
          success: false,
          error: skipReasonToLabel('status_changed_by_other'),
          skip_reason: 'status_changed_by_other',
          dish_name: dishName,
        });
      }
    } catch (err) {
      logError('Batch resolve failed for item', err as Error, { batchOperationId, anomalyId: id });
      failed.push({
        id,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  try {
    insertBatchOperationRecord(
      batchOperationId,
      'resolve',
      result,
      reason,
      anomalyType,
      filter,
      uniqueIds.length,
      success.length,
      skipped.length,
      failed.length,
      now
    );
  } catch (recErr) {
    logError('Failed to insert batch operation record', recErr as Error, { batchOperationId });
  }

  const response: BatchOperationResponse = {
    batch_operation_id: batchOperationId,
    success,
    skipped,
    failed,
    total_submitted: uniqueIds.length,
    action: 'resolve',
    applied_result: result,
    applied_reason: reason,
    timestamp: now,
  };

  logInfo('Batch resolve completed (core)', {
    batchOperationId,
    totalCount: uniqueIds.length,
    successCount: success.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    result,
  });

  return response;
}

function processBatchReopen(
  anomalyIds: string[],
  reason: string,
  filter?: BatchFilterCriteria
): BatchOperationResponse {
  const batchOperationId = genId('batch');
  const now = new Date().toISOString();
  const success: BatchOperationResultItem[] = [];
  const skipped: BatchOperationResultItem[] = [];
  const failed: BatchOperationResultItem[] = [];
  const uniqueIds = Array.from(new Set(anomalyIds));
  const appliedReason = reason || '批量撤销关闭';

  logInfo('Batch reopen starting (core)', {
    batchOperationId,
    uniqueCount: uniqueIds.length,
  });

  for (const id of uniqueIds) {
    try {
      const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(id) as Anomaly | undefined;
      if (!anomaly) {
        logWarn('Batch reopen skipped: anomaly not found', { batchOperationId, anomalyId: id });
        skipped.push({
          id,
          success: false,
          error: '异常不存在',
          skip_reason: 'not_found',
        });
        continue;
      }

      const dishName = (
        db.prepare('SELECT dish_name FROM weighing_records WHERE id = ?').get(anomaly.record_id) as
          | { dish_name: string }
          | undefined
      )?.dish_name;

      const conflict = checkAnomalyForConflict(anomaly, 'resolved', 'reopen', batchOperationId);
      if (!conflict.ok) {
        const srCode = conflict.skipReason!;
        logWarn('Batch reopen skipped: conflict detected', {
          batchOperationId,
          anomalyId: id,
          skipReason: srCode,
          currentStatus: anomaly.status,
        });
        skipped.push({
          id,
          success: false,
          error: skipReasonToLabel(srCode),
          skip_reason: srCode,
          previous_status: anomaly.status,
          previous_result: anomaly.manual_result,
          dish_name: dishName,
        });
        continue;
      }

      const tx = db.transaction(() => {
        db.prepare(`
          UPDATE anomalies SET status = 'unresolved', manual_reason = NULL, manual_result = NULL, resolved_at = NULL WHERE id = ? AND status = 'resolved'
        `).run(id);

        const changes = db.prepare('SELECT changes() as ch').get() as { ch: number };
        if (changes.ch === 0) {
          throw new Error('状态更新失败：记录可能已被并发修改');
        }

        db.prepare(`
          UPDATE batches SET unresolved_count = unresolved_count + 1 WHERE id = ?
        `).run(anomaly.batch_id);

        const historyId = genId('hist');
        db.prepare(`
          INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp, batch_operation_id)
          VALUES (?, ?, 'reopen', ?, NULL, 'admin', ?, ?)
        `).run(historyId, id, appliedReason, now, batchOperationId);
      });
      try {
        tx();
        success.push({ id, success: true, dish_name: dishName });
        logInfo('Batch reopen item success', { batchOperationId, anomalyId: id, dishName });
      } catch (txErr) {
        logWarn('Batch reopen item skipped after tx conflict', {
          batchOperationId,
          anomalyId: id,
          error: (txErr as Error).message,
        });
        skipped.push({
          id,
          success: false,
          error: skipReasonToLabel('status_changed_by_other'),
          skip_reason: 'status_changed_by_other',
          dish_name: dishName,
        });
      }
    } catch (err) {
      logError('Batch reopen failed for item', err as Error, { batchOperationId, anomalyId: id });
      failed.push({
        id,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  try {
    insertBatchOperationRecord(
      batchOperationId,
      'reopen',
      null,
      appliedReason,
      undefined,
      filter,
      uniqueIds.length,
      success.length,
      skipped.length,
      failed.length,
      now
    );
  } catch (recErr) {
    logError('Failed to insert batch operation record', recErr as Error, { batchOperationId });
  }

  const response: BatchOperationResponse = {
    batch_operation_id: batchOperationId,
    success,
    skipped,
    failed,
    total_submitted: uniqueIds.length,
    action: 'reopen',
    applied_result: null,
    applied_reason: appliedReason,
    timestamp: now,
  };

  logInfo('Batch reopen completed (core)', {
    batchOperationId,
    totalCount: uniqueIds.length,
    successCount: success.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
  });

  return response;
}

router.get('/', (req: Request, res: Response) => {
  const batchId = req.query.batch_id as string | undefined;
  const status = req.query.status as AnomalyStatus | undefined;
  const type = req.query.type as string | undefined;

  let sql = 'SELECT * FROM anomalies WHERE 1=1';
  const params: (string | number)[] = [];
  if (batchId) {
    sql += ' AND batch_id = ?';
    params.push(batchId);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (type) {
    sql += ' AND anomaly_type = ?';
    params.push(type);
  }
  sql += ' ORDER BY created_at DESC';

  const anomalies = db.prepare(sql).all(...params) as Anomaly[];
  res.json(anomalies);
});

router.get('/:id', (req: Request, res: Response) => {
  const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(req.params.id) as Anomaly;
  if (!anomaly) return res.status(404).json({ error: '异常不存在' });

  const record = db.prepare('SELECT * FROM weighing_records WHERE id = ?').get(anomaly.record_id) as WeighingRecord;
  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(anomaly.rule_version_id) as Rule;
  const history = db.prepare('SELECT * FROM review_history WHERE anomaly_id = ? ORDER BY timestamp DESC').all(anomaly.id) as ReviewHistory[];

  const detail: AnomalyDetail = {
    ...anomaly,
    record,
    rule,
    history,
  };
  res.json(detail);
});

router.post('/:id/resolve', (req: Request, res: Response) => {
  const { reason, result, anomaly_type } = req.body as { reason: string; result: ManualResult; anomaly_type?: AnomalyType };
  const anomalyId = req.params.id;

  logInfo('Resolve anomaly request received', { anomalyId, result, hasReason: !!reason, hasTypeOverride: !!anomaly_type });

  if (!reason || !result) {
    logWarn('Resolve failed: missing reason or result', { anomalyId });
    return res.status(400).json({ error: '原因和判定结果必填' });
  }
  if (anomaly_type && !['over_prep', 'spoilage_suspect'].includes(anomaly_type)) {
    logWarn('Resolve failed: invalid anomaly type', { anomalyId, anomaly_type });
    return res.status(400).json({ error: '异常类型无效' });
  }

  const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(anomalyId) as Anomaly;
  if (!anomaly) {
    logWarn('Resolve failed: anomaly not found', { anomalyId });
    return res.status(404).json({ error: '异常不存在' });
  }
  if (anomaly.status === 'resolved') {
    logWarn('Resolve skipped: anomaly already resolved', { anomalyId });
    return res.status(400).json({ error: '该异常已关闭' });
  }

  const now = new Date().toISOString();
  const typeChanged = anomaly_type && anomaly_type !== anomaly.anomaly_type;
  const finalType = anomaly_type || anomaly.anomaly_type;

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE anomalies SET status = 'resolved', manual_reason = ?, manual_result = ?, resolved_at = ?, anomaly_type = ? WHERE id = ?
      `).run(reason, result, now, finalType, anomalyId);

      db.prepare(`
        UPDATE batches SET unresolved_count = unresolved_count - 1 WHERE id = ?
      `).run(anomaly.batch_id);

      const histReason = typeChanged
        ? `${reason}（人工改判类型：${anomaly.anomaly_type} → ${anomaly_type}）`
        : reason;
      const historyId = genId('hist');
      db.prepare(`
        INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp, batch_operation_id)
        VALUES (?, ?, 'resolve', ?, ?, 'admin', ?, NULL)
      `).run(historyId, anomalyId, histReason, result, now);
    });
    tx();

    const updated = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(anomalyId) as Anomaly;
    logInfo('Anomaly resolved successfully', {
      anomalyId,
      result,
      batchId: anomaly.batch_id,
      typeChanged: !!typeChanged,
    });
    logOperation('single_resolve', 'anomaly', anomalyId, `result=${result}, reason=${reason}`);
    res.json(updated);
  } catch (err) {
    logError('Resolve failed: database error', err as Error, { anomalyId });
    res.status(500).json({ error: '关闭异常失败，请稍后重试' });
  }
});

router.post('/batch-preview', (req: Request, res: Response) => {
  const filter = (req.body.filter || {}) as BatchFilterCriteria;
  const { anomaly_ids } = req.body as { anomaly_ids?: string[] };

  logInfo('Batch preview request received', {
    hasFilter: Object.keys(filter).length > 0,
    explicitIdCount: anomaly_ids?.length || 0,
  });

  try {
    let baseSql = `
      SELECT a.*, r.dish_name, r.planned_weight, r.actual_weight, r.temperature, r.timestamp as record_time
      FROM anomalies a
      LEFT JOIN weighing_records r ON a.record_id = r.id
    `;
    const params: (string | number)[] = [];

    if (anomaly_ids && anomaly_ids.length > 0) {
      const placeholders = anomaly_ids.map(() => '?').join(',');
      baseSql += ` WHERE a.id IN (${placeholders})`;
      params.push(...anomaly_ids);
      if (Object.keys(filter).length > 0) {
        const { sql, params: fp } = buildFilterSql(filter);
        baseSql += sql.replace(' WHERE ', ' AND ');
        params.push(...fp);
      }
    } else {
      const { sql, params: fp } = buildFilterSql(filter);
      baseSql += sql;
      params.push(...fp);
    }

    const allRows = db.prepare(baseSql).all(...params) as (Anomaly & {
      dish_name: string;
      planned_weight: number;
      actual_weight: number;
      temperature: number | null;
      record_time: string;
    })[];

    const matchedCount = allRows.length;
    const byBatchMap = new Map<string, {
      batch_id: string;
      batch_name: string;
      count: number;
      unresolved_count: number;
      resolved_count: number;
    }>();

    for (const row of allRows) {
      if (!byBatchMap.has(row.batch_id)) {
        const batch = db.prepare('SELECT name FROM batches WHERE id = ?').get(row.batch_id) as { name: string } | undefined;
        byBatchMap.set(row.batch_id, {
          batch_id: row.batch_id,
          batch_name: batch?.name || '未知批次',
          count: 0,
          unresolved_count: 0,
          resolved_count: 0,
        });
      }
      const entry = byBatchMap.get(row.batch_id)!;
      entry.count++;
      if (row.status === 'unresolved') entry.unresolved_count++;
      else entry.resolved_count++;
    }

    const byTypeMap = new Map<AnomalyType, { type: AnomalyType; label: string; count: number }>();
    for (const row of allRows) {
      if (!byTypeMap.has(row.anomaly_type)) {
        byTypeMap.set(row.anomaly_type, {
          type: row.anomaly_type,
          label: row.anomaly_type === 'over_prep' ? '备餐过量' : '变质怀疑',
          count: 0,
        });
      }
      byTypeMap.get(row.anomaly_type)!.count++;
    }

    const byStatusMap = new Map<AnomalyStatus, { status: AnomalyStatus; label: string; count: number }>();
    for (const row of allRows) {
      if (!byStatusMap.has(row.status)) {
        byStatusMap.set(row.status, {
          status: row.status,
          label: row.status === 'unresolved' ? '未结' : '已关闭',
          count: 0,
        });
      }
      byStatusMap.get(row.status)!.count++;
    }

    const samples: BatchPreviewAnomaly[] = allRows.slice(0, 20).map((row) => ({
      id: row.id,
      batch_id: row.batch_id,
      anomaly_type: row.anomaly_type,
      status: row.status,
      manual_result: row.manual_result,
      dish_name: row.dish_name,
      planned_weight: row.planned_weight,
      actual_weight: row.actual_weight,
      temperature: row.temperature,
      record_time: row.record_time,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      evidence_summary: evidenceToSummary(row.evidence),
    }));

    const estimatedUnresolvedActionable = allRows.filter((r) => r.status === 'unresolved').length;
    const estimatedResolvedActionable = allRows.filter((r) => r.status === 'resolved').length;

    const preview: BatchPreviewResponse = {
      filter,
      matched_count: matchedCount,
      by_batch: Array.from(byBatchMap.values()),
      by_type: Array.from(byTypeMap.values()),
      by_status: Array.from(byStatusMap.values()),
      samples,
      estimated_unresolved_actionable: estimatedUnresolvedActionable,
      estimated_resolved_actionable: estimatedResolvedActionable,
    };

    logInfo('Batch preview generated', {
    matchedCount,
    byBatchCount: preview.by_batch.length,
    byTypeCount: preview.by_type.length,
    estimatedActionable: estimatedUnresolvedActionable + estimatedResolvedActionable,
  });

  logOperation('batch_preview', 'filter', null, `matched=${matchedCount}, unresolved=${estimatedUnresolvedActionable}, resolved=${estimatedResolvedActionable}`, filter);

  res.json(preview);
  } catch (err) {
    logError('Batch preview failed', err as Error, { filter });
    res.status(500).json({ error: '生成预览失败，请稍后重试' });
  }
});

router.post('/batch-resolve', (req: Request, res: Response) => {
  const {
    anomaly_ids,
    reason,
    result,
    anomaly_type,
    filter,
  } = req.body as {
    anomaly_ids: string[];
    reason: string;
    result: ManualResult;
    anomaly_type?: AnomalyType;
    filter?: BatchFilterCriteria;
  };

  logInfo('Batch resolve request received', {
    count: anomaly_ids?.length || 0,
    result,
    hasReason: !!reason,
    hasTypeOverride: !!anomaly_type,
    hasFilter: !!filter,
  });

  if (!anomaly_ids || !Array.isArray(anomaly_ids) || anomaly_ids.length === 0) {
    logWarn('Batch resolve failed: empty anomaly ids');
    return res.status(400).json({ error: '请选择要处理的异常' });
  }
  if (!reason || !result) {
    logWarn('Batch resolve failed: missing reason or result');
    return res.status(400).json({ error: '原因和判定结果必填' });
  }
  if (anomaly_type && !['over_prep', 'spoilage_suspect'].includes(anomaly_type)) {
    logWarn('Batch resolve failed: invalid anomaly type', { anomaly_type });
    return res.status(400).json({ error: '异常类型无效' });
  }

  const response = processBatchResolve(anomaly_ids, reason, result, anomaly_type, filter);
  logOperation('batch_resolve', 'batch_op', response.batch_operation_id, `success=${response.success.length}, skipped=${response.skipped.length}, failed=${response.failed.length}`, filter);
  res.json(response);
});

router.post('/batch-resolve-by-filter', (req: Request, res: Response) => {
  const { filter, reason, result, anomaly_type } = req.body as {
    filter: BatchFilterCriteria;
    reason: string;
    result: ManualResult;
    anomaly_type?: AnomalyType;
  };

  logInfo('Batch resolve by filter request received', {
    filterKeys: Object.keys(filter || {}),
    result,
    hasReason: !!reason,
    hasTypeOverride: !!anomaly_type,
  });

  if (!filter || Object.keys(filter).length === 0) {
    logWarn('Batch resolve by filter failed: empty filter');
    return res.status(400).json({ error: '必须指定筛选条件' });
  }
  if (!reason || !result) {
    logWarn('Batch resolve by filter failed: missing reason or result');
    return res.status(400).json({ error: '原因和判定结果必填' });
  }
  if (anomaly_type && !['over_prep', 'spoilage_suspect'].includes(anomaly_type)) {
    logWarn('Batch resolve by filter failed: invalid anomaly type', { anomaly_type });
    return res.status(400).json({ error: '异常类型无效' });
  }

  try {
    const { sql, params } = buildFilterSql({ ...filter, status: 'unresolved' });
    const filterSql = `SELECT a.id FROM anomalies a LEFT JOIN weighing_records r ON a.record_id = r.id ${sql}`;
    const rows = db.prepare(filterSql).all(...params) as { id: string }[];
    const anomalyIds = rows.map((r) => r.id);

    logInfo('Batch resolve by filter: matched IDs', {
      matchedCount: anomalyIds.length,
    });

    if (anomalyIds.length === 0) {
      const emptyResponse: BatchOperationResponse = {
        batch_operation_id: genId('batch'),
        success: [],
        skipped: [],
        failed: [],
        total_submitted: 0,
        action: 'resolve',
        applied_result: result,
        applied_reason: reason,
        timestamp: new Date().toISOString(),
        error: '筛选条件下没有可处理的未结异常',
      };
      return res.json(emptyResponse);
    }

    const response = processBatchResolve(anomalyIds, reason, result, anomaly_type, filter);
    logOperation('batch_resolve_by_filter', 'batch_op', response.batch_operation_id, `success=${response.success.length}, skipped=${response.skipped.length}, failed=${response.failed.length}`, filter);
    res.json(response);
  } catch (err) {
    logError('Batch resolve by filter failed', err as Error, { filter });
    res.status(500).json({ error: '按筛选批量处理失败，请稍后重试' });
  }
});

router.post('/:id/reopen', (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const anomalyId = req.params.id;

  logInfo('Reopen anomaly request received', { anomalyId, hasReason: !!reason });

  const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(anomalyId) as Anomaly;
  if (!anomaly) {
    logWarn('Reopen failed: anomaly not found', { anomalyId });
    return res.status(404).json({ error: '异常不存在' });
  }
  if (anomaly.status === 'unresolved') {
    logWarn('Reopen skipped: already unresolved', { anomalyId });
    return res.status(400).json({ error: '该异常尚未关闭' });
  }

  const now = new Date().toISOString();

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE anomalies SET status = 'unresolved', manual_reason = NULL, manual_result = NULL, resolved_at = NULL WHERE id = ?
      `).run(anomalyId);

      db.prepare(`
        UPDATE batches SET unresolved_count = unresolved_count + 1 WHERE id = ?
      `).run(anomaly.batch_id);

      const historyId = genId('hist');
      db.prepare(`
        INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp, batch_operation_id)
        VALUES (?, ?, 'reopen', ?, NULL, 'admin', ?, NULL)
      `).run(historyId, anomalyId, reason || '撤销关闭', now);
    });
    tx();

    const updated = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(anomalyId) as Anomaly;
    logInfo('Anomaly reopened successfully', { anomalyId, batchId: anomaly.batch_id });
    logOperation('single_reopen', 'anomaly', anomalyId, `reason=${reason || '撤销关闭'}`);
    res.json(updated);
  } catch (err) {
    logError('Reopen failed: database error', err as Error, { anomalyId });
    res.status(500).json({ error: '撤销关闭失败，请稍后重试' });
  }
});

router.post('/batch-reopen', (req: Request, res: Response) => {
  const {
    anomaly_ids,
    reason,
    filter,
  } = req.body as {
    anomaly_ids: string[];
    reason?: string;
    filter?: BatchFilterCriteria;
  };

  logInfo('Batch reopen request received', {
    count: anomaly_ids?.length || 0,
    hasReason: !!reason,
    hasFilter: !!filter,
  });

  if (!anomaly_ids || !Array.isArray(anomaly_ids) || anomaly_ids.length === 0) {
    logWarn('Batch reopen failed: empty anomaly ids');
    return res.status(400).json({ error: '请选择要恢复的异常' });
  }

  const appliedReason = reason || '批量撤销关闭';
  const response = processBatchReopen(anomaly_ids, appliedReason, filter);
  logOperation('batch_reopen', 'batch_op', response.batch_operation_id, `success=${response.success.length}, skipped=${response.skipped.length}, failed=${response.failed.length}`, filter);
  res.json(response);
});

router.post('/batch-reopen-by-filter', (req: Request, res: Response) => {
  const { filter, reason } = req.body as {
    filter: BatchFilterCriteria;
    reason?: string;
  };

  logInfo('Batch reopen by filter request received', {
    filterKeys: Object.keys(filter || {}),
    hasReason: !!reason,
  });

  if (!filter || Object.keys(filter).length === 0) {
    logWarn('Batch reopen by filter failed: empty filter');
    return res.status(400).json({ error: '必须指定筛选条件' });
  }

  try {
    const { sql, params } = buildFilterSql({ ...filter, status: 'resolved' });
    const filterSql = `SELECT a.id FROM anomalies a LEFT JOIN weighing_records r ON a.record_id = r.id ${sql}`;
    const rows = db.prepare(filterSql).all(...params) as { id: string }[];
    const anomalyIds = rows.map((r) => r.id);

    logInfo('Batch reopen by filter: matched IDs', {
      matchedCount: anomalyIds.length,
    });

    if (anomalyIds.length === 0) {
      const emptyResponse: BatchOperationResponse = {
        batch_operation_id: genId('batch'),
        success: [],
        skipped: [],
        failed: [],
        total_submitted: 0,
        action: 'reopen',
        applied_result: null,
        applied_reason: reason || '批量撤销关闭',
        timestamp: new Date().toISOString(),
        error: '筛选条件下没有可恢复的已关异常',
      };
      return res.json(emptyResponse);
    }

    const appliedReason = reason || '批量撤销关闭';
    const response = processBatchReopen(anomalyIds, appliedReason, filter);
    logOperation('batch_reopen_by_filter', 'batch_op', response.batch_operation_id, `success=${response.success.length}, skipped=${response.skipped.length}, failed=${response.failed.length}`, filter);
    res.json(response);
  } catch (err) {
    logError('Batch reopen by filter failed', err as Error, { filter });
    res.status(500).json({ error: '按筛选批量撤销失败，请稍后重试' });
  }
});

router.get('/batch-operation/:batch_operation_id', (req: Request, res: Response) => {
  const { batch_operation_id } = req.params;
  logInfo('Fetch batch operation detail', { batchOperationId: batch_operation_id });
  try {
    const opRecord = db
      .prepare('SELECT * FROM batch_operations WHERE id = ?')
      .get(batch_operation_id) as BatchOperationRecord | undefined;

    const history = db.prepare(`
      SELECT h.*, a.anomaly_type, a.batch_id, r.dish_name
      FROM review_history h
      LEFT JOIN anomalies a ON h.anomaly_id = a.id
      LEFT JOIN weighing_records r ON a.record_id = r.id
      WHERE h.batch_operation_id = ?
      ORDER BY h.timestamp DESC
    `).all(batch_operation_id) as (ReviewHistory & { anomaly_type: string; batch_id: string; dish_name: string })[];

    res.json({
      operation: opRecord || null,
      history,
    });
  } catch (err) {
    logError('Fetch batch operation failed', err as Error, { batchOperationId: batch_operation_id });
    res.status(500).json({ error: '查询批量操作详情失败' });
  }
});

router.get('/batch-operations/list', (_req: Request, res: Response) => {
  logInfo('Fetch batch operations list');
  try {
    const list = db
      .prepare('SELECT * FROM batch_operations ORDER BY timestamp DESC LIMIT 100')
      .all() as BatchOperationRecord[];
    res.json(list);
  } catch (err) {
    logError('Fetch batch operations list failed', err as Error);
    res.status(500).json({ error: '查询批量操作列表失败' });
  }
});

router.get('/operation-logs/list', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  logInfo('Fetch operation logs', { limit });
  try {
    const list = db
      .prepare('SELECT * FROM operation_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as OperationLog[];
    res.json(list);
  } catch (err) {
    logError('Fetch operation logs failed', err as Error);
    res.status(500).json({ error: '查询操作日志失败' });
  }
});

export default router;
