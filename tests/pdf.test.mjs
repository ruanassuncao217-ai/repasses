// Leitura de PDF: testa a montagem da tabela a partir das posições do texto,
// com dados fictícios no mesmo layout do "Relatório de Atendimento".
import test from "node:test";
import assert from "node:assert/strict";
import { matrixFromPages, groupLines } from "../js/pdf.js";
import { tableFromMatrix, autoMap, classifyPayment, defaultRules, compute, parseMoney } from "../js/engine.js";

const H = [[24, "DATA ATEND"], [71, "DATA PAGAM"], [119, "ENTRADA"], [156, "CLIENTE"], [308, "CONVÊNIO"], [368, "PROCEDIMENTO"],
  [467, "NF"], [500, "PROF. EXECUT."], [567, "AGENTE"], [631, "FORMA PAG"], [681, "VALOR"], [719, "DESC"], [752, "LÍQUIDO"], [787, "SITUAÇÃO"]];
const head = y => H.map(([x, s]) => ({ x, y, w: 20, s }));
const row = (y, c) => [
  { x: 24, y, w: 30, s: c.data }, ...(c.pag ? [{ x: 71, y, w: 55, s: c.pag }] : []), { x: 124, y, w: 28, s: "000001.01" },
  { x: 156, y, w: c.nomeW || 90, s: c.nome }, { x: 308, y, w: 40, s: c.conv }, { x: 368, y, w: 100, s: c.proc },
  { x: 500, y, w: 68, s: "DR. FULANO DE TAL" }, ...(c.forma ? [{ x: 631, y, w: 72, s: c.forma }] : []),
  { x: 694, y, w: 18, s: c.valor }, { x: 728, y, w: 12, s: "0,00" }, { x: 765, y, w: 18, s: c.valor }, { x: 787, y: y + 0.8, w: 20, s: c.sit },
];
const pages = [
  { items: [{ x: 306, y: 37, w: 200, s: "RELATÓRIO DE ATENDIMENTO" }, { x: 25, y: 80, w: 60, s: "PROFISSIONAL:" }, { x: 106, y: 80, w: 70, s: "DR. FULANO DE TAL" },
    ...head(93),
    ...row(105, { data: "13/10/2026", pag: "13/10/2026 09:10:46", nome: "PACIENTE UM", conv: "PARTICULAR", proc: "AVALIAÇÃO DE MARCA-PASSO", forma: "CARTÃO DE CRÉDITO 1X", valor: "400,00", sit: "PAGO" }),
    ...row(114, { data: "26/10/2026", nome: "PACIENTE COM NOME BEM COMPRIDO QUE QUASE ENCOSTA", nomeW: 150, conv: "UNIMED", proc: "HOLTER 24 HORAS", valor: "121,03", sit: "ABERTO" }),
    { x: 24, y: 300, w: 120, s: "TOTAL PROFISSIONAL: 2" }, { x: 694, y: 300, w: 18, s: "521,03" }, { x: 728, y: 300, w: 12, s: "0,00" }, { x: 765, y: 300, w: 18, s: "521,03" },
    { x: 24, y: 565, w: 150, s: "segunda-feira, 9 de novembro de 2026" }, { x: 813, y: 565, w: 4, s: "1" }] },
  { items: [...head(31),
    ...row(43, { data: "15/10/2026", pag: "15/10/2026 11:09:36", nome: "PACIENTE TRÊS", conv: "PARTICULAR", proc: "ELETROCARDIOGRAMA DE REPOUSO", forma: "CARTÃO DE CRÉDITO 3X", valor: "60,00", sit: "PAGO" })] },
];

test("pdf: agrupa itens da mesma linha mesmo com pequena diferença de altura", () => {
  const ls = groupLines([{ x: 10, y: 100, s: "A" }, { x: 50, y: 100.8, s: "B" }, { x: 10, y: 110, s: "C" }]);
  assert.equal(ls.length, 2);
  assert.deepEqual(ls[0].items.map(i => i.s), ["A", "B"]);
});

test("pdf: monta a tabela, ignora título, total, rodapé e cabeçalho repetido", () => {
  const t = tableFromMatrix(matrixFromPages(pages));
  assert.equal(t.headers.length, 14);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0]["FORMA PAG"], "CARTÃO DE CRÉDITO 1X");
  assert.equal(t.rows[0]["VALOR"], "400,00");
  assert.equal(t.rows[1]["CLIENTE"], "PACIENTE COM NOME BEM COMPRIDO QUE QUASE ENCOSTA");
  assert.equal(t.rows[1]["CONVÊNIO"], "UNIMED");
  assert.equal(t.rows[1]["DATA PAGAM"], "");
  assert.equal(t.rows[2]["SITUAÇÃO"], "PAGO");
  const soma = t.rows.reduce((a, r) => a + parseMoney(r["VALOR"]), 0);
  assert.equal(soma, 58103);
});

test("pdf: mapeamento automático do layout do relatório de atendimento", () => {
  const t = tableFromMatrix(matrixFromPages(pages));
  const m = autoMap(t.headers);
  assert.equal(m.medico, "PROF. EXECUT.");
  assert.equal(m.pagamento, "FORMA PAG");
  assert.equal(m.data, "DATA ATEND");
  assert.equal(m.paciente, "CLIENTE");
  assert.equal(m.valor, "VALOR");
});

test("mapeamento: 'Data Pagamento' não é usado como forma de pagamento", () => {
  const m = autoMap(["Data", "Data Pagamento", "Paciente", "Profissional", "Procedimento", "Forma de Pagamento", "Valor"]);
  assert.equal(m.pagamento, "Forma de Pagamento");
  assert.equal(m.data, "Data");
});

test("pagamento: crédito 1X é à vista e 3X é parcelado", () => {
  const r = defaultRules();
  assert.equal(classifyPayment("CARTÃO DE CRÉDITO 1X", "PARTICULAR", r), "credito");
  assert.equal(classifyPayment("CARTÃO DE CRÉDITO 3X", "PARTICULAR", r), "parcelado");
  assert.equal(classifyPayment("CARTAO DE DEBITO", "PARTICULAR", r), "debito");
});

test("pdf: cálculo completo fecha a prova real", () => {
  const t = tableFromMatrix(matrixFromPages(pages));
  const rules = { ...defaultRules(), exames: [{ chave: "ELETROCARDIOGRAMA", modo: "fixo", valor: "7,00" }, { chave: "HOLTER", modo: "fixo", valor: "0,00" }] };
  const res = compute({ rows: t.rows, mapping: autoMap(t.headers), rules });
  assert.equal(res.medicos.length, 1);
  assert.equal(res.medicos[0].total, 700);
});
