import { test } from "node:test";
import assert from "node:assert/strict";
import { easter, feriadosNacionais, isBusinessDay, nthBusinessDay, nextBusinessDay, buildPeriod, previousPeriodId, suggestedPeriod, br, weekday } from "../js/periodo.js";

test("Páscoa", () => {
  assert.equal(easter(2024), "2024-03-31");
  assert.equal(easter(2025), "2025-04-20");
  assert.equal(easter(2026), "2026-04-05");
  assert.equal(easter(2027), "2027-03-28");
});

test("feriados nacionais incluem móveis e Consciência Negra", () => {
  const f = feriadosNacionais(2026);
  for (const d of ["2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-06-04", "2026-11-20", "2026-12-25"]) assert.ok(f.has(d), d);
});

test("dias úteis", () => {
  assert.equal(weekday(2026, 11, 4), 3);
  assert.equal(isBusinessDay("2026-11-04"), true);
  assert.equal(isBusinessDay("2026-11-07"), false);
  assert.equal(isBusinessDay("2026-11-20"), false);
  assert.equal(isBusinessDay("2026-11-04", ["2026-11-04"]), false);
  assert.equal(nextBusinessDay("2026-11-20"), "2026-11-23");
  assert.equal(nthBusinessDay(2026, 12, 5), "2026-12-07");
  assert.equal(nthBusinessDay(2027, 1, 1), "2027-01-04");
});

test("períodos e datas de pagamento", () => {
  const q1 = buildPeriod(2026, 11, "Q1");
  assert.equal(q1.inicio, "2026-11-01"); assert.equal(q1.fim, "2026-11-15");
  assert.equal(q1.pagamento, "2026-11-23");
  const q2 = buildPeriod(2026, 2, "Q2");
  assert.equal(q2.fim, "2026-02-28");
  assert.equal(q2.pagamento, "2026-03-06");
  const dez = buildPeriod(2026, 12, "Q2");
  assert.equal(dez.pagamento, "2027-01-08");
  const mes = buildPeriod(2026, 10, "M");
  assert.equal(mes.inicio, "2026-10-01"); assert.equal(mes.fim, "2026-10-31");
  assert.equal(mes.competencia, "10/2026");
  assert.equal(q1.pix, "Repasse 1Q nov/26");
  assert.equal(mes.pix, "Repasse out/26");
  assert.throws(() => buildPeriod(2026, 13, "Q1"));
  assert.ok(q1.aprovacaoAte < q1.pagamento);
});

test("navegação de períodos", () => {
  assert.equal(previousPeriodId("2026-11-Q2"), "2026-11-Q1");
  assert.equal(previousPeriodId("2026-11-Q1"), "2026-10-Q2");
  assert.equal(previousPeriodId("2026-01-Q1"), "2025-12-Q2");
  assert.equal(previousPeriodId("2026-01-M"), "2025-12-M");
  assert.deepEqual(suggestedPeriod("2026-11-04"), { y: 2026, m: 10, tipo: "Q2" });
  assert.deepEqual(suggestedPeriod("2026-11-17"), { y: 2026, m: 11, tipo: "Q1" });
  assert.deepEqual(suggestedPeriod("2026-01-03"), { y: 2025, m: 12, tipo: "Q2" });
  assert.equal(br("2026-11-23"), "23/11/2026");
});
