import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import WordsPage from './pages/WordsPage';
import PhrasesPage from './pages/PhrasesPage';
import ReadingPage from './pages/ReadingPage';
import ReviewPage from './pages/ReviewPage';
import InsightsPage from './pages/InsightsPage';
import SettingsPage from './pages/SettingsPage';
import { ThemeProvider } from './components/ThemeProvider';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/files" replace />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/words" element={<WordsPage />} />
            <Route path="/phrases" element={<PhrasesPage />} />
            <Route path="/reading" element={<ReadingPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
