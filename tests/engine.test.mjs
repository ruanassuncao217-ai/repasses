import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMoney, pctToBp, applyPct, formatBRL, formatPlain, normalize, medicoKey,
  tableFromMatrix, autoMap, classifyPayment, classifyType, findExame, findEspecial, findCadastro,
  compute, checkIntegrity, defaultRules, validateRules, toCSV, missingRequired,
} from "../js/engine.js";

const MAP = { medico: "Médico", procedimento: "Procedimento", valor: "Valor", tipo: "Tipo", pagamento: "Pagamento", convenio: "Convênio", data: "Data", paciente: "Paciente", quantidade: "" };
const row = (o) => ({ Médico: "Dr. Ana Lima", Procedimento: "Consulta cardiológica", Valor: "300,00", Tipo: "Consulta", Pagamento: "PIX", Convênio: "", Data: "2026-11-03", Paciente: "Paciente A", ...o });
function rules(over = {}) {
  const r = defaultRules();
  r.taxas = { debito: 1.5, credito: 3, parcelado: 4.5 };
  r.exames = [{ chave: "holter", modo: "fixo", valor: "80,00" }, { chave: "ecocardiograma", modo: "fixo", valor: "120" }, { chave: "mapa", modo: "percentual", valor: 50 }];
  r.medicos = [{ nome: "Ana Lima", fornecedor: "ANA LIMA SERVICOS MEDICOS", tipo: "PJ" }, { nome: "Bruno Sá", fornecedor: "Bruno Sá", tipo: "PF" }];
  return Object.assign(r, over);
}

test("parseMoney: formatos brasileiros e americanos", () => {
  assert.equal(parseMoney("R$ 1.234,56"), 123456);
  assert.equal(parseMoney("1234,5"), 123450);
  assert.equal(parseMoney("1.234"), 123400);
  assert.equal(parseMoney("12.5"), 1250);
  assert.equal(parseMoney("1,234.56"), 123456);
  assert.equal(parseMoney(300), 30000);
  assert.equal(parseMoney(1.005), 101);
  assert.equal(parseMoney(0.1 + 0.2), 30);
  assert.equal(parseMoney("(50,00)"), -5000);
  assert.equal(parseMoney("-50"), -5000);
  assert.equal(parseMoney("50-"), -5000);
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney(null), 0);
  assert.ok(Number.isNaN(parseMoney("abc")));
  assert.ok(Number.isNaN(parseMoney("1,2,3")));
  assert.equal(parseMoney("1.234.567,89"), 123456789);
});

test("pctToBp e applyPct sem erro de ponto flutuante", () => {
  assert.equal(pctToBp(15), 1500);
  assert.equal(pctToBp("7,25"), 725);
  assert.equal(pctToBp("3%"), 300);
  assert.equal(applyPct(30000, 7500, 1500), 19125);           // 300 × 85% × 75% = 191,25
  assert.equal(applyPct(30000, 7500, 1500 + 300), 18450);     // − 3% taxa = 184,50
  assert.equal(applyPct(33333, 7500, 1500), 21250);           // 333,33 × 0,6375 = 212,4979 → 212,50
  assert.equal(applyPct(-30000, 7500, 1500), -19125);
  assert.equal(applyPct(999999999999, 7500, 0), 749999999999); // sem estouro
});

test("formatação", () => {
  assert.equal(formatBRL(123456), "R$ 1.234,56");
  assert.equal(formatBRL(-5), "-R$ 0,05");
  assert.equal(formatBRL(0), "R$ 0,00");
  assert.equal(formatPlain(1999), "19,99");
});

test("normalize e medicoKey", () => {
  assert.equal(normalize("  JOSÉ   da  Silva "), "jose da silva");
  assert.equal(medicoKey("Dr. Fábio Leal"), "fabio leal");
  assert.equal(medicoKey("Dra Maria Clara"), "maria clara");
});

