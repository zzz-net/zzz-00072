import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Thermometer,
  Scale,
  CheckCircle,
  RotateCcw,
  Filter,
  AlertCircle,
  Clock,
  FileText,
} from 'lucide-react';
import { useAppStore } from '@/stores';
import type { Anomaly, AnomalyStatus, ManualResult, AnomalyType } from '@shared/types';

export default function ReviewList() {
  const { id } = useParams<{ id: string }>();
  const {
    batches,
    anomalies,
    anomalyDetail,
    fetchAnomalies,
    fetchAnomalyDetail,
    resolveAnomaly,
    reopenAnomaly,
    fetchBatches,
  } = useAppStore();

  const [statusFilter, setStatusFilter] = useState<AnomalyStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveResult, setResolveResult] = useState<ManualResult>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [overrideType, setOverrideType] = useState<AnomalyType | ''>('');

  const batch = batches.find((b) => b.id === id);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    if (id) {
      fetchAnomalies(
        id,
        statusFilter === 'all' ? undefined : statusFilter,
        typeFilter === 'all' ? undefined : typeFilter
      );
    }
  }, [id, statusFilter, typeFilter, fetchAnomalies]);

  useEffect(() => {
    if (anomalyDetail) {
      setResolveReason(anomalyDetail.manual_reason || '');
      setResolveResult(anomalyDetail.manual_result);
      setReopenReason('');
      setOverrideType('');
    }
  }, [anomalyDetail]);

  const handleSelectAnomaly = (a: Anomaly) => {
    fetchAnomalyDetail(a.id);
  };

  const handleResolve = async () => {
    if (!anomalyDetail || !resolveReason || !resolveResult) return;
    await resolveAnomaly(
      anomalyDetail.id,
      resolveReason,
      resolveResult,
      overrideType ? overrideType : undefined
    );
    setResolveReason('');
    setResolveResult(null);
    setOverrideType('');
  };

  const handleReopen = async () => {
    if (!anomalyDetail) return;
    await reopenAnomaly(anomalyDetail.id, reopenReason || undefined);
  };

  const anomalyTypeBadge = (t: string) => {
    if (t === 'over_prep')
      return { label: '备餐过量', color: 'bg-red-100 text-red-700', icon: Scale };
    return { label: '变质怀疑', color: 'bg-amber-100 text-amber-700', icon: Thermometer };
  };

  const currentDetail = anomalyDetail;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/batches"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary-600"
          >
            <ArrowLeft className="w-4 h-4" />
            返回批次列表
          </Link>
          <div className="h-4 w-px bg-slate-300" />
          <div>
            <h2 className="text-lg font-bold text-slate-800">{batch?.name || '异常复核'}</h2>
            <p className="text-xs text-slate-500">
              共 {batch?.anomaly_count ?? 0} 条异常，未结 {batch?.unresolved_count ?? 0} 条
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
        <Filter className="w-4 h-4 text-slate-500" />
        <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
          {(['all', 'unresolved', 'resolved'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                statusFilter === s
                  ? 'bg-white text-primary-700 shadow-sm font-medium'
                  : 'text-slate-600'
              }`}
            >
              {s === 'all' ? '全部' : s === 'unresolved' ? '未结' : '已关闭'}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-slate-200" />
        <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
          {(['all', 'over_prep', 'spoilage_suspect'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                typeFilter === t
                  ? 'bg-white text-primary-700 shadow-sm font-medium'
                  : 'text-slate-600'
              }`}
            >
              {t === 'all' ? '全部类型' : t === 'over_prep' ? '备餐过量' : '变质怀疑'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 min-h-[600px]">
        <div className="col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-medium text-slate-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary-600" />
            异常列表
          </div>
          <div className="flex-1 overflow-auto scrollbar-thin">
            {anomalies.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">暂无符合条件的异常</div>
            ) : (
              anomalies.map((a) => {
                const tb = anomalyTypeBadge(a.anomaly_type);
                const active = currentDetail?.id === a.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => handleSelectAnomaly(a)}
                    className={`px-4 py-3 border-l-4 cursor-pointer transition-all ${
                      active
                        ? 'border-primary-600 bg-primary-50/60'
                        : 'border-transparent hover:bg-slate-50'
                    } border-b border-slate-100`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <tb.icon
                            className={`w-4 h-4 ${
                              a.status === 'unresolved' ? 'text-red-500' : 'text-emerald-500'
                            }`}
                          />
                          <span className="text-xs font-medium text-slate-800">
                            {tb.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          {a.evidence ? (() => {
                            try {
                              const ev = JSON.parse(a.evidence);
                              return ev.formula || a.evidence;
                            } catch {
                              return a.evidence;
                            }
                          })() : '命中规则'}
                        </p>
                      </div>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${tb.color}`}>
                        {tb.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          a.status === 'unresolved' ? 'text-amber-600' : 'text-emerald-600'
                        }`}
                      >
                        {a.status === 'unresolved' ? (
                          <>
                            <Clock className="w-3 h-3" />
                            未结
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            已关闭
                          </>
                        )}
                      </span>
                      <span className="truncate">
                        {a.manual_result === 'normal'
                          ? '判定正常'
                          : a.manual_result === 'confirmed'
                          ? '确认异常'
                          : '待人工判定'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          {!currentDetail ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">选择左侧异常查看详情</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">异常详情</h3>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                    currentDetail.status === 'unresolved'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {currentDetail.status === 'unresolved' ? (
                    <>
                      <Clock className="w-3 h-3" />
                      未结
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-3 h-3" />
                      已关闭
                    </>
                  )}
                </span>
              </div>
              <div className="flex-1 overflow-auto scrollbar-thin p-5 space-y-5">
                <section>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    原始称重数据
                  </h4>
                  <div className="bg-slate-50 rounded p-3 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                    <div>
                      <div className="text-xs text-slate-500">菜品</div>
                      <div className="font-medium text-slate-800">
                        {currentDetail.record.dish_name}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">称重时间</div>
                      <div className="font-medium text-slate-800">
                        {new Date(currentDetail.record.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">计划重量</div>
                      <div className="font-medium text-slate-800">
                        {currentDetail.record.planned_weight} g
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">实际重量</div>
                      <div
                        className={`font-medium ${
                          currentDetail.anomaly_type === 'over_prep'
                            ? 'text-red-600'
                            : 'text-slate-800'
                        }`}
                      >
                        {currentDetail.record.actual_weight} g
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">温度</div>
                      <div
                        className={`font-medium ${
                          currentDetail.anomaly_type === 'spoilage_suspect'
                            ? 'text-amber-600'
                            : 'text-slate-800'
                        }`}
                      >
                        {currentDetail.record.temperature ?? '—'} ℃
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">记录状态</div>
                      <div className="font-medium text-slate-800">
                        {currentDetail.record.is_valid ? '有效' : '无效'}
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    规则命中证据
                  </h4>
                  <div className="bg-red-50 rounded p-3 border border-red-100">
                    <div className="text-sm text-red-700 font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {currentDetail.anomaly_type === 'over_prep' ? '备餐过量' : '变质怀疑'}
                    </div>
                    <div className="mt-2 text-xs text-slate-600 bg-white/70 rounded p-2 font-mono break-all">
                      {(() => {
                        try {
                          const ev = JSON.parse(currentDetail.evidence as unknown as string);
                          return ev.formula || currentDetail.evidence;
                        } catch {
                          return currentDetail.evidence;
                        }
                      })()}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                      <span>命中规则版本：{currentDetail.rule.version}</span>
                      <span>规则ID：{currentDetail.rule.id}</span>
                    </div>
                  </div>
                </section>

                {currentDetail.status === 'unresolved' ? (
                  <section>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      人工复核判定
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm text-slate-600">判定结果</label>
                        <div className="mt-1 flex gap-2">
                          <button
                            onClick={() => setResolveResult('normal')}
                            className={`flex-1 py-2 rounded border text-sm transition-colors ${
                              resolveResult === 'normal'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            判定正常（误报）
                          </button>
                          <button
                            onClick={() => setResolveResult('confirmed')}
                            className={`flex-1 py-2 rounded border text-sm transition-colors ${
                              resolveResult === 'confirmed'
                                ? 'bg-red-600 text-white border-red-600'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            确认异常
                          </button>
                        </div>
                      </div>
                      {resolveResult === 'confirmed' && (
                        <div>
                          <label className="text-sm text-slate-600">
                            修正异常类型（可选，留空则保留系统识别结果）
                          </label>
                          <div className="mt-1 flex gap-2">
                            {(['over_prep', 'spoilage_suspect'] as const).map((t) => {
                              const label =
                                t === 'over_prep' ? '备餐过量' : '变质怀疑';
                              const original = currentDetail?.anomaly_type === t;
                              const selected = overrideType
                                ? overrideType === t
                                : original;
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() =>
                                    setOverrideType(
                                      original ? '' : (t as AnomalyType)
                                    )
                                  }
                                  className={`flex-1 py-2 rounded border text-sm transition-colors ${
                                    selected
                                      ? t === 'over_prep'
                                        ? 'bg-red-100 border-red-400 text-red-700 font-medium'
                                        : 'bg-amber-100 border-amber-400 text-amber-700 font-medium'
                                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {label}
                                  {original && (
                                    <span className="ml-1 text-[10px] opacity-70">
                                      （原判定）
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="text-sm text-slate-600">复核原因（必填）</label>
                        <textarea
                          value={resolveReason}
                          onChange={(e) => setResolveReason(e.target.value)}
                          rows={3}
                          placeholder="请填写复核原因"
                          className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <button
                        onClick={handleResolve}
                        disabled={!resolveReason || !resolveResult}
                        className="w-full py-2 bg-primary-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600"
                      >
                        提交复核并关闭
                      </button>
                    </div>
                  </section>
                ) : (
                  <section>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      已关闭 - 复核信息
                    </h4>
                    <div className="bg-emerald-50 rounded p-3 border border-emerald-100 space-y-2">
                      <div className="text-sm text-slate-700 flex justify-between">
                        <span className="text-slate-500">判定结果</span>
                        <span
                          className={`font-medium ${
                            currentDetail.manual_result === 'normal'
                              ? 'text-emerald-600'
                              : 'text-red-600'
                          }`}
                        >
                          {currentDetail.manual_result === 'normal'
                            ? '判定正常（误报）'
                            : '确认异常'}
                        </span>
                      </div>
                      <div className="text-sm text-slate-700">
                        <span className="text-slate-500">复核原因：</span>
                        {currentDetail.manual_reason}
                      </div>
                      <div className="text-xs text-slate-500 text-right">
                        关闭时间：
                        {currentDetail.resolved_at &&
                          new Date(currentDetail.resolved_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="text-sm text-slate-600">撤销原因（可选）</label>
                      <textarea
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        rows={2}
                        placeholder="填写撤销原因"
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button
                        onClick={handleReopen}
                        className="mt-2 w-full py-2 bg-amber-500 text-white rounded text-sm hover:bg-amber-600 inline-flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                        撤销关闭，恢复未结
                      </button>
                    </div>
                  </section>
                )}

                {currentDetail.history.length > 0 && (
                  <section>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      复核历史
                    </h4>
                    <div className="space-y-2">
                      {currentDetail.history.map((h) => (
                        <div key={h.id} className="flex items-start gap-3 text-xs">
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 ${
                              h.action === 'resolve' ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          <div className="flex-1">
                            <div className="text-slate-700">
                              {h.action === 'resolve' ? '关闭异常' : '撤销关闭'}
                              {h.result && (
                                <span className="text-slate-500">
                                  {' '}
                                  · 判定为{h.result === 'normal' ? '正常' : '异常'}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-400 mt-0.5">
                              {h.reason} · {new Date(h.timestamp).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    原始CSV行（留存证据）
                  </h4>
                  <div className="bg-slate-900 rounded p-2 text-[11px] text-slate-300 font-mono break-all">
                    {currentDetail.record.raw_line}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
