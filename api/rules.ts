import { db, genId } from './db';
import type { Rule, WeighingRecord, AnomalyType } from '../shared/types';

export interface RuleEvidence {
  rule_id: string;
  rule_version: string;
  anomaly_type: AnomalyType;
  threshold: Record<string, number>;
  actual: Record<string, number>;
  formula: string;
}

export function detectAnomalies(
  record: WeighingRecord, rule: Rule): RuleEvidence | null {
  if (!record.is_valid) return null;

  const overDiff = record.actual_weight - record.planned_weight;
  const overPct = record.planned_weight > 0
    ? (overDiff / record.planned_weight) * 100
    : 0;

  if (overDiff > rule.over_prep_threshold_abs || overPct > rule.over_prep_threshold_pct) {
    return {
      rule_id: rule.id,
      rule_version: rule.version,
      anomaly_type: 'over_prep',
      threshold: {
        abs_g: rule.over_prep_threshold_abs,
        pct: rule.over_prep_threshold_pct,
      },
      actual: {
        diff_g: overDiff,
        pct: overPct,
        planned: record.planned_weight,
        actual: record.actual_weight,
      },
      formula: `实际(${record.actual_weight}g) - 计划(${record.planned_weight}g) = 超出${overDiff.toFixed(1)}g (${overPct.toFixed(1)}%)`,
    };
  }

  if (
    record.temperature != null &&
    (record.temperature < rule.spoilage_temp_min ||
      record.temperature > rule.spoilage_temp_max)
  ) {
    return {
      rule_id: rule.id,
      rule_version: rule.version,
      anomaly_type: 'spoilage_suspect',
      threshold: {
        min_c: rule.spoilage_temp_min,
        max_c: rule.spoilage_temp_max,
      },
      actual: {
        temperature: record.temperature,
      },
      formula: `温度${record.temperature}℃ 超出安全范围[${rule.spoilage_temp_min}℃, ${rule.spoilage_temp_max}℃]`,
    };
  }

  return null;
}

export function createRule(input: {
  version: string;
  over_prep_threshold_pct: number;
  over_prep_threshold_abs: number;
  spoilage_temp_min: number;
  spoilage_temp_max: number;
  description: string;
}): Rule {
  const now = new Date().toISOString();
  const id = genId('rule');
  db.prepare(
    'INSERT INTO rules (id, version, is_active, over_prep_threshold_pct, over_prep_threshold_abs, spoilage_temp_min, spoilage_temp_max, created_at, description) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.version,
    input.over_prep_threshold_pct,
    input.over_prep_threshold_abs,
    input.spoilage_temp_min,
    input.spoilage_temp_max,
    now,
    input.description
  );
  return db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Rule;
}

export function activateRule(ruleId: string): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE rules SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE rules SET is_active = 1 WHERE id = ?').run(ruleId);
  });
  tx();
}

export function listRules(): Rule[] {
  return db.prepare('SELECT * FROM rules ORDER BY created_at DESC').all() as Rule[];
}