test("tableFromMatrix pula título e linha de total, e desduplica cabeçalhos", () => {
  const aoa = [["Relatório de produção"], [], ["Médico", "Procedimento", "Valor", "Valor"], ["Ana", "Consulta", 100, 1], ["", "", "", ""], ["Total", "", 100, ""]];
  const t = tableFromMatrix(aoa);
  assert.deepEqual(t.headers, ["Médico", "Procedimento", "Valor", "Valor (2)"]);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0]["Valor (2)"], 1);
});

test("autoMap reconhece colunas e não repete cabeçalho", () => {
  const m = autoMap(["Data Atendimento", "Paciente", "Profissional", "Procedimento", "Forma de Pagamento", "Convênio", "Valor Total"]);
  assert.equal(m.medico, "Profissional");
  assert.equal(m.procedimento, "Procedimento");
  assert.equal(m.valor, "Valor Total");
  assert.equal(m.pagamento, "Forma de Pagamento");
  assert.equal(m.convenio, "Convênio");
  assert.equal(m.data, "Data Atendimento");
  assert.equal(m.paciente, "Paciente");
  assert.deepEqual(missingRequired(m), []);
  assert.deepEqual(missingRequired({}), ["Médico", "Procedimento", "Valor"]);
});

test("classifyPayment", () => {
  const r = rules();
  assert.equal(classifyPayment("PIX", "", r), "semtaxa");
  assert.equal(classifyPayment("Dinheiro", "", r), "semtaxa");
  assert.equal(classifyPayment("Cartão de Débito", "", r), "debito");
  assert.equal(classifyPayment("Crédito à vista", "", r), "credito");
  assert.equal(classifyPayment("Crédito 3x", "", r), "parcelado");
  assert.equal(classifyPayment("Crédito parcelado", "", r), "parcelado");
  assert.equal(classifyPayment("", "Humana Saúde", r), "convenio");
  assert.equal(classifyPayment("Particular", "Particular", r), "semtaxa");
  assert.equal(classifyPayment("IAPEP", "", r), "convenio");
  assert.equal(classifyPayment("Cheque", "", r), "desconhecida");
  r.paymentMap = [{ contem: "cheque", forma: "semtaxa" }];
  assert.equal(classifyPayment("Cheque", "", r), "semtaxa");
});

test("classifyType e tabela de exames (o mais específico vence)", () => {
  const r = rules();
  r.exames.push({ chave: "holter 24h", modo: "fixo", valor: "90" });
  assert.equal(classifyType("", "Holter 24h", r).exame.chave, "holter 24h");
  assert.equal(classifyType("Consulta", "Holter", r).tipo, "consulta");
  assert.equal(classifyType("", "Consulta de retorno", r).tipo, "consulta");
  assert.equal(classifyType("", "Marca-passo avaliação", r).tipo, "?");
  assert.equal(classifyType("Exame", "Teste ergométrico", r).exame, null);
  assert.equal(findExame("ECOCARDIOGRAMA TRANSTORACICO", r).chave, "ecocardiograma");
});

test("findEspecial e findCadastro (com apelidos)", () => {
  const r = rules({ especiais: [{ nome: "Marcelo", pct: 60, base: "liquido", nota: "" }] });
  assert.equal(findEspecial("Dr. Marcelo Araújo", r).pct, 60);
  assert.equal(findEspecial("Dra. Ana", r), null);
  r.medicos.push({ nome: "Francisco Cesar", aliases: "Chico, F. Cesar", fornecedor: "FC", tipo: "PF" });
  assert.equal(findCadastro("Chico", r).fornecedor, "FC");
  assert.equal(findCadastro("Dr. Francisco Cesar Moura", r).fornecedor, "FC");
  assert.equal(findCadastro("Desconhecido", r), null);
});

