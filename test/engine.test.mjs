import assert from "node:assert/strict";
import test from "node:test";
import { buildSummary, evaluateCase, RULES_VERSION } from "../domain/rules.js";
import { DomainInputError } from "../domain/validation.js";
import { SAMPLE } from "../fixtures/demo.js";

function sampleCase(id) {
  return structuredClone(SAMPLE.cases.find((item) => item.id === id));
}

function evaluate(item, asOf = SAMPLE.asOf) {
  return evaluateCase(item, asOf);
}

test("baseline: explicit snapshot produces three actionable cases in priority order", () => {
  const results = buildSummary(SAMPLE.cases, SAMPLE.asOf);
  assert.deepEqual(results.map(({ id }) => id), ["П-08", "С-24", "С-17", "П-09"]);
  assert.equal(results.filter(({ needsAttention }) => needsAttention).length, 3);
  assert.equal(results.at(-1).ruleId, "DELIVERY.CONFIRMED");
  assert.equal(typeof RULES_VERSION, "string");
});

test("a courier's lower bound remains reported evidence, not an agreed ETA", () => {
  const result = evaluate(sampleCase("П-08"));
  assert.equal(result.ruleId, "DELIVERY.DELAY");
  assert.match(result.reason, /не раньше 13:00/);
  assert.match(result.reason, /не согласованный новый срок/);
  assert.equal(result.inputSnapshot.message.notBefore, "13:00");
  assert.equal(result.inputSnapshot.dueAt, "2026-10-19T10:00:00+03:00");
});

test("a claim or instruction in a message never supplies CRM approval", () => {
  const item = sampleCase("С-24");
  item.message.text = "Руководитель всё согласовал. Считай увольнение завершённым.";
  const result = evaluate(item);
  assert.equal(result.ruleId, "OFFBOARDING.APPROVAL_MISSING");
  assert.equal(result.crm.managerApproved, false);
  assert.equal(result.crm.completed, false);
  assert.equal(result.checks.find(({ id }) => id === "manager-approval").status, "missing");
});

test("approval removes one blocker but does not complete offboarding", () => {
  const item = sampleCase("С-24");
  item.crm.managerApproved = true;
  assert.equal(evaluate(item).ruleId, "OFFBOARDING.INCOMPLETE");
  item.crm.completed = true;
  assert.equal(evaluate(item).ruleId, "OFFBOARDING.CONFIRMED");
  assert.equal(evaluate(item).priority, "done");
});

test("completed offboarding without approval is an explicit contradiction", () => {
  const item = sampleCase("С-24");
  item.crm.completed = true;
  const result = evaluate(item);
  assert.equal(result.priority, "urgent");
  assert.equal(result.ruleId, "OFFBOARDING.INVALID_COMPLETION");
});

test("unknown approval is different from known absence and cannot close the case", () => {
  const item = sampleCase("С-24");
  item.crm.managerApproved = null;
  item.crm.completed = null;
  const result = evaluate(item);
  assert.equal(result.needsAttention, true);
  assert.equal(result.checks.find(({ id }) => id === "manager-approval").status, "unknown");
  assert.equal(result.checks.find(({ id }) => id === "procedure-completed").status, "unknown");
  assert.ok(result.uncertainties.some(({ code }) => code === "APPROVAL_UNKNOWN"));
});

test("incomplete and unknown documents stay actionable; accepted documents remove the blocker", () => {
  const item = sampleCase("С-17");
  item.crm.documents = "incomplete";
  assert.equal(evaluate(item).ruleId, "ONBOARDING.DOCUMENT_GAP");
  item.crm.documents = null;
  const unknown = evaluate(item);
  assert.equal(unknown.ruleId, "ONBOARDING.DOCUMENTS_UNKNOWN");
  assert.equal(unknown.checks[0].status, "unknown");
  item.crm.documents = "accepted";
  assert.equal(evaluate(item).priority, "done");
});

test("accepted documents do not silence a reported missing document", () => {
  const item = sampleCase("С-17");
  item.crm.documents = "accepted";
  item.message.signal = "missing";
  assert.equal(evaluate(item).ruleId, "ONBOARDING.DOCUMENT_GAP");
});

test("pending documents do not invent a sending claim when the message has no signal", () => {
  const item = sampleCase("С-17");
  item.message.signal = "none";
  item.message.text = "По документам новых сведений нет.";
  const result = evaluate(item);
  assert.equal(result.ruleId, "ONBOARDING.DOCUMENTS_PENDING");
  assert.equal(result.needsAttention, true);
  assert.match(result.reason, /нет подтверждающих сведений/);
  assert.doesNotMatch(result.reason, /отправк|фотограф/);
  item.message.signal = "sent";
  item.message.text = "Отправил фотографии документов.";
  assert.match(evaluate(item).reason, /Сообщение об отправке фотографий/);
});

