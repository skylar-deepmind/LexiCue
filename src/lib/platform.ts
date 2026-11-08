/** WKWebView identifies iPhone/iPad; iPad desktop mode reports touch-enabled Mac. */
export function isMobilePlatform(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function isIOSPlatform(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
