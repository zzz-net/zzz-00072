import { NavLink, Outlet } from 'react-router-dom';
import { Package, ClipboardCheck, Settings, Download, Scale, AlertCircle, CheckCircle2, ClipboardList } from 'lucide-react';
import { useAppStore } from '@/stores';

export default function Layout() {
  const toast = useAppStore((s) => s.toast);

  const navItems = [
    { to: '/batches', label: '批次列表', icon: Package },
    { to: '/rules', label: '规则配置', icon: Settings },
    { to: '/result-center', label: '结果中心', icon: ClipboardList },
    { to: '/export', label: '报表导出', icon: Download },
  ];

  const toastBg =
    toast?.type === 'success'
      ? '#059669'
      : toast?.type === 'error'
      ? '#dc2626'
      : '#2563eb';

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-56 bg-primary-800 text-white flex flex-col">
        <div className="px-5 py-5 border-b border-primary-700/40 flex items-center gap-3">
          <Scale className="w-7 h-7 text-accent-400" />
          <div>
            <h1 className="text-base font-bold leading-tight">食堂损耗复核台</h1>
            <p className="text-xs text-primary-200">Canteen Loss Review</p>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-inner'
                    : 'text-primary-100 hover:bg-primary-700/60 hover:text-white'
                }`
              }
            >
              <item.icon className="w-[18px] h-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-primary-700/40 text-xs text-primary-200">
          <div className="flex items-center gap-1.5">
            <ClipboardCheck className="w-4 h-4" />
            <span>本地数据模式</span>
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6">
          <div className="text-sm text-slate-500">
            食堂质量管理 / <span className="text-slate-800 font-medium">损耗复核</span>
          </div>
        </header>
        <div className="flex-1 overflow-auto scrollbar-thin p-6">
          <Outlet />
        </div>
      </main>
      {toast && (
        <div
          className="fixed top-4 right-4 px-4 py-2.5 rounded-md shadow-lg text-sm text-white flex items-center gap-2 z-50"
          style={{ background: toastBg }}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
