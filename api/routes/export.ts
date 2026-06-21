import { Router, Request, Response } from 'express';
import { db } from '../db';
import type { Anomaly, Batch, ReviewHistory, Rule, WeighingRecord } from '../../shared/types';

const router = Router();

function sendCsv(res: Response, csv: string, filenameCn: string, fallback: string) {
  const encoded = encodeURIComponent(filenameCn);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8-sig');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
  );
  res.send('\ufeff' + csv);
}

router.get('/summary', (req: Request, res: Response) => {
  const batchIds = (req.query.batch_ids as string)?.split(',') || [];
  if (!batchIds.length) return res.status(400).json({ error: '请选择批次' });

  const placeholders = batchIds.map(() => '?').join(',');
  const batches = db.prepare(`SELECT * FROM batches WHERE id IN (${placeholders})`).all(...batchIds) as Batch[];

  let csv = '批次ID,批次名称,导入日期,总记录数,有效记录,错误记录,异常总数,未结异常,已关异常\n';
  batches.forEach((b) => {
    const resolved = b.anomaly_count - b.unresolved_count;
    csv += `${b.id},${b.name},${b.import_date},${b.total_records},${b.valid_records},${b.error_records},${b.anomaly_count},${b.unresolved_count},${resolved}\n`;
  });

  const date = new Date().toISOString().slice(0, 10);
  sendCsv(res, csv, `损耗汇总_${date}.csv`, `loss-summary-${date}.csv`);
});

router.get('/detail', (req: Request, res: Response) => {
  const batchIds = (req.query.batch_ids as string)?.split(',') || [];
  if (!batchIds.length) return res.status(400).json({ error: '请选择批次' });

  const placeholders = batchIds.map(() => '?').join(',');
  const anomalies = db.prepare(`
    SELECT a.*, r.dish_name, r.planned_weight, r.actual_weight, r.temperature, r.timestamp as record_time, ru.version as rule_version
    FROM anomalies a
    LEFT JOIN weighing_records r ON a.record_id = r.id
    LEFT JOIN rules ru ON a.rule_version_id = ru.id
    WHERE a.batch_id IN (${placeholders})
    ORDER BY a.batch_id, a.created_at
  `).all(...batchIds) as (Anomaly & { dish_name: string; planned_weight: number; actual_weight: number; temperature: number; record_time: string; rule_version: string })[];

  let csv = '批次ID,异常ID,异常类型,菜品,计划重量(g),实际重量(g),温度(℃),称重时间,规则版本,状态,人工判定,人工原因,创建时间,关闭时间\n';
  anomalies.forEach((a) => {
    const typeLabel = a.anomaly_type === 'over_prep' ? '备餐过量' : '变质怀疑';
    const statusLabel = a.status === 'unresolved' ? '未结' : '已关闭';
    const resultLabel = a.manual_result === 'confirmed' ? '确认异常' : a.manual_result === 'normal' ? '判定正常' : '';
    csv += `${a.batch_id},${a.id},${typeLabel},${a.dish_name},${a.planned_weight},${a.actual_weight},${a.temperature ?? ''},${a.record_time},${a.rule_version},${statusLabel},${resultLabel},"${(a.manual_reason || '').replace(/"/g, '""')}",${a.created_at},${a.resolved_at || ''}\n`;
  });

  const date = new Date().toISOString().slice(0, 10);
  sendCsv(res, csv, `损耗明细_${date}.csv`, `loss-detail-${date}.csv`);
});

