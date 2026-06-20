import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { db, genId, getActiveRule } from '../db';
import { detectAnomalies } from '../rules';
import { generateSampleBatch, SampleRow } from '../sampleData';
import type { Batch, Rule, WeighingRecord } from '../../shared/types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface CsvRow {
  dish_name: string;
  planned_weight: string;
  actual_weight: string;
  temperature: string;
  timestamp: string;
}

function processBatchRows(
  batchId: string,
  batchName: string,
  batchDate: string,
  rows: SampleRow[],
  rule: Rule
) {
  const insertRecord = db.prepare(`
    INSERT INTO weighing_records (id, batch_id, dish_name, planned_weight, actual_weight, temperature, timestamp, is_valid, error_reason, raw_line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAnomaly = db.prepare(`
    INSERT INTO anomalies (id, batch_id, record_id, rule_version_id, anomaly_type, evidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unresolved', ?)
  `);

  let validCount = 0;
  let errorCount = 0;
  let anomalyCount = 0;

  const tx = db.transaction(() => {
    rows.forEach((r) => {
      const recordId = genId('rec');
      const rawLine = `${r.dish_name},${r.planned_weight},${r.actual_weight},${r.temperature},${r.timestamp}`;
      const planned = Number(r.planned_weight);
      const actual = Number(r.actual_weight);
      const temp = r.temperature != null ? Number(r.temperature) : null;

      let isValid = true;
      let errorReason: string | null = null;

      if (Number.isNaN(actual) || actual <= 0) {
        isValid = false;
        errorReason = '负数重量或无效数值';
      }
      if (Number.isNaN(planned) || planned <= 0) {
        isValid = false;
        errorReason = errorReason ?? '计划重量无效';
      }

      if (isValid) validCount++;
      else errorCount++;

      insertRecord.run(
        recordId,
        batchId,
        r.dish_name,
        planned || 0,
        actual || 0,
        temp,
        r.timestamp,
        isValid ? 1 : 0,
        errorReason,
        rawLine
      );

      if (isValid) {
        const record: WeighingRecord = {
          id: recordId,
          batch_id: batchId,
          dish_name: r.dish_name,
          planned_weight: planned,
          actual_weight: actual,
          temperature: temp ?? 0,
          timestamp: r.timestamp,
          is_valid: isValid,
          error_reason: errorReason,
          raw_line: rawLine,
        };
        const evidence = detectAnomalies(record, rule);
        if (evidence) {
          const anomalyId = genId('anom');
          insertAnomaly.run(
            anomalyId,
            batchId,
            recordId,
            rule.id,
            evidence.anomaly_type,
            JSON.stringify(evidence),
            new Date().toISOString()
          );
          anomalyCount++;
        }
      }
    });

    db.prepare(`
      UPDATE batches
      SET total_records = ?, valid_records = ?, error_records = ?, anomaly_count = ?, unresolved_count = ?, status = 'completed'
      WHERE id = ?
    `).run(rows.length, validCount, errorCount, anomalyCount, anomalyCount, batchId);
  });

  tx();

  return { total: rows.length, valid: validCount, error: errorCount, anomalies: anomalyCount };
}

router.get('/', (_req: Request, res: Response) => {
  const batches = db.prepare('SELECT * FROM batches ORDER BY import_date DESC').all() as Batch[];
  res.json(batches);
});

router.get('/:id', (req: Request, res: Response) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id) as Batch;
  if (!batch) return res.status(404).json({ error: '批次不存在' });
  res.json(batch);
});

router.post('/', upload.single('csv'), (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传CSV文件' });

    const batchName = (req.body.name as string) || `导入批次-${new Date().toISOString().slice(0, 10)}`;
    const batchDate = (req.body.date as string) || new Date().toISOString().slice(0, 10);

    const existing = db.prepare('SELECT id FROM batches WHERE name = ?').get(batchName);
    if (existing) return res.status(409).json({ error: '该批次已存在，请使用其他名称' });

    const rule = getActiveRule() as Rule;
    if (!rule) return res.status(500).json({ error: '没有生效的规则' });

    const csvText = req.file.buffer.toString('utf-8');
    const parsed = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as CsvRow[];

    if (!parsed.length) return res.status(400).json({ error: 'CSV文件为空' });

    const rows: SampleRow[] = parsed.map((r) => ({
      batch_id: '',
      dish_name: r.dish_name || '未知菜品',
      planned_weight: Number(r.planned_weight),
      actual_weight: Number(r.actual_weight),
      temperature: Number(r.temperature),
      timestamp: r.timestamp || new Date().toISOString(),
    }));

    const batchId = genId('batch');
    db.prepare(`
      INSERT INTO batches (id, name, import_date, total_records, valid_records, error_records, anomaly_count, unresolved_count, status, rule_version_id)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'importing', ?)
    `).run(batchId, batchName, batchDate, rule.id);

    const stats = processBatchRows(batchId, batchName, batchDate, rows, rule);
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as Batch;
    res.json({ batch, stats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/sample', (_req: Request, res: Response) => {
  try {
    const rule = getActiveRule() as Rule;
    if (!rule) return res.status(500).json({ error: '没有生效的规则' });

    const sample = generateSampleBatch();
    const existing = db.prepare('SELECT id FROM batches WHERE name = ?').get(sample.batchName);
    if (existing) return res.status(409).json({ error: '样例批次已存在，请先删除或更换日期' });

    const batchId = genId('batch');
    db.prepare(`
      INSERT INTO batches (id, name, import_date, total_records, valid_records, error_records, anomaly_count, unresolved_count, status, rule_version_id)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'importing', ?)
    `).run(batchId, sample.batchName, sample.batchDate, rule.id);

    const stats = processBatchRows(batchId, sample.batchName, sample.batchDate, sample.rows, rule);
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as Batch;
    res.json({ batch, stats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
