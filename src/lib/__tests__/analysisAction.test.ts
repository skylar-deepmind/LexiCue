import { describe, expect, it } from 'vitest';
import { analysisAction } from '../analysisAction';
describe('single analysis button', () => {
  it('distinguishes first extraction, forced reanalysis and cached continuation', () => {
    expect(analysisAction(false, false, true)).toEqual({ label: 'analyze', force: false });
    expect(analysisAction(true, false, true)).toEqual({ label: 'reanalyze', force: true });
    expect(analysisAction(true, true, true)).toEqual({ label: 'continueAnalysis', force: false });
    expect(analysisAction(false, true, true)).toEqual({ label: 'continueAnalysis', force: false });
  });
  it('preserves the non-English force behavior', () => {
    expect(analysisAction(true, false, false).force).toBe(false);
  });
});
