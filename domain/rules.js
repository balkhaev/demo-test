import { validateSnapshot } from "./validation.js";
import { sources, dataUncertainties, requiredChecks } from './evidence.js';
import { conclusion } from './decision.js';
import { deliveryRules } from './rules/delivery.js';
import { onboardingRules } from './rules/onboarding.js';
import { offboardingRules } from './rules/offboarding.js';

export const RULES_VERSION = "2.0.0";

const PRIORITY_ORDER = { urgent: 0, today: 1, "before-start": 2, done: 3 };
const STATUS_LABELS = {
  urgent: "Проверить сейчас",
  today: "Решить сегодня",
  "before-start": "До срока",
  done: "Без вмешательства",
};
/**
 * Only predicates actually evaluated appear in the trace.
 * First matching rule wins; IDs remain stable for UI explanations and tests.
 */
function runRules(rules, trace) {
  for (const rule of rules) {
    const matched = Boolean(rule.when());
    trace.push({ ruleId: rule.id, title: rule.title, matched, sourceIds: rule.sourceIds });
    if (matched) return { ...rule.then(), ruleId: rule.id };
  }
  throw new Error("Domain rules must include a fallback");
}

const RULE_SETS = {
  delivery: deliveryRules,
  onboarding: onboardingRules,
  offboarding: offboardingRules,
};

function evaluateValidatedCase(item, asOf) {
  const inputSnapshot = structuredClone(item);
  const trace = [];
  const uncertainties = dataUncertainties(inputSnapshot);
  const ids = sources(item);
  const futureSources = [
    ["receipt-time", item.crm.receivedAt],
    ["message-time", item.message.occurredAt],
    ["crm-update-time", item.sources.crm.updatedAt],
  ].filter(([, time]) => time !== null && Date.parse(time) > Date.parse(asOf));
  const dataRule = {
    id: "DATA.FUTURE_SOURCE",
    title: "Данные после времени снимка нельзя использовать в его выводе",
    sourceIds: [ids.crm, ids.message],
    when: () => futureSources.length > 0,
    then: () => conclusion("today",
      "В источниках есть событие позже времени снимка. Сначала нужно проверить даты или выбрать корректное время расчёта.",
      "Сверить время приёмки, сообщения и обновления CRM со временем снимка.",
      "Исправить время или пересчитать сводку на момент, включающий эти события.",
      ["Время событий проверено; все использованные сведения относятся к выбранному снимку."]),
  };
  const result = runRules([dataRule, ...RULE_SETS[item.kind](inputSnapshot, asOf)], trace);
  if (futureSources.length > 0) uncertainties.push({
    code: "SOURCE_AFTER_SNAPSHOT",
    text: "События после выбранного времени снимка требуют ручной проверки дат.",
  });
  if (result.priority !== "done" && !item.dueAt && !item.dueDate) {
    uncertainties.push({ code: "DEADLINE_UNKNOWN", text: "Срок операции не указан; срочность по времени нельзя подтвердить." });
  }
  const checks = requiredChecks(inputSnapshot);
  if (futureSources.length > 0) {
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
