import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import WordsPage from './pages/WordsPage';
import PhrasesPage from './pages/PhrasesPage';
import FileDetailPage from './pages/FileDetailPage';
import ReviewPage from './pages/ReviewPage';
import InsightsPage from './pages/InsightsPage';
import SettingsPage from './pages/SettingsPage';
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
            <Route path="/words" element={<WordsPage />} />
            <Route path="/phrases" element={<PhrasesPage />} />
            <Route path="/reading" element={<LegacyReadingRedirect />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
