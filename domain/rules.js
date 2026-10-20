import { validateSnapshot } from "./validation.js";
import { dataUncertainties, requiredChecks } from './evidence.js';
import { selectRule, resolveDecision } from './rule-engine.js';
import { deadlinePriority } from './deadlines.js';
import { dataRules } from './rules/data.js';
import { deliveryRules } from './rules/delivery.js';
import { onboardingRules } from './rules/onboarding.js';
import { offboardingRules } from './rules/offboarding.js';
import { deadlineRules } from './rules/deadline.js';
import { createHash } from 'node:crypto';

const PRIORITY_ORDER = { urgent: 0, today: 1, "before-start": 2, done: 3 };
const STATUS_LABELS = {
  urgent: "Проверить сейчас",
  today: "Решить сегодня",
  "before-start": "До срока",
  done: "Без вмешательства",
};
export const RULE_SETS = {
  delivery: deliveryRules,
  onboarding: onboardingRules,
  offboarding: offboardingRules,
};

// A changed definition gets a new version without a manual version bump.
export const RULES_VERSION = createHash('sha256')
  .update(JSON.stringify([dataRules, RULE_SETS, deadlineRules], (_, value) =>
    typeof value === 'function' ? value.toString().replace(/\r\n/g, '\n') : value))
  .digest('hex').slice(0, 16);

function evaluateValidatedCase(item, asOf) {
  const inputSnapshot = structuredClone(item);
  const trace = [];
  const uncertainties = dataUncertainties(inputSnapshot);
  const rule = selectRule([...dataRules, ...RULE_SETS[item.kind]], { ...inputSnapshot, asOf }, trace);
  const result = resolveDecision(rule, inputSnapshot, asOf, deadlinePriority);
  const hasFutureSources = result.ruleId === 'DATA.FUTURE_SOURCE';
  if (hasFutureSources) uncertainties.push({
    code: "SOURCE_AFTER_SNAPSHOT",
    text: "События после выбранного времени снимка требуют ручной проверки дат.",
  });
  if (result.priority !== "done" && !item.dueAt && !item.dueDate) {
    uncertainties.push({ code: "DEADLINE_UNKNOWN", text: "Срок операции не указан; срочность по времени нельзя подтвердить." });
  }
  const checks = requiredChecks(inputSnapshot);
  if (hasFutureSources) {
    for (const check of checks) if (check.status === "met") check.status = "unknown";
  }
  return {
    ...structuredClone(inputSnapshot),
    ...result,
    needsAttention: result.priority !== "done",
    statusLabel: item.kind === "onboarding" && result.priority === "before-start"
      ? "До первого выхода" : STATUS_LABELS[result.priority],
    checks,
    trace,
    uncertainties,
    inputSnapshot,
  };
}

/** Pure single-case use case: no network, mutation, model calls or system clock. */
export function evaluateCase(item, asOf) {
  validateSnapshot({ cases: [item], asOf });
  return evaluateValidatedCase(item, asOf);
}

/** Equal priorities retain input order; caller supplies an explicit snapshot time. */
export function buildSummary(cases, asOf) {
  validateSnapshot({ cases, asOf });
  return cases.map((item) => evaluateValidatedCase(item, asOf))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