test("compute: consulta PIX, cartão e exame fixo", () => {
  const rows = [
    row({}),                                                            // 191,25
    row({ Pagamento: "Crédito à vista", Paciente: "B" }),               // 300 × (1 − 0,18) × 0,75 = 184,50
    row({ Procedimento: "Holter 24h", Tipo: "Exame", Paciente: "C" }), // fixo 80,00
    row({ Procedimento: "MAPA", Tipo: "", Valor: "200", Paciente: "D" }), // 200 × 0,85 × 0,5 = 85,00
  ];
  const res = compute({ rows, mapping: MAP, rules: rules() });
  assert.equal(res.medicos.length, 1);
  const m = res.medicos[0];
  assert.equal(m.repCons, 19125 + 18450);
  assert.equal(m.repExa, 8000 + 8500);
  assert.equal(m.total, 19125 + 18450 + 8000 + 8500);
  assert.equal(m.nCons, 2);
  assert.equal(m.nExa, 2);
  assert.equal(m.fornecedor, "ANA LIMA SERVICOS MEDICOS");
  assert.equal(res.bloqueado, false);
  assert.ok(res.alerts.some(a => a.code === "PJ_NOTA"));
  assert.ok(checkIntegrity(res).ok);
});

test("compute: regra especial, base líquida e bruta", () => {
  const rows = [row({ Médico: "Dr. Marcelo" })];
  const liq = compute({ rows, mapping: MAP, rules: rules({ especiais: [{ nome: "Marcelo", pct: 60, base: "liquido", nota: "a confirmar" }] }) });
  assert.equal(liq.medicos[0].total, 15300); // 300 × 0,85 × 0,60
  assert.ok(liq.alerts.some(a => a.code === "REGRA_A_CONFIRMAR"));
  const bru = compute({ rows, mapping: MAP, rules: rules({ especiais: [{ nome: "Marcelo", pct: 60, base: "bruto", nota: "" }] }) });
  assert.equal(bru.medicos[0].total, 18000);
});

test("compute: alertas que bloqueiam a aprovação", () => {
  const rows = [
    row({ Médico: "" }),
    row({ Valor: "abc", Paciente: "X" }),
    row({ Procedimento: "Marca-passo", Tipo: "", Paciente: "Y" }),
    row({ Procedimento: "Teste ergométrico", Tipo: "Exame", Paciente: "Z" }),
  ];
  const res = compute({ rows, mapping: MAP, rules: rules() });
  const codes = res.alerts.map(a => a.code);
  for (const c of ["SEM_MEDICO", "VALOR_INVALIDO", "SEM_REGRA", "EXAME_SEM_VALOR"]) assert.ok(codes.includes(c), c);
  assert.equal(res.bloqueado, true);
  assert.equal(res.totals.linhasCalculadas, 0);
});

test("compute: taxa zerada com cartão bloqueia, salvo se a clínica não desconta taxa", () => {
  const rows = [row({ Pagamento: "Débito" })];
  const r = rules({ taxas: { debito: 0, credito: 0, parcelado: 0 } });
  assert.ok(compute({ rows, mapping: MAP, rules: r }).alerts.some(a => a.code === "TAXA_ZERADA"));
  r.descontarTaxa = false;
  const res = compute({ rows, mapping: MAP, rules: r });
  assert.ok(!res.alerts.some(a => a.code === "TAXA_ZERADA"));
  assert.equal(res.totals.total, 19125);
});

test("compute: convênio na competência ou só após recebimento", () => {
  const rows = [row({ Convênio: "Humana Saúde", Pagamento: "" }), row({ Paciente: "B" })];
  const a = compute({ rows, mapping: MAP, rules: rules() });
  assert.equal(a.totals.total, 19125 * 2);
  const b = compute({ rows, mapping: MAP, rules: rules({ convenioPolicy: "recebimento" }) });
  assert.equal(b.totals.total, 19125);
  assert.ok(b.alerts.some(x => x.code === "CONVENIO_FORA"));
});

test("compute: duplicidade, estorno e valor zerado", () => {
  const rows = [row({}), row({}), row({ Valor: "-300", Paciente: "E" }), row({ Valor: "0", Paciente: "F" })];
  const res = compute({ rows, mapping: MAP, rules: rules() });
  const codes = res.alerts.map(a => a.code);
  assert.ok(codes.includes("DUPLICADO"));
  assert.ok(codes.includes("VALOR_NEGATIVO"));
  assert.ok(codes.includes("VALOR_ZERO"));
  assert.equal(res.totals.total, 19125 * 2 - 19125);
  assert.ok(checkIntegrity(res).ok);
});

