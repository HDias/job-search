import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Admin } from './pages/Admin';
import { AppSettings } from './pages/AppSettings';
import { Dashboard } from './pages/Dashboard';
import { JobDetail } from './pages/JobDetail';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="admin" element={<Admin />} />
        <Route path="admin/settings" element={<AppSettings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
