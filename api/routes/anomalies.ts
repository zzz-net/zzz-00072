import { Router, Request, Response } from 'express';
import { db, genId } from '../db';
import type {
  Anomaly,
  AnomalyDetail,
  AnomalyStatus,
  AnomalyType,
  ManualResult,
  ReviewHistory,
  Rule,
  WeighingRecord,
} from '../../shared/types';

const router = Router();

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
  if (!reason || !result) return res.status(400).json({ error: '原因和判定结果必填' });
  if (anomaly_type && !['over_prep', 'spoilage_suspect'].includes(anomaly_type)) {
    return res.status(400).json({ error: '异常类型无效' });
  }

  const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(req.params.id) as Anomaly;
  if (!anomaly) return res.status(404).json({ error: '异常不存在' });
  if (anomaly.status === 'resolved') return res.status(400).json({ error: '该异常已关闭' });

  const now = new Date().toISOString();
  const typeChanged = anomaly_type && anomaly_type !== anomaly.anomaly_type;
  const finalType = anomaly_type || anomaly.anomaly_type;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE anomalies SET status = 'resolved', manual_reason = ?, manual_result = ?, resolved_at = ?, anomaly_type = ? WHERE id = ?
    `).run(reason, result, now, finalType, req.params.id);

    db.prepare(`
      UPDATE batches SET unresolved_count = unresolved_count - 1 WHERE id = ?
    `).run(anomaly.batch_id);

    const histReason = typeChanged
      ? `${reason}（人工改判类型：${anomaly.anomaly_type} → ${anomaly_type}）`
      : reason;
    const historyId = genId('hist');
    db.prepare(`
      INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp)
      VALUES (?, ?, 'resolve', ?, ?, 'admin', ?)
    `).run(historyId, req.params.id, histReason, result, now);
  });
  tx();

  const updated = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(req.params.id) as Anomaly;
  res.json(updated);
});

router.post('/:id/reopen', (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };

  const anomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(req.params.id) as Anomaly;
  if (!anomaly) return res.status(404).json({ error: '异常不存在' });
  if (anomaly.status === 'unresolved') return res.status(400).json({ error: '该异常尚未关闭' });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE anomalies SET status = 'unresolved', manual_reason = NULL, manual_result = NULL, resolved_at = NULL WHERE id = ?
    `).run(req.params.id);

    db.prepare(`
      UPDATE batches SET unresolved_count = unresolved_count + 1 WHERE id = ?
    `).run(anomaly.batch_id);

    const historyId = genId('hist');
    db.prepare(`
      INSERT INTO review_history (id, anomaly_id, action, reason, result, operator, timestamp)
      VALUES (?, ?, 'reopen', ?, NULL, 'admin', ?)
    `).run(historyId, req.params.id, reason || '撤销关闭', now);
  });
  tx();

  const updated = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(req.params.id) as Anomaly;
  res.json(updated);
});

export default router;
