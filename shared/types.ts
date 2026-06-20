export interface Batch {
  id: string;
  name: string;
  import_date: string;
  total_records: number;
  valid_records: number;
  error_records: number;
  anomaly_count: number;
  unresolved_count: number;
  status: 'importing' | 'completed' | 'failed';
  rule_version_id: string;
}

export interface WeighingRecord {
  id: string;
  batch_id: string;
  dish_name: string;
  planned_weight: number;
  actual_weight: number;
  temperature: number;
  timestamp: string;
  is_valid: boolean;
  error_reason: string | null;
  raw_line: string;
}

export interface Rule {
  id: string;
  version: string;
  is_active: boolean;
  over_prep_threshold_pct: number;
  over_prep_threshold_abs: number;
  spoilage_temp_min: number;
  spoilage_temp_max: number;
  created_at: string;
  description: string;
}

export type AnomalyType = 'over_prep' | 'spoilage_suspect';
export type AnomalyStatus = 'unresolved' | 'resolved';
export type ManualResult = 'normal' | 'confirmed' | null;

export interface Anomaly {
  id: string;
  batch_id: string;
  record_id: string;
  rule_version_id: string;
  anomaly_type: AnomalyType;
  evidence: string;
  status: AnomalyStatus;
  manual_reason: string | null;
  manual_result: ManualResult;
  resolved_at: string | null;
  created_at: string;
}

export interface ReviewHistory {
  id: string;
  anomaly_id: string;
  action: 'resolve' | 'reopen';
  reason: string;
  result: ManualResult;
  operator: string;
  timestamp: string;
}

export interface AnomalyDetail extends Anomaly {
  record: WeighingRecord;
  rule: Rule;
  history: ReviewHistory[];
}

export type RulePreviewStatus = 'pending' | 'confirmed' | 'expired' | 'cancelled';

export interface RulePreview {
  id: string;
  target_rule_id: string;
  from_active_rule_id: string | null;
  snapshot: string;
  status: RulePreviewStatus;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface RulePreviewDetail extends RulePreview {
  target_rule: Rule;
  from_active_rule: Rule | null;
  diff: {
    changes: {
      field: string;
      label: string;
      old_value: string | number | null;
      new_value: string | number | null;
      direction: 'added' | 'removed' | 'modified';
    }[];
  };
}

export type RuleActivationAction = 'activate' | 'rollback' | 'direct';

export interface RuleActivationLog {
  id: string;
  preview_id: string | null;
  from_rule_id: string | null;
  to_rule_id: string;
  action: RuleActivationAction;
  operator: string;
  rollback_package_id: string | null;
  created_at: string;
}

export interface RuleActivationLogDetail extends RuleActivationLog {
  from_rule: Rule | null;
  to_rule: Rule;
}

export interface RuleRollbackPackage {
  id: string;
  name: string;
  description: string | null;
  package_data: string;
  from_activation_log_id: string | null;
  created_at: string;
}

export interface RuleRollbackPackageExport {
  schema_version: string;
  package_id: string;
  exported_at: string;
  name: string;
  description: string | null;
  original_activation_log_id: string | null;
  from_rule: Rule | null;
  to_rule: Rule;
  all_rules_snapshot: Rule[];
}
