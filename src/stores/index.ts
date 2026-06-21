import { create } from 'zustand';
import type {
  Anomaly,
  AnomalyDetail,
  AnomalyStatus,
  AnomalyType,
  Batch,
  BatchFilterCriteria,
  BatchOperationRecord,
  BatchOperationResponse,
  BatchPreviewResponse,
  ManualResult,
  OperationLog,
  ReviewHistory,
  Rule,
  RulePreviewDetail,
  RuleActivationLogDetail,
  RuleRollbackPackage,
  RuleRollbackPackageExport,
} from '@shared/types';

interface ValidationIssue {
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  rules?: Rule[];
}

interface ImportResult {
  imported: Rule[];
  warnings: ValidationIssue[];
  count: number;
  activated?: string;
  activation_log?: RuleActivationLogDetail;
  rollback_package?: RuleRollbackPackage;
  rollback_export?: RuleRollbackPackageExport;
}

interface RollbackValidationResult extends ValidationResult {
  parsed?: RuleRollbackPackageExport;
}

interface ConfirmPreviewResult {
  success: boolean;
  activation_log?: RuleActivationLogDetail;
  rollback_package?: RuleRollbackPackage;
  rollback_export?: RuleRollbackPackageExport;
}

interface AppState {
  batches: Batch[];
  rules: Rule[];
  selectedBatchId: string | null;
  anomalies: Anomaly[];
  anomalyDetail: AnomalyDetail | null;
  selectedAnomalyIds: Set<string>;
  batchOperationResult: BatchOperationResponse | null;
  batchPreview: BatchPreviewResponse | null;
  batchOperations: BatchOperationRecord[];
  batchOperationDetail: { operation: BatchOperationRecord | null; history: ReviewHistory[] } | null;
  operationLogs: OperationLog[];
  consistency: { ok: boolean; issues: string[]; stats: unknown } | null;
  lastValidation: ValidationResult | null;
  rulePreviews: RulePreviewDetail[];
  activationLogs: RuleActivationLogDetail[];
  rollbackPackages: RuleRollbackPackage[];
  currentPreview: RulePreviewDetail | null;
  fetchBatches: () => Promise<void>;
  fetchRules: () => Promise<void>;
  importSample: () => Promise<{ error?: string }>;
  importCsv: (file: File, name?: string, date?: string) => Promise<{ error?: string }>;
  selectBatch: (id: string | null) => void;
  fetchAnomalies: (batchId?: string, status?: AnomalyStatus, type?: string) => Promise<void>;
  fetchAnomalyDetail: (id: string) => Promise<void>;
  resolveAnomaly: (id: string, reason: string, result: ManualResult, anomaly_type?: AnomalyType) => Promise<{ error?: string }>;
  reopenAnomaly: (id: string, reason?: string) => Promise<{ error?: string }>;
  toggleAnomalySelection: (id: string) => void;
  selectAllAnomalies: (status?: AnomalyStatus) => void;
  clearAnomalySelection: () => void;
  batchPreviewAnomalies: (filter: BatchFilterCriteria, anomalyIds?: string[]) => Promise<{ error?: string; preview?: BatchPreviewResponse }>;
  clearBatchPreview: () => void;
  batchResolveAnomalies: (ids: string[], reason: string, result: ManualResult, anomaly_type?: AnomalyType, filter?: BatchFilterCriteria) => Promise<{ error?: string; result?: BatchOperationResponse }>;
  batchResolveByFilter: (filter: BatchFilterCriteria, reason: string, result: ManualResult, anomaly_type?: AnomalyType) => Promise<{ error?: string; result?: BatchOperationResponse }>;
  batchReopenAnomalies: (ids: string[], reason?: string, filter?: BatchFilterCriteria) => Promise<{ error?: string; result?: BatchOperationResponse }>;
  batchReopenByFilter: (filter: BatchFilterCriteria, reason?: string) => Promise<{ error?: string; result?: BatchOperationResponse }>;
  fetchBatchOperationHistory: (batchOperationId: string) => Promise<ReviewHistory[] | null>;
  fetchBatchOperations: () => Promise<void>;
  fetchBatchOperationDetail: (batchOperationId: string) => Promise<void>;
  setBatchOperationResult: (r: BatchOperationResponse | null) => void;
  fetchOperationLogs: (limit?: number) => Promise<void>;
  exportFilteredDetail: (filter: BatchFilterCriteria) => Promise<void>;
  createRule: (r: Omit<Rule, 'id' | 'created_at' | 'is_active'>) => Promise<{ error?: string; issues?: ValidationIssue[] }>;
  activateRule: (id: string) => Promise<void>;
  checkConsistency: () => Promise<void>;
  exportRules: () => Promise<void>;
  validateRulePackage: (pkg: unknown) => Promise<ValidationResult>;
  importRulePackage: (pkg: unknown, activateFirst?: boolean) => Promise<{ error?: string; issues?: ValidationIssue[]; result?: ImportResult }>;
  setLastValidation: (v: ValidationResult | null) => void;
  createRulePreview: (ruleId: string) => Promise<{ error?: string; preview?: RulePreviewDetail }>;
  fetchRulePreviews: () => Promise<void>;
  confirmRulePreview: (previewId: string) => Promise<{ error?: string; result?: ConfirmPreviewResult }>;
  cancelRulePreview: (previewId: string) => Promise<{ error?: string }>;
  fetchActivationLogs: () => Promise<void>;
  fetchRollbackPackages: () => Promise<void>;
  exportRollbackPackage: (packageId: string) => Promise<void>;
  validateRollbackPackage: (pkg: unknown) => Promise<RollbackValidationResult>;
  applyRollbackPackage: (pkg: RuleRollbackPackageExport) => Promise<{ error?: string; log?: RuleActivationLogDetail }>;
  setCurrentPreview: (p: RulePreviewDetail | null) => void;
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
}

