import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import FileDetailPage from './pages/FileDetailPage';
import SettingsPage from './pages/SettingsPage';
import SavedPage from './pages/SavedPage';
import LegacyPage from './pages/LegacyPage';
import ExamplePage from './pages/ExamplePage';
import { useOnboardingStore } from './stores/onboardingStore';
import { ThemeProvider } from './components/ThemeProvider';
import { legacyReadingRoute } from './lib/fileProgress';

function LegacyReadingRedirect() {
  const location = useLocation();
  return <Navigate to={legacyReadingRoute(location.search)} replace />;
}
function FirstLaunch() {
  const outcome = useOnboardingStore(state => state.outcome);
  return <Navigate to={outcome === 'unseen' ? '/example' : '/files'} replace/>;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<FirstLaunch />} />
            <Route path="/example" element={<ExamplePage />} />
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
