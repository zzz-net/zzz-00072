import { db, genId } from './db';
import type {
  Rule,
  WeighingRecord,
  AnomalyType,
  RulePreview,
  RulePreviewDetail,
  RulePreviewStatus,
  RuleActivationLog,
  RuleActivationLogDetail,
  RuleRollbackPackage,
  RuleRollbackPackageExport,
} from '../shared/types';

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

export function activateRule(ruleId: string): { success: boolean; issues?: ValidationIssue[] } {
  const target = db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId) as Rule | undefined;
  if (!target) {
    return { success: false, issues: [{ message: 'Rule not found (规则不存在)', severity: 'error' }] };
  }

  const selfValidation = validateRuleInput(target, false);
  if (!selfValidation.valid) {
    return { success: false, issues: selfValidation.issues };
  }

  if (target.description && target.description.trim() !== '') {
    const conflicts = db
      .prepare('SELECT * FROM rules WHERE description = ? AND id != ?')
      .all(target.description, ruleId) as Rule[];
    for (const other of conflicts) {
      const differs =
        Number(other.over_prep_threshold_pct) !== Number(target.over_prep_threshold_pct) ||
        Number(other.over_prep_threshold_abs) !== Number(target.over_prep_threshold_abs) ||
        Number(other.spoilage_temp_min) !== Number(target.spoilage_temp_min) ||
        Number(other.spoilage_temp_max) !== Number(target.spoilage_temp_max);
      if (differs) {
        return {
          success: false,
          issues: [
            {
              field: 'description',
              message: `Cannot activate: same description as rule "${other.version}" but different thresholds (与已有规则描述重复但阈值不一致，无法启用): "${target.description}"`,
              severity: 'error',
            },
          ],
        };
      }
    }
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE rules SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE rules SET is_active = 1 WHERE id = ?').run(ruleId);
  });
  tx();
  return { success: true };
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
    } else if (checkDbDuplicates && input.description.trim() !== '') {
      const dbRows = db
        .prepare('SELECT * FROM rules WHERE description = ?')
        .all(input.description) as Rule[];
      for (const dbRule of dbRows) {
        if (input.version && dbRule.version === input.version) continue;
        const differs =
          Number(dbRule.over_prep_threshold_pct) !== Number(input.over_prep_threshold_pct) ||
          Number(dbRule.over_prep_threshold_abs) !== Number(input.over_prep_threshold_abs) ||
          Number(dbRule.spoilage_temp_min) !== Number(input.spoilage_temp_min) ||
          Number(dbRule.spoilage_temp_max) !== Number(input.spoilage_temp_max);
        if (differs) {
          issues.push({
            field: 'description',
            message: `Same description as existing rule "${dbRule.version}" but different thresholds (与已有规则描述重复但阈值不一致): "${input.description}"`,
            severity: 'error',
          });
          break;
        }
      }
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
            message: `Rule[${idx}]: same description but different thresholds in package (说明文字重复但内容不一致): "${rule.description}"`,
            severity: 'error',
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

const DIFF_FIELDS: { field: keyof Rule; label: string }[] = [
  { field: 'version', label: '版本号' },
  { field: 'over_prep_threshold_pct', label: '备餐过量阈值(%)' },
  { field: 'over_prep_threshold_abs', label: '备餐过量阈值(g)' },
  { field: 'spoilage_temp_min', label: '温度下限(℃)' },
  { field: 'spoilage_temp_max', label: '温度上限(℃)' },
  { field: 'description', label: '规则描述' },
];

function computeRuleDiff(
  fromRule: Rule | null | undefined,
  toRule: Rule
): RulePreviewDetail['diff'] {
  const changes: RulePreviewDetail['diff']['changes'] = [];
  for (const { field, label } of DIFF_FIELDS) {
    const oldVal = fromRule ? fromRule[field] : null;
    const newVal = toRule[field];
    const oldStr = oldVal === null || oldVal === undefined ? null : (typeof oldVal === 'string' ? oldVal : String(oldVal));
    const newStr = newVal === null || newVal === undefined ? null : (typeof newVal === 'string' ? newVal : String(newVal));
    let direction: 'added' | 'removed' | 'modified' = 'modified';
    if (oldVal === null || oldVal === undefined || oldStr === '') {
      direction = 'added';
    } else if (newVal === null || newVal === undefined || newStr === '') {
      direction = 'removed';
    } else if (oldStr !== newStr) {
      direction = 'modified';
    } else {
      continue;
    }
    changes.push({
      field,
      label,
      old_value: oldVal as string | number | null,
      new_value: newVal as string | number | null,
      direction,
    });
  }
  return { changes };
}

export function createRulePreview(targetRuleId: string): {
  success: boolean;
  issues?: ValidationIssue[];
  preview?: RulePreviewDetail;
} {
  const target = db.prepare('SELECT * FROM rules WHERE id = ?').get(targetRuleId) as Rule | undefined;
  if (!target) {
    return { success: false, issues: [{ message: '目标规则不存在', severity: 'error' }] };
  }

  const selfValidation = validateRuleInput(target, false);
  if (!selfValidation.valid) {
    return { success: false, issues: selfValidation.issues };
  }

  if (target.description && target.description.trim() !== '') {
    const conflicts = db
      .prepare('SELECT * FROM rules WHERE description = ? AND id != ?')
      .all(target.description, targetRuleId) as Rule[];
    for (const other of conflicts) {
      const differs =
        Number(other.over_prep_threshold_pct) !== Number(target.over_prep_threshold_pct) ||
        Number(other.over_prep_threshold_abs) !== Number(target.over_prep_threshold_abs) ||
        Number(other.spoilage_temp_min) !== Number(target.spoilage_temp_min) ||
        Number(other.spoilage_temp_max) !== Number(target.spoilage_temp_max);
      if (differs) {
        return {
          success: false,
          issues: [
            {
              field: 'description',
              message: `与已有规则描述重复但阈值不一致，无法启用: "${target.description}"`,
              severity: 'error',
            },
          ],
        };
      }
    }
  }

  const activeRule = db.prepare('SELECT * FROM rules WHERE is_active = 1').get() as Rule | undefined;

  if (activeRule && activeRule.id === targetRuleId) {
    return {
      success: false,
      issues: [{ message: '目标规则已是当前生效版本，无需切换', severity: 'error' }],
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const snapshot = JSON.stringify({
    active_rule_snapshot: activeRule,
    target_rule_snapshot: target,
    all_rules_snapshot: listRules(),
    created_at: now.toISOString(),
  });
  const id = genId('preview');

  db.prepare(`
    INSERT INTO rule_previews (id, target_rule_id, from_active_rule_id, snapshot, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    targetRuleId,
    activeRule?.id ?? null,
    snapshot,
    expiresAt,
    now.toISOString()
  );

  const diff = computeRuleDiff(activeRule, target);

  return {
    success: true,
    preview: {
      id,
      target_rule_id: targetRuleId,
      from_active_rule_id: activeRule?.id ?? null,
      snapshot,
      status: 'pending' as RulePreviewStatus,
      expires_at: expiresAt,
      created_at: now.toISOString(),
      confirmed_at: null,
      target_rule: target,
      from_active_rule: activeRule ?? null,
      diff,
    },
  };
}

export function getRulePreviewDetail(previewId: string): RulePreviewDetail | null {
  const row = db.prepare('SELECT * FROM rule_previews WHERE id = ?').get(previewId) as RulePreview | undefined;
  if (!row) return null;

  const targetRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(row.target_rule_id) as Rule | undefined;
  const fromRule = row.from_active_rule_id
    ? (db.prepare('SELECT * FROM rules WHERE id = ?').get(row.from_active_rule_id) as Rule | undefined)
    : null;

  if (!targetRule) return null;

  return {
    ...row,
    target_rule: targetRule,
    from_active_rule: fromRule ?? null,
    diff: computeRuleDiff(fromRule, targetRule),
  };
}

function cleanupExpiredPreviews(): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE rule_previews SET status = 'expired'
    WHERE status = 'pending' AND expires_at < ?
  `).run(now);
}

export function listRulePreviews(limit = 20): RulePreviewDetail[] {
  cleanupExpiredPreviews();
  const rows = db.prepare(`
    SELECT * FROM rule_previews ORDER BY created_at DESC LIMIT ?
  `).all(limit) as RulePreview[];
  return rows
    .map((row) => {
      const targetRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(row.target_rule_id) as Rule | undefined;
      const fromRule = row.from_active_rule_id
        ? (db.prepare('SELECT * FROM rules WHERE id = ?').get(row.from_active_rule_id) as Rule | undefined)
        : null;
      if (!targetRule) return null;
      return {
        ...row,
        target_rule: targetRule,
        from_active_rule: fromRule ?? null,
        diff: computeRuleDiff(fromRule, targetRule),
      };
    })
    .filter((v): v is RulePreviewDetail => v !== null);
}

export interface ConfirmPreviewResult {
  success: boolean;
  issues?: ValidationIssue[];
  activation_log?: RuleActivationLogDetail;
  rollback_package?: RuleRollbackPackage;
  rollback_export?: RuleRollbackPackageExport;
}

export function confirmRulePreview(previewId: string, operator = 'system'): ConfirmPreviewResult {
  cleanupExpiredPreviews();

  const row = db.prepare('SELECT * FROM rule_previews WHERE id = ?').get(previewId) as RulePreview | undefined;
  if (!row) {
    return { success: false, issues: [{ message: '预演记录不存在', severity: 'error' }] };
  }

  if (row.status === 'expired') {
    return { success: false, issues: [{ message: '预演已过期，请重新生成新的预演', severity: 'error' }] };
  }
  if (row.status !== 'pending') {
    return { success: false, issues: [{ message: `预演状态异常：${row.status}`, severity: 'error' }] };
  }

  const snapshot = JSON.parse(row.snapshot) as {
    active_rule_snapshot: Rule | null };
  const snapshotActiveRuleId = snapshot.active_rule_snapshot?.id ?? null;

  const currentActiveRuleId = getActiveRuleId();

  if (snapshotActiveRuleId !== currentActiveRuleId) {
    db.prepare(`UPDATE rule_previews SET status = 'expired' WHERE id = ?`).run(previewId);
    return {
      success: false,
      issues: [
        {
          message: '当前生效版本已在预演期间被变更，请重新预演后再确认',
          severity: 'error',
        },
      ],
    };
  }

  const targetRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(row.target_rule_id) as Rule | undefined;
  if (!targetRule) {
    return { success: false, issues: [{ message: '目标规则不存在', severity: 'error' }] };
  }

  const allRulesSnapshot = listRules();
  const activeRule = currentActiveRuleId
    ? (db.prepare('SELECT * FROM rules WHERE id = ?').get(currentActiveRuleId) as Rule | undefined)
    : null;

  const logId = genId('actlog');
  const rollbackPkgId = genId('rbpkg');
  const activationLogId = logId;

  const rollbackExport: RuleRollbackPackageExport = {
    schema_version: '1.0',
    package_id: rollbackPkgId,
    exported_at: new Date().toISOString(),
    name: `回退包_切回${activeRule?.version ?? '无版本'}_from_${targetRule.version}`,
    description: `启用规则${targetRule.version} 时自动生成的回退包`,
    original_activation_log_id: activationLogId,
    from_rule: targetRule,
    to_rule: activeRule ?? ({} as Rule),
    all_rules_snapshot: allRulesSnapshot,
  };

  const rollbackPackageData = JSON.stringify(rollbackExport);

  const tx = db.transaction(() => {
    db.prepare('UPDATE rules SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE rules SET is_active = 1 WHERE id = ?').run(row.target_rule_id);

    db.prepare(`UPDATE rule_previews SET status = 'confirmed', confirmed_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      previewId
    );

    db.prepare(`
      INSERT INTO rule_activation_logs (id, preview_id, from_rule_id, to_rule_id, action, operator, rollback_package_id, created_at)
      VALUES (?, ?, ?, ?, 'activate', ?, ?, ?)
    `).run(
      logId,
      previewId,
      currentActiveRuleId,
      row.target_rule_id,
      operator,
      rollbackPkgId,
      new Date().toISOString()
    );

    db.prepare(`
      INSERT INTO rule_rollback_packages (id, name, description, package_data, from_activation_log_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      rollbackPkgId,
      rollbackExport.name,
      rollbackExport.description,
      rollbackPackageData,
      logId,
      new Date().toISOString()
    );
  });

  tx();

  const logRow = db.prepare('SELECT * FROM rule_activation_logs WHERE id = ?').get(logId) as RuleActivationLog;

  return {
    success: true,
    activation_log: {
      ...logRow,
      from_rule: activeRule ?? null,
      to_rule: targetRule,
    },
    rollback_package: {
      id: rollbackPkgId,
      name: rollbackExport.name,
      description: rollbackExport.description ?? null,
      package_data: rollbackPackageData,
      from_activation_log_id: logId,
      created_at: new Date().toISOString(),
    },
    rollback_export: rollbackExport,
  };
}

export function listActivationLogs(limit = 50): RuleActivationLogDetail[] {
  const rows = db.prepare(`
    SELECT * FROM rule_activation_logs ORDER BY created_at DESC LIMIT ?
  `).all(limit) as RuleActivationLog[];
  return rows.map((row) => {
    const toRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(row.to_rule_id) as Rule;
    const fromRule = row.from_rule_id
      ? (db.prepare('SELECT * FROM rules WHERE id = ?').get(row.from_rule_id) as Rule | undefined)
      : null;
    return { ...row, to_rule: toRule, from_rule: fromRule ?? null };
  });
}

export function listRollbackPackages(limit = 20): RuleRollbackPackage[] {
  return db.prepare(`
    SELECT * FROM rule_rollback_packages ORDER BY created_at DESC LIMIT ?
  `).all(limit) as RuleRollbackPackage[];
}

export function getRollbackPackageExport(packageId: string): RuleRollbackPackageExport | null {
  const row = db.prepare('SELECT * FROM rule_rollback_packages WHERE id = ?').get(packageId) as RuleRollbackPackage | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.package_data);
  } catch {
    return null;
  }
}

export const ROLLBACK_PACKAGE_REQUIRED_FIELDS: (keyof RuleRollbackPackageExport)[] = [
  'schema_version',
  'package_id',
  'exported_at',
  'name',
  'to_rule',
  'all_rules_snapshot',
];

export function validateRollbackPackage(
  pkg: unknown
): ValidationResult & { parsed?: RuleRollbackPackageExport } {
  const issues: ValidationIssue[] = [];

  if (!pkg || typeof pkg !== 'object') {
    return { valid: false, issues: [{ message: '回退包必须是 JSON 对象', severity: 'error' }] };
  }

  const obj = pkg as Record<string, unknown>;

  for (const field of ROLLBACK_PACKAGE_REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      issues.push({ message: `回退包缺少必填字段: ${field}`, severity: 'error' });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  if (typeof obj.schema_version !== 'string' || !obj.schema_version.startsWith('1.')) {
    issues.push({ message: `回退包 schema_version 不兼容: ${obj.schema_version}`, severity: 'error' });
  }

  const parsed = obj as unknown as RuleRollbackPackageExport;

  if (!Array.isArray(parsed.all_rules_snapshot) || parsed.all_rules_snapshot.length === 0) {
    issues.push({ message: '回退包 all_rules_snapshot 必须是非空数组', severity: 'error' });
  }

  if (!parsed.to_rule || typeof parsed.to_rule !== 'object') {
    issues.push({ message: '回退包 to_rule 字段无效', severity: 'error' });
  } else {
    const toRuleValidation = validateRuleInput(parsed.to_rule as Partial<Rule>, false);
    toRuleValidation.issues.forEach((issue) => {
      issues.push({ ...issue, message: `回退包 to_rule: ${issue.message}` });
    });
  }

  const seenVersions = new Set<string>();
  (parsed.all_rules_snapshot || []).forEach((rule, idx) => {
    const rv = validateRuleInput(rule as Partial<Rule>, false);
    rv.issues.forEach(issue => {
      issues.push({ ...issue, message: `回退包 all_rules_snapshot[${idx}]: ${issue.message}` });
    });
    if (rule && typeof rule === 'object' && 'version' in rule) {
      const v = (rule as { version: string }).version;
      if (v && seenVersions.has(v)) {
        issues.push({ message: `回退包内版本号重复: ${v}`, severity: 'error' });
      }
      if (v) seenVersions.add(v);
    }
  });

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    parsed: issues.filter((i) => i.severity === 'error').length === 0 ? parsed : undefined,
  };
}

export function applyRollbackPackage(pkg: RuleRollbackPackageExport, operator = 'system'): {
  success: boolean;
  issues?: ValidationIssue[];
  activation_log?: RuleActivationLogDetail;
} {
  const validation = validateRollbackPackage(pkg);
  if (!validation.valid) {
    return { success: false, issues: validation.issues };
  }

  const currentActiveId = getActiveRuleId();
  const targetRule = validation.parsed!.to_rule;

  const tx = db.transaction(() => {
    for (const rule of validation.parsed!.all_rules_snapshot) {
      const existing = db.prepare('SELECT id FROM rules WHERE id = ?').get(rule.id) as { id: string } | undefined;
      if (existing) {
        db.prepare(`
          UPDATE rules SET
            version = ?,
            over_prep_threshold_pct = ?,
            over_prep_threshold_abs = ?,
            spoilage_temp_min = ?,
            spoilage_temp_max = ?,
            description = ?
          WHERE id = ?
        `).run(
          rule.version,
          Number(rule.over_prep_threshold_pct),
          Number(rule.over_prep_threshold_abs),
          Number(rule.spoilage_temp_min),
          Number(rule.spoilage_temp_max),
          rule.description ?? '',
          rule.id
        );
      } else {
        db.prepare(`
          INSERT INTO rules (id, version, is_active, over_prep_threshold_pct, over_prep_threshold_abs, spoilage_temp_min, spoilage_temp_max, created_at, description)
          VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
        `).run(
          rule.id,
          rule.version,
          Number(rule.over_prep_threshold_pct),
          Number(rule.over_prep_threshold_abs),
          Number(rule.spoilage_temp_min),
          Number(rule.spoilage_temp_max),
          rule.created_at ?? new Date().toISOString(),
          rule.description ?? ''
        );
      }
    }

    db.prepare('UPDATE rules SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE rules SET is_active = 1 WHERE id = ?').run(targetRule.id);

    const logId = genId('actlog');
    db.prepare(`
      INSERT INTO rule_activation_logs (id, preview_id, from_rule_id, to_rule_id, action, operator, rollback_package_id, created_at)
      VALUES (?, NULL, ?, ?, 'rollback', ?, ?, ?)
    `).run(
      logId,
      currentActiveId,
      targetRule.id,
      operator,
      validation.parsed!.package_id,
      new Date().toISOString()
    );
  });

  tx();

  const latestLog = db.prepare(`
    SELECT * FROM rule_activation_logs ORDER BY created_at DESC LIMIT 1
  `).get() as RuleActivationLog;

  const toRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(latestLog.to_rule_id) as Rule;
  const fromRule = latestLog.from_rule_id
    ? (db.prepare('SELECT * FROM rules WHERE id = ?').get(latestLog.from_rule_id) as Rule | undefined)
    : null;

  return {
    success: true,
    activation_log: {
      ...latestLog,
      from_rule: fromRule ?? null,
      to_rule: toRule,
    },
  };
}

export function cancelRulePreview(previewId: string): { success: boolean; issues?: ValidationIssue[] } {
  const row = db.prepare('SELECT * FROM rule_previews WHERE id = ?').get(previewId) as RulePreview | undefined;
  if (!row) {
    return { success: false, issues: [{ message: '预演记录不存在', severity: 'error' }] };
  }
  if (row.status !== 'pending') {
    return { success: false, issues: [{ message: `预演状态为 ${row.status}，无法取消`, severity: 'error' }] };
  }
  db.prepare(`UPDATE rule_previews SET status = 'cancelled' WHERE id = ?`).run(previewId);
  return { success: true };
}
