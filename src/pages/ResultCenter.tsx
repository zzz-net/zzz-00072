import { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  Clock,
  CalendarDays,
  FileText,
  Activity,
  Search,
  Layers,
} from 'lucide-react';
import { useAppStore } from '@/stores';
import type { BatchOperationRecord, BatchResultItem, ResultCenterConfig } from '@shared/types';

const DEFAULT_CONFIG: ResultCenterConfig = {
  action_filter: 'all',
  outcome_filter: 'all',
  time_start: '',
  time_end: '',
};

export default function ResultCenter() {
  const {
    resultCenterList,
    resultCenterDetail,
    resultCenterConfig,
    fetchResultCenterList,
    fetchResultCenterDetail,
    exportResultCenterItem,
    loadResultCenterConfig,
    saveResultCenterConfig,
    operationLogs,
    fetchOperationLogs,
  } = useAppStore();

  const [config, setConfig] = useState<ResultCenterConfig>(resultCenterConfig || DEFAULT_CONFIG);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showOpsLog, setShowOpsLog] = useState(false);
  const [detailTab, setDetailTab] = useState<'items' | 'history'>('items');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'success' | 'skipped' | 'failed'>('all');

  useEffect(() => {
    loadResultCenterConfig();
    fetchOperationLogs(30);
  }, [loadResultCenterConfig, fetchOperationLogs]);

  useEffect(() => {
    if (resultCenterConfig) {
      setConfig(resultCenterConfig);
    }
  }, [resultCenterConfig]);

  useEffect(() => {
    fetchResultCenterList({
      action: config.action_filter,
      outcome: config.outcome_filter,
      time_start: config.time_start,
      time_end: config.time_end,
    });
    saveResultCenterConfig(config);
  }, [config]);

  const handleExpand = async (opId: string) => {
    if (expandedId === opId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(opId);
    setDetailTab('items');
    setOutcomeFilter('all');
    await fetchResultCenterDetail(opId);
  };

  const handleExport = async (opId: string) => {
    await exportResultCenterItem(opId);
  };

  const actionLabel = (a: string) => (a === 'resolve' ? '批量关闭' : '批量撤销');
  const actionColor = (a: string) =>
    a === 'resolve' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
  const resultLabel = (r: string | null) => {
    if (r === 'normal') return '判定正常(误报)';
    if (r === 'confirmed') return '确认异常';
    return '';
  };
  const resultColor = (r: string | null) => {
    if (r === 'normal') return 'bg-emerald-100 text-emerald-700';
    if (r === 'confirmed') return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-600';
  };
  const outcomeLabel = (o: string) => {
    const m: Record<string, string> = { success: '成功', skipped: '跳过', failed: '失败' };
    return m[o] || o;
  };
  const outcomeColor = (o: string) => {
    if (o === 'success') return 'bg-emerald-100 text-emerald-700';
    if (o === 'skipped') return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  };
  const skipReasonLabel = (code: string | null) => {
    const m: Record<string, string> = {
      not_found: '记录不存在',
      already_resolved: '已关闭',
      already_unresolved: '已未结',
      status_changed_by_other: '状态变更',
      reopened_after_batch: '已撤销',
      modified_individually: '单条处理',
      batch_mismatch: '筛选不符',
    };
    return code ? m[code] || code : '';
  };
  const statusLabel = (s: string | null) => {
    if (s === 'unresolved') return '未结';
    if (s === 'resolved') return '已关闭';
    return s || '';
  };

  const filteredItems = useMemo(() => {
    if (!resultCenterDetail?.items) return [];
    if (outcomeFilter === 'all') return resultCenterDetail.items;
    return resultCenterDetail.items.filter((i) => i.outcome === outcomeFilter);
  }, [resultCenterDetail, outcomeFilter]);

  const recentOps = useMemo(() => operationLogs.slice(0, 10), [operationLogs]);

  const totalOps = resultCenterList.length;
  const totalSuccess = resultCenterList.reduce((s, o) => s + o.success_count, 0);
  const totalSkipped = resultCenterList.reduce((s, o) => s + o.skipped_count, 0);
  const totalFailed = resultCenterList.reduce((s, o) => s + o.failed_count, 0);

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">批量处理结果中心</h2>
          <p className="text-sm text-slate-500 mt-1">
            查看每次批量操作的处理结果、受影响数据和处理前后状态对比
          </p>
        </div>
        <button
          onClick={() => setShowOpsLog(!showOpsLog)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm shadow-sm transition-colors ${
            showOpsLog
              ? 'bg-primary-50 text-primary-700 border border-primary-200'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Activity className="w-4 h-4" />
          操作日志
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-slate-700">{totalOps}</div>
          <div className="text-xs text-slate-500 mt-1">批量操作次数</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{totalSuccess}</div>
          <div className="text-xs text-emerald-700 mt-1">累计成功</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{totalSkipped}</div>
          <div className="text-xs text-amber-700 mt-1">累计跳过</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{totalFailed}</div>
          <div className="text-xs text-red-700 mt-1">累计失败</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-slate-500" />
          <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
            {(['all', 'resolve', 'reopen'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setConfig({ ...config, action_filter: a })}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  config.action_filter === a
                    ? 'bg-white text-primary-700 shadow-sm font-medium'
                    : 'text-slate-600'
                }`}
              >
                {a === 'all' ? '全部类型' : a === 'resolve' ? '批量关闭' : '批量撤销'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
            {(['all', 'success', 'skipped', 'failed'] as const).map((o) => (
              <button
                key={o}
                onClick={() => setConfig({ ...config, outcome_filter: o })}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  config.outcome_filter === o
                    ? 'bg-white text-primary-700 shadow-sm font-medium'
                    : 'text-slate-600'
                }`}
              >
                {o === 'all' ? '全部结果' : o === 'success' ? '有成功' : o === 'skipped' ? '有跳过' : '有失败'}
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={config.time_start}
              onChange={(e) => setConfig({ ...config, time_start: e.target.value })}
              className="px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-xs text-slate-400">至</span>
            <input
              type="date"
              value={config.time_end}
              onChange={(e) => setConfig({ ...config, time_end: e.target.value })}
              className="px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {(config.time_start || config.time_end || config.action_filter !== 'all' || config.outcome_filter !== 'all') && (
            <button
              onClick={() => setConfig(DEFAULT_CONFIG)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 hover:bg-slate-100 rounded"
            >
              清空筛选
            </button>
          )}
        </div>
      </div>

      {showOpsLog && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-medium text-slate-700">最近操作日志（交接用）</span>
            </div>
            <button onClick={() => setShowOpsLog(false)} className="text-slate-400 hover:text-slate-600">
              ✕
            </button>
          </div>
          <div className="max-h-48 overflow-auto scrollbar-thin">
            {recentOps.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">暂无操作日志</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentOps.map((op) => (
                  <div key={op.id} className="px-4 py-2 flex items-start gap-3 text-xs">
                    <div
                      className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                        op.action.includes('resolve')
                          ? 'bg-emerald-500'
                          : op.action.includes('reopen')
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">{op.action}</span>
                        {op.target_id && (
                          <span className="font-mono text-[10px] text-slate-400">
                            {op.target_id.slice(-8)}
                          </span>
                        )}
                      </div>
                      {op.detail && (
                        <div className="text-slate-500 mt-0.5 truncate">{op.detail}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(op.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary-600" />
            <span className="text-sm font-medium text-slate-700">批量操作记录</span>
            <span className="text-xs text-slate-400">共 {resultCenterList.length} 条</span>
          </div>
        </div>
        <div className="max-h-[600px] overflow-auto scrollbar-thin">
          {resultCenterList.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              <Layers className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>暂无批量操作记录</p>
              <p className="text-xs mt-1">进行批量处理后，结果将自动留存于此</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {resultCenterList.map((op) => {
                const isExpanded = expandedId === op.id;
                const pct =
                  op.total_submitted > 0
                    ? Math.round((op.success_count / op.total_submitted) * 100)
                    : 0;
                return (
                  <div key={op.id}>
                    <div
                      onClick={() => handleExpand(op.id)}
                      className="px-5 py-3.5 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                              op.action === 'resolve' ? 'bg-blue-500' : 'bg-amber-500'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${actionColor(op.action)}`}
                              >
                                {actionLabel(op.action)}
                              </span>
                              {op.applied_result && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded ${resultColor(
                                    op.applied_result
                                  )}`}
                                >
                                  {resultLabel(op.applied_result)}
                                </span>
                              )}
                              <span className="text-sm font-medium text-slate-800 truncate">
                                {op.applied_reason}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(op.timestamp).toLocaleString()}
                              </span>
                              <span>
                                成功 {op.success_count} / 跳过 {op.skipped_count} / 失败{' '}
                                {op.failed_count}
                              </span>
                              <span>共 {op.total_submitted} 条</span>
                              {op.idempotency_key && (
                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                  幂等保护
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="w-24">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                              <span>成功率</span>
                              <span>{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  pct >= 80
                                    ? 'bg-emerald-500'
                                    : pct >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExport(op.id);
                            }}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                            title="导出此操作结果"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && resultCenterDetail && resultCenterDetail.operation.id === op.id && (
                      <div className="bg-slate-50 border-t border-slate-200 px-5 py-4 space-y-4">
                        <div className="grid grid-cols-4 gap-3 text-center text-xs">
                          <div className="bg-white rounded p-2 border border-slate-200">
                            <div className="text-lg font-bold text-slate-700">
                              {resultCenterDetail.operation.total_submitted}
                            </div>
                            <div className="text-slate-500">提交总数</div>
                          </div>
                          <div className="bg-emerald-50 rounded p-2 border border-emerald-200">
                            <div className="text-lg font-bold text-emerald-600">
                              {resultCenterDetail.operation.success_count}
                            </div>
                            <div className="text-emerald-700">成功</div>
                          </div>
                          <div className="bg-amber-50 rounded p-2 border border-amber-200">
                            <div className="text-lg font-bold text-amber-600">
                              {resultCenterDetail.operation.skipped_count}
                            </div>
                            <div className="text-amber-700">跳过</div>
                          </div>
                          <div className="bg-red-50 rounded p-2 border border-red-200">
                            <div className="text-lg font-bold text-red-600">
                              {resultCenterDetail.operation.failed_count}
                            </div>
                            <div className="text-red-700">失败</div>
                          </div>
                        </div>

                        <div className="bg-white rounded p-3 border border-slate-200 text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-500">操作ID</span>
                            <span className="font-mono text-slate-700">{resultCenterDetail.operation.id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">操作时间</span>
                            <span className="text-slate-700">
                              {new Date(resultCenterDetail.operation.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">统一原因</span>
                            <span className="text-slate-700 text-right max-w-[60%] truncate">
                              {resultCenterDetail.operation.applied_reason}
                            </span>
                          </div>
                          {(resultCenterDetail.operation as BatchOperationRecord & { filter_snapshot_parsed?: unknown }).filter_snapshot_parsed && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-500 flex-shrink-0">筛选条件</span>
                              <span className="text-slate-700 text-right max-w-[60%] font-mono text-[10px] break-all">
                                {JSON.stringify(
                                  (resultCenterDetail.operation as BatchOperationRecord & { filter_snapshot_parsed?: unknown }).filter_snapshot_parsed
                                )}
                              </span>
                            </div>
                          )}
                          {resultCenterDetail.current_unresolved_count > 0 && (
                            <div className="flex justify-between">
                              <span className="text-amber-600 font-medium">已被撤销恢复为未结</span>
                              <span className="text-amber-700 font-bold">
                                {resultCenterDetail.current_unresolved_count} 条
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                          <button
                            onClick={() => setDetailTab('items')}
                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                              detailTab === 'items'
                                ? 'bg-primary-600 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <FileText className="w-3 h-3 inline mr-1" />
                            处理明细
                          </button>
                          <button
                            onClick={() => setDetailTab('history')}
                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                              detailTab === 'history'
                                ? 'bg-primary-600 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Clock className="w-3 h-3 inline mr-1" />
                            复核历史
                          </button>
                          {detailTab === 'items' && (
                            <div className="flex items-center gap-1 ml-auto">
                              {(['all', 'success', 'skipped', 'failed'] as const).map((o) => (
                                <button
                                  key={o}
                                  onClick={() => setOutcomeFilter(o)}
                                  className={`px-2 py-1 text-[10px] rounded transition-colors ${
                                    outcomeFilter === o
                                      ? 'bg-primary-100 text-primary-700 font-medium'
                                      : 'text-slate-500 hover:bg-slate-100'
                                  }`}
                                >
                                  {o === 'all'
                                    ? '全部'
                                    : o === 'success'
                                    ? `成功(${resultCenterDetail.items.filter((i) => i.outcome === 'success').length})`
                                    : o === 'skipped'
                                    ? `跳过(${resultCenterDetail.items.filter((i) => i.outcome === 'skipped').length})`
                                    : `失败(${resultCenterDetail.items.filter((i) => i.outcome === 'failed').length})`}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {detailTab === 'items' && (
                          <div className="max-h-80 overflow-auto scrollbar-thin">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-100 text-slate-600 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">异常ID</th>
                                  <th className="px-3 py-2 text-left font-medium">菜品</th>
                                  <th className="px-3 py-2 text-left font-medium">处理前状态</th>
                                  <th className="px-3 py-2 text-left font-medium">处理前判定</th>
                                  <th className="px-3 py-2 text-left font-medium">处理结果</th>
                                  <th className="px-3 py-2 text-left font-medium">跳过/失败原因</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {filteredItems.map((item) => (
                                  <tr key={item.id} className="hover:bg-white/80">
                                    <td className="px-3 py-2 font-mono text-slate-600">
                                      {item.anomaly_id.slice(-10)}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">
                                      {item.dish_name || '—'}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                                          item.status_before === 'unresolved'
                                            ? 'bg-amber-100 text-amber-700'
                                            : item.status_before === 'resolved'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-slate-100 text-slate-500'
                                        }`}
                                      >
                                        {statusLabel(item.status_before)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">
                                      {item.result_before === 'normal'
                                        ? '正常'
                                        : item.result_before === 'confirmed'
                                        ? '确认异常'
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded ${outcomeColor(
                                          item.outcome
                                        )}`}
                                      >
                                        {outcomeLabel(item.outcome)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                                      {item.outcome === 'skipped' && item.skip_reason && (
                                        <span className="mr-1 text-[10px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">
                                          {skipReasonLabel(item.skip_reason)}
                                        </span>
                                      )}
                                      {item.error_message && (
                                        <span className="truncate">{item.error_message}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {filteredItems.length === 0 && (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                                      暂无匹配记录
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {detailTab === 'history' && (
                          <div className="max-h-80 overflow-auto scrollbar-thin space-y-2">
                            {resultCenterDetail.history.length === 0 ? (
                              <div className="p-4 text-center text-slate-400 text-xs">
                                暂无复核历史
                              </div>
                            ) : (
                              resultCenterDetail.history.map((h) => (
                                <div
                                  key={h.id}
                                  className="bg-white rounded p-3 border border-slate-200 flex items-start gap-3 text-xs"
                                >
                                  <div
                                    className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                                      h.action === 'resolve' ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-slate-700">
                                        {h.action === 'resolve' ? '关闭异常' : '撤销关闭'}
                                      </span>
                                      {h.result && (
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            h.result === 'normal'
                                              ? 'bg-emerald-100 text-emerald-700'
                                              : 'bg-red-100 text-red-700'
                                          }`}
                                        >
                                          {h.result === 'normal' ? '判定正常' : '确认异常'}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-slate-500 mt-0.5 truncate">{h.reason}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                      {new Date(h.timestamp).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