test("compute: ajustes (adiantamento, complemento) e total negativo", () => {
  const rows = [row({})];
  const res = compute({ rows, mapping: MAP, rules: rules(), ajustes: [
    { medico: "Dr. Ana Lima", tipo: "desconto", valor: 5000, motivo: "Adiantamento", categoria: "consultas" },
    { medico: "Bruno Sá", tipo: "acrescimo", valor: 10000, motivo: "Complemento", categoria: "exames" },
    { medico: "", tipo: "acrescimo", valor: 100, motivo: "inválido" },
  ] });
  const ana = res.medicos.find(m => m.key === "ana lima");
  const bruno = res.medicos.find(m => m.key === "bruno sa");
  assert.equal(ana.total, 19125 - 5000);
  assert.equal(bruno.total, 10000);
  assert.equal(res.ajustes.length, 2);
  assert.ok(checkIntegrity(res).ok);
  const neg = compute({ rows, mapping: MAP, rules: rules(), ajustes: [{ medico: "Ana Lima", tipo: "desconto", valor: 50000, motivo: "x" }] });
  assert.ok(neg.alerts.some(a => a.code === "TOTAL_NEGATIVO"));
  assert.equal(neg.bloqueado, true);
});

test("compute: quantidade em exame e médicos agrupados por nome normalizado", () => {
  const map = { ...MAP, quantidade: "Qtd" };
  const rows = [
    row({ Procedimento: "Holter", Tipo: "Exame", Qtd: "2", Paciente: "A" }),
    row({ Médico: "DRA. ANA LIMA", Procedimento: "Holter", Tipo: "Exame", Qtd: "", Paciente: "B" }),
  ];
  const res = compute({ rows, mapping: map, rules: rules() });
  assert.equal(res.medicos.length, 1);
  assert.equal(res.medicos[0].repExa, 8000 * 3);
  assert.equal(res.medicos[0].nExa, 3);
});

test("compute: centavos fecham em lote grande (prova real)", () => {
  const nomes = ["Ana Lima", "Bruno Sá", "Carla", "Davi"];
  const formas = ["PIX", "Débito", "Crédito", "Crédito 3x", "Dinheiro"];
  const rows = Array.from({ length: 3000 }, (_, i) => row({
    Médico: nomes[i % 4], Paciente: "P" + i, Pagamento: formas[i % 5],
    Valor: ((i * 37) % 900 + 0.01 * (i % 100)).toFixed(2).replace(".", ","),
    Procedimento: i % 7 === 0 ? "Holter" : "Consulta", Tipo: i % 7 === 0 ? "Exame" : "Consulta",
  }));
  const res = compute({ rows, mapping: MAP, rules: rules() });
  const integ = checkIntegrity(res);
  assert.ok(integ.ok, JSON.stringify(integ));
  for (const m of res.medicos) assert.equal(m.total, m.repCons + m.repExa);
});

test("compute: recusa regras inválidas e colunas faltando", () => {
  assert.throws(() => compute({ rows: [], mapping: {}, rules: rules() }), /Colunas obrigatórias/);
  assert.throws(() => compute({ rows: [], mapping: MAP, rules: rules({ consultaPct: 150 }) }), /Regras inválidas/);
});

test("validateRules", () => {
  assert.deepEqual(validateRules(rules()), []);
  const r = rules();
  r.exames.push({ chave: "Holter", modo: "fixo", valor: "10" });
  r.medicos.push({ nome: "Dra. Ana Lima", fornecedor: "x", tipo: "PF" });
  r.impostoPct = 95; r.taxas.parcelado = 10;
  const p = validateRules(r).join(" ");
  assert.match(p, /Exame repetido/);
  assert.match(p, /Médico repetido/);
  assert.match(p, /100%/);
});

test("toCSV: escape, BOM e proteção contra fórmula", () => {
  const csv = toCSV([["a;b", 'diz "oi"', "=HYPERLINK(1)", "-12,50", "ok"]]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.slice(1), `"a;b";"diz ""oi""";'=HYPERLINK(1);-12,50;ok`);
});
