import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronRight,
  AlertOctagon,
  ClipboardList,
  FileInput,
} from 'lucide-react';
import { useAppStore } from '@/stores';

export default function BatchList() {
  const navigate = useNavigate();
  const { batches, fetchBatches, importSample, importCsv } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importName, setImportName] = useState('');
  const [importDate, setImportDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showModalOpen, setShowModalOpen] = useState(false);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const handleSelectFile = () => fileInputRef.current?.click();

  const handleSubmit = async () => {
    if (!selectedFile) return;
    await importCsv(selectedFile, importName || undefined, importDate);
    setShowModalOpen(false);
    setSelectedFile(null);
    setImportName('');
  };

  const statusBadge = (s: string) => {
    if (s === 'completed')
      return { label: '已完成', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle };
    if (s === 'importing')
      return { label: '导入中', color: 'bg-blue-100 text-blue-700', icon: Clock };
    return { label: '失败', color: 'bg-red-100 text-red-700', icon: AlertOctagon };
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">批次列表</h2>
          <p className="text-sm text-slate-500 mt-1">
            导入称重明细批次，查看异常数量与复核进度
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => importSample()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            导入样例批次
          </button>
          <button
            onClick={() => setShowModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-700 text-white rounded-md text-sm hover:bg-primary-600 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            导入CSV
          </button>
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg p-16 text-center">
          <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileInput className="w-7 h-7 text-primary-600" />
          </div>
          <p className="text-slate-800 font-medium">暂无批次数据</p>
          <p className="text-sm text-slate-500 mt-1">
            点击右上角「导入样例批次」快速体验完整流程
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {batches.map((b) => {
            const st = statusBadge(b.status);
            const resolved = b.anomaly_count - b.unresolved_count;
            const pct =
              b.anomaly_count > 0 ? Math.round((resolved / b.anomaly_count) * 100) : 100;
            return (
              <div
                key={b.id}
                onClick={() => navigate(`/batches/${b.id}`)}
                className="bg-white border border-slate-200 rounded-lg p-5 cursor-pointer hover:shadow-md hover:border-primary-300 transition-all group"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800 group-hover:text-primary-700">
                      {b.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <ClipboardList className="w-3.5 h-3.5" />
                        {b.import_date}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${st.color}`}
                  >
                    <st.icon className="w-3.5 h-3.5" />
                    {st.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-slate-50 rounded p-2">
                    <div className="text-lg font-bold text-slate-800">{b.total_records}</div>
                    <div className="text-[11px] text-slate-500">总记录</div>
                  </div>
                  <div className="bg-emerald-50 rounded p-2">
                    <div className="text-lg font-bold text-emerald-700">{b.valid_records}</div>
                    <div className="text-[11px] text-slate-500">有效</div>
                  </div>
                  <div className="bg-red-50 rounded p-2">
                    <div className="text-lg font-bold text-red-600">{b.anomaly_count}</div>
                    <div className="text-[11px] text-slate-500">异常</div>
                  </div>
                  <div className="bg-amber-50 rounded p-2">
                    <div className="text-lg font-bold text-amber-600">{b.unresolved_count}</div>
                    <div className="text-[11px] text-slate-500">未结</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>复核进度</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {b.error_records > 0 && (
                  <div className="mt-3 text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    包含 {b.error_records} 条无效记录（负数重量等），已留存原始行
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center text-sm text-primary-600 group-hover:text-primary-700">
                  <span className="text-xs">进入复核</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-[440px]">
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800">导入称重明细CSV</h3>
              <button
                onClick={() => setShowModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm text-slate-600">批次名称</label>
                <input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="可选，默认按日期生成"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">批次日期</label>
                <input
                  type="date"
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">CSV文件</label>
                <div
                  onClick={handleSelectFile}
                  className="mt-1 border-2 border-dashed border-slate-300 rounded-md p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/40"
                >
                  <Upload className="w-6 h-6 mx-auto text-slate-400" />
                  <p className="text-sm text-slate-600 mt-2">
                    {selectedFile ? selectedFile.name : '点击选择CSV文件'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    列：dish_name,planned_weight,actual_weight,temperature,timestamp
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowModalOpen(false)}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!selectedFile}
                className="px-4 py-1.5 bg-primary-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600"
              >
                <span className="inline-flex items-center gap-1">
                  <Plus className="w-4 h-4" />
                  开始导入
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
