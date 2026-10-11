export function analysisAction(completed: boolean, interrupted: boolean, allowForce: boolean) {
  return { label: interrupted ? 'continueAnalysis' : completed ? 'reanalyze' : 'analyze', force: completed && !interrupted && allowForce };
}
