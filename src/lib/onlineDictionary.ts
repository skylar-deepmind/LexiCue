import { dictionaryContentAssessment, hasSubstantiveTargetContent, lookupCambridge, lookupFreeDictionary, shouldLookupCambridge, type DictionaryResult } from './dictionaryResult';

export type OnlineProvider = 'cambridge' | 'wiktionary';
export type OnlineIssue = 'not_found' | 'unavailable' | 'rate_limited' | 'relation_only' | 'unconfirmed' | 'deadline';
export interface OnlineOutcome { attempted: OnlineProvider[]; issue: OnlineIssue | null }

/** English already present only needs the existing Chinese supplement. */
export function shouldContinueToFreeDictionary(local: DictionaryResult | null, cambridge: DictionaryResult | null): boolean {
  return !hasSubstantiveTargetContent(local) && !hasSubstantiveTargetContent(cambridge);
}
export function onlineIssue(result: DictionaryResult | null): OnlineIssue {
  if (result?.notices.some(notice => /rate_limit|too_many|cooldown/.test(notice.code))) return 'rate_limited';
  if (result?.notices.some(notice => /relation_only|reference_only|form_only/.test(notice.code))) return 'relation_only';
  if (result?.notices.some(notice => /not_found/.test(notice.code))) return 'not_found';
  if (result?.notices.some(notice => /invalid|unconfirmed|shape_changed|structure_limit|missing_|parse|malformed|scope|identity/.test(notice.code))) return 'unconfirmed';
  if (result && dictionaryContentAssessment(result).kind === 'relation_only') return 'relation_only';
  return result?.status === 'not_found' ? 'not_found' : 'unavailable';
}

/** A query owns one monotonic deadline. Native commands also cancel their
 * network future at 10s/remaining 8s; this is not a Promise-only timeout. */
export async function runOnlineDictionary(options: {
  expression: string; context: string; local: DictionaryResult | null;
  mode?: 'automatic' | 'manual' | 'continue'; signal: AbortSignal;
  onResult: (provider: OnlineProvider, result: DictionaryResult) => void;
  cambridge?: typeof lookupCambridge; free?: typeof lookupFreeDictionary;
  now?: () => number;
}): Promise<OnlineOutcome> {
  const { expression, context, local, signal, onResult, mode = 'automatic' } = options;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + 18_000;
  const attempted: OnlineProvider[] = [];
  if (signal.aborted || (mode === 'automatic' && !shouldLookupCambridge(local))) return { attempted, issue: null };
  let cambridge: DictionaryResult | null = null;
  let issue: OnlineIssue | null = null;
  if (mode !== 'continue') {
    attempted.push('cambridge');
    try {
      cambridge = await (options.cambridge ?? lookupCambridge)(expression, context);
      if (signal.aborted) return { attempted, issue: null };
      onResult('cambridge', cambridge);
      issue = hasSubstantiveTargetContent(cambridge) ? null : onlineIssue(cambridge);
    } catch { issue = 'unavailable'; }
  }
  if (signal.aborted) return { attempted, issue: null };
  if (mode !== 'continue' && !shouldContinueToFreeDictionary(local, cambridge)) return { attempted, issue };
  const remaining = Math.min(8_000, Math.floor(deadline - now()));
  if (remaining <= 0) return { attempted, issue: 'deadline' };
  attempted.push('wiktionary');
  try {
    const value = await (options.free ?? lookupFreeDictionary)(expression, context, remaining);
    if (signal.aborted) return { attempted, issue: null };
    onResult('wiktionary', value);
    issue = hasSubstantiveTargetContent(value) ? null : onlineIssue(value);
  } catch { issue = 'unavailable'; }
  return { attempted, issue };
}
