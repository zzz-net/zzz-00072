import { Router, Request, Response } from 'express';
import { db } from '../db';
import type {
  BatchOperationRecord,
  BatchResultItem,
  ReviewHistory,
} from '../../shared/types';

const router = Router();

router.get('/list', (req: Request, res: Response) => {
  const action = req.query.action as string | undefined;
  const outcome = req.query.outcome as string | undefined;
  const timeStart = req.query.time_start as string | undefined;
  const timeEnd = req.query.time_end as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

  let sql = 'SELECT * FROM batch_operations WHERE 1=1';
  const params: (string | number)[] = [];

  if (action && action !== 'all') {
    sql += ' AND action = ?';
    params.push(action);
  }
  if (timeStart) {
    sql += ' AND timestamp >= ?';
    params.push(timeStart);
  }
  if (timeEnd) {
    sql += ' AND timestamp <= ?';
    params.push(timeEnd + 'T23:59:59');
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  let operations = db.prepare(sql).all(...params) as BatchOperationRecord[];

  if (outcome && outcome !== 'all') {
    const filteredOps: BatchOperationRecord[] = [];
    for (const op of operations) {
      const hasOutcome = db.prepare(
        'SELECT COUNT(*) as cnt FROM batch_result_items WHERE batch_operation_id = ? AND outcome = ?'
      ).get(op.id, outcome) as { cnt: number };
      if (hasOutcome.cnt > 0) {
        filteredOps.push(op);
      }
    }
    operations = filteredOps;
  }

  const result = operations.map((op) => {
    const filterSnapshot = op.filter_snapshot ? JSON.parse(op.filter_snapshot) : null;
    return { ...op, filter_snapshot_parsed: filterSnapshot };
  });

  res.json(result);
});

router.get('/detail/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const operation = db.prepare('SELECT * FROM batch_operations WHERE id = ?').get(id) as BatchOperationRecord | undefined;
  if (!operation) {
    return res.status(404).json({ error: '批量操作记录不存在' });
  }

  const items = db.prepare(
    'SELECT * FROM batch_result_items WHERE batch_operation_id = ? ORDER BY outcome, anomaly_id'
  ).all(id) as BatchResultItem[];

  const history = db.prepare(`
    SELECT h.*, a.anomaly_type, a.batch_id, r.dish_name
    FROM review_history h
    LEFT JOIN anomalies a ON h.anomaly_id = a.id
    LEFT JOIN weighing_records r ON a.record_id = r.id
    WHERE h.batch_operation_id = ?
    ORDER BY h.timestamp DESC
  `).all(id) as (ReviewHistory & { anomaly_type: string; batch_id: string; dish_name: string })[];

  let currentUnresolvedCount = 0;
  if (operation.action === 'resolve') {
    const successIds = items.filter(i => i.outcome === 'success').map(i => i.anomaly_id);
    if (successIds.length > 0) {
      const unresolved = db.prepare(
        `SELECT COUNT(*) as cnt FROM anomalies WHERE id IN (${successIds.map(() => '?').join(',')}) AND status = 'unresolved'`
      ).get(...successIds) as { cnt: number };
      currentUnresolvedCount = unresolved.cnt;
    }
  }

  const filterSnapshot = operation.filter_snapshot ? JSON.parse(operation.filter_snapshot) : null;

  res.json({
    operation: { ...operation, filter_snapshot_parsed: filterSnapshot },
    items,
    history,
    current_unresolved_count: currentUnresolvedCount,
  });
});

router.get('/export/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const operation = db.prepare('SELECT * FROM batch_operations WHERE id = ?').get(id) as BatchOperationRecord | undefined;
  if (!operation) {
    return res.status(404).json({ error: '批量操作记录不存在' });
  }

  const items = db.prepare(
    'SELECT * FROM batch_result_items WHERE batch_operation_id = ? ORDER BY outcome, anomaly_id'
  ).all(id) as BatchResultItem[];

  const actionLabel = operation.action === 'resolve' ? '批量关闭' : '批量撤销';
  const resultLabel = operation.applied_result === 'normal' ? '判定正常(误报)' : operation.applied_result === 'confirmed' ? '确认异常' : '';
  const outcomeMap: Record<string, string> = { success: '成功', skipped: '跳过', failed: '失败' };
  const statusMap: Record<string, string> = { unresolved: '未结', resolved: '已关闭' };
  const resultMap: Record<string, string> = { normal: '正常', confirmed: '确认异常' };

  let csv = '批量操作结果导出\n';
  csv += `操作ID,${operation.id}\n`;
  csv += `操作类型,${actionLabel}\n`;
  csv += `判定结果,${resultLabel}\n`;
  csv += `统一原因,"${(operation.applied_reason || '').replace(/"/g, '""')}"\n`;
  csv += `操作时间,${operation.timestamp}\n`;
  csv += `提交数,${operation.total_submitted}\n`;
  csv += `成功数,${operation.success_count}\n`;
  csv += `跳过数,${operation.skipped_count}\n`;
  csv += `失败数,${operation.failed_count}\n`;
  if (operation.filter_snapshot) {
    csv += `筛选条件,"${operation.filter_snapshot.replace(/"/g, '""')}"\n`;
  }
  csv += '\n';
  csv += '异常ID,菜品,处理前状态,处理前判定,处理结果,跳过原因,失败原因\n';

  for (const item of items) {
    const sBefore = item.status_before ? statusMap[item.status_before] || item.status_before : '';
    const rBefore = item.result_before ? resultMap[item.result_before] || item.result_before : '';
    const outcome = outcomeMap[item.outcome] || item.outcome;
    csv += `${item.anomaly_id},${item.dish_name || ''},${sBefore},${rBefore},${outcome},${item.skip_reason || ''},"${(item.error_message || '').replace(/"/g, '""')}"\n`;
  }

  const date = new Date().toISOString().slice(0, 10);
  const encoded = encodeURIComponent(`批量操作结果_${operation.id.slice(-8)}_${date}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="batch-result-${date}.csv"; filename*=UTF-8''${encoded}`
  );
  res.send('\ufeff' + csv);
});

router.get('/config', (_req: Request, res: Response) => {
  const row = db.prepare("SELECT value FROM result_center_config WHERE key = 'filter'").get() as { value: string } | undefined;
  if (row) {
    try {
      res.json(JSON.parse(row.value));
    } catch {
      res.json(null);
    }
  } else {
    res.json(null);
  }
});

router.post('/config', (req: Request, res: Response) => {
  const config = req.body;
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT key FROM result_center_config WHERE key = 'filter'").get() as { key: string } | undefined;
  if (existing) {
    db.prepare("UPDATE result_center_config SET value = ?, updated_at = ? WHERE key = 'filter'").run(JSON.stringify(config), now);
  } else {
    db.prepare("INSERT INTO result_center_config (key, value, updated_at) VALUES ('filter', ?, ?)").run(JSON.stringify(config), now);
  }
  res.json({ ok: true });
});

router.get('/recent-snapshot', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
  const recentOps = db.prepare(
    'SELECT * FROM batch_operations ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as BatchOperationRecord[];

  const snapshots = recentOps.map((op) => {
    const items = db.prepare(
      'SELECT * FROM batch_result_items WHERE batch_operation_id = ?'
    ).all(op.id) as BatchResultItem[];
    return { operation: op, items };
  });

  res.json(snapshots);
});

export default router;
