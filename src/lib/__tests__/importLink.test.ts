import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }));
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { inspectImportLink, readImportClipboard } from '../importLink';

describe('clipboard import boundary', () => {
  it.each([
    'https://www.youtube.com/watch?v=abcdefghijk',
    'https://youtu.be/abcdefghijk?t=20',
    'https://www.youtube.com/shorts/abcdefghijk',
  ])('routes an existing source without rewriting its URL: %s', url => {
    expect(inspectImportLink(` \n${url}\t`)).toEqual({ url });
  });
  it.each([null, '', ' \n '])('handles empty clipboard text: %s', value => {
    expect(inspectImportLink(value)).toEqual({ url: '', error: 'clipboardEmpty' });
  });
  it.each(['a private note', 'javascript:alert(1)', 'file:///private/data', 'https://name:secret@youtube.com/watch?v=abcdefghijk'])('does not route non-link or credential content: %s', text => {
    expect(inspectImportLink(text)).toEqual({ url: '', error: 'invalidLink' });
  });
  it.each(['https://youtube.com.example.org/watch?v=abcdefghijk', 'https://example.org/private', 'http://127.0.0.1:8080/data'])('does not send an unsupported URL to the current downloader: %s', url => {
    expect(inspectImportLink(url)).toEqual({ url, error: 'unsupportedLink' });
  });
  it('reads native clipboard only on explicit invocation and preserves read failures for manual fallback', async () => {
    expect(readText).not.toHaveBeenCalled();
    vi.mocked(readText).mockResolvedValueOnce('https://youtu.be/abcdefghijk');
    await expect(readImportClipboard()).resolves.toBe('https://youtu.be/abcdefghijk');
    vi.mocked(readText).mockRejectedValueOnce(new Error('denied'));
    await expect(readImportClipboard()).rejects.toThrow('denied');
    expect(readText).toHaveBeenCalledTimes(2);
  });
});
