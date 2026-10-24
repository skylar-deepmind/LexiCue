import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import FileDetailPage from './pages/FileDetailPage';
import SettingsPage from './pages/SettingsPage';
import SavedPage from './pages/SavedPage';
import LegacyPage from './pages/LegacyPage';
import { ThemeProvider } from './components/ThemeProvider';
import { legacyReadingRoute } from './lib/fileProgress';

function LegacyReadingRedirect() {
  const location = useLocation();
  return <Navigate to={legacyReadingRoute(location.search)} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/files" replace />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/files/:fileId" element={<FileDetailPage />} />
            <Route path="/words" element={<Navigate to="/legacy?kind=words" replace />} />
            <Route path="/phrases" element={<Navigate to="/legacy?kind=phrases" replace />} />
            <Route path="/reading" element={<LegacyReadingRedirect />} />
            <Route path="/review" element={<Navigate to="/legacy?kind=reviews" replace />} />
            <Route path="/insights" element={<Navigate to="/legacy?kind=review_logs" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/legacy" element={<LegacyPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
