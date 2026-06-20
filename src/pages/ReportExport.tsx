import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  ListChecks,
  History as HistoryIcon,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { useAppStore } from '@/stores';

export default function ReportExport() {
  const { batches, fetchBatches, consistency, checkConsistency } = useAppStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandConsistency, setExpandConsistency] = useState(false);

  useEffect(() => {
    fetchBatches();
    checkConsistency();
  }, [fetchBatches, checkConsistency]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === batches.length) setSelectedIds([]);
    else setSelectedIds(batches.map((b) => b.id));
  };

  const doDownload = (type: 'summary' | 'detail' | 'history') => {
    if (type !== 'history' && selectedIds.length === 0) return;
    const q =
      type === 'history'
        ? ''
        : `?batch_ids=${encodeURIComponent(selectedIds.join(','))}`;
    window.open(`/api/export/${type}${q}`, '_blank');
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">报表导出</h2>
          <p className="text-sm text-slate-500 mt-1">
            选择批次导出汇总或明细报表，CSV 格式支持 Excel 打开
          </p>
        </div>
        <button
          onClick={checkConsistency}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700 hover:bg-slate-50 shadow-sm"
        >
          <ShieldCheck className="w-4 h-4" />
          数据一致性校验
        </button>
      </div>

      {consistency && (
        <div
          className={`rounded-lg border p-4 ${
            consistency.ok
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setExpandConsistency(!expandConsistency)}
          >
            <div className="flex items-center gap-2">
              {consistency.ok ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <span
                className={`font-medium text-sm ${
                  consistency.ok ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {consistency.ok
                  ? '数据一致性校验通过'
                  : `发现 ${consistency.issues.length} 个不一致问题`}
              </span>
            </div>
            {expandConsistency ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </div>
          {expandConsistency && !consistency.ok && (
            <ul className="mt-3 pl-7 list-disc space-y-1">
              {consistency.issues.map((issue, i) => (
                <li key={i} className="text-sm text-red-700">
                  {issue}
                </li>
              ))}
            </ul>
          )}
          {expandConsistency && (
            <div className="mt-2 text-xs text-slate-500 pl-7">
              批次：{(consistency.stats as { batch_count: number }).batch_count} 个 · 生效规则：
              {(consistency.stats as { active_rules: number }).active_rules} 个
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-medium text-slate-700">选择要导出的批次</h3>
            <button
              onClick={toggleAll}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              {selectedIds.length === batches.length ? '取消全选' : '全选'}
            </button>
          </div>
          <div className="max-h-[400px] overflow-auto scrollbar-thin">
            {batches.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">暂无批次数据</div>
            ) : (
              batches.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 cursor-pointer border-b last:border-b-0 border-slate-100"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(b.id)}
                    onChange={() => toggleSelect(b.id)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-800">{b.name}</div>
                    <div className="text-xs text-slate-500">
                      {b.import_date} · 共 {b.total_records} 条记录 · {b.anomaly_count} 条异常（未结{' '}
                      {b.unresolved_count}）
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="col-span-4 space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 bg-primary-100 rounded flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary-700" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800">汇总报表</h4>
                <p className="text-xs text-slate-500">按批次统计各指标</p>
              </div>
            </div>
            <button
              onClick={() => doDownload('summary')}
              disabled={selectedIds.length === 0}
              className="w-full py-2 bg-primary-700 text-white rounded text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-600"
            >
              <Download className="w-4 h-4" />
              导出汇总 CSV
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 bg-amber-100 rounded flex items-center justify-center">
                <ListChecks className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800">明细报表</h4>
                <p className="text-xs text-slate-500">每条异常的完整信息</p>
              </div>
            </div>
            <button
              onClick={() => doDownload('detail')}
              disabled={selectedIds.length === 0}
              className="w-full py-2 bg-amber-500 text-white rounded text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-600"
            >
              <Download className="w-4 h-4" />
              导出明细 CSV
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 bg-emerald-100 rounded flex items-center justify-center">
                <HistoryIcon className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800">复核历史</h4>
                <p className="text-xs text-slate-500">人工改判的操作审计</p>
              </div>
            </div>
            <button
              onClick={() => doDownload('history')}
              className="w-full py-2 bg-emerald-600 text-white rounded text-sm inline-flex items-center justify-center gap-1.5 hover:bg-emerald-700"
            >
              <Download className="w-4 h-4" />
              导出全部历史 CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
