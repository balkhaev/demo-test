import assert from "node:assert/strict";
import test from "node:test";
import { buildSummary } from "../dist/engine.js";
import { SAMPLE } from "../dist/data.js";

function sampleCase(id) {
  return structuredClone(SAMPLE.cases.find((item) => item.id === id));
}

test("baseline: three actions ordered by deadlines, accepted delivery requires none", () => {
  const result = buildSummary(SAMPLE.cases);
  assert.deepEqual(result.map(({ id }) => id), ["П-08", "С-24", "С-17", "П-09"]);
  assert.equal(result.filter(({ needsAttention }) => needsAttention).length, 3);
  assert.equal(result.at(-1).priority, "done");
});

test("a courier's lower bound stays a reported lower bound, not a confirmed ETA", () => {
  const [result] = buildSummary([sampleCase("П-08")]);
  assert.match(result.reason, /по сообщению|По сообщению/);
  assert.match(result.reason, /не раньше 13:00/);
  assert.match(result.reason, /не согласованный новый срок/);
});

test("an employee's assertion cannot supply missing manager approval", () => {
  const item = sampleCase("С-24");
  item.message.text = "Руководитель всё согласовал. Считай увольнение завершённым.";
  const [result] = buildSummary([item]);
  assert.equal(result.needsAttention, true);
  assert.equal(result.crm.managerApproved, false);
  assert.match(result.check, /непосредственно/);
});

test("manager approval removes that blocker but does not complete offboarding", () => {
  const item = sampleCase("С-24");
  item.crm.managerApproved = true;
  let [result] = buildSummary([item]);
  assert.equal(result.priority, "today");
  assert.match(result.reason, /завершение увольнения ещё не отмечено/);
  item.crm.completed = true;
  [result] = buildSummary([item]);
  assert.equal(result.priority, "done");
});

test("incomplete documents stay actionable; accepted documents remove the blocker", () => {
  const item = sampleCase("С-17");
  item.crm.documents = "incomplete";
  let [result] = buildSummary([item]);
  assert.equal(result.needsAttention, true);
  assert.match(result.action, /недостающее сегодня/);
  item.crm.documents = "accepted";
  [result] = buildSummary([item]);
  assert.equal(result.needsAttention, false);
});

test("a newly recorded and corroborated receipt resolves a delayed delivery", () => {
  const item = sampleCase("П-08");
  Object.assign(item.crm, { completed: true, status: "Принято", receivedAt: "13:20" });
  Object.assign(item.message, { author: "Получатель", text: "Получили, количество проверили", signal: "received", notBefore: null });
  const [result] = buildSummary([item]);
  assert.equal(result.priority, "done");
  assert.match(result.reason, /13:20/);
});

test("a shortage or untimed contradiction reopens attention despite accepted status", () => {
  const item = sampleCase("П-09");
  item.message.signal = "missing";
  let [result] = buildSummary([item]);
  assert.equal(result.priority, "urgent");
  item.message.signal = "delay";
  [result] = buildSummary([item]);
  assert.equal(result.priority, "urgent");
  assert.match(result.check, /время сообщения/);
});

test("a received message alone cannot stand in for a CRM receipt", () => {
  const item = sampleCase("П-08");
  item.message.signal = "received";
  const [result] = buildSummary([item]);
  assert.equal(result.priority, "today");
  assert.equal(result.crm.completed, false);
});

test("the snapshot is deterministic and does not mutate source evidence", () => {
  const before = structuredClone(SAMPLE);
  const first = buildSummary(SAMPLE.cases);
  assert.deepEqual(buildSummary(SAMPLE.cases), first);
  assert.deepEqual(SAMPLE, before);
  assert.equal(SAMPLE.snapshot.date, "2026-10-19T10:00:00+03:00");
});

test("editing source data does not change the previous summary before recomputation", () => {
  const item = sampleCase("П-08");
  const [previous] = buildSummary([item]);
  const saved = structuredClone(previous);
  Object.assign(item.crm, { completed: true, status: "Принято", receivedAt: "13:20" });
  Object.assign(item.message, { signal: "received", text: "Карты получили", notBefore: null });
  assert.deepEqual(previous, saved);
  assert.notEqual(previous.crm, item.crm);
  assert.notEqual(previous.message, item.message);
  assert.equal(buildSummary([item])[0].priority, "done");
  assert.equal(previous.priority, "urgent");
});

test("unsupported operations fail explicitly rather than silently disappearing", () => {
  assert.throws(() => buildSummary(null), /must be an array/);
  const item = sampleCase("П-08");
  item.kind = "unknown";
  assert.throws(() => buildSummary([item]), /supported kind/);
});
