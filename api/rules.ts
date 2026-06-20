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

export interface ValidationIssue {
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface RuleExportPackage {
  schema_version: string;
  exported_at: string;
  rules: Rule[];
}

const REQUIRED_FIELDS: (keyof Omit<Rule, 'id' | 'created_at' | 'is_active'>)[] = [
  'version',
  'over_prep_threshold_pct',
  'over_prep_threshold_abs',
  'spoilage_temp_min',
  'spoilage_temp_max',
  'description',
];

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

export function validateRuleInput(input: Partial<Rule>, checkDbDuplicates = true): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null) {
      issues.push({ field, message: `Field "${field}" is missing or empty (字段缺失或为空)`, severity: 'error' });
    }
  }

  if (input.version !== undefined && input.version !== null) {
    if (typeof input.version !== 'string' || input.version.trim() === '') {
      issues.push({ field: 'version', message: 'Version must be a non-empty string (版本号必须是非空字符串)', severity: 'error' });
    } else if (checkDbDuplicates) {
      const existing = db.prepare('SELECT id FROM rules WHERE version = ?').get(input.version);
      if (existing) {
        issues.push({ field: 'version', message: `Version "${input.version}" already exists (版本号已存在)`, severity: 'error' });
      }
    }
  }

  const numericFields: (keyof Rule)[] = [
    'over_prep_threshold_pct',
    'over_prep_threshold_abs',
    'spoilage_temp_min',
    'spoilage_temp_max',
  ];
  for (const field of numericFields) {
    if (input[field] !== undefined && input[field] !== null) {
      const val = Number(input[field]);
      if (Number.isNaN(val)) {
        issues.push({ field, message: `Field "${field}" must be a numeric value (必须是数值类型)`, severity: 'error' });
      } else if (val < 0) {
        issues.push({ field, message: `Field "${field}" cannot be negative (不能为负数)`, severity: 'error' });
      }
    }
  }

  if (
    input.spoilage_temp_min !== undefined && input.spoilage_temp_min !== null &&
    input.spoilage_temp_max !== undefined && input.spoilage_temp_max !== null &&
    !Number.isNaN(Number(input.spoilage_temp_min)) &&
    !Number.isNaN(Number(input.spoilage_temp_max))
  ) {
    if (Number(input.spoilage_temp_min) > Number(input.spoilage_temp_max)) {
      issues.push({
        field: 'spoilage_temp_max',
        message: `Temperature limits reversed: min(${input.spoilage_temp_min}C) > max(${input.spoilage_temp_max}C) (温度上下限写反)`,
        severity: 'error',
      });
    }
  }

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') {
      issues.push({ field: 'description', message: 'Description must be a string (规则描述必须是字符串)', severity: 'error' });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

export function validateRulePackage(
  pkg: unknown,
  checkDbDuplicates = true
): ValidationResult & { rules?: Rule[] } {
  const issues: ValidationIssue[] = [];

  if (!pkg || typeof pkg !== 'object') {
    return { valid: false, issues: [{ message: 'Rule package must be a JSON object (规则包必须是 JSON 对象)', severity: 'error' }] };
  }

  const obj = pkg as Record<string, unknown>;

  if (!obj.schema_version || typeof obj.schema_version !== 'string') {
    issues.push({ message: 'Rule package is missing schema_version field (规则包缺少 schema_version 字段)', severity: 'error' });
  }

  if (!Array.isArray(obj.rules)) {
    return {
      valid: false,
      issues: [...issues, { message: 'Rule package rules field must be an array (rules 字段必须是数组)', severity: 'error' }],
    };
  }

  const rawRules = obj.rules as unknown[];
  const validatedRules: Rule[] = [];
  const seenVersions = new Set<string>();
  const descMap = new Map<string, Partial<Rule>>();

  rawRules.forEach((r, idx) => {
    if (!r || typeof r !== 'object') {
      issues.push({ message: `Rule[${idx}]: not a valid object (不是有效对象)`, severity: 'error' });
      return;
    }

    const rule = r as Partial<Rule>;
    const result = validateRuleInput(rule, checkDbDuplicates);
    result.issues.forEach((issue) => {
      issues.push({
        ...issue,
        message: `Rule[${idx}]${issue.field ? '.' + issue.field : ''}: ${issue.message}`,
      });
    });

    if (rule.version) {
      if (seenVersions.has(rule.version)) {
        issues.push({
          field: 'version',
          message: `Rule[${idx}]: duplicate version "${rule.version}" within package (包内版本号重复)`,
          severity: 'error',
        });
      }
      seenVersions.add(rule.version);
    }

    if (rule.description && rule.description.trim() !== '') {
      const existing = descMap.get(rule.description);
      if (existing) {
        const differs =
          existing.over_prep_threshold_pct !== rule.over_prep_threshold_pct ||
          existing.over_prep_threshold_abs !== rule.over_prep_threshold_abs ||
          existing.spoilage_temp_min !== rule.spoilage_temp_min ||
          existing.spoilage_temp_max !== rule.spoilage_temp_max;
        if (differs) {
          issues.push({
            field: 'description',
            message: `Rule[${idx}]: same description but different thresholds (说明文字重复但内容不一致): "${rule.description}"`,
            severity: 'warning',
          });
        }
      } else {
        descMap.set(rule.description, rule);
      }
    }

    if (result.valid) {
      validatedRules.push(rule as Rule);
    }
  });

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    rules: validatedRules,
  };
}

export function exportRules(): RuleExportPackage {
  const rules = listRules();
  return {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    rules,
  };
}

export function importRules(
  pkg: RuleExportPackage,
  activateFirst = false
): { imported: Rule[]; issues: ValidationIssue[] } {
  const validation = validateRulePackage(pkg, true);
  if (!validation.valid) {
    return { imported: [], issues: validation.issues };
  }

  const rulesToImport = validation.rules!;
  const imported: Rule[] = [];

  const tx = db.transaction(() => {
    for (const ruleData of rulesToImport) {
      const now = new Date().toISOString();
      const id = genId('rule');
      db.prepare(
        'INSERT INTO rules (id, version, is_active, over_prep_threshold_pct, over_prep_threshold_abs, spoilage_temp_min, spoilage_temp_max, created_at, description) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        ruleData.version,
        Number(ruleData.over_prep_threshold_pct),
        Number(ruleData.over_prep_threshold_abs),
        Number(ruleData.spoilage_temp_min),
        Number(ruleData.spoilage_temp_max),
        now,
        ruleData.description || ''
      );
      const inserted = db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Rule;
      imported.push(inserted);
    }

    if (activateFirst && imported.length > 0) {
      db.prepare('UPDATE rules SET is_active = 0 WHERE is_active = 1').run();
      db.prepare('UPDATE rules SET is_active = 1 WHERE id = ?').run(imported[0].id);
      imported[0].is_active = true;
    }
  });

  tx();

  return { imported, issues: validation.issues.filter((i) => i.severity === 'warning') };
}

export function getActiveRuleId(): string | null {
  const row = db.prepare('SELECT id FROM rules WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined;
  return row?.id ?? null;
}
