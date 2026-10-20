import { buildSummary, RULES_VERSION } from './rules.js';
import { validateSnapshot } from './validation.js';
import { SAMPLE } from '../fixtures/demo.js';

/**
 * Application use case: validated facts -> immutable decisions -> summary counts.
 * No HTTP objects, UI state, database writes, model calls or hidden current clock.
 */
export function evaluateBrief(input) {
  const snapshot = structuredClone(validateSnapshot(input));
  const summary = buildSummary(snapshot.cases, snapshot.asOf);
  return {
    asOf: snapshot.asOf,
    cases: snapshot.cases,
    summary,
    counts: {
      total: summary.length,
      attention: summary.filter(item => item.needsAttention).length,
      done: summary.filter(item => !item.needsAttention).length,
      urgent: summary.filter(item => item.priority === 'urgent').length,
    },
    rulesVersion: RULES_VERSION,
  };
}

export function getDemoBrief() {
  return {
    snapshot: structuredClone(SAMPLE.snapshot),
    ...evaluateBrief({ asOf: SAMPLE.asOf, cases: SAMPLE.cases }),
  };
}
