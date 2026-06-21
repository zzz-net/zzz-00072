import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import BatchList from '@/pages/BatchList';
import ReviewList from '@/pages/ReviewList';
import RuleConfig from '@/pages/RuleConfig';
import ReportExport from '@/pages/ReportExport';
import ResultCenter from '@/pages/ResultCenter';

export default function App() {
  return (
    <Router>
      <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/batches" replace />} />
        <Route path="batches" element={<BatchList />} />
        <Route path="batches/:id" element={<ReviewList />} />
        <Route path="rules" element={<RuleConfig />} />
        <Route path="result-center" element={<ResultCenter />} />
        <Route path="export" element={<ReportExport />} />
        <Route path="*" element={<Navigate to="/batches" replace />} />
      </Route>
      </Routes>
    </Router>
  );
}
