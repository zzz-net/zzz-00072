import { useEffect, useState, useMemo } from 'react';
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
  CheckSquare,
  Square,
  XCircle,
  Info,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  SlidersHorizontal,
  Eye,
  ListChecks,
  Layers,
} from 'lucide-react';
import { useAppStore } from '@/stores';
import type {
  Anomaly,
  AnomalyStatus,
  ManualResult,
  AnomalyType,
  BatchFilterCriteria,
} from '@shared/types';

export default function ReviewList() {
  const { id } = useParams<{ id: string }>();
  const {
    batches,
    anomalies,
    anomalyDetail,
    selectedAnomalyIds,
    batchOperationResult,
    batchPreview,
    fetchAnomalies,
    fetchAnomalyDetail,
    resolveAnomaly,
    reopenAnomaly,
    fetchBatches,
    selectBatch,
    toggleAnomalySelection,
    selectAllAnomalies,
    clearAnomalySelection,
    batchResolveAnomalies,
    batchReopenAnomalies,
    batchPreviewAnomalies,
    clearBatchPreview,
    setBatchOperationResult,
    fetchBatchOperations,
  } = useAppStore();

  const [statusFilter, setStatusFilter] = useState<AnomalyStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveResult, setResolveResult] = useState<ManualResult>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [overrideType, setOverrideType] = useState<AnomalyType | ''>('');
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showBatchReopenModal, setShowBatchReopenModal] = useState(false);
  const [batchResolveResult, setBatchResolveResult] = useState<ManualResult>(null);
  const [batchReason, setBatchReason] = useState('');
  const [batchReopenReason, setBatchReopenReason] = useState('');
  const [showBatchResult, setShowBatchResult] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [recordTimeStart, setRecordTimeStart] = useState('');
  const [recordTimeEnd, setRecordTimeEnd] = useState('');
  const [createdTimeStart, setCreatedTimeStart] = useState('');
  const [createdTimeEnd, setCreatedTimeEnd] = useState('');
  const [dishKeyword, setDishKeyword] = useState('');

  const batch = batches.find((b) => b.id === id);

  const selectedUnresolvedCount = useMemo(() => {
    return anomalies.filter(
      (a) => a.status === 'unresolved' && selectedAnomalyIds.has(a.id)
    ).length;
  }, [anomalies, selectedAnomalyIds]);

  const selectedResolvedCount = useMemo(() => {
    return anomalies.filter(
      (a) => a.status === 'resolved' && selectedAnomalyIds.has(a.id)
    ).length;
  }, [anomalies, selectedAnomalyIds]);

  const buildFilter = (): BatchFilterCriteria => {
    const f: BatchFilterCriteria = {};
    if (id) f.batch_ids = [id];
    if (statusFilter !== 'all') f.status = statusFilter;
    if (typeFilter !== 'all') f.anomaly_types = [typeFilter as AnomalyType];
    if (recordTimeStart) f.time_start = recordTimeStart;
    if (recordTimeEnd) f.time_end = recordTimeEnd + 'T23:59:59';
    if (createdTimeStart) f.created_start = createdTimeStart;
    if (createdTimeEnd) f.created_end = createdTimeEnd + 'T23:59:59';
    if (dishKeyword.trim()) f.dish_name_keyword = dishKeyword.trim();
    return f;
  };

  const handleSelectAll = () => {
    selectAllAnomalies(statusFilter === 'all' ? undefined : statusFilter);
  };

  const openBatchResolveModal = (result: ManualResult) => {
    setBatchResolveResult(result);
    setBatchReason('');
    setShowBatchModal(true);
  };

  const openBatchReopenModal = () => {
    setBatchReopenReason('');
    setShowBatchReopenModal(true);
  };

  const refreshAllAfterBatch = async () => {
    await Promise.all([
      fetchAnomalies(
        id,
        statusFilter === 'all' ? undefined : statusFilter,
        typeFilter === 'all' ? undefined : typeFilter
      ),
      anomalyDetail ? fetchAnomalyDetail(anomalyDetail.id) : Promise.resolve(),
      fetchBatches(),
      fetchBatchOperations(),
    ]);
  };

  const handleBatchResolve = async () => {
    if (!batchResolveResult || !batchReason) return;
    const ids = Array.from(selectedAnomalyIds).filter((aid) =>
      anomalies.some((a) => a.id === aid && a.status === 'unresolved')
    );
    if (ids.length === 0) return;

    const filter = buildFilter();
    const r = await batchResolveAnomalies(ids, batchReason, batchResolveResult, undefined, filter);
    if (r.result) {
      setShowBatchModal(false);
      setShowBatchResult(true);
      await refreshAllAfterBatch();
    }
  };

  const handleBatchReopen = async () => {
    const ids = Array.from(selectedAnomalyIds).filter((aid) =>
      anomalies.some((a) => a.id === aid && a.status === 'resolved')
    );
    if (ids.length === 0) return;

    const reason = batchReopenReason || undefined;
    const filter = buildFilter();
    const r = await batchReopenAnomalies(ids, reason, filter);
    if (r.result) {
      setShowBatchReopenModal(false);
      setShowBatchResult(true);
      await refreshAllAfterBatch();
    }
  };

  const handlePreviewSelection = async () => {
    if (selectedAnomalyIds.size === 0) return;
    setPreviewLoading(true);
    const filter = buildFilter();
    const ids = Array.from(selectedAnomalyIds);
    await batchPreviewAnomalies(filter, ids);
    setPreviewLoading(false);
    setShowPreviewModal(true);
  };

  const handlePreviewFilter = async () => {
    setPreviewLoading(true);
    const filter = buildFilter();
    await batchPreviewAnomalies(filter);
    setPreviewLoading(false);
    setShowPreviewModal(true);
  };

  useEffect(() => {
    fetchBatches();
    fetchBatchOperations();
  }, [fetchBatches, fetchBatchOperations]);

  useEffect(() => {
    if (id) {
      selectBatch(id);
      fetchAnomalies(
        id,
        statusFilter === 'all' ? undefined : statusFilter,
        typeFilter === 'all' ? undefined : typeFilter
      );
    }
  }, [id, statusFilter, typeFilter, selectBatch, fetchAnomalies]);

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
    const r = await resolveAnomaly(
      anomalyDetail.id,
      resolveReason,
      resolveResult,
      overrideType ? overrideType : undefined
    );
    if (!r.error) {
      await refreshAllAfterBatch();
    }
    setResolveReason('');
    setResolveResult(null);
    setOverrideType('');
  };

  const handleReopen = async () => {
    if (!anomalyDetail) return;
    const r = await reopenAnomaly(anomalyDetail.id, reopenReason || undefined);
    if (!r.error) {
      await refreshAllAfterBatch();
    }
    setReopenReason('');
  };

  const anomalyTypeBadge = (t: string) => {
    if (t === 'over_prep')
      return { label: '备餐过量', color: 'bg-red-100 text-red-700', icon: Scale };
    return { label: '变质怀疑', color: 'bg-amber-100 text-amber-700', icon: Thermometer };
  };

  const skipReasonBadge = (code?: string) => {
    const map: Record<string, { color: string; label: string }> = {
      not_found: { color: 'bg-slate-100 text-slate-600', label: '记录不存在' },
      already_resolved: { color: 'bg-emerald-100 text-emerald-700', label: '已关闭' },
      already_unresolved: { color: 'bg-amber-100 text-amber-700', label: '已未结' },
      status_changed_by_other: { color: 'bg-orange-100 text-orange-700', label: '状态变更' },
      reopened_after_batch: { color: 'bg-blue-100 text-blue-700', label: '已撤销' },
      modified_individually: { color: 'bg-purple-100 text-purple-700', label: '单条处理' },
      batch_mismatch: { color: 'bg-pink-100 text-pink-700', label: '筛选不符' },
    };
    return map[code || ''] || { color: 'bg-slate-100 text-slate-600', label: '未知' };
  };

  const currentDetail = anomalyDetail;
  const hasAdvancedFilters = !!recordTimeStart || !!recordTimeEnd || !!createdTimeStart || !!createdTimeEnd || !!dishKeyword.trim();

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

      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
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
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={dishKeyword}
                onChange={(e) => setDishKeyword(e.target.value)}
                placeholder="搜索菜品名称..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
          <button
            onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors ${
              showAdvancedFilter || hasAdvancedFilters
                ? 'bg-primary-50 text-primary-700 border border-primary-200 font-medium'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            高级筛选
            {hasAdvancedFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary-500 ml-0.5" />
            )}
            {showAdvancedFilter ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={handlePreviewFilter}
            disabled={previewLoading}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 text-slate-700 rounded text-xs hover:bg-slate-200 disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" />
            {previewLoading ? '加载中...' : '预览筛选结果'}
          </button>
        </div>

        {showAdvancedFilter && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                称重时间范围
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={recordTimeStart}
                  onChange={(e) => setRecordTimeStart(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-xs text-slate-400">至</span>
                <input
                  type="date"
                  value={recordTimeEnd}
                  onChange={(e) => setRecordTimeEnd(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                异常创建时间范围
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={createdTimeStart}
                  onChange={(e) => setCreatedTimeStart(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-xs text-slate-400">至</span>
                <input
                  type="date"
                  value={createdTimeEnd}
                  onChange={(e) => setCreatedTimeEnd(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            {(recordTimeStart || recordTimeEnd || createdTimeStart || createdTimeEnd || dishKeyword.trim()) && (
              <div className="md:col-span-2 flex justify-end">
                <button
                  onClick={() => {
                    setRecordTimeStart('');
                    setRecordTimeEnd('');
                    setCreatedTimeStart('');
                    setCreatedTimeEnd('');
                    setDishKeyword('');
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1 hover:bg-slate-100 rounded"
                >
                  清空高级筛选条件
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedAnomalyIds.size > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckSquare className="w-4 h-4 text-primary-600" />
            <span className="text-sm text-slate-700">
              已选中 <strong>{selectedAnomalyIds.size}</strong> 条
              {selectedUnresolvedCount > 0 && (
                <span className="ml-2 text-amber-600">
                  （未结 {selectedUnresolvedCount} 条）
                </span>
              )}
              {selectedResolvedCount > 0 && (
                <span className="ml-2 text-emerald-600">
                  （已关闭 {selectedResolvedCount} 条）
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePreviewSelection}
              disabled={previewLoading}
              className="px-3 py-1.5 bg-white border border-primary-200 text-primary-700 rounded text-xs hover:bg-primary-50 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              预览选中项
            </button>
            {selectedUnresolvedCount > 0 && (
              <>
                <button
                  onClick={() => openBatchResolveModal('normal')}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 inline-flex items-center gap-1"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  批量判定正常（误报）
                </button>
                <button
                  onClick={() => openBatchResolveModal('confirmed')}
                  className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 inline-flex items-center gap-1"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  批量确认异常
                </button>
              </>
            )}
            {selectedResolvedCount > 0 && (
              <button
                onClick={openBatchReopenModal}
                className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600 inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                批量撤销关闭
              </button>
            )}
            <button
              onClick={clearAnomalySelection}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded text-xs hover:bg-slate-300"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4 min-h-[600px]">
        <div className="col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-medium text-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-primary-600" />
              异常列表
              {anomalies.length > 0 && (
                <span className="text-xs font-normal text-slate-400">
                  共 {anomalies.length} 条
                </span>
              )}
            </div>
            <button
              onClick={handleSelectAll}
              className="text-xs text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
            >
              {selectedAnomalyIds.size === anomalies.length && anomalies.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              全选当前筛选
            </button>
          </div>
          <div className="flex-1 overflow-auto scrollbar-thin">
            {anomalies.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">暂无符合条件的异常</div>
            ) : (
              anomalies.map((a) => {
                const tb = anomalyTypeBadge(a.anomaly_type);
                const active = currentDetail?.id === a.id;
                const selected = selectedAnomalyIds.has(a.id);
                return (
                  <div
                    key={a.id}
                    onClick={() => handleSelectAnomaly(a)}
                    className={`px-4 py-3 border-l-4 cursor-pointer transition-all ${
                      active
                        ? 'border-primary-600 bg-primary-50/60'
                        : selected
                        ? 'border-primary-300 bg-primary-50/30'
                        : 'border-transparent hover:bg-slate-50'
                    } border-b border-slate-100`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAnomalySelection(a.id);
                          }}
                          className="mt-0.5 flex-shrink-0"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-primary-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
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
                      </div>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${tb.color}`}>
                        {tb.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
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
                              {h.batch_operation_id && (
                                <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                  批量操作
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

      {showPreviewModal && batchPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary-600" />
                批量处理预览
              </h3>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  clearBatchPreview();
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-2xl font-bold text-slate-700">
                    {batchPreview.matched_count}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">匹配总数</div>
                </div>
                <div className="bg-amber-50 rounded p-3">
                  <div className="text-2xl font-bold text-amber-600">
                    {batchPreview.estimated_unresolved_actionable}
                  </div>
                  <div className="text-xs text-amber-700 mt-1">未结可处理</div>
                </div>
                <div className="bg-emerald-50 rounded p-3">
                  <div className="text-2xl font-bold text-emerald-600">
                    {batchPreview.estimated_resolved_actionable}
                  </div>
                  <div className="text-xs text-emerald-700 mt-1">已关可撤销</div>
                </div>
              </div>

              {batchPreview.by_batch.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    按批次分布
                  </h4>
                  <div className="space-y-1">
                    {batchPreview.by_batch.map((b) => (
                      <div key={b.batch_id} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-xs">
                        <span className="text-slate-700 font-medium">{b.batch_name}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-slate-500">共 {b.count}</span>
                          <span className="text-amber-600">未结 {b.unresolved_count}</span>
                          <span className="text-emerald-600">已关 {b.resolved_count}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {batchPreview.by_type.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                      <ListChecks className="w-3.5 h-3.5" />
                      按异常类型
                    </h4>
                    <div className="space-y-1">
                      {batchPreview.by_type.map((t) => (
                        <div key={t.type} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-xs">
                          <span className="text-slate-700">{t.label}</span>
                          <span className="text-slate-500 font-medium">{t.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {batchPreview.by_status.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      按处理状态
                    </h4>
                    <div className="space-y-1">
                      {batchPreview.by_status.map((s) => (
                        <div key={s.status} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-xs">
                          <span className="text-slate-700">{s.label}</span>
                          <span className={`font-medium ${s.status === 'unresolved' ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {s.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {batchPreview.samples.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">
                    样例记录（最多展示 20 条）
                  </h4>
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">菜品</th>
                          <th className="px-3 py-2 text-left font-medium">类型</th>
                          <th className="px-3 py-2 text-left font-medium">状态</th>
                          <th className="px-3 py-2 text-left font-medium">称重时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {batchPreview.samples.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">{s.dish_name}</td>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                s.anomaly_type === 'over_prep' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {s.anomaly_type === 'over_prep' ? '备餐过量' : '变质怀疑'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={s.status === 'unresolved' ? 'text-amber-600' : 'text-emerald-600'}>
                                {s.status === 'unresolved' ? '未结' : '已关闭'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {new Date(s.record_time).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  clearBatchPreview();
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">
                批量{batchResolveResult === 'normal' ? '判定正常（误报）' : '确认异常'}
              </h3>
              <button
                onClick={() => setShowBatchModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 rounded p-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary-600" />
                  即将批量处理 <strong>{selectedUnresolvedCount}</strong> 条未结异常
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  已关闭状态的异常将被自动跳过，每条记录会进行状态检查
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-600">复核原因（必填）</label>
                <textarea
                  value={batchReason}
                  onChange={(e) => setBatchReason(e.target.value)}
                  rows={4}
                  placeholder="请填写统一的复核原因，将应用于所有选中的异常"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBatchModal(false)}
                  className="flex-1 py-2 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchResolve}
                  disabled={!batchReason.trim()}
                  className={`flex-1 py-2 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                    batchResolveResult === 'normal'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  确认批量提交
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBatchReopenModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">批量撤销关闭</h3>
              <button
                onClick={() => setShowBatchReopenModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 rounded p-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600" />
                  即将批量恢复 <strong>{selectedResolvedCount}</strong> 条已关闭异常为未结状态
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  未结状态的异常将被自动跳过
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-600">撤销原因（可选）</label>
                <textarea
                  value={batchReopenReason}
                  onChange={(e) => setBatchReopenReason(e.target.value)}
                  rows={4}
                  placeholder="请填写撤销原因（可选），将应用于所有选中的异常"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBatchReopenModal(false)}
                  className="flex-1 py-2 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchReopen}
                  className="flex-1 py-2 bg-amber-600 text-white rounded text-sm hover:bg-amber-700"
                >
                  确认批量撤销
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBatchResult && batchOperationResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary-600" />
                批量操作结果
                <span className={`text-xs px-2 py-0.5 rounded ${
                  batchOperationResult.action === 'resolve'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {batchOperationResult.action === 'resolve' ? '批量关闭' : '批量撤销'}
                </span>
              </h3>
              <button
                onClick={() => {
                  setShowBatchResult(false);
                  setBatchOperationResult(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-2xl font-bold text-slate-700">
                    {batchOperationResult.total_submitted}
                  </div>
                  <div className="text-xs text-slate-500">提交总数</div>
                </div>
                <div className="bg-emerald-50 rounded p-3">
                  <div className="text-2xl font-bold text-emerald-600">
                    {batchOperationResult.success.length}
                  </div>
                  <div className="text-xs text-emerald-700">成功</div>
                </div>
                <div className="bg-amber-50 rounded p-3">
                  <div className="text-2xl font-bold text-amber-600">
                    {batchOperationResult.skipped.length}
                  </div>
                  <div className="text-xs text-amber-700">跳过</div>
                </div>
                <div className="bg-red-50 rounded p-3">
                  <div className="text-2xl font-bold text-red-600">
                    {batchOperationResult.failed.length}
                  </div>
                  <div className="text-xs text-red-700">失败</div>
                </div>
              </div>

              <div className="bg-slate-50 rounded p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">批次操作ID</span>
                  <span className="font-mono text-slate-700">{batchOperationResult.batch_operation_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">操作时间</span>
                  <span className="text-slate-700">{new Date(batchOperationResult.timestamp).toLocaleString()}</span>
                </div>
                {batchOperationResult.applied_reason && (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500 flex-shrink-0">统一原因</span>
                    <span className="text-slate-700 text-right">{batchOperationResult.applied_reason}</span>
                  </div>
                )}
              </div>

              {batchOperationResult.success.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-emerald-700 mb-2">
                    成功处理（{batchOperationResult.success.length} 条）
                  </h4>
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-2 space-y-1 max-h-36 overflow-auto">
                    {batchOperationResult.success.slice(0, 20).map((item) => (
                      <div key={item.id} className="text-xs text-emerald-800 flex justify-between items-center">
                        <div>
                          <span className="font-mono opacity-70 mr-2">{item.id.slice(-8)}</span>
                          {item.dish_name || ''}
                        </div>
                        <CheckCircle className="w-3 h-3" />
                      </div>
                    ))}
                    {batchOperationResult.success.length > 20 && (
                      <div className="text-xs text-emerald-600 text-center pt-1 border-t border-emerald-100">
                        ...还有 {batchOperationResult.success.length - 20} 条
                      </div>
                    )}
                  </div>
                </div>
              )}

              {batchOperationResult.skipped.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-700 mb-2">
                    跳过的异常（{batchOperationResult.skipped.length} 条）
                  </h4>
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1.5 max-h-56 overflow-auto">
                    {batchOperationResult.skipped.map((item) => (
                      <div key={item.id} className="text-xs flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-amber-700">{item.id.slice(-12)}</span>
                            {item.dish_name && (
                              <span className="text-amber-800 truncate">{item.dish_name}</span>
                            )}
                            {item.skip_reason && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${skipReasonBadge(item.skip_reason).color}`}>
                                {skipReasonBadge(item.skip_reason).label}
                              </span>
                            )}
                          </div>
                          <div className="text-amber-600 mt-0.5 pl-1">{item.error}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {batchOperationResult.failed.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-red-700 mb-2">
                    失败的异常（{batchOperationResult.failed.length} 条）
                  </h4>
                  <div className="bg-red-50 border border-red-200 rounded p-2 space-y-1 max-h-36 overflow-auto">
                    {batchOperationResult.failed.map((item) => (
                      <div key={item.id} className="text-xs text-red-800 flex justify-between">
                        <span className="font-mono">{item.id.slice(-12)}</span>
                        <span>{item.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowBatchResult(false);
                  setBatchOperationResult(null);
                }}
                className="w-full py-2 bg-primary-700 text-white rounded text-sm hover:bg-primary-600"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
