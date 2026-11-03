import { FileText, Bookmark, Settings } from 'lucide-react';
export const navigationItems = [
    { to: '/files', icon: FileText, key: 'materials.title' },
    { to: '/saved', icon: Bookmark, key: 'savedRecords.title' },
    { to: '/settings', icon: Settings, key: 'sidebar.settings' },
];
export function normalizeNavigationPath(path: string) { return path.replace(/\/+$/, '') || '/'; }
export function importEntryVisible(path: string) { return normalizeNavigationPath(path) === '/files'; }
export function navigationActive(path: string, to: string, _legacyVocabulary?: boolean) { path = normalizeNavigationPath(path); return path === to || path.startsWith(`${to}/`) || path === '/example' && to === '/files'; }
