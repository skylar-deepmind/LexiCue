import type { SubtitleResult, SubtitleSource } from '../stores/youtubeStore';

export interface BrowserSession { enabled: boolean; browser: string; profile: string }
export const EMPTY_BROWSER_SESSION: BrowserSession = { enabled: false, browser: 'chrome', profile: '' };
export const YOUTUBE_BROWSERS = ['chrome', 'chromium', 'edge', 'firefox', 'safari', 'brave', 'opera', 'vivaldi'] as const;

export function normalizeBrowserSession(value: unknown): BrowserSession {
  const saved = value && typeof value === 'object' ? value as Partial<BrowserSession> : {};
  const validBrowser = typeof saved.browser === 'string' && YOUTUBE_BROWSERS.some(browser => browser === saved.browser);
  return { enabled: saved.enabled === true && validBrowser, browser: validBrowser ? saved.browser! : 'chrome',
    profile: typeof saved.profile === 'string' && !/[\n\r\0:]/.test(saved.profile) && saved.profile.length <= 1024 ? saved.profile.trim() : '' };
}

export interface YouTubeDownloadError {
  code: string; stage: string; role: 'primary' | 'secondary'; language: string;
  source: SubtitleSource; retryable: boolean; cooldown_seconds: number;
}
export type PreparedSubtitles = { status: 'complete'; subtitle: SubtitleResult }
  | { status: 'partial'; primary: SubtitleResult; error: YouTubeDownloadError };

export function downloadError(value: unknown): YouTubeDownloadError {
  if (value && typeof value === 'object' && 'code' in value && typeof value.code === 'string') {
    return { stage: 'download', role: 'primary', language: '', source: 'unknown', retryable: false, cooldown_seconds: 0, ...value } as YouTubeDownloadError;
  }
  const message = String(value);
  return { code: message.includes('ERR_CANCELLED') ? 'cancelled' : 'download_failed', stage: 'download', role: 'primary',
    language: '', source: 'unknown', retryable: true, cooldown_seconds: 0 };
}

export function isYouTubeCancelled(value: unknown): boolean { return downloadError(value).code === 'cancelled'; }

export function cooldownRemaining(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
