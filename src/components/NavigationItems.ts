import { FileText, BookOpen, Brain, BarChart3, Settings } from 'lucide-react';

export const navigationItems = [
  { to: '/files', icon: FileText, key: 'sidebar.files' },
  { to: '/words', icon: BookOpen, key: 'shell.vocabulary', vocabulary: true },
  { to: '/review', icon: Brain, key: 'sidebar.review' },
  { to: '/insights', icon: BarChart3, key: 'shell.statistics' },
  { to: '/settings', icon: Settings, key: 'sidebar.settings' },
];

export function normalizeNavigationPath(path: string) { return path.replace(/\/+$/, '') || '/'; }

export function navigationActive(path: string, to: string, vocabulary?: boolean) {
  path = normalizeNavigationPath(path);
  return vocabulary ? path === '/words' || path === '/phrases' : path === to || path.startsWith(`${to}/`);
}
