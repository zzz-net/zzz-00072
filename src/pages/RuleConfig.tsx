import { useEffect, useRef, useState } from 'react';
import { Plus, Check, History, Gauge, Thermometer, Download, Upload, AlertTriangle, AlertCircle, CheckCircle2, FileJson, X } from 'lucide-react';
import { useAppStore } from '@/stores';
import type { Rule } from '@shared/types';

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

export default function RuleConfig() {
  const {
    rules,
    fetchRules,
    createRule,
    activateRule,
    exportRules,
    validateRulePackage,
    importRulePackage,
    lastValidation,
    setLastValidation,
  } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

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

  const displayValidation = previewValidation || lastValidation;

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">规则配置</h2>
          <p className="text-sm text-slate-500 mt-1">配置损耗判定规则，支持版本管理、导入导出和生效切换</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportRules()}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-md text-sm hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-4 h-4" />
            导出 JSON
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-md text-sm hover:bg-slate-50 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            导入 JSON
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
                  <button
                    onClick={() => activateRule(r.id)}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
                  >
                    启用此版本
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] overflow-auto scrollbar-thin">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
              <h3 className="font-semibold text-slate-800">新建规则版本</h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ×
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
                    onChange={(e) =>
                      setForm({ ...form, over_prep_threshold_pct: Number(e.target.value) })
                    }
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">备餐过量阈值 (g)</label>
                  <input
                    type="number"
                    value={form.over_prep_threshold_abs}
                    onChange={(e) =>
                      setForm({ ...form, over_prep_threshold_abs: Number(e.target.value) })
                    }
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">温度下限 (℃)</label>
                  <input
                    type="number"
                    value={form.spoilage_temp_min}
                    onChange={(e) =>
                      setForm({ ...form, spoilage_temp_min: Number(e.target.value) })
                    }
                    min={0}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">温度上限 (℃)</label>
                  <input
                    type="number"
                    value={form.spoilage_temp_max}
                    onChange={(e) =>
                      setForm({ ...form, spoilage_temp_max: Number(e.target.value) })
                    }
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
              <button
                onClick={closeImport}
                className="text-slate-400 hover:text-slate-600"
              >
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
                      <div className="px-3 py-4 text-center text-xs text-slate-400">
                        未发现问题
                      </div>
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
    </div>
  );
}