router.get('/history', (req: Request, res: Response) => {
  const anomalyId = req.query.anomaly_id as string | undefined;
  let history: ReviewHistory[];
  if (anomalyId) {
    history = db.prepare('SELECT * FROM review_history WHERE anomaly_id = ? ORDER BY timestamp DESC').all(anomalyId) as ReviewHistory[];
  } else {
    history = db.prepare('SELECT * FROM review_history ORDER BY timestamp DESC').all() as ReviewHistory[];
  }

  let csv = '异常ID,操作,原因,判定结果,操作人,时间,批量操作ID\n';
  history.forEach((h) => {
    const actionLabel = h.action === 'resolve' ? '关闭' : '撤销';
    const resultLabel = h.result === 'confirmed' ? '确认异常' : h.result === 'normal' ? '判定正常' : '';
    const batchOpId = (h as ReviewHistory & { batch_operation_id?: string | null }).batch_operation_id || '';
    csv += `${h.anomaly_id},${actionLabel},"${(h.reason || '').replace(/"/g, '""')}",${resultLabel},${h.operator},${h.timestamp},${batchOpId}\n`;
  });

  const date = new Date().toISOString().slice(0, 10);
  sendCsv(res, csv, `复核历史_${date}.csv`, `review-history-${date}.csv`);
});

router.get('/consistency', (_req: Request, res: Response) => {
  const batches = db.prepare('SELECT * FROM batches').all() as Batch[];
  const issues: string[] = [];

  batches.forEach((b) => {
    const countValid = db.prepare('SELECT COUNT(*) as cnt FROM weighing_records WHERE batch_id = ? AND is_valid = 1').get(b.id) as { cnt: number };
    const countError = db.prepare('SELECT COUNT(*) as cnt FROM weighing_records WHERE batch_id = ? AND is_valid = 0').get(b.id) as { cnt: number };
    const countAnomalies = db.prepare('SELECT COUNT(*) as cnt FROM anomalies WHERE batch_id = ?').get(b.id) as { cnt: number };
    const countUnresolved = db.prepare('SELECT COUNT(*) as cnt FROM anomalies WHERE batch_id = ? AND status = ?').get(b.id, 'unresolved') as { cnt: number };

    if (b.valid_records !== countValid.cnt) issues.push(`批次 ${b.name}: 有效记录数不一致 (批次表=${b.valid_records}, 记录表=${countValid.cnt})`);
    if (b.error_records !== countError.cnt) issues.push(`批次 ${b.name}: 错误记录数不一致 (批次表=${b.error_records}, 记录表=${countError.cnt})`);
    if (b.anomaly_count !== countAnomalies.cnt) issues.push(`批次 ${b.name}: 异常总数不一致 (批次表=${b.anomaly_count}, 异常表=${countAnomalies.cnt})`);
    if (b.unresolved_count !== countUnresolved.cnt) issues.push(`批次 ${b.name}: 未结异常数不一致 (批次表=${b.unresolved_count}, 异常表=${countUnresolved.cnt})`);
  });

  const activeRules = db.prepare('SELECT COUNT(*) as cnt FROM rules WHERE is_active = 1').get() as { cnt: number };
  if (activeRules.cnt !== 1) issues.push(`生效规则数量异常（应为1，实际=${activeRules.cnt}）`);

  const anomaliesNoEvidence = db.prepare("SELECT COUNT(*) as cnt FROM anomalies WHERE evidence IS NULL OR evidence = ''").get() as { cnt: number };
  if (anomaliesNoEvidence.cnt > 0) issues.push(`存在 ${anomaliesNoEvidence.cnt} 条异常缺失规则证据`);

  const unresolvedNoNull = db.prepare("SELECT COUNT(*) as cnt FROM anomalies WHERE status = 'unresolved' AND (manual_reason IS NOT NULL OR manual_result IS NOT NULL)").get() as { cnt: number };
  if (unresolvedNoNull.cnt > 0) issues.push(`存在 ${unresolvedNoNull.cnt} 条未结异常带有判定结果（状态不一致）`);

  const resolvedNoReason = db.prepare("SELECT COUNT(*) as cnt FROM anomalies WHERE status = 'resolved' AND (manual_reason IS NULL OR manual_result IS NULL)").get() as { cnt: number };
  if (resolvedNoReason.cnt > 0) issues.push(`存在 ${resolvedNoReason.cnt} 条已关异常缺失判定信息`);

  res.json({
    ok: issues.length === 0,
    issues,
    stats: {
      batch_count: batches.length,
      active_rules: activeRules.cnt,
    },
  });
});

export default router;