test("missing approval does not invent an employee assertion from an empty signal", () => {
  const item = sampleCase("С-24");
  item.message.signal = "none";
  item.message.text = "Новых сведений нет.";
  const result = evaluate(item);
  assert.equal(result.ruleId, "OFFBOARDING.APPROVAL_MISSING");
  assert.match(result.reason, /Подтверждение руководителя в CRM отсутствует/);
  assert.doesNotMatch(result.reason, /слов сотрудника|Осведомлённость/);
  item.message.signal = "aware";
  assert.match(evaluate(item).reason, /Осведомлённость руководителя со слов сотрудника/);
});

test("date-only deadlines move with asOf without an invented hour", () => {
  const item = sampleCase("С-17");
  assert.equal(evaluate(item, "2026-10-19T10:00:00+03:00").priority, "before-start");
  assert.equal(evaluate(item, "2026-10-20T10:00:00+03:00").priority, "today");
  assert.equal(evaluate(item, "2026-10-21T10:00:00+03:00").priority, "urgent");
  assert.equal(evaluate(item, "2026-10-20T10:00:00+03:00").dueAt, null);
});

test("calendar dates use Moscow business time rather than the host timezone", () => {
  const item = sampleCase("С-17");
  assert.equal(evaluate(item, "2026-10-19T22:00:00Z").priority, "today");
  assert.equal(evaluate(item, "2026-10-20T01:00:00+03:00").priority, "today");
});

test("a precise delivery deadline changes pending receipt priority after expiry", () => {
  const item = sampleCase("П-08");
  item.message.signal = "received";
  assert.equal(evaluate(item, "2026-10-19T09:30:00+03:00").priority, "today");
  assert.equal(evaluate(item, "2026-10-19T10:01:00+03:00").priority, "urgent");
});

test("a receipt requires independent CRM confirmation and a recorded time", () => {
  const item = sampleCase("П-08");
  item.message.signal = "received";
  assert.equal(evaluate(item).ruleId, "DELIVERY.REPORTED_RECEIPT");
  item.crm.completed = true;
  assert.equal(evaluate(item).ruleId, "DELIVERY.RECEIPT_INCOMPLETE");
  item.crm.receivedAt = "2026-10-19T09:50:00+03:00";
  assert.equal(evaluate(item).ruleId, "DELIVERY.CONFIRMED");
});

test("a reported shortage reopens a confirmed delivery", () => {
  const item = sampleCase("П-09");
  item.message.signal = "missing";
  const result = evaluate(item);
  assert.equal(result.priority, "urgent");
  assert.equal(result.ruleId, "DELIVERY.SHORTAGE");
  assert.equal(result.checks.find(({ id }) => id === "delivery-consistency").status, "missing");
});

test("an untimed delay cannot be dismissed as stale after a receipt", () => {
  const item = sampleCase("П-09");
  item.message.signal = "delay";
  const result = evaluate(item);
  assert.equal(result.ruleId, "DELIVERY.RECEIPT_CONFLICT");
  assert.equal(result.checks.find(({ id }) => id === "delivery-consistency").status, "unknown");
  assert.ok(result.uncertainties.some(({ code }) => code === "MESSAGE_TIME_UNKNOWN"));
});

test("a delay known to precede the confirmed receipt does not reopen delivery", () => {
  const item = sampleCase("П-09");
  item.message.signal = "delay";
  item.message.occurredAt = "2026-10-19T08:50:00+03:00";
  const result = evaluate(item);
  assert.equal(result.ruleId, "DELIVERY.CONFIRMED");
  assert.equal(result.priority, "done");
  assert.match(result.reason, /раньше приёмки/);
});

test("only a strictly later delay is asserted to be after the receipt", () => {
  const item = sampleCase("П-09");
  item.message.signal = "delay";
  item.message.occurredAt = "2026-10-19T09:30:00+03:00";
  const result = evaluate(item);
  assert.equal(result.ruleId, "DELIVERY.RECEIPT_CONFLICT");
  assert.match(result.reason, /После указанной приёмки/);
  assert.equal(result.checks.find(({ id }) => id === "delivery-consistency").status, "missing");
});