const api = (path: string, options?: RequestInit) =>
  fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });

export const useAppStore = create<AppState>((set, get) => ({
  batches: [],
  rules: [],
  selectedBatchId: null,
  anomalies: [],
  anomalyDetail: null,
  selectedAnomalyIds: new Set(),
  batchOperationResult: null,
  batchPreview: null,
  batchOperations: [],
  batchOperationDetail: null,
  operationLogs: [],
  consistency: null,
  lastValidation: null,
  rulePreviews: [],
  activationLogs: [],
  rollbackPackages: [],
  currentPreview: null,
  toast: null,

  setToast: (t) => {
    set({ toast: t });
    if (t) {
      setTimeout(() => set({ toast: null }), 3000);
    }
  },

  fetchBatches: async () => {
    const r = await api('/batches');
    if (r.ok) set({ batches: await r.json() });
  },

  fetchRules: async () => {
    const r = await api('/rules');
    if (r.ok) set({ rules: await r.json() });
  },

  importSample: async () => {
    const r = await api('/batches/sample', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '导入样例失败', type: 'error' });
      return { error: data.error };
    }
    await get().fetchBatches();
    get().setToast({ msg: '样例批次导入成功', type: 'success' });
    return {};
  },

  importCsv: async (file, name, date) => {
    const form = new FormData();
    form.append('csv', file);
    if (name) form.append('name', name);
    if (date) form.append('date', date);
    const r = await fetch('/api/batches', { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '导入失败', type: 'error' });
      return { error: data.error };
    }
    await get().fetchBatches();
    get().setToast({ msg: '批次导入成功', type: 'success' });
    return {};
  },

  selectBatch: (id) => set({ selectedBatchId: id }),

  fetchAnomalies: async (batchId, status, type) => {
    const q = new URLSearchParams();
    if (batchId) q.set('batch_id', batchId);
    if (status) q.set('status', status);
    if (type) q.set('type', type);
    const r = await api(`/anomalies?${q.toString()}`);
    if (r.ok) set({ anomalies: await r.json() });
  },

  fetchAnomalyDetail: async (id) => {
    const r = await api(`/anomalies/${id}`);
    if (r.ok) set({ anomalyDetail: await r.json() });
  },

  resolveAnomaly: async (id, reason, result, anomaly_type) => {
    const body: Record<string, unknown> = { reason, result };
    if (anomaly_type) body.anomaly_type = anomaly_type;
    const r = await api(`/anomalies/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '关闭失败', type: 'error' });
      return { error: data.error };
    }
    get().setToast({ msg: '已完成人工复核', type: 'success' });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    return { data };
  },

  reopenAnomaly: async (id, reason) => {
    const r = await api(`/anomalies/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '撤销失败', type: 'error' });
      return { error: data.error };
    }
    get().setToast({ msg: '已撤销关闭，恢复为未结', type: 'info' });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    return { data };
  },

  toggleAnomalySelection: (id) => {
    const current = get().selectedAnomalyIds;
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({ selectedAnomalyIds: next });
  },

  selectAllAnomalies: (status) => {
    const { anomalies } = get();
    const targetIds = anomalies
      .filter((a) => !status || a.status === status)
      .map((a) => a.id);
    set({ selectedAnomalyIds: new Set(targetIds) });
  },

  clearAnomalySelection: () => {
    set({ selectedAnomalyIds: new Set(), batchOperationResult: null });
  },

  batchPreviewAnomalies: async (filter, anomalyIds) => {
    try {
      const body: Record<string, unknown> = { filter };
      if (anomalyIds && anomalyIds.length > 0) body.anomaly_ids = anomalyIds;
      const r = await api('/anomalies/batch-preview', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const raw = await r.json();
      const data = raw as BatchPreviewResponse;
      if (!r.ok) {
        const errMsg = (raw && (raw as { error?: string }).error) || '预览生成失败';
        get().setToast({ msg: errMsg, type: 'error' });
        return { error: errMsg };
      }
      set({ batchPreview: data });
      return { preview: data };
    } catch (e) {
      const msg = (e as Error).message;
      get().setToast({ msg: '预览生成失败', type: 'error' });
      return { error: msg };
    }
  },

  clearBatchPreview: () => {
    set({ batchPreview: null });
  },

  batchResolveAnomalies: async (ids, reason, result, anomaly_type, filter) => {
    const body: Record<string, unknown> = { anomaly_ids: ids, reason, result };
    if (anomaly_type) body.anomaly_type = anomaly_type;
    if (filter) body.filter = filter;
    const r = await api('/anomalies/batch-resolve', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as BatchOperationResponse;
    if (!r.ok) {
      get().setToast({ msg: data.error || '批量处理失败', type: 'error' });
      return { error: data.error };
    }
    set({ batchOperationResult: data, selectedAnomalyIds: new Set(), batchPreview: null });
    const successCount = data.success.length;
    const skipCount = data.skipped.length;
    const failCount = data.failed.length;
    let msg = `批量处理完成：成功 ${successCount} 条`;
    if (skipCount > 0) msg += `，跳过 ${skipCount} 条`;
    if (failCount > 0) msg += `，失败 ${failCount} 条`;
    get().setToast({
      msg,
      type: failCount > 0 ? 'error' : skipCount > 0 ? 'info' : 'success',
    });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    await get().fetchBatchOperations();
    return { result: data };
  },

  batchResolveByFilter: async (filter, reason, result, anomaly_type) => {
    const body: Record<string, unknown> = { filter, reason, result };
    if (anomaly_type) body.anomaly_type = anomaly_type;
    const r = await api('/anomalies/batch-resolve-by-filter', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as BatchOperationResponse;
    if (!r.ok) {
      get().setToast({ msg: data.error || '按筛选批量处理失败', type: 'error' });
      return { error: data.error };
    }
    set({ batchOperationResult: data, selectedAnomalyIds: new Set(), batchPreview: null });
    const successCount = data.success.length;
    const skipCount = data.skipped.length;
    const failCount = data.failed.length;
    let msg = `按筛选批量处理完成：成功 ${successCount} 条`;
    if (data.total_submitted === 0) msg = data.error || '筛选条件下没有可处理的异常';
    else {
      if (skipCount > 0) msg += `，跳过 ${skipCount} 条`;
      if (failCount > 0) msg += `，失败 ${failCount} 条`;
    }
    get().setToast({
      msg,
      type: data.total_submitted === 0 ? 'info' : failCount > 0 ? 'error' : skipCount > 0 ? 'info' : 'success',
    });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    await get().fetchBatchOperations();
    return { result: data };
  },

  batchReopenAnomalies: async (ids, reason, filter) => {
    const body: Record<string, unknown> = { anomaly_ids: ids };
    if (reason) body.reason = reason;
    if (filter) body.filter = filter;
    const r = await api('/anomalies/batch-reopen', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as BatchOperationResponse;
    if (!r.ok) {
      get().setToast({ msg: data.error || '批量撤销失败', type: 'error' });
      return { error: data.error };
    }
    set({ batchOperationResult: data, selectedAnomalyIds: new Set(), batchPreview: null });
    const successCount = data.success.length;
    const skipCount = data.skipped.length;
    const failCount = data.failed.length;
    let msg = `批量撤销完成：成功 ${successCount} 条`;
    if (skipCount > 0) msg += `，跳过 ${skipCount} 条`;
    if (failCount > 0) msg += `，失败 ${failCount} 条`;
    get().setToast({
      msg,
      type: failCount > 0 ? 'error' : skipCount > 0 ? 'info' : 'success',
    });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    await get().fetchBatchOperations();
    return { result: data };
  },

  batchReopenByFilter: async (filter, reason) => {
    const body: Record<string, unknown> = { filter };
    if (reason) body.reason = reason;
    const r = await api('/anomalies/batch-reopen-by-filter', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as BatchOperationResponse;
    if (!r.ok) {
      get().setToast({ msg: data.error || '按筛选批量撤销失败', type: 'error' });
      return { error: data.error };
    }
    set({ batchOperationResult: data, selectedAnomalyIds: new Set(), batchPreview: null });
    const successCount = data.success.length;
    const skipCount = data.skipped.length;
    const failCount = data.failed.length;
    let msg = `按筛选批量撤销完成：成功 ${successCount} 条`;
    if (data.total_submitted === 0) msg = data.error || '筛选条件下没有可恢复的异常';
    else {
      if (skipCount > 0) msg += `，跳过 ${skipCount} 条`;
      if (failCount > 0) msg += `，失败 ${failCount} 条`;
    }
    get().setToast({
      msg,
      type: data.total_submitted === 0 ? 'info' : failCount > 0 ? 'error' : skipCount > 0 ? 'info' : 'success',
    });
    if (get().selectedBatchId) {
      await get().fetchBatches();
    }
    await get().fetchBatchOperations();
    return { result: data };
  },

  fetchBatchOperationHistory: async (batchOperationId) => {
    const r = await api(`/anomalies/batch-operation/${batchOperationId}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.history as ReviewHistory[];
  },

  fetchBatchOperations: async () => {
    const r = await api('/anomalies/batch-operations/list');
    if (r.ok) {
      const data = await r.json();
      set({ batchOperations: data as BatchOperationRecord[] });
    }
  },

  fetchBatchOperationDetail: async (batchOperationId) => {
    const r = await api(`/anomalies/batch-operation/${batchOperationId}`);
    if (r.ok) {
      const data = await r.json();
      set({ batchOperationDetail: data as { operation: BatchOperationRecord | null; history: ReviewHistory[] } });
    }
  },

  setBatchOperationResult: (r) => set({ batchOperationResult: r }),

  fetchOperationLogs: async (limit = 50) => {
    const r = await api(`/anomalies/operation-logs/list?limit=${limit}`);
    if (r.ok) {
      const data = await r.json();
      set({ operationLogs: data as OperationLog[] });
    }
  },

  exportFilteredDetail: async (filter) => {
    try {
      const r = await fetch('/api/export/filtered-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        get().setToast({ msg: (data as { error?: string }).error || '导出失败', type: 'error' });
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition');
      let filename = `review-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
      if (cd) {
        const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
        if (match) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      get().setToast({ msg: '筛选结果已导出为 CSV', type: 'success' });
    } catch {
      get().setToast({ msg: '导出失败', type: 'error' });
    }
  },

  createRule: async (r) => {
    const resp = await api('/rules', { method: 'POST', body: JSON.stringify(r) });
    const data = await resp.json();
    if (!resp.ok) {
      get().setToast({ msg: data.error || '创建规则失败', type: 'error' });
      return { error: data.error };
    }
    await get().fetchRules();
    get().setToast({ msg: '规则版本已创建', type: 'success' });
    return {};
  },

  activateRule: async (id) => {
    const resp = await api(`/rules/${id}/activate`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) {
      get().setToast({ msg: data.error || '启用规则失败', type: 'error' });
      return;
    }
    await get().fetchRules();
    await get().fetchActivationLogs();
    get().setToast({ msg: '已切换生效规则', type: 'success' });
  },

  checkConsistency: async () => {
    const r = await api('/export/consistency');
    if (r.ok) {
      const data = await r.json();
      set({ consistency: data });
      if (data.ok) get().setToast({ msg: '数据一致性校验通过', type: 'success' });
      else get().setToast({ msg: `发现 ${data.issues.length} 个数据不一致问题`, type: 'error' });
    }
  },

  setLastValidation: (v) => set({ lastValidation: v }),

  exportRules: async () => {
    try {
      const r = await fetch('/api/rules/export');
      if (!r.ok) {
        get().setToast({ msg: '导出失败', type: 'error' });
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition');
      let filename = `rules_${new Date().toISOString().slice(0, 10)}.json`;
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      get().setToast({ msg: '规则已导出为 JSON 文件', type: 'success' });
    } catch {
      get().setToast({ msg: '导出失败', type: 'error' });
    }
  },

  validateRulePackage: async (pkg) => {
    const r = await api('/rules/validate', {
      method: 'POST',
      body: JSON.stringify(pkg),
    });
    const data = (await r.json()) as ValidationResult;
    set({ lastValidation: data });
    return data;
  },

  importRulePackage: async (pkg, activateFirst = false) => {
    const validation = await get().validateRulePackage(pkg);
    if (!validation.valid) {
      return {
        error: '规则校验失败，请查看问题列表',
        issues: validation.issues,
      };
    }
    const qs = activateFirst ? '?activate=1' : '';
    const r = await api(`/rules/import${qs}`, {
      method: 'POST',
      body: JSON.stringify({ ...(pkg as Record<string, unknown>), operator: 'frontend_user' }),
    });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '导入失败', type: 'error' });
      return { error: data.error, issues: data.issues };
    }
    await get().fetchRules();
    if (activateFirst) {
      await get().fetchActivationLogs();
      await get().fetchRollbackPackages();
    }
    const warnings = (data.warnings || []) as ValidationIssue[];
    if (warnings.length > 0) {
      get().setToast({ msg: `已导入 ${data.count} 条规则，存在 ${warnings.length} 条警告`, type: 'info' });
    } else {
      get().setToast({ msg: `成功导入 ${data.count} 条规则${activateFirst ? '并已生效' : ''}`, type: 'success' });
    }
    return { result: data as ImportResult };
  },

  createRulePreview: async (ruleId) => {
    const r = await api(`/rules/${ruleId}/preview`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '预演创建失败', type: 'error' });
      return { error: data.error };
    }
    set({ currentPreview: data as RulePreviewDetail });
    await get().fetchRulePreviews();
    get().setToast({ msg: '已生成变更预演，请确认后再启用', type: 'info' });
    return { preview: data as RulePreviewDetail };
  },

  fetchRulePreviews: async () => {
    const r = await api('/rules/previews');
    if (r.ok) set({ rulePreviews: await r.json() });
  },

  confirmRulePreview: async (previewId) => {
    const r = await api(`/rules/previews/${previewId}/confirm`, { method: 'POST', body: '{}' });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '确认启用失败', type: 'error' });
      return { error: data.error };
    }
    set({ currentPreview: null });
    await get().fetchRules();
    await get().fetchRulePreviews();
    await get().fetchActivationLogs();
    await get().fetchRollbackPackages();
    get().setToast({ msg: '规则已生效，已自动生成回退包', type: 'success' });
    return { result: data as ConfirmPreviewResult };
  },

  cancelRulePreview: async (previewId) => {
    const r = await api(`/rules/previews/${previewId}/cancel`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '取消预演失败', type: 'error' });
      return { error: data.error };
    }
    set({ currentPreview: null });
    await get().fetchRulePreviews();
    get().setToast({ msg: '已取消预演', type: 'info' });
    return {};
  },

  fetchActivationLogs: async () => {
    const r = await api('/rules/activation-logs');
    if (r.ok) set({ activationLogs: await r.json() });
  },

  fetchRollbackPackages: async () => {
    const r = await api('/rules/rollback-packages');
    if (r.ok) set({ rollbackPackages: await r.json() });
  },

  exportRollbackPackage: async (packageId) => {
    try {
      const r = await fetch(`/api/rules/rollback-packages/${packageId}/export`);
      if (!r.ok) {
        get().setToast({ msg: '回退包导出失败', type: 'error' });
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition');
      let filename = `rollback_${packageId.slice(-8)}.json`;
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      get().setToast({ msg: '回退包已导出', type: 'success' });
    } catch {
      get().setToast({ msg: '回退包导出失败', type: 'error' });
    }
  },

  validateRollbackPackage: async (pkg) => {
    const r = await api('/rules/rollback-packages/validate', {
      method: 'POST',
      body: JSON.stringify(pkg),
    });
    return (await r.json()) as RollbackValidationResult;
  },

  applyRollbackPackage: async (pkg) => {
    const r = await api('/rules/rollback-packages/apply', {
      method: 'POST',
      body: JSON.stringify(pkg),
    });
    const data = await r.json();
    if (!r.ok) {
      get().setToast({ msg: data.error || '应用回退包失败', type: 'error' });
      return { error: data.error };
    }
    await get().fetchRules();
    await get().fetchActivationLogs();
    await get().fetchRollbackPackages();
    get().setToast({ msg: '已成功回退到目标版本', type: 'success' });
    return { log: data.activation_log as RuleActivationLogDetail };
  },

  setCurrentPreview: (p) => set({ currentPreview: p }),
}));
