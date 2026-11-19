import { lazy, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import MobileStartup from './components/MobileStartup';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import { readingRoute, savedRoute, settingsRoute } from './lib/routeModules';
import { invalidateSavedReads } from './lib/savedReadCache';
import { useRecallStore } from './stores/recallStore';
const LegacyPage = lazy(() => import('./pages/LegacyPage'));
import { ThemeProvider } from './components/ThemeProvider';
import { legacyReadingRoute } from './lib/fileProgress';

function LegacyReadingRedirect() {
  const location = useLocation();
  return <Navigate to={legacyReadingRoute(location.search)} replace />;
}

export default function App() {
  useEffect(() => {
    let active = true;
    const events = ['lexicue-saved-changed', 'lexicue-sync-applied', 'lexicue-dictionary-changed'];
    const invalidate = () => {
      invalidateSavedReads();
      useRecallStore.getState().invalidate();
    };
    events.forEach(event => window.addEventListener(event, invalidate));
    const subscription = listen('dictionary-packs-changed', () => { if (active) window.dispatchEvent(new Event('lexicue-dictionary-changed')); });
    void subscription.catch(() => {});
    return () => {
      active = false;
      events.forEach(event => window.removeEventListener(event, invalidate));
      void subscription.then(unlisten => unlisten()).catch(() => {});
    };
  }, []);
  return (
    <ThemeProvider>
      <MobileStartup>
      <BrowserRouter useTransitions={false}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/files" replace/>} />
            <Route path="/example" element={<Navigate to="/files" replace />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/files/:fileId" element={<readingRoute.Page />} />
            <Route path="/words" element={<Navigate to="/legacy?kind=words" replace />} />
            <Route path="/phrases" element={<Navigate to="/legacy?kind=phrases" replace />} />
            <Route path="/reading" element={<LegacyReadingRedirect />} />
            <Route path="/review" element={<Navigate to="/legacy?kind=reviews" replace />} />
            <Route path="/insights" element={<Navigate to="/legacy?kind=review_logs" replace />} />
            <Route path="/settings" element={<settingsRoute.Page />} />
            <Route path="/saved" element={<savedRoute.Page />} />
            <Route path="/legacy" element={<LegacyPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </MobileStartup>
    </ThemeProvider>
  );
}