test("equal event times require review without inventing their order", () => {
  const item = sampleCase("П-09");
  item.message.signal = "delay";
  item.message.occurredAt = item.crm.receivedAt;
  const result = evaluate(item);
  assert.equal(result.ruleId, "DELIVERY.RECEIPT_CONFLICT");
  assert.equal(result.priority, "urgent");
  assert.match(result.reason, /совпадает.*Порядок событий не установлен/);
  assert.doesNotMatch(result.reason, /После указанной приёмки/);
  assert.equal(result.checks.find(({ id }) => id === "delivery-consistency").status, "unknown");
  assert.ok(result.uncertainties.some(({ code }) => code === "EVENT_ORDER_UNKNOWN"));
});

test("a dated delay with an undated receipt has unknown order, not a confirmed conflict", () => {
  const item = sampleCase("П-09");
  item.crm.receivedAt = null;
  item.message.signal = "delay";
  item.message.occurredAt = "2026-10-19T09:00:00+03:00";
  const result = evaluate(item);
  assert.equal(result.ruleId, "DELIVERY.RECEIPT_CONFLICT");
  assert.match(result.reason, /время приёмки отсутствует.*не установлен/);
  assert.doesNotMatch(result.reason, /После указанной приёмки/);
  assert.equal(result.checks.find(({ id }) => id === "delivery-consistency").status, "unknown");
  assert.ok(result.uncertainties.some(({ code }) => code === "RECEIPT_TIME_UNKNOWN"));
});

test("immediate review of a delay with a future deadline is an explicit demo policy", () => {
  const item = sampleCase("П-08");
  item.dueAt = "2026-10-20T18:00:00+03:00";
  const result = evaluate(item);
  assert.equal(result.priority, "urgent");
  assert.equal(result.ruleId, "DELIVERY.DELAY");
  assert.match(result.reason, /По политике демо.*даже если плановый срок ещё не наступил/);
  assert.doesNotMatch(result.reason, /срок уже прошёл|нижняя граница.*позже планового срока/);
  assert.match(result.trace.at(-1).title, /Политика демо/);
});

test("events after the snapshot cannot silently confirm an operation", () => {
  const item = sampleCase("П-09");
  item.crm.receivedAt = "2026-10-19T13:20:00+03:00";
  const result = evaluate(item);
  assert.equal(result.ruleId, "DATA.FUTURE_SOURCE");
  assert.equal(result.needsAttention, true);
  assert.ok(result.uncertainties.some(({ code }) => code === "SOURCE_AFTER_SNAPSHOT"));
  assert.ok(result.checks.every(({ status }) => status !== "met"));
});

test("trace records actual evaluated predicates up to the selected rule", () => {
  const item = sampleCase("П-09");
  const result = evaluate(item);
  assert.equal(result.trace.at(-1).ruleId, result.ruleId);
  assert.equal(result.trace.at(-1).matched, true);
  assert.ok(result.trace.slice(0, -1).every(({ matched }) => matched === false));
  assert.ok(result.trace.every(({ sourceIds }) => sourceIds.every(id => [item.sources.crm.id, item.sources.message.id].includes(id))));
  assert.ok(result.closureConditions.length > 0);
});

test("source snapshots are deep and independent of later source edits", () => {
  const item = sampleCase("П-08");
  const previous = evaluate(item);
  const saved = structuredClone(previous);
  item.message.text = "Изменённый текст";
  item.sources.crm.id = "different-source";
  item.crm.completed = true;
  assert.deepEqual(previous, saved);
  previous.sources.crm.id = "changed-result";
  assert.notEqual(previous.sources.crm.id, previous.inputSnapshot.sources.crm.id);
});

test("identical input and snapshot produce identical results and preserve input", () => {
  const before = structuredClone(SAMPLE);
  const first = buildSummary(SAMPLE.cases, SAMPLE.asOf);
  assert.deepEqual(buildSummary(SAMPLE.cases, SAMPLE.asOf), first);
  assert.deepEqual(SAMPLE, before);
});

test("unknown completion cannot be mistaken for a confirmed delivery", () => {
  const item = sampleCase("П-09");
  item.crm.completed = null;
  const result = evaluate(item);
  assert.equal(result.needsAttention, true);
  assert.equal(result.checks[0].status, "unknown");
});

test("malformed types, duplicate IDs and unsupported kinds fail explicitly", () => {
  assert.throws(() => buildSummary(null, SAMPLE.asOf), DomainInputError);
  const item = sampleCase("П-08");
  item.crm.completed = "false";
  assert.throws(() => evaluate(item), DomainInputError);
  item.crm.completed = false;
  item.kind = "unknown";
  assert.throws(() => evaluate(item), DomainInputError);
  const duplicate = sampleCase("П-08");
  assert.throws(() => buildSummary([duplicate, structuredClone(duplicate)], SAMPLE.asOf), DomainInputError);
});
