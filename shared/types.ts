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
  batch_operation_id?: string | null;
}

export interface BatchOperationResultItem {
  id: string;
  success: boolean;
  error?: string;
  skip_reason?: SkipReasonCode;
  previous_status?: AnomalyStatus;
  previous_result?: ManualResult;
  dish_name?: string;
}

export type SkipReasonCode =
  | 'not_found'
  | 'already_resolved'
  | 'already_unresolved'
  | 'status_changed_by_other'
  | 'reopened_after_batch'
  | 'modified_individually'
  | 'batch_mismatch';

export interface BatchFilterCriteria {
  batch_ids?: string[];
  status?: AnomalyStatus;
  anomaly_types?: AnomalyType[];
  manual_results?: ManualResult[];
  time_start?: string;
  time_end?: string;
  created_start?: string;
  created_end?: string;
  dish_name_keyword?: string;
}

export interface BatchPreviewAnomaly {
  id: string;
  batch_id: string;
  anomaly_type: AnomalyType;
  status: AnomalyStatus;
  manual_result: ManualResult;
  dish_name: string;
  planned_weight: number;
  actual_weight: number;
  temperature: number | null;
  record_time: string;
  created_at: string;
  resolved_at: string | null;
  evidence_summary: string;
}

export interface BatchPreviewResponse {
  filter: BatchFilterCriteria;
  matched_count: number;
  by_batch: {
    batch_id: string;
    batch_name: string;
    count: number;
    unresolved_count: number;
    resolved_count: number;
  }[];
  by_type: { type: AnomalyType; label: string; count: number }[];
  by_status: { status: AnomalyStatus; label: string; count: number }[];
  samples: BatchPreviewAnomaly[];
  estimated_unresolved_actionable: number;
  estimated_resolved_actionable: number;
  error?: string;
}

export interface BatchResolveRequest {
  anomaly_ids: string[];
  reason: string;
  result: ManualResult;
  anomaly_type?: AnomalyType;
  filter?: BatchFilterCriteria;
  preview_token?: string;
  idempotency_key?: string;
}

export interface BatchReopenRequest {
  anomaly_ids: string[];
  reason?: string;
  filter?: BatchFilterCriteria;
  preview_token?: string;
  idempotency_key?: string;
}

export interface BatchFilterResolveRequest {
  filter: BatchFilterCriteria;
  reason: string;
  result: ManualResult;
  anomaly_type?: AnomalyType;
  idempotency_key?: string;
}

export interface BatchFilterReopenRequest {
  filter: BatchFilterCriteria;
  reason?: string;
  idempotency_key?: string;
}

export interface BatchOperationResponse {
  batch_operation_id: string;
  success: BatchOperationResultItem[];
  skipped: BatchOperationResultItem[];
  failed: BatchOperationResultItem[];
  total_submitted: number;
  action: 'resolve' | 'reopen';
  applied_result?: ManualResult;
  applied_reason?: string;
  timestamp: string;
  error?: string;
}

export interface BatchOperationRecord {
  id: string;
  action: 'resolve' | 'reopen';
  applied_result: ManualResult;
  applied_reason: string;
  applied_anomaly_type?: AnomalyType | null;
  filter_snapshot?: string | null;
  total_submitted: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  operator: string;
  timestamp: string;
  idempotency_key?: string | null;
}

export interface BatchResultItem {
  id: string;
  batch_operation_id: string;
  anomaly_id: string;
  dish_name: string | null;
  status_before: AnomalyStatus | null;
  result_before: ManualResult;
  outcome: 'success' | 'skipped' | 'failed';
  skip_reason: SkipReasonCode | null;
  error_message: string | null;
}

export interface BatchOperationDetail {
  operation: BatchOperationRecord;
  items: BatchResultItem[];
  history: ReviewHistory[];
  current_unresolved_count: number;
}

export interface ResultCenterConfig {
  action_filter: 'all' | 'resolve' | 'reopen';
  outcome_filter: 'all' | 'success' | 'skipped' | 'failed';
  time_start: string;
  time_end: string;
}

export interface OperationLog {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: string | null;
  operator: string;
  filter_snapshot: string | null;
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
