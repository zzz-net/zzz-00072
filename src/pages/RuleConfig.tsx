import { useEffect, useRef, useState } from 'react';
import {
  Plus, Check, History, Gauge, ListTodo, RefreshCcw, Eye, ArrowRight, X,
  Download, Upload, Thermometer, AlertCircle, AlertTriangle, CheckCircle2, FileJson,
} from 'lucide-react';
import { useAppStore } from '@/stores';
import type { Rule, RulePreviewDetail, RuleRollbackPackageExport } from '@shared/types';

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

type Tab = 'rules' | 'previews' | 'logs' | 'rollbacks';

export default function RuleConfig() {
  const {
    rules,
    fetchRules,
    createRule,
    exportRules,
    validateRulePackage,
    importRulePackage,
    lastValidation,
    setLastValidation,
    rulePreviews,
    activationLogs,
    rollbackPackages,
    currentPreview,
    fetchRulePreviews,
    fetchActivationLogs,
    fetchRollbackPackages,
    createRulePreview,
    confirmRulePreview,
    cancelRulePreview,
    exportRollbackPackage,
    validateRollbackPackage,
    applyRollbackPackage,
    setCurrentPreview,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<Tab>('rules');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showRollbackImport, setShowRollbackImport] = useState(false);
  const [form, setForm] = useState({
    version: '',
    over_prep_threshold_pct: 15,
    over_prep_threshold_abs: 100,
    spoilage_temp_min: 4,
    spoilage_temp_max: 60,
    description: '',
  });
  const [previewPkg, setPreviewPkg] = useState<unknown | null>(null);
  const [previewValidation, setPreviewValidation] = useState<ValidationResult | null>(null);
  const [activateOnImport, setActivateOnImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rollbackFileValidation, setRollbackFileValidation] = useState<ValidationResult & { parsed?: RuleRollbackPackageExport } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rollbackFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRules();
    fetchRulePreviews();
    fetchActivationLogs();
    fetchRollbackPackages();
  }, [fetchRules, fetchRulePreviews, fetchActivationLogs, fetchRollbackPackages]);

  useEffect(() => {
    if (currentPreview) {
      setShowPreview(true);
    }
  }, [currentPreview]);

  const activeRule = rules.find((r) => r.is_active);

  const handleCreate = async () => {
    if (!form.version) return;
    const result = await createRule(form);
    if (!result.error) {
      setShowForm(false);
      setForm({
        version: '',
        over_prep_threshold_pct: 15,
        over_prep_threshold_abs: 100,
        spoilage_temp_min: 4,
        spoilage_temp_max: 60,
        description: '',
      });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      setPreviewPkg(pkg);
      const result = await validateRulePackage(pkg);
      setPreviewValidation(result);
    } catch (err) {
      setPreviewValidation({
        valid: false,
        issues: [{ message: 'JSON 解析失败：' + (err as Error).message, severity: 'error' }],
      });
      setPreviewPkg(null);
    }
  };

  const handleImport = async () => {
    if (!previewPkg || !previewValidation?.valid) return;
    setImporting(true);
    const result = await importRulePackage(previewPkg, activateOnImport);
    setImporting(false);
    if (!result.error) {
      setShowImport(false);
      setPreviewPkg(null);
      setPreviewValidation(null);
      setLastValidation(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const closeImport = () => {
    setShowImport(false);
    setPreviewPkg(null);
    setPreviewValidation(null);
    setLastValidation(null);
    setActivateOnImport(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePreviewActivate = async (ruleId: string) => {
    await createRulePreview(ruleId);
  };

  const handleConfirmPreview = async () => {
    if (!currentPreview) return;
    setConfirming(true);
    await confirmRulePreview(currentPreview.id);
    setConfirming(false);
    setShowPreview(false);
  };

  const handleCancelPreview = async () => {
    if (!currentPreview) return;
    await cancelRulePreview(currentPreview.id);
    setShowPreview(false);
  };

  const closePreview = () => {
    setShowPreview(false);
    setCurrentPreview(null);
  };

  const handleRollbackFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const result = await validateRollbackPackage(pkg);
      setRollbackFileValidation(result);
    } catch (err) {
      setRollbackFileValidation({
        valid: false,
        issues: [{ message: 'JSON 解析失败：' + (err as Error).message, severity: 'error' }],
      });
    }
  };

  const handleApplyRollbackFile = async () => {
    if (!rollbackFileValidation?.valid || !rollbackFileValidation.parsed) return;
    await applyRollbackPackage(rollbackFileValidation.parsed);
    setShowRollbackImport(false);
    setRollbackFileValidation(null);
    if (rollbackFileInputRef.current) rollbackFileInputRef.current.value = '';
  };

  const closeRollbackImport = () => {
    setShowRollbackImport(false);
    setRollbackFileValidation(null);
    if (rollbackFileInputRef.current) rollbackFileInputRef.current.value = '';
  };

  const displayValidation = previewValidation || lastValidation;

  const statusBadge = (status: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      pending: { text: '待确认', cls: 'bg-amber-100 text-amber-700' },
      confirmed: { text: '已确认', cls: 'bg-emerald-100 text-emerald-700' },
      expired: { text: '已过期', cls: 'bg-slate-100 text-slate-600' },
      cancelled: { text: '已取消', cls: 'bg-rose-100 text-rose-700' },
    };
    const cfg = map[status] || { text: status, cls: 'bg-slate-100 text-slate-600' };
    return <span className={`text-[11px] px-1.5 py-0.5 rounded ${cfg.cls}`}>{cfg.text}</span>;
  };

  const actionBadge = (action: string) => {
    const map: Record<string, { text: string; cls: string }> = {
      activate: { text: '启用', cls: 'bg-primary-100 text-primary-700' },
      rollback: { text: '回退', cls: 'bg-amber-100 text-amber-700' },
      direct: { text: '直接启用', cls: 'bg-slate-100 text-slate-600' },
    };
    const cfg = map[action] || { text: action, cls: 'bg-slate-100 text-slate-600' };
    return <span className={`text-[11px] px-1.5 py-0.5 rounded ${cfg.cls}`}>{cfg.text}</span>;
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'rules', label: '规则版本', icon: <History className="w-4 h-4" /> },
    { key: 'previews', label: '预演记录', icon: <Eye className="w-4 h-4" /> },
    { key: 'logs', label: '启用日志', icon: <ListTodo className="w-4 h-4" /> },
    { key: 'rollbacks', label: '回退包', icon: <RefreshCcw className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">规则配置</h2>
          <p className="text-sm text-slate-500 mt-1">配置损耗判定规则，支持变更预演、启用日志和版本回退</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportRules()}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-md text-sm hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-4 h-4" />
            导出规则
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-md text-sm hover:bg-slate-50 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            导入规则
          </button>
          <button
            onClick={() => setShowRollbackImport(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-md text-sm hover:bg-amber-100 shadow-sm"
          >
            <RefreshCcw className="w-4 h-4" />
            导入回退包
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-700 text-white rounded-md text-sm hover:bg-primary-600 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            新建规则版本
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && (
        <>
          {activeRule && (
            <div className="bg-gradient-to-br from-primary-700 to-primary-800 rounded-lg p-5 text-white">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <Check className="w-5 h-5 text-accent-300" />
                </div>
                <div>
                  <h3 className="font-semibold">当前生效规则</h3>
                  <p className="text-xs text-primary-200">版本 {activeRule.version}</p>
                </div>
              </div>
              {activeRule.description && (
                <p className="text-sm text-primary-100 mb-4">{activeRule.description}</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/10 rounded p-3">
                  <div className="flex items-center gap-1.5 text-primary-200 text-xs mb-1">
                    <Gauge className="w-3.5 h-3.5" />
                    备餐过量阈值(%)
                  </div>
                  <div className="text-lg font-bold">{activeRule.over_prep_threshold_pct}%</div>
                </div>
                <div className="bg-white/10 rounded p-3">
                  <div className="flex items-center gap-1.5 text-primary-200 text-xs mb-1">
                    <Gauge className="w-3.5 h-3.5" />
                    备餐过量阈值(g)
                  </div>
                  <div className="text-lg font-bold">{activeRule.over_prep_threshold_abs} g</div>
                </div>
                <div className="bg-white/10 rounded p-3">
                  <div className="flex items-center gap-1.5 text-primary-200 text-xs mb-1">
                    <Thermometer className="w-3.5 h-3.5" />
                    温度下限
                  </div>
                  <div className="text-lg font-bold">{activeRule.spoilage_temp_min} ℃</div>
                </div>
                <div className="bg-white/10 rounded p-3">
                  <div className="flex items-center gap-1.5 text-primary-200 text-xs mb-1">
                    <Thermometer className="w-3.5 h-3.5" />
                    温度上限
                  </div>
                  <div className="text-lg font-bold">{activeRule.spoilage_temp_max} ℃</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-xs text-primary-200">
                  <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                  已生成的批次异常和复核结果将继续绑定其创建时的规则版本，仅新导入批次会使用当前生效规则。
                </p>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-medium text-slate-700">
              <History className="w-4 h-4 text-primary-600" />
              历史版本
              <span className="ml-2 text-xs text-slate-400 font-normal">（共 {rules.length} 条）</span>
            </div>
            <div className="divide-y divide-slate-100">
              {rules.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">暂无规则版本</div>
              ) : (
                rules.map((r) => (
                  <div key={r.id} className="px-5 py-4 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">版本 {r.version}</span>
                        {r.is_active ? (
                          <span className="text-[11px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                            已生效
                          </span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            未启用
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        过量 {r.over_prep_threshold_pct}% / {r.over_prep_threshold_abs}g · 温度{' '}
                        {r.spoilage_temp_min}~{r.spoilage_temp_max}℃ · 创建于 {r.created_at.slice(0, 10)}
                      </div>
                      {r.description && (
                        <p className="text-xs text-slate-400 mt-1">{r.description}</p>
                      )}
                    </div>
                    {!r.is_active && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePreviewActivate(r.id)}
                          className="px-3 py-1.5 text-sm border border-primary-200 bg-primary-50 text-primary-700 rounded hover:bg-primary-100 inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          预演并启用
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'previews' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Eye className="w-4 h-4 text-primary-600" />
            最近预演记录
            <span className="ml-2 text-xs text-slate-400 font-normal">（应用重启后仍可查看）</span>
          </div>
          <div className="divide-y divide-slate-100">
            {rulePreviews.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">暂无预演记录</div>
            ) : (
              rulePreviews.map((p) => (
                <div key={p.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        预演 → 版本 {p.target_rule.version}
                      </span>
                      {statusBadge(p.status)}
                    </div>
                    <span className="text-xs text-slate-400">
                      创建于 {p.created_at.replace('T', ' ').slice(0, 19)}
                    </span>
                  </div>
                  {p.from_active_rule && (
                    <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                      从 <span className="font-medium">版本 {p.from_active_rule.version}</span>
                      <ArrowRight className="w-3 h-3" />
                      <span className="font-medium">版本 {p.target_rule.version}</span>
                    </div>
                  )}
                  <div className="border border-slate-100 rounded-md divide-y divide-slate-50 max-h-40 overflow-auto">
                    {p.diff.changes.map((c, idx) => (
                      <div key={idx} className="px-3 py-2 text-xs flex items-center gap-3">
                        <span className="text-slate-500 w-28 flex-shrink-0">{c.label}</span>
                        <span
                          className={`flex-1 line-through ${
                            c.direction === 'removed' ? 'text-rose-600' : 'text-slate-400'
                          }`}
                        >
                          {c.old_value ?? '(空)'}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-300" />
                        <span
                          className={`flex-1 font-medium ${
                            c.direction === 'added' ? 'text-emerald-700' : 'text-slate-800'
                          }`}
                        >
                          {c.new_value ?? '(空)'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {p.status === 'pending' && (
                    <div className="mt-3 flex gap-2 justify-end">
                      <button
                        onClick={() => {
                          setCurrentPreview(p);
                          setShowPreview(true);
                        }}
                        className="px-3 py-1.5 text-sm border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
                      >
                        查看详情
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-medium text-slate-700">
            <ListTodo className="w-4 h-4 text-primary-600" />
            启用变更日志
            <span className="ml-2 text-xs text-slate-400 font-normal">（应用重启后仍可查看）</span>
          </div>
          <div className="divide-y divide-slate-100">
            {activationLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">暂无启用日志</div>
            ) : (
              activationLogs.map((log) => (
                <div key={log.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {actionBadge(log.action)}
                      <span className="text-sm font-medium text-slate-800">
                        {log.from_rule
                          ? `版本 ${log.from_rule.version} → 版本 ${log.to_rule.version}`
                          : `启用 → 版本 ${log.to_rule.version}`}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {log.created_at.replace('T', ' ').slice(0, 19)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    操作人：{log.operator}
                    {log.rollback_package_id && (
                      <span className="ml-3">回退包：{log.rollback_package_id.slice(-12)}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'rollbacks' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-medium text-slate-700">
            <RefreshCcw className="w-4 h-4 text-primary-600" />
            可用回退包
            <span className="ml-2 text-xs text-slate-400 font-normal">（应用重启后仍可使用）</span>
          </div>
          <div className="divide-y divide-slate-100">
            {rollbackPackages.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">暂无回退包</div>
            ) : (
              rollbackPackages.map((pkg) => (
                <div key={pkg.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{pkg.name}</div>
                    {pkg.description && (
                      <div className="text-xs text-slate-500 mt-0.5">{pkg.description}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-1">
                      创建于 {pkg.created_at.replace('T', ' ').slice(0, 19)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => exportRollbackPackage(pkg.id)}
                      className="px-3 py-1.5 text-sm border border-slate-200 rounded hover:bg-slate-50 text-slate-600 inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出
                    </button>
                    <button
                      onClick={async () => {
                        const r = await fetch(`/api/rules/rollback-packages/${pkg.id}/export`);
                        const exp = await r.json();
                        if (exp && exp.to_rule && exp.all_rules_snapshot) {
                          if (window.confirm(`确认回退到版本 ${exp.to_rule.version}？此操作会恢复所有规则快照。`)) {
                            await applyRollbackPackage(exp);
                          }
                        }
                      }}
                      className="px-3 py-1.5 text-sm border border-amber-200 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 inline-flex items-center gap-1"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      应用回退
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] overflow-auto scrollbar-thin">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
              <h3 className="font-semibold text-slate-800">新建规则版本</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-sm text-slate-600">版本号 *</label>
                  <input
                    value={form.version}
                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                    placeholder="例如 v1.1"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">备餐过量阈值 (%)</label>
                  <input
                    type="number"
                    value={form.over_prep_threshold_pct}
                    onChange={(e) => setForm({ ...form, over_prep_threshold_pct: Number(e.target.value) })}
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">备餐过量阈值 (g)</label>
                  <input
                    type="number"
                    value={form.over_prep_threshold_abs}
                    onChange={(e) => setForm({ ...form, over_prep_threshold_abs: Number(e.target.value) })}
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">温度下限 (℃)</label>
                  <input
                    type="number"
                    value={form.spoilage_temp_min}
                    onChange={(e) => setForm({ ...form, spoilage_temp_min: Number(e.target.value) })}
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">温度上限 (℃)</label>
                  <input
                    type="number"
                    value={form.spoilage_temp_max}
                    onChange={(e) => setForm({ ...form, spoilage_temp_max: Number(e.target.value) })}
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm text-slate-600">规则描述</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    placeholder="可选"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.version}
                className="px-4 py-1.5 bg-primary-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600"
              >
                创建新版本
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[620px] max-h-[90vh] overflow-auto scrollbar-thin flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-slate-800">导入规则包</h3>
              <button onClick={closeImport} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-auto">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center hover:border-primary-300 transition-colors">
                <FileJson className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-1">选择规则 JSON 文件进行导入</p>
                <p className="text-xs text-slate-400 mb-4">支持 .json 格式，导入前会进行完整校验</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-primary-700 text-white rounded text-sm hover:bg-primary-600"
                >
                  选择文件
                </button>
              </div>

              {displayValidation && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">校验结果</span>
                    {displayValidation.valid ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        通过
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        未通过
                      </span>
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-60 overflow-auto">
                    {displayValidation.issues.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-slate-400">未发现问题</div>
                    ) : (
                      displayValidation.issues.map((issue, idx) => (
                        <div key={idx} className="px-3 py-2 flex items-start gap-2">
                          {issue.severity === 'error' ? (
                            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="text-xs">
                            <span className={issue.severity === 'error' ? 'text-rose-700 font-medium' : 'text-amber-700 font-medium'}>
                              {issue.severity === 'error' ? '错误' : '警告'}
                              {issue.field && ` [${issue.field}]`}
                              ：
                            </span>
                            <span className="text-slate-600">{issue.message}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {previewValidation?.valid && previewValidation.rules && previewValidation.rules.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">待导入规则预览</div>
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-48 overflow-auto">
                    {previewValidation.rules.map((r, idx) => (
                      <div key={idx} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">v{r.version}</span>
                          <span className="text-xs text-slate-400">
                            过量 {r.over_prep_threshold_pct}%/{r.over_prep_threshold_abs}g · 温度 {r.spoilage_temp_min}~{r.spoilage_temp_max}℃
                          </span>
                        </div>
                        {r.description && (
                          <div className="text-xs text-slate-500 mt-0.5">{r.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activateOnImport}
                      onChange={(e) => setActivateOnImport(e.target.checked)}
                      className="rounded border-slate-300 text-primary-700 focus:ring-primary-500"
                    />
                    导入后将第一条规则设为生效版本
                  </label>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={closeImport}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!previewValidation?.valid || importing}
                className="px-4 py-1.5 bg-primary-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600"
              >
                {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreview && currentPreview && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[90vh] overflow-auto scrollbar-thin flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold text-slate-800">变更预演确认</h3>
                <p className="text-xs text-slate-500 mt-0.5">请核对以下变更，确认无误后再启用</p>
              </div>
              <button onClick={closePreview} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-auto">
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex-1">
                    <div className="text-xs text-slate-500">当前生效版本</div>
                    <div className="font-semibold text-slate-700">
                      {currentPreview.from_active_rule
                        ? `版本 ${currentPreview.from_active_rule.version}`
                        : '(无)'}
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400" />
                  <div className="flex-1 text-right">
                    <div className="text-xs text-primary-600">即将生效版本</div>
                    <div className="font-semibold text-primary-700">版本 {currentPreview.target_rule.version}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">具体变更内容</div>
                <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                  {currentPreview.diff.changes.map((c, idx) => (
                    <div key={idx} className="px-3 py-2.5 text-sm flex items-center gap-3">
                      <span className="text-slate-500 w-32 flex-shrink-0 text-xs">{c.label}</span>
                      <span
                        className={`flex-1 text-xs ${
                          c.direction === 'removed' ? 'line-through text-rose-600' : 'text-slate-400'
                        }`}
                      >
                        {c.old_value ?? '(空)'}
                      </span>
                      <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                      <span
                        className={`flex-1 font-medium text-xs ${
                          c.direction === 'added' ? 'text-emerald-700' : 'text-slate-800'
                        }`}
                      >
                        {c.new_value ?? '(空)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {currentPreview.target_rule.description && (
                <div className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-md p-3">
                  <AlertTriangle className="w-4 h-4 inline mr-1 text-amber-500" />
                  {currentPreview.target_rule.description}
                </div>
              )}

              <div className="text-xs text-slate-500">
                <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                确认启用后系统会：1) 切换当前生效规则；2) 自动生成一个可导出的回退包，方便之后恢复。
              </div>
              <div className="text-xs text-slate-400">
                预演有效期至 {currentPreview.expires_at.replace('T', ' ').slice(0, 19)}，过期后需重新预演。
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={handleCancelPreview}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50"
              >
                取消预演
              </button>
              <button
                onClick={handleConfirmPreview}
                disabled={confirming}
                className="px-4 py-1.5 bg-primary-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600 inline-flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                {confirming ? '确认中...' : '确认并启用'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRollbackImport && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[620px] max-h-[90vh] overflow-auto scrollbar-thin flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold text-slate-800">导入回退包</h3>
                <p className="text-xs text-slate-500 mt-0.5">导入前会进行严格校验，脏数据不会落库</p>
              </div>
              <button onClick={closeRollbackImport} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-auto">
              <div className="border-2 border-dashed border-amber-200 bg-amber-50 rounded-lg p-8 text-center hover:border-amber-300 transition-colors">
                <RefreshCcw className="w-12 h-12 text-amber-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-1">选择回退包 JSON 文件</p>
                <p className="text-xs text-slate-400 mb-4">导入前会校验版本号、必填字段和内容完整性</p>
                <input
                  ref={rollbackFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRollbackFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => rollbackFileInputRef.current?.click()}
                  className="px-4 py-2 bg-amber-600 text-white rounded text-sm hover:bg-amber-500"
                >
                  选择回退包
                </button>
              </div>

              {rollbackFileValidation && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">校验结果</span>
                    {rollbackFileValidation.valid ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        通过，可以安全应用
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        拦截，不允许应用
                      </span>
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-40 overflow-auto">
                    {rollbackFileValidation.issues.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-slate-400">未发现问题</div>
                    ) : (
                      rollbackFileValidation.issues.map((issue, idx) => (
                        <div key={idx} className="px-3 py-2 flex items-start gap-2">
                          {issue.severity === 'error' ? (
                            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="text-xs">
                            <span className={issue.severity === 'error' ? 'text-rose-700 font-medium' : 'text-amber-700 font-medium'}>
                              {issue.severity === 'error' ? '错误' : '警告'}
                              {issue.field && ` [${issue.field}]`}
                              ：
                            </span>
                            <span className="text-slate-600">{issue.message}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {rollbackFileValidation?.valid && rollbackFileValidation.parsed && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">回退目标</div>
                  <div className="bg-amber-50 border border-amber-100 rounded-md p-3">
                    <div className="text-sm font-medium text-amber-800">
                      将恢复到版本 {rollbackFileValidation.parsed.to_rule.version}
                    </div>
                    <div className="text-xs text-amber-600 mt-1">
                      {rollbackFileValidation.parsed.name}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={closeRollbackImport}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleApplyRollbackFile}
                disabled={!rollbackFileValidation?.valid}
                className="px-4 py-1.5 bg-amber-600 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-500"
              >
                确认应用回退
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
