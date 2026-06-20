import { create } from 'zustand';
import type {
  Anomaly,
  AnomalyDetail,
  AnomalyStatus,
  AnomalyType,
  Batch,
  ManualResult,
  Rule,
} from '@shared/types';

interface AppState {
  batches: Batch[];
  rules: Rule[];
  selectedBatchId: string | null;
  anomalies: Anomaly[];
  anomalyDetail: AnomalyDetail | null;
  consistency: { ok: boolean; issues: string[]; stats: unknown } | null;
  fetchBatches: () => Promise<void>;
  fetchRules: () => Promise<void>;
  importSample: () => Promise<{ error?: string }>;
  importCsv: (file: File, name?: string, date?: string) => Promise<{ error?: string }>;
  selectBatch: (id: string | null) => void;
  fetchAnomalies: (batchId: string, status?: AnomalyStatus, type?: string) => Promise<void>;
  fetchAnomalyDetail: (id: string) => Promise<void>;
  resolveAnomaly: (id: string, reason: string, result: ManualResult, anomaly_type?: AnomalyType) => Promise<{ error?: string }>;
  reopenAnomaly: (id: string, reason?: string) => Promise<{ error?: string }>;
  createRule: (r: Omit<Rule, 'id' | 'created_at' | 'is_active'>) => Promise<{ error?: string }>;
  activateRule: (id: string) => Promise<void>;
  checkConsistency: () => Promise<void>;
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
  consistency: null,
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
    const q = new URLSearchParams({ batch_id: batchId });
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
    await api(`/rules/${id}/activate`, { method: 'POST' });
    await get().fetchRules();
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
}));
