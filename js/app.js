/**
 * RepasseMed – interface.
 * Toda regra de dinheiro está em engine.js; este arquivo só orquestra a tela.
 */
import {
  FIELDS, FORMAS, tableFromMatrix, autoMap, missingRequired, compute, checkIntegrity,
  validateRules, parseMoney, formatBRL, formatPlain, toCSV, normalize, medicoKey, findCadastro,
} from "./engine.js";
import { buildPeriod, br, previousPeriodId, suggestedPeriod, MESES } from "./periodo.js";
import * as store from "./storage.js";
import { ask, askJSON, maskSample, testConnection, AIError } from "./ai.js";
import { readPdf } from "./pdf.js";

export const VERSION = "1.1.0";

/* ================================================================== */
/* Utilidades de tela                                                  */
/* ================================================================== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Data do Excel em "AAAA-MM-DD" pelos componentes locais (sem deslocar o dia pelo fuso). */
const localISO = d => Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** "03/11/2026" (padrão brasileiro) vira "2026-11-03"; outros textos ficam como estão. */
const normDateText = v => { const m = typeof v === "string" && /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim()); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v; };
const fmtDT = s => s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copiado"); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copiado"); } catch { toast("Não consegui copiar. Selecione o texto e copie."); }
    ta.remove();
  }
}

function download(name, data, type = "text/csv;charset=utf-8") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Diálogo de confirmação; com `input`, exige texto (ex.: motivo). */
function confirmDlg(title, text, { input = false, placeholder = "", okLabel = "Confirmar" } = {}) {
  return new Promise(resolve => {
    const d = $("#dlg");
    $("#dlgTitle").textContent = title; $("#dlgText").textContent = text; $("#dlgOk").textContent = okLabel;
    const inp = $("#dlgInput"); inp.hidden = !input; inp.value = ""; inp.placeholder = placeholder;
    const done = () => {
      d.removeEventListener("close", done);
      if (d.returnValue !== "ok") return resolve(null);
      if (input && !inp.value.trim()) { toast("Informe o motivo"); return resolve(null); }
      resolve(input ? inp.value.trim() : true);
    };
    d.returnValue = "";
    d.addEventListener("close", done);
    d.showModal();
    (input ? inp : $("#dlgOk")).focus();
  });
}

function setLocked(el, locked) { el.classList.toggle("locked", locked); el.querySelector(".body").inert = locked; }

/* ================================================================== */
/* Estado                                                              */
/* ================================================================== */
let cfg = store.loadConfig();
let period = null;      // período selecionado (buildPeriod)
let doc = null;         // documento persistido do período
let result = null;      // cálculo atual (não persistido inteiro)
let tableMem = null;    // tabela do arquivo em memória (quando não se guarda detalhe)
let draftRules = null;  // edição de regras
let draftMedicos = null;

function operador() { return cfg.clinica.responsavel || "Operador"; }
function extras() { return cfg.feriadosExtras || []; }

function newDoc(p) {
  return { id: p.id, label: p.label, periodo: p, criadoEm: new Date().toISOString(), arquivo: null, tabela: null, mapping: {}, ajustes: [], resumo: null, aprovacao: null, status: {}, auditoria: [] };
}
function persist() { try { store.savePeriod(doc); } catch (e) { toast(e.message); } }
function tabela() { return doc?.tabela || tableMem; }
function isApproved() { return !!doc?.aprovacao; }
function rulesInUse() { return isApproved() ? doc.aprovacao.regras : cfg.rules; }

/* ================================================================== */
/* Período                                                             */
/* ================================================================== */
function fillTipoOptions() {
  const sel = $("#tipo");
  const cur = sel.value;
  sel.innerHTML = cfg.periodicidade === "mensal"
    ? `<option value="M">Mês inteiro</option>`
    : `<option value="Q1">1ª quinzena (1 a 15)</option><option value="Q2">2ª quinzena (16 ao fim)</option>`;
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function selectPeriod(y, m, tipo) {
  $("#mes").value = `${y}-${String(m).padStart(2, "0")}`;
  fillTipoOptions();
  $("#tipo").value = cfg.periodicidade === "mensal" ? "M" : (tipo === "M" ? "Q1" : tipo);
  onPeriodChange();
}

function onPeriodChange() {
  const [y, m] = ($("#mes").value || "").split("-").map(Number);
  if (!y || !m) return;
  period = buildPeriod(y, m, $("#tipo").value, cfg.pagamento, extras());
  doc = store.loadPeriod(period.id) || newDoc(period);
  if (!doc.aprovacao) doc.periodo = period; // datas recalculadas se feriados mudarem
  tableMem = null; result = null;
  $("#periodDates").textContent = `${br(period.inicio)} a ${br(period.fim)} · pagar em ${br((doc.aprovacao ? doc.periodo : period).pagamento)}`;
  if (doc.tabela || (isApproved() && doc.tabela)) recalc(false);
  renderAll();
}

/* ================================================================== */
/* Etapa 1: arquivo e colunas                                          */
/* ================================================================== */
async function readFile(file) {
  if (isApproved()) { toast("Período aprovado. Reabra para trocar o arquivo."); return; }
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (!isPdf && !window.XLSX) { toast("O leitor de planilhas não carregou. Verifique a internet e recarregue a página."); return; }
  try {
    const buf = await file.arrayBuffer();
    let aoa;
    if (isPdf) {
      $("#fileInfo").textContent = `Lendo ${file.name}…`;
      aoa = await readPdf(buf);
      if (!aoa.length) { toast("Não encontrei uma tabela de atendimentos neste PDF. Se for um PDF escaneado (imagem), exporte o relatório em Excel."); renderStep1(); return; }
    } else {
    let wb;
    if (/\.(csv|txt)$/i.test(file.name)) {
      // CSV: decodifica nós mesmos (UTF-8 ou ANSI/Windows-1252) e não deixa a
      // biblioteca interpretar datas, que viriam no padrão americano (mês/dia).
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch { text = new TextDecoder("windows-1252").decode(buf); }
      wb = window.XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string", raw: true, dense: true });
    } else {
      wb = window.XLSX.read(buf, { type: "array", cellDates: true, dense: true });
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
    }
    const t = tableFromMatrix(aoa);
    if (!t.rows.length) { toast("Não encontrei linhas de atendimento no arquivo."); return; }
    const tab = { headers: t.headers, rows: t.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? localISO(v) : normDateText(v)]))) };
    const anterior = doc.mapping || {};
    const auto = autoMap(tab.headers);
    // reaproveita o mapeamento anterior quando as colunas são as mesmas
    const reuse = Object.values(anterior).filter(Boolean).every(h => tab.headers.includes(h)) && Object.values(anterior).some(Boolean);
    doc.mapping = reuse ? anterior : auto;
    doc.arquivo = { nome: file.name, linhas: tab.rows.length, carregadoEm: new Date().toISOString() };
    if (cfg.guardarDetalhe) { doc.tabela = tab; tableMem = null; } else { doc.tabela = null; tableMem = tab; }
    result = null; doc.resumo = null;
    store.audit(doc, "Arquivo carregado", `${file.name} (${tab.rows.length} linhas)`, operador());
    persist();
    renderStep1(); renderStep2(); renderSteps();
    $("#mapMsg").textContent = reuse ? "Usei as mesmas colunas do arquivo anterior. Confira e calcule." : "Confira as colunas e calcule.";
  } catch (e) {
    console.error(e);
    toast("Não consegui ler o arquivo. Use o relatório em PDF, Excel (.xlsx) ou CSV e tente de novo.");
  }
}

function renderStep1() {
  const t = tabela();
  const locked = isApproved();
  $("#lockNote1").innerHTML = locked ? `<div class="alert info"><span class="dot"></span><div class="txt">Período aprovado: arquivo, colunas e ajustes estão travados.</div></div>` : "";
  $("#drop").hidden = locked;
  $("#fileInfo").textContent = doc.arquivo ? `${doc.arquivo.nome}: ${doc.arquivo.linhas} linhas` : "Relatório do sistema da clínica em PDF, Excel ou CSV";
  if (!t) { $("#mapBox").hidden = true; if (doc.arquivo && !locked) $("#fileInfo").textContent += " (carregue de novo: o detalhe não fica guardado)"; return; }
  $("#mapBox").hidden = false;
  const opts = h => `<option value="">— não tem —</option>` + t.headers.map(x => `<option ${x === h ? "selected" : ""} value="${esc(x)}">${esc(x)}</option>`).join("");
  $("#map").innerHTML = FIELDS.map(f => `<label><span class="${f.req ? "req" : ""}">${f.label}</span><select data-k="${f.k}" ${locked ? "disabled" : ""}>${opts(doc.mapping[f.k])}</select></label>`).join("");
  $$("#map select").forEach(s => s.onchange = () => { doc.mapping[s.dataset.k] = s.value; persist(); });
  $("#calc").disabled = locked; $("#aiMap").disabled = locked;
  $("#aiMap").hidden = cfg.ai.mode === "off";
}

/* ================================================================== */
/* Cálculo                                                             */
/* ================================================================== */
function recalc(showErrors = true) {
  const t = tabela();
  if (!t) { result = null; return false; }
  const miss = missingRequired(doc.mapping);
  if (miss.length) { if (showErrors) $("#mapMsg").textContent = `Escolha a coluna de: ${miss.join(", ")}.`; result = null; return false; }
  try {
    result = compute({ rows: t.rows, mapping: doc.mapping, rules: rulesInUse(), ajustes: doc.ajustes });
  } catch (e) {
    result = null;
    if (showErrors) { $("#mapMsg").textContent = e.message; toast("Corrija as regras antes de calcular"); }
    return false;
  }
  // Atendimentos com data fora do período: evita pagar o mês inteiro numa quinzena
  const pp = doc.aprovacao ? doc.periodo : period;
  if (doc.mapping.data && pp?.inicio && pp?.fim) {
    const fora = result.linhas.filter(l => typeof l.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.data) && (l.data < pp.inicio || l.data > pp.fim));
    if (fora.length) {
      const v = fora.reduce((a, l) => a + (Number(l.valor) || 0), 0);
      result.alerts.unshift({ code: "FORA_PERIODO", level: "bad", msg: `${fora.length} atendimento(s) fora do período ${br(pp.inicio)} a ${br(pp.fim)} (${formatBRL(v)}). Escolha o período certo ou use um relatório só deste período`, linhas: fora.map(l => l.i) });
      result.bloqueado = true;
    }
  }
  const integ = checkIntegrity(result);
  if (!integ.ok) {
    result.alerts.unshift({ code: "INTEGRIDADE", level: "bad", msg: "Falha na prova real do cálculo. Não aprove e contate o suporte.", linhas: [] });
    result.bloqueado = true;
  }
  if (!isApproved()) {
    doc.resumo = summary(result);
    persist();
  } else if (result.totals.total !== doc.aprovacao.snapshot.totals.total) {
    result.alerts.unshift({ code: "DIVERGE", level: "warn", msg: "O detalhe guardado não bate com o total aprovado. Os valores aprovados prevalecem.", linhas: [] });
  }
  if (showErrors) $("#mapMsg").textContent = "";
  return true;
}

function summary(r) {
  return {
    totals: r.totals,
    medicos: r.medicos.map(m => ({ key: m.key, nome: m.nome, fornecedor: m.fornecedor, tipo: m.tipo, nCons: m.nCons, nExa: m.nExa, brutoCons: m.brutoCons, brutoExa: m.brutoExa, repConsBase: m.repCons, repExaBase: m.repExa, repCons: m.repCons + m.ajustesCons, repExa: m.repExa + m.ajustesExa, ajustes: m.ajustesCons + m.ajustesExa, total: m.total })),
    alertas: r.alerts.map(a => ({ code: a.code, level: a.level, msg: a.msg, qtd: a.linhas.length })),
    bloqueado: r.bloqueado,
    calculadoEm: new Date().toISOString(),
  };
}

function onCalc() {
  if (recalc(true)) {
    store.audit(doc, "Cálculo", `Total ${formatBRL(result.totals.total)}; ${result.alerts.filter(a => a.level === "bad").length} alerta(s) bloqueante(s)`, operador());
    persist();
    renderAll();
    $("#st2").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

/* ================================================================== */
/* Etapa 2: conferência e ajustes                                      */
/* ================================================================== */
function medicosView() { return isApproved() ? doc.aprovacao.snapshot.medicos : (doc.resumo?.medicos || []); }
function totalsView() { return isApproved() ? doc.aprovacao.snapshot.totals : doc.resumo?.totals; }

function renderStep2() {
  const meds = medicosView(), tot = totalsView();
  if (!tot) { $("#alerts").innerHTML = ""; $("#resumo").innerHTML = ""; $("#alertSummary").className = "pill neutral"; $("#alertSummary").textContent = "Aguardando cálculo"; $("#ajBox").hidden = true; $("#analyzeRow").hidden = true; return; }
  const alerts = result ? result.alerts : (isApproved() ? doc.aprovacao.snapshot.alertas : doc.resumo.alertas).map(a => ({ ...a, linhas: [] }));
  const bad = alerts.filter(a => a.level === "bad").length, warn = alerts.filter(a => a.level === "warn").length;
  $("#alertSummary").className = "pill " + (bad ? "bad" : warn ? "warn" : "ok");
  $("#alertSummary").textContent = bad ? `${bad} alerta(s) que bloqueiam` : warn ? `${warn} ponto(s) de atenção` : "Tudo certo";
  const linhaTxt = i => {
    const l = result?.linhas[i]; if (!l) return "";
    return `Linha ${i + 1}: ${esc(l.medico || "(sem médico)")} · ${esc(l.procedimento)} · ${esc(l.data)} · ${formatBRL(l.valor)}`;
  };
  $("#alerts").innerHTML = (alerts.length ? alerts : [{ level: "ok", msg: "Nenhum alerta. Pode pedir a aprovação.", linhas: [] }]).map(a => {
    const n = a.linhas?.length || a.qtd || 0;
    return `<div class="alert ${a.level}"><span class="dot" aria-hidden="true"></span><div class="txt"><b>${esc(a.msg)}</b>${n ? ` <span class="muted">(${n})</span>` : ""}${a.linhas?.length ? `<details><summary class="small">Ver linhas</summary><div class="small">${a.linhas.slice(0, 50).map(linhaTxt).join("<br>")}${a.linhas.length > 50 ? "<br>…" : ""}</div></details>` : ""}</div></div>`;
  }).join("");

  const pctRep = tot.bruto ? (tot.total / tot.bruto * 100).toFixed(2).replace(".", ",") : "0,00";
  $("#resumo").innerHTML = `
    <div class="row mt between">
      <div><div class="muted small">Total de repasse da ${esc(period.label)}</div><div class="total">${formatBRL(tot.total)}</div>
      <div class="muted small">${meds.length} médicos · ${tot.linhasCalculadas} de ${tot.linhas} linhas calculadas · produção ${formatBRL(tot.bruto)} · repasse ${pctRep}% da produção${tot.ajustes ? ` · ajustes ${formatBRL(tot.ajustes)}` : ""}</div></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Médico</th><th>Fornecedor</th><th class="num">Consultas</th><th class="num">Repasse consultas</th><th class="num">Exames</th><th class="num">Repasse exames</th><th class="num">Total</th></tr></thead>
      <tbody>${meds.map((m, ix) => `<tr class="${result ? "clickable" : ""}" data-key="${esc(m.key)}" tabindex="${result ? 0 : -1}"><td>${esc(m.nome)}${m.tipo === "PJ" ? ' <span class="pill neutral">PJ</span>' : ""}</td><td>${m.fornecedor ? esc(m.fornecedor) : '<span class="muted">sem cadastro</span>'}</td><td class="num">${m.nCons}</td><td class="num">${formatBRL(m.repCons)}</td><td class="num">${m.nExa}</td><td class="num">${formatBRL(m.repExa)}</td><td class="num"><b>${formatBRL(m.total)}</b></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td></td><td class="num">${meds.reduce((s, m) => s + m.nCons, 0)}</td><td class="num">${formatBRL(tot.repCons)}</td><td class="num">${meds.reduce((s, m) => s + m.nExa, 0)}</td><td class="num">${formatBRL(tot.repExa)}</td><td class="num">${formatBRL(tot.total)}</td></tr></tfoot>
    </table></div>${result ? '<p class="muted small">Clique em um médico para ver como cada atendimento foi calculado.</p>' : ""}`;
  if (result) $$("#resumo tr.clickable").forEach(tr => {
    const toggle = () => {
      const nx = tr.nextElementSibling;
      if (nx?.classList.contains("detail")) { nx.remove(); return; }
      const m = result.medicos.find(x => x.key === tr.dataset.key); if (!m) return;
      const d = document.createElement("tr"); d.className = "detail";
      d.innerHTML = `<td colspan="7"><div class="tablewrap"><table><thead><tr><th>Data</th><th>Paciente</th><th>Procedimento</th><th>Pagamento</th><th class="num">Valor</th><th>Regra aplicada</th><th class="num">Repasse</th></tr></thead><tbody>${m.linhas.map(i => { const l = result.linhas[i]; return `<tr><td>${esc(br(l.data) || l.data)}</td><td>${esc(l.paciente)}</td><td>${esc(l.procedimento)}</td><td>${esc(FORMAS[l.forma])}</td><td class="num">${formatBRL(l.valor)}</td><td class="small">${esc(l.regra)}</td><td class="num">${formatBRL(l.repasse)}</td></tr>`; }).join("")}</tbody></table></div></td>`;
      tr.after(d);
    };
    tr.onclick = toggle; tr.onkeydown = e => { if (e.key === "Enter") toggle(); };
  });
  renderAjustes();
  $("#analyzeRow").hidden = cfg.ai.mode === "off";
}

function renderAjustes() {
  const box = $("#ajBox");
  box.hidden = !totalsView();
  const locked = isApproved();
  $$("#ajBox .ajForm input, #ajBox .ajForm select, #ajBox .ajForm button").forEach(e => e.disabled = locked);
  $("#medList").innerHTML = [...new Set([...medicosView().map(m => m.nome), ...cfg.rules.medicos.map(m => m.nome)])].map(n => `<option value="${esc(n)}">`).join("");
  const aj = doc.ajustes || [];
  if (aj.length) box.open = true;
  $("#ajTable").innerHTML = aj.length ? `<thead><tr><th>Médico</th><th>Tipo</th><th>Categoria</th><th class="num">Valor</th><th>Motivo</th><th></th></tr></thead><tbody>${aj.map((a, i) => `<tr><td>${esc(a.medico)}</td><td>${a.tipo === "desconto" ? "Desconto" : "Acréscimo"}</td><td>${a.categoria === "exames" ? "Exames" : "Consultas"}</td><td class="num">${formatBRL(a.tipo === "desconto" ? -a.valor : a.valor)}</td><td>${esc(a.motivo)}</td><td>${locked ? "" : `<button class="btn sm ghost" data-del="${i}" type="button">Remover</button>`}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="muted">Nenhum ajuste neste período.</td></tr></tbody>`;
  $$("#ajTable [data-del]").forEach(b => b.onclick = () => {
    const a = doc.ajustes.splice(Number(b.dataset.del), 1)[0];
    store.audit(doc, "Ajuste removido", `${a.medico}: ${formatBRL(a.valor)} (${a.motivo})`, operador());
    recalc(false); persist(); renderAll();
  });
}

function addAjuste() {
  const medico = $("#ajMed").value.trim(), motivo = $("#ajMot").value.trim();
  const valor = parseMoney($("#ajVal").value);
  if (!medico) return toast("Informe o médico");
  if (!Number.isFinite(valor) || valor <= 0) return toast("Informe um valor maior que zero");
  if (!motivo) return toast("Informe o motivo do ajuste");
  const a = { id: crypto.randomUUID(), medico, tipo: $("#ajTipo").value, categoria: $("#ajCat").value, valor, motivo, em: new Date().toISOString(), por: operador() };
  doc.ajustes.push(a);
  store.audit(doc, "Ajuste incluído", `${medico}: ${a.tipo} ${formatBRL(valor)} (${motivo})`, operador());
  $("#ajMed").value = $("#ajVal").value = $("#ajMot").value = "";
  if (!recalc(true)) { doc.ajustes.pop(); return; }
  persist(); renderAll();
}

/* ================================================================== */
/* Etapa 3: aprovação                                                  */
/* ================================================================== */
function approvalMessage() {
  const meds = medicosView(), tot = totalsView(); if (!tot) return "";
  const r = rulesInUse();
  const conf = (r.especiais || []).filter(e => /confirmar/i.test(e.nota || "")).map(e => `Regra de ${e.nome} (${e.pct}% sobre o ${e.base === "bruto" ? "bruto" : "líquido"}) ainda está a confirmar.`);
  const aj = (doc.ajustes || []).map(a => `• ${a.medico}: ${a.tipo === "desconto" ? "desconto" : "acréscimo"} de ${formatBRL(a.valor)} (${a.motivo})`);
  const bad = result ? result.alerts.filter(a => a.level === "bad").length : 0;
  const quem = cfg.clinica.aprovador || "Doutor(a)";
  return `${quem}, segue o repasse da ${period.label} (atendimentos de ${br(period.inicio)} a ${br(period.fim)}) para aprovação:

${meds.map(m => `• ${m.nome}: ${formatBRL(m.total)} (consultas ${formatBRL(m.repCons)}, exames ${formatBRL(m.repExa)})`).join("\n")}

Total: ${formatBRL(tot.total)}
Pagamento previsto: ${br(period.pagamento)}${aj.length ? `\n\nAjustes incluídos:\n${aj.join("\n")}` : ""}${conf.length ? `\n\n${conf.join("\n")}` : ""}
Alertas pendentes: ${bad ? bad + " (ainda em correção)" : "nenhum"}

Posso lançar e pagar?`;
}

function renderStep3() {
  const ap = doc.aprovacao;
  $("#approvalBody").hidden = !!ap; $("#approvedBody").hidden = !ap;
  $("#approvalPill").className = "pill " + (ap ? "ok" : "neutral");
  $("#approvalPill").textContent = ap ? `Aprovado por ${ap.por}` : "Não aprovado";
  if (ap) {
    $("#approvedText").innerHTML = `Aprovado por <b>${esc(ap.por)}</b> em ${esc(br(ap.em))}${ap.obs ? ` (${esc(ap.obs)})` : ""}. Total aprovado: <b>${formatBRL(ap.snapshot.totals.total)}</b>. Registrado por ${esc(ap.registradoPor)} em ${esc(fmtDT(ap.registradoEm))}.`;
    return;
  }
  $("#approvalMsg").value = approvalMessage();
  if (!$("#apPor").dataset.touched) $("#apPor").value = cfg.clinica.aprovador || "";
  if (!$("#apEm").value) $("#apEm").value = todayISO();
  const can = !!result && !result.bloqueado;
  $("#approve").disabled = !can;
  $("#approve").title = !result ? "Calcule primeiro (com o arquivo carregado)" : result.bloqueado ? "Resolva os alertas vermelhos antes" : "";
}

async function approve() {
  if (!result || result.bloqueado) return;
  const por = $("#apPor").value.trim(), em = $("#apEm").value, obs = $("#apObs").value.trim();
  if (!por) return toast("Informe quem aprovou");
  if (!em) return toast("Informe a data da aprovação");
  if (em > todayISO()) return toast("A data da aprovação não pode ser futura");
  const ok = await confirmDlg("Registrar aprovação", `Confirmar que ${por} aprovou o total de ${formatBRL(result.totals.total)}? Depois disso, arquivo, regras e ajustes deste período ficam travados.`);
  if (!ok) return;
  doc.periodo = period;
  doc.aprovacao = {
    por, em, obs, registradoPor: operador(), registradoEm: new Date().toISOString(),
    regras: structuredClone(cfg.rules), snapshot: summary(result),
  };
  store.audit(doc, "Aprovação registrada", `${por} em ${br(em)}: ${formatBRL(result.totals.total)}`, operador());
  persist(); renderAll();
  $("#st4").scrollIntoView({ block: "start" });
}

async function reopen() {
  const motivo = await confirmDlg("Reabrir período", "O período volta para conferência e a aprovação atual é cancelada. Os controles de lançamento e pagamento ficam guardados. Informe o motivo:", { input: true, placeholder: "Ex.: médico apontou atendimento faltando", okLabel: "Reabrir" });
  if (!motivo) return;
  const ap = doc.aprovacao;
  doc.aprovacoesAnteriores ||= [];
  doc.aprovacoesAnteriores.push({ ...ap, canceladaEm: new Date().toISOString(), motivo });
  doc.aprovacao = null;
  doc.fechadoEm = null;
  store.audit(doc, "Período reaberto", `Motivo: ${motivo}. Aprovação anterior: ${formatBRL(ap.snapshot.totals.total)}`, operador());
  const anyPaid = Object.values(doc.status || {}).some(s => s.pago);
  persist(); recalc(false); renderAll();
  if (anyPaid) toast("Atenção: há médicos marcados como pagos. Diferenças entram como ajuste.");
}

/* ================================================================== */
/* Etapas 4–6                                                          */
/* ================================================================== */
const st = k => (doc.status || {})[k] || {};
function setStatus(k, f, v) {
  doc.status ||= {}; doc.status[k] ||= {};
  doc.status[k][f] = v; doc.status[k][f + "Em"] = v ? new Date().toISOString() : null;
  const m = medicosView().find(x => x.key === k);
  store.audit(doc, v ? `Marcado: ${f}` : `Desmarcado: ${f}`, m?.nome || k, operador());
  const meds = medicosView();
  const fechado = meds.length && meds.every(x => st(x.key).conciliado && st(x.key).enviado);
  if (fechado && !doc.fechadoEm) { doc.fechadoEm = new Date().toISOString(); store.audit(doc, "Período fechado", "", operador()); }
  if (!fechado) doc.fechadoEm = null;
  persist(); renderStep5(); renderSteps(); renderHeaderStatus();
}
function bindChecks(root) {
  root.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copy(b.dataset.copy));
  root.querySelectorAll("input[type=checkbox][data-k]").forEach(c => c.onchange = () => setStatus(c.dataset.k, c.dataset.f, c.checked));
}

function renderStep4() {
  const p = doc.aprovacao ? doc.periodo : period;
  const meds = isApproved() ? medicosView() : [];
  $("#caCards").innerHTML = meds.map(m => {
    const desc = `Repasse ${m.nome} – ${p.curto}`;
    const kv = [
      ["Fornecedor", m.fornecedor || `${m.nome} (cadastrar)`, m.fornecedor || m.nome],
      ["Descrição", desc, desc],
      ["Valor", formatBRL(m.total), formatPlain(m.total)],
      ["Competência", p.competencia, p.competencia],
      ["Vencimento", br(p.pagamento), br(p.pagamento)],
      ["Repasse consultas", formatBRL(m.repCons), formatPlain(m.repCons)],
      ["Repasse exames", formatBRL(m.repExa), formatPlain(m.repExa)],
    ];
    return `<div class="card"><div class="title"><h3>${esc(m.nome)}</h3><b>${formatBRL(m.total)}</b></div>
      <div class="kv">${kv.map(([k, v, c]) => `<span class="k">${k}</span><span class="v">${esc(v)}</span><button class="copy" type="button" data-copy="${esc(c)}">copiar</button>`).join("")}</div>
      ${m.tipo === "PJ" ? `<div class="checks"><label><input type="checkbox" data-k="${esc(m.key)}" data-f="nf" ${st(m.key).nf ? "checked" : ""}> Nota fiscal recebida e anexada</label></div>` : ""}
      <div class="checks"><label><input type="checkbox" data-k="${esc(m.key)}" data-f="lancado" ${st(m.key).lancado ? "checked" : ""}> Lançado</label></div></div>`;
  }).join("") || `<p class="muted">Liberado após a aprovação.</p>`;
  bindChecks($("#caCards"));
}

function renderStep5() {
  const p = doc.aprovacao ? doc.periodo : period;
  const meds = isApproved() ? medicosView() : [];
  if (!meds.length) { $("#payTable").innerHTML = `<tbody><tr><td class="muted">Liberado após a aprovação.</td></tr></tbody>`; return; }
  const cb = (m, f, dis = false) => `<input type="checkbox" aria-label="${f} ${esc(m.nome)}" data-k="${esc(m.key)}" data-f="${f}" ${st(m.key)[f] ? "checked" : ""} ${dis ? "disabled" : ""}>`;
  const pagar = meds.filter(m => m.total > 0);
  $("#payTable").innerHTML = `<thead><tr><th>Médico</th><th class="num">Valor do PIX</th><th>Descrição</th><th>Pago</th><th>Conciliado</th></tr></thead>
    <tbody>${pagar.map(m => {
      const travaNF = m.tipo === "PJ" && !st(m.key).nf;
      return `<tr><td>${esc(m.nome)}${travaNF ? ' <span class="pill warn">aguardando NF</span>' : ""}</td><td class="num">${formatBRL(m.total)} <button class="copy" type="button" data-copy="${formatPlain(m.total)}">copiar</button></td><td>${esc(p.pix)} <button class="copy" type="button" data-copy="${esc(p.pix)}">copiar</button></td><td>${cb(m, "pago", travaNF && !st(m.key).pago)}</td><td>${cb(m, "conciliado", !st(m.key).pago)}</td></tr>`;
    }).join("")}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${formatBRL(pagar.reduce((s, m) => s + m.total, 0))}</td><td></td><td>${pagar.filter(m => st(m.key).pago).length}/${pagar.length}</td><td>${pagar.filter(m => st(m.key).conciliado).length}/${pagar.length}</td></tr></tfoot>`;
  bindChecks($("#payTable"));
}

function demoText(m) {
  const p = doc.periodo;
  return `Olá, ${m.nome}. Segue seu demonstrativo de repasse da ${p.label} (atendimentos de ${br(p.inicio)} a ${br(p.fim)}):

Consultas: ${m.nCons} · repasse ${formatBRL(m.repConsBase ?? m.repCons)}
Exames: ${m.nExa} · repasse ${formatBRL(m.repExaBase ?? m.repExa)}${m.ajustes ? `\nAjustes: ${formatBRL(m.ajustes)}` : ""}
Total: ${formatBRL(m.total)}
Pagamento: PIX ${st(m.key).pago ? "realizado" : "previsto"} em ${br(p.pagamento)}.

Se encontrar alguma divergência, me avise em até 3 dias úteis.
${operador()} – ${cfg.clinica.nome || "Clínica"}`;
}

function renderStep6() {
  const meds = isApproved() ? medicosView() : [];
  $("#printAll").disabled = $("#csvAll").disabled = !meds.length;
  $("#csvDet").disabled = !meds.length || !result;
  $("#demoCards").innerHTML = meds.map(m => `<div class="card"><div class="title"><h3>${esc(m.nome)}</h3><b>${formatBRL(m.total)}</b></div>
    <div class="row mt"><button class="btn sm" type="button" data-msg="${esc(m.key)}">Copiar mensagem</button><button class="btn sm" type="button" data-print="${esc(m.key)}">Imprimir / PDF</button></div>
    <div class="checks"><label><input type="checkbox" data-k="${esc(m.key)}" data-f="enviado" ${st(m.key).enviado ? "checked" : ""}> Demonstrativo enviado</label></div></div>`).join("") || `<p class="muted">Liberado após a aprovação.</p>`;
  bindChecks($("#demoCards"));
  $$("#demoCards [data-msg]").forEach(b => b.onclick = () => copy(demoText(meds.find(m => m.key === b.dataset.msg))));
  $$("#demoCards [data-print]").forEach(b => b.onclick = () => printDemos([meds.find(m => m.key === b.dataset.print)]));
}

function printDemos(meds) {
  const p = doc.periodo;
  const clin = cfg.clinica;
  $("#print").innerHTML = meds.map(m => {
    const det = result?.medicos.find(x => x.key === m.key);
    const linhas = det ? det.linhas.map(i => result.linhas[i]) : [];
    return `<section class="demo">
      <h1>Demonstrativo de repasse médico</h1>
      <div>${esc(clin.nome || "")}${clin.cnpj ? ` – CNPJ ${esc(clin.cnpj)}` : ""}</div>
      <p><b>Médico:</b> ${esc(m.nome)}${m.fornecedor ? ` (${esc(m.fornecedor)})` : ""}<br><b>Período:</b> ${esc(p.label)}, atendimentos de ${br(p.inicio)} a ${br(p.fim)}<br><b>Pagamento:</b> ${br(p.pagamento)} por PIX</p>
      ${linhas.length ? `<table><thead><tr><th>Data</th><th>Paciente</th><th>Procedimento</th><th>Pagamento</th><th class="num">Valor</th><th class="num">Repasse</th></tr></thead><tbody>${linhas.map(l => `<tr><td>${esc(br(l.data) || l.data)}</td><td>${esc(l.paciente)}</td><td>${esc(l.procedimento)}</td><td>${esc(FORMAS[l.forma])}</td><td class="num">${formatBRL(l.valor)}</td><td class="num">${formatBRL(l.repasse)}</td></tr>`).join("")}</tbody></table>` : `<p><i>Detalhe dos atendimentos não disponível neste computador.</i></p>`}
      <table><tbody>
        <tr><td>Consultas (${m.nCons})</td><td class="num">${formatBRL(m.repConsBase ?? m.repCons)}</td></tr>
        <tr><td>Exames (${m.nExa})</td><td class="num">${formatBRL(m.repExaBase ?? m.repExa)}</td></tr>
        ${(doc.ajustes || []).filter(a => medicoKey(a.medico) === m.key).map(a => `<tr><td>Ajuste: ${esc(a.motivo)}</td><td class="num">${formatBRL(a.tipo === "desconto" ? -a.valor : a.valor)}</td></tr>`).join("")}
      </tbody></table>
      <div class="tot">Total do repasse: ${formatBRL(m.total)}</div>
      <p class="small">Aprovado por ${esc(doc.aprovacao.por)} em ${br(doc.aprovacao.em)}. Divergências devem ser comunicadas em até 3 dias úteis.</p>
      <div class="sig"><div>${esc(clin.nome || "Clínica")}</div><div>${esc(m.nome)}</div></div>
    </section>`;
  }).join("");
  window.print();
}

function csvResumo() {
  const p = doc.periodo;
  const rows = [["Período", "Médico", "Fornecedor", "Tipo", "Consultas", "Repasse consultas", "Exames", "Repasse exames", "Ajustes", "Total", "Lançado", "Pago", "Conciliado", "Enviado"],
    ...medicosView().map(m => [p.label, m.nome, m.fornecedor, m.tipo, m.nCons, formatPlain(m.repCons), m.nExa, formatPlain(m.repExa), formatPlain(m.ajustes || 0), formatPlain(m.total), st(m.key).lancado ? "sim" : "", st(m.key).pago ? "sim" : "", st(m.key).conciliado ? "sim" : "", st(m.key).enviado ? "sim" : ""])];
  download(`repasse_${p.id}_resumo.csv`, toCSV(rows));
}
function csvDetalhe() {
  if (!result) return;
  const p = doc.periodo;
  const rows = [["Linha", "Data", "Médico", "Paciente", "Procedimento", "Tipo", "Pagamento", "Valor", "Regra", "Repasse", "Situação"],
    ...result.linhas.map(l => [l.i + 1, br(l.data) || l.data, l.medico, l.paciente, l.procedimento, l.tipo, FORMAS[l.forma], formatPlain(l.valor), l.regra, formatPlain(l.repasse), l.status])];
  download(`repasse_${p.id}_detalhe.csv`, toCSV(rows));
}

function renderAudit() {
  const a = [...(doc.auditoria || [])].reverse();
  $("#audTable").innerHTML = a.length ? `<thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>${a.map(x => `<tr><td>${esc(fmtDT(x.em))}</td><td>${esc(x.operador)}</td><td>${esc(x.acao)}</td><td class="wrapcell">${esc(x.detalhe)}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="muted">Sem registros.</td></tr></tbody>`;
}

function renderSteps() {
  const has = !!totalsView(), ap = isApproved();
  const meds = ap ? medicosView() : [];
  const pagar = meds.filter(m => m.total > 0);
  const all = (list, f) => list.length > 0 && list.every(m => st(m.key)[f]);
  const set = (id, locked, done, active) => { const e = $(id); setLocked(e, locked); e.classList.toggle("done", !!done); e.classList.toggle("active", !!active && !done); };
  set("#st1", false, has, !has);
  set("#st2", !has, ap, has && !ap);
  set("#st3", !has, ap, has && !ap);
  set("#st4", !ap, all(meds, "lancado"), ap);
  set("#st5", !ap, all(pagar, "pago") && all(pagar, "conciliado"), ap && all(meds, "lancado"));
  set("#st6", !ap, all(meds, "enviado"), ap && all(pagar, "pago"));
}

function renderHeaderStatus() {
  const pill = $("#periodStatus");
  if (!doc) return;
  if (doc.fechadoEm) { pill.className = "pill ok"; pill.textContent = "Fechado"; }
  else if (isApproved()) { pill.className = "pill warn"; pill.textContent = "Aprovado, em pagamento"; }
  else if (totalsView()) { pill.className = "pill warn"; pill.textContent = "Em conferência"; }
  else { pill.className = "pill neutral"; pill.textContent = "Novo"; }
}

function renderAll() {
  renderStep1(); renderStep2(); renderStep3(); renderStep4(); renderStep5(); renderStep6();
  renderAudit(); renderSteps(); renderHeaderStatus();
}

/* ================================================================== */
/* Regras                                                              */
/* ================================================================== */
function editable(sel, arr, cols, onChange) {
  const t = $(sel);
  t.innerHTML = `<thead><tr>${cols.map(c => `<th>${c.l}</th>`).join("")}<th></th></tr></thead><tbody>${arr.map((o, i) => `<tr>${cols.map(c => `<td>${c.opts
    ? `<select data-i="${i}" data-k="${c.k}" aria-label="${c.l}">${c.opts.map(([v, l]) => `<option value="${v}" ${String(o[c.k]) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`
    : `<input data-i="${i}" data-k="${c.k}" type="text" ${c.num ? 'inputmode="decimal"' : ""} aria-label="${c.l}" value="${esc(o[c.k] ?? "")}">`}</td>`).join("")}<td><button class="btn sm ghost" type="button" data-del="${i}">Remover</button></td></tr>`).join("") || `<tr><td colspan="${cols.length + 1}" class="muted">Nenhum item.</td></tr>`}</tbody>`;
  t.querySelectorAll("[data-k]").forEach(inp => inp.oninput = inp.onchange = () => { arr[inp.dataset.i][inp.dataset.k] = inp.value; onChange?.(); });
  t.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { arr.splice(Number(b.dataset.del), 1); editable(sel, arr, cols, onChange); onChange?.(); });
}

const EXA_COLS = [{ k: "chave", l: "Procedimento contém" }, { k: "modo", l: "Tipo de valor", opts: [["fixo", "Fixo (R$)"], ["percentual", "% do líquido"]] }, { k: "valor", l: "Valor", num: true }];
const ESP_COLS = [{ k: "nome", l: "Nome do médico contém" }, { k: "pct", l: "% da consulta", num: true }, { k: "base", l: "Base", opts: [["liquido", "Líquido"], ["bruto", "Bruto"]] }, { k: "nota", l: "Observação" }];
const PAY_COLS = [{ k: "contem", l: "Texto no relatório" }, { k: "forma", l: "É", opts: Object.entries(FORMAS).filter(([k]) => k !== "desconhecida") }];

function renderRules() {
  draftRules = structuredClone(cfg.rules);
  const r = draftRules;
  $("#rImposto").value = r.impostoPct; $("#rConsulta").value = r.consultaPct;
  $("#rDeb").value = r.taxas.debito; $("#rCred").value = r.taxas.credito; $("#rParc").value = r.taxas.parcelado;
  $("#rDescTaxa").value = r.descontarTaxa === false ? "0" : "1";
  $("#rConv").value = r.convenioPolicy; $("#rConvWords").value = (r.convenioWords || []).join(", ");
  editable("#exaTable", r.exames, EXA_COLS);
  editable("#espTable", r.especiais, ESP_COLS);
  editable("#payMapTable", r.paymentMap, PAY_COLS);
  ["#rImposto", "#rConsulta", "#rDeb", "#rCred", "#rParc", "#rDescTaxa"].forEach(s => $(s).oninput = $(s).onchange = renderFormula);
  renderFormula(); $("#rulesErr").innerHTML = "";
  const log = [...(cfg.rulesLog || [])].reverse();
  $("#rulesLog").innerHTML = log.length ? `<thead><tr><th>Quando</th><th>Aprovado por</th><th>Registrado por</th><th>Mudanças</th></tr></thead><tbody>${log.map(x => `<tr><td>${esc(fmtDT(x.em))}</td><td>${esc(x.aprovadoPor)}</td><td>${esc(x.operador)}</td><td class="wrapcell">${esc(x.mudancas)}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="muted">Nenhuma mudança registrada.</td></tr></tbody>`;
}

function renderFormula() {
  const imp = $("#rImposto").value || 0, c = $("#rConsulta").value || 0;
  const v = 30000, ex = Math.round(v * (1 - Number(String(imp).replace(",", ".")) / 100) * Number(String(c).replace(",", ".")) / 100);
  $("#formula").innerHTML = `<b>Consulta:</b> repasse = ${esc(c)}% × (valor − ${esc(imp)}% de imposto${$("#rDescTaxa").value === "1" ? " − taxa do cartão" : ""}). Exemplo: consulta de R$ 300,00 por PIX gera ${Number.isFinite(ex) ? formatBRL(ex) : "—"} de repasse.`;
}

function readRulesForm() {
  const r = draftRules;
  r.impostoPct = $("#rImposto").value.trim(); r.consultaPct = $("#rConsulta").value.trim();
  r.taxas = { debito: $("#rDeb").value.trim() || 0, credito: $("#rCred").value.trim() || 0, parcelado: $("#rParc").value.trim() || 0 };
  r.descontarTaxa = $("#rDescTaxa").value === "1";
  r.convenioPolicy = $("#rConv").value;
  r.convenioWords = $("#rConvWords").value.split(",").map(s => s.trim()).filter(Boolean);
  r.exames = r.exames.filter(e => String(e.chave || "").trim() || String(e.valor || "").trim());
  r.especiais = r.especiais.filter(e => String(e.nome || "").trim());
  r.paymentMap = r.paymentMap.filter(e => String(e.contem || "").trim());
  return r;
}

function describeChanges(a, b) {
  const out = [];
  const f = (k, l) => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${l}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`); };
  f("impostoPct", "imposto"); f("consultaPct", "consulta"); f("taxas", "taxas"); f("descontarTaxa", "desconta taxa"); f("convenioPolicy", "convênio");
  for (const [k, l] of [["exames", "tabela de exames"], ["especiais", "regras especiais"], ["paymentMap", "formas de pagamento"], ["convenioWords", "palavras de convênio"], ["medicos", "cadastro de médicos"]])
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${l} alterada (${(b[k] || []).length} itens)`);
  return out.join("; ") || "sem mudança";
}

function saveRulesWith(newRules, aprovEl, errEl) {
  const aprov = $(aprovEl).value.trim();
  const problems = validateRules(newRules);
  if (problems.length) { $(errEl).innerHTML = problems.map(p => `<div class="alert bad"><span class="dot"></span><div class="txt">${esc(p)}</div></div>`).join(""); return false; }
  const mud = describeChanges(cfg.rules, newRules);
  if (mud === "sem mudança") { toast("Nada mudou"); return false; }
  if (!aprov) { $(errEl).innerHTML = `<div class="alert bad"><span class="dot"></span><div class="txt">Informe quem aprovou a mudança.</div></div>`; $(aprovEl).focus(); return false; }
  cfg.rulesLog ||= [];
  cfg.rulesLog.push({ em: new Date().toISOString(), aprovadoPor: aprov, operador: operador(), mudancas: mud });
  cfg.rules = structuredClone(newRules);
  store.saveConfig(cfg);
  $(aprovEl).value = ""; $(errEl).innerHTML = "";
  toast("Salvo");
  if (!isApproved() && tabela()) { recalc(false); }
  renderAll();
  return true;
}

function renderMedicos() {
  draftMedicos = structuredClone(cfg.rules.medicos || []);
  editable("#medTable", draftMedicos, [{ k: "nome", l: "Nome no relatório" }, { k: "aliases", l: "Outros nomes" }, { k: "fornecedor", l: "Fornecedor no financeiro" }, { k: "tipo", l: "PF ou PJ", opts: [["PF", "PF"], ["PJ", "PJ"]] }, { k: "chavePix", l: "Chave PIX" }]);
  $("#medErr").innerHTML = "";
}

/* ================================================================== */
/* Histórico                                                           */
/* ================================================================== */
function renderHistory() {
  const list = store.listPeriods();
  const t = $("#histTable");
  if (!list.length) { t.innerHTML = `<tbody><tr><td class="muted">Nenhum período registrado ainda.</td></tr></tbody>`; $("#histChart").innerHTML = ""; return; }
  const tot = p => p.aprovacao?.snapshot.totals.total ?? p.resumo?.totals.total ?? 0;
  t.innerHTML = `<thead><tr><th>Período</th><th class="num">Médicos</th><th class="num">Produção</th><th class="num">Repasse</th><th class="num">% da produção</th><th class="num">Variação</th><th>Aprovação</th><th>Situação</th></tr></thead><tbody>${list.map(p => {
    const prev = list.find(x => x.id === previousPeriodId(p.id));
    const v = prev && tot(prev) ? (tot(p) / tot(prev) - 1) * 100 : null;
    const s = p.aprovacao?.snapshot || p.resumo;
    const bruto = s?.totals.bruto || 0;
    const sit = p.fechadoEm ? '<span class="pill ok">Fechado</span>' : p.aprovacao ? '<span class="pill warn">Em pagamento</span>' : s ? '<span class="pill neutral">Em conferência</span>' : '<span class="pill neutral">Sem cálculo</span>';
    return `<tr class="clickable" tabindex="0" data-id="${esc(p.id)}"><td>${esc(p.label)}</td><td class="num">${s?.medicos.length ?? 0}</td><td class="num">${formatBRL(bruto)}</td><td class="num">${formatBRL(tot(p))}</td><td class="num">${bruto ? (tot(p) / bruto * 100).toFixed(1).replace(".", ",") + "%" : "—"}</td><td class="num">${v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + "%"}</td><td>${p.aprovacao ? esc(p.aprovacao.por) + " " + br(p.aprovacao.em) : ""}</td><td>${sit}</td></tr>`;
  }).join("")}</tbody>`;
  $$("#histTable tr[data-id]").forEach(tr => { const go = () => { const [y, m, tp] = tr.dataset.id.split("-"); selectPeriod(+y, +m, tp); location.hash = "#quinzena"; }; tr.onclick = go; tr.onkeydown = e => { if (e.key === "Enter") go(); }; });

  // gráfico: repasse por período, mais antigo à esquerda
  const pts = list.slice(0, 12).reverse().map(p => ({ l: p.id.slice(5, 7) + "/" + p.id.slice(2, 4) + (p.id.endsWith("M") ? "" : " " + p.id.slice(-2).replace("Q", "") + "Q"), v: tot(p) }));
  const W = 760, H = 220, pad = 30, max = Math.max(...pts.map(p => p.v), 1);
  const bw = (W - pad * 2) / pts.length;
  $("#histChart").className = "chart";
  $("#histChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Repasse total por período">${pts.map((p, i) => {
    const h = Math.max(0, (p.v / max) * (H - 70)); const x = pad + i * bw + bw * 0.15; const y = H - 30 - h;
    return `<rect class="bar" x="${x}" y="${y}" width="${bw * 0.7}" height="${h}" rx="3"></rect><text class="val" x="${x + bw * 0.35}" y="${y - 6}" text-anchor="middle">${(p.v / 100000).toFixed(1).replace(".", ",")} mil</text><text class="lbl" x="${x + bw * 0.35}" y="${H - 12}" text-anchor="middle">${esc(p.l)}</text>`;
  }).join("")}</svg>`;
}

/* ================================================================== */
/* IA                                                                  */
/* ================================================================== */
const POP = `Processo de repasse médico da clínica (executado pela auxiliar financeira, aprovado pelo responsável):
1) Exportar a produção do período do sistema da clínica (médico, paciente, data, procedimento, tipo, forma de pagamento, valor).
2) Carregar no RepasseMed e conferir as colunas. Ele calcula: consulta = % de repasse × (valor − imposto − taxa do cartão, se a clínica desconta); exame = valor fixo da tabela ou % do líquido. Médicos podem ter regra especial.
3) Resolver alertas vermelhos (sem médico, exame sem valor, procedimento sem regra, taxa zerada, total negativo). Não seguir com alerta vermelho. Ajustes manuais (adiantamento, glosa, complemento) exigem motivo.
4) Enviar a mensagem de aprovação e registrar quem aprovou. Sem aprovação nada é lançado nem pago. Depois de aprovado, o período fica travado; para corrigir, reabrir com motivo (fica na auditoria).
5) Lançar no sistema financeiro uma conta a pagar por médico: fornecedor, descrição, competência = mês do atendimento, vencimento = data de pagamento, rateio entre repasse de consultas e de exames. Médico PJ: nota fiscal antes de pagar.
6) Pagar pelo banco: um PIX por médico, valor exato, descrição padrão. Não dar baixa manual na conta a pagar.
7) No dia seguinte, conciliar o extrato vinculando cada PIX à conta a pagar do médico (buscar o lançamento existente; nunca criar novo; nunca aceitar sugestão automática sem conferir médico e valor).
8) Enviar a cada médico o demonstrativo e o comprovante. Divergência: 3 dias úteis; correção aprovada entra como ajuste no período seguinte.
Casos: adiantamento só com aprovação; PIX devolvido: pedir nova chave e pagar de novo; atendimento esquecido entra como ajuste "complemento" no período seguinte.`;

function aiInstr() {
  return `Você é o assistente do RepasseMed na clínica ${cfg.clinica.nome || ""}. Ajuda ${operador()} a executar o repasse médico. Responda em português do Brasil, curto e prático, em passos quando for procedimento. Use só o processo e os dados abaixo. Se a resposta mudar valor pago a médico, regra ou exceção, diga que precisa da aprovação de ${cfg.clinica.aprovador || "quem aprova o repasse"}. Para dúvidas fiscais, trabalhistas ou de nota fiscal, diga para confirmar com a contabilidade. Se não souber, diga que não sabe. Nunca invente valores.\n\n${POP}`;
}
function aiContext() {
  const r = rulesInUse();
  const meds = medicosView().map(m => ({ medico: m.nome, tipo: m.tipo, consultas: m.nCons, repasseConsultas: formatBRL(m.repCons), exames: m.nExa, repasseExames: formatBRL(m.repExa), total: formatBRL(m.total), status: st(m.key) }));
  return `Regras: imposto ${r.impostoPct}%, consulta ${r.consultaPct}%, taxas ${JSON.stringify(r.taxas)}, desconta taxa: ${r.descontarTaxa !== false}, convênio: ${r.convenioPolicy}, especiais: ${JSON.stringify(r.especiais)}, exames: ${JSON.stringify(r.exames)}.
Período aberto: ${period?.label} (${br(period?.inicio)} a ${br(period?.fim)}), pagamento ${br(period?.pagamento)}. Situação: ${$("#periodStatus").textContent}.
Alertas: ${result ? JSON.stringify(result.alerts.map(a => ({ nivel: a.level, msg: a.msg, qtd: a.linhas.length }))) : "sem cálculo carregado"}.
Ajustes: ${JSON.stringify((doc?.ajustes || []).map(a => ({ medico: a.medico, tipo: a.tipo, valor: formatBRL(a.valor), motivo: a.motivo })))}.
Por médico (sem pacientes): ${JSON.stringify(meds)}`;
}
function aiErr(e) { return e instanceof AIError ? e.message : "A IA não respondeu. Tente de novo."; }

async function aiMap() {
  const t = tabela(); if (!t) return;
  const amostra = t.rows.slice(0, 4).map(r => Object.fromEntries(t.headers.map(h => [h, maskSample(r[h])])));
  const btn = $("#aiMap"); btn.disabled = true; $("#mapMsg").textContent = "A IA está lendo as colunas…";
  try {
    const res = await askJSON(cfg.ai, {
      system: "Você mapeia colunas de relatórios de produção de clínicas médicas. Responda apenas JSON.",
      prompt: `Cabeçalhos: ${JSON.stringify(t.headers)}\nAmostra (textos mascarados): ${JSON.stringify(amostra)}\nAssocie cada campo a UM cabeçalho exatamente como escrito, ou "" se não existir. Campos: medico (profissional que atendeu), procedimento, valor (valor cobrado), tipo (consulta ou exame), pagamento (forma de pagamento), convenio (plano), data, paciente, quantidade.\nResponda só: {"medico":"","procedimento":"","valor":"","tipo":"","pagamento":"","convenio":"","data":"","paciente":"","quantidade":""}`,
    });
    let n = 0;
    for (const f of FIELDS) if (typeof res?.[f.k] === "string" && (res[f.k] === "" || t.headers.includes(res[f.k]))) { doc.mapping[f.k] = res[f.k]; n++; }
    persist(); renderStep1();
    $("#mapMsg").textContent = n ? "Colunas ajustadas pela IA. Confira antes de calcular." : "A IA não conseguiu sugerir. Ajuste manualmente.";
  } catch (e) { $("#mapMsg").textContent = aiErr(e); }
  finally { btn.disabled = false; }
}

async function aiAnalyze() {
  const tot = totalsView(); if (!tot) return;
  const prev = store.loadPeriod(previousPeriodId(period.id));
  const ps = prev?.aprovacao?.snapshot || prev?.resumo;
  const box = $("#analysis"); box.innerHTML = `<div class="ai">Analisando…</div>`; const out = box.firstElementChild;
  try {
    await ask(cfg.ai, {
      system: aiInstr(), maxTokens: 700, onText: t => { out.textContent = t; },
      messages: [{ role: "user", content: `Analise o período antes da aprovação. Em até 8 linhas curtas: médicos com variação grande em relação ao período anterior, proporção repasse/produção fora do comum, alertas que exigem ação e o que conferir no sistema da clínica. Termine com "Pronto para aprovação" ou "Resolver antes de aprovar".\n\n${aiContext()}\nProdução bruta: ${formatBRL(tot.bruto)}. Repasse: ${formatBRL(tot.total)}.\nPeríodo anterior: ${ps ? JSON.stringify({ total: formatBRL(ps.totals.total), bruto: formatBRL(ps.totals.bruto), medicos: ps.medicos.map(m => ({ medico: m.nome, total: formatBRL(m.total) })) }) : "sem registro"}` }],
    });
  } catch (e) { out.textContent = (e.partial ? e.partial + "\n\n" : "") + aiErr(e); }
}

let turns = [], chatCtl = null;
const SUG = ["Como lanço a conta a pagar?", "O PIX de um médico voltou. O que faço?", "Como concilio os PIX de repasse?", "O médico disse que o valor está errado.", "Como registro um adiantamento?", "O que falta para fechar este período?"];
function bubble(cls, text) { const d = document.createElement("div"); d.className = "msg " + cls; d.textContent = text; $("#msgs").appendChild(d); $("#msgs").scrollTop = $("#msgs").scrollHeight; return d; }
async function sendChat() {
  const q = $("#ask").value.trim(); if (!q) return;
  if (cfg.ai.mode === "off") { bubble("bot", "A IA está desligada. Ative em Configurações."); return; }
  $("#ask").value = ""; bubble("me", q); turns.push({ role: "user", content: q });
  const b = bubble("bot", "Pensando…");
  chatCtl = new AbortController(); $("#stop").hidden = false; $("#send").disabled = true;
  const hist = turns.slice(-12);
  const messages = [{ role: "user", content: `Contexto atual:\n${aiContext()}\n\nPergunta: ${hist[0].content}` }, ...hist.slice(1)];
  try {
    const text = await ask(cfg.ai, { system: aiInstr(), messages, onText: t => { b.textContent = t; $("#msgs").scrollTop = $("#msgs").scrollHeight; }, signal: chatCtl.signal });
    turns.push({ role: "assistant", content: text || "(sem resposta)" });
  } catch (e) {
    b.textContent = (e.partial ? e.partial + "\n\n" : "") + aiErr(e);
    turns.push({ role: "assistant", content: e.partial || "(erro)" });
  } finally { $("#stop").hidden = true; $("#send").disabled = false; }
}

/* ================================================================== */
/* Configurações                                                       */
/* ================================================================== */
function renderConfig() {
  const c = cfg;
  $("#cNome").value = c.clinica.nome; $("#cCnpj").value = c.clinica.cnpj; $("#cAprov").value = c.clinica.aprovador; $("#cResp").value = c.clinica.responsavel;
  $("#cPer").value = c.periodicidade; $("#cQ1").value = c.pagamento.q1Dia; $("#cQ2").value = c.pagamento.q2DiaUtil; $("#cM").value = c.pagamento.mensalDiaUtil;
  $("#cFer").value = (c.feriadosExtras || []).map(br).join(", ");
  $("#cDet").checked = c.guardarDetalhe;
  $("#aiMode").value = c.ai.mode; $("#aiKey").value = c.ai.apiKey; $("#aiUrl").value = c.ai.proxyUrl; $("#aiTok").value = c.ai.proxyToken; $("#aiModel").value = c.ai.model;
  aiModeVis();
  $("#usage").textContent = `Espaço usado neste navegador: ${store.usageKB()} KB.`;
}
function aiModeVis() { const m = $("#aiMode").value; $("#lKey").hidden = m !== "direct"; $("#lUrl").hidden = $("#lTok").hidden = m !== "proxy"; }

function readConfigForm() {
  const fer = $("#cFer").value.split(",").map(s => s.trim()).filter(Boolean);
  const isoFer = [];
  for (const f of fer) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f);
    if (!m) throw new Error(`Feriado em formato inválido: "${f}". Use DD/MM/AAAA.`);
    isoFer.push(`${m[3]}-${m[2]}-${m[1]}`);
  }
  const q1 = parseInt($("#cQ1").value, 10), q2 = parseInt($("#cQ2").value, 10), mm = parseInt($("#cM").value, 10);
  if (!(q1 >= 1 && q1 <= 28) || !(q2 >= 1 && q2 <= 15) || !(mm >= 1 && mm <= 15)) throw new Error("Confira os dias de pagamento.");
  const mode = $("#aiMode").value;
  if (mode === "direct" && $("#aiKey").value && !/^sk-ant-/.test($("#aiKey").value.trim())) throw new Error("A chave da Anthropic começa com sk-ant-.");
  if (mode === "proxy" && $("#aiUrl").value && !/^https:\/\//.test($("#aiUrl").value.trim())) throw new Error("O endereço do proxy precisa começar com https://.");
  return {
    ...cfg,
    clinica: { ...cfg.clinica, nome: $("#cNome").value.trim(), cnpj: $("#cCnpj").value.trim(), aprovador: $("#cAprov").value.trim(), responsavel: $("#cResp").value.trim() },
    periodicidade: $("#cPer").value,
    pagamento: { q1Dia: q1, q2DiaUtil: q2, mensalDiaUtil: mm },
    feriadosExtras: isoFer,
    guardarDetalhe: $("#cDet").checked,
    ai: { mode, apiKey: $("#aiKey").value.trim(), proxyUrl: $("#aiUrl").value.trim(), proxyToken: $("#aiTok").value.trim(), model: $("#aiModel").value.trim() || "claude-sonnet-5-5" },
  };
}

function saveConfigForm() {
  try {
    const before = cfg.periodicidade;
    cfg = readConfigForm();
    store.saveConfig(cfg);
    $("#cfgMsg").textContent = "Configurações salvas.";
    applyBranding();
    if (before !== cfg.periodicidade) { const s = suggestedPeriod(todayISO(), cfg.periodicidade === "mensal"); selectPeriod(s.y, s.m, s.tipo); }
    else onPeriodChange();
    renderBanner();
  } catch (e) { $("#cfgMsg").textContent = e.message; }
}

function applyBranding() {
  $("#clinicName").textContent = cfg.clinica.nome ? `${cfg.clinica.nome}` : "Configure o nome da clínica em Configurações";
  document.title = `RepasseMed${cfg.clinica.nome ? " – " + cfg.clinica.nome : ""}`;
  $("#ver").textContent = `v${VERSION}`;
}
function renderBanner() {
  const pend = [];
  if (!cfg.clinica.nome) pend.push(`<a href="#config">nome da clínica e aprovador</a>`);
  if (!cfg.rules.exames.length) pend.push(`<a href="#regras">tabela de exames</a>`);
  if (!cfg.rules.medicos.length) pend.push(`<a href="#medicos">cadastro dos médicos</a>`);
  $("#banner").innerHTML = pend.length ? `<div class="alert info"><span class="dot"></span><div class="txt">Para começar, preencha: ${pend.join(", ")}.</div></div>` : "";
}

/* ================================================================== */
/* Navegação e início                                                  */
/* ================================================================== */
const TABS = ["quinzena", "regras", "medicos", "historico", "assistente", "config"];
function route() {
  const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "quinzena";
  $$("nav.tabs a").forEach(a => a.setAttribute("aria-selected", String(a.dataset.tab === t)));
  $$(".panel").forEach(p => p.hidden = p.id !== "tab-" + t);
  if (t === "regras") renderRules();
  if (t === "medicos") renderMedicos();
  if (t === "historico") renderHistory();
  if (t === "config") renderConfig();
  if (t === "assistente") $("#aiState").textContent = cfg.ai.mode === "off" ? "A IA está desligada. Ative em Configurações." : `Modelo ${cfg.ai.model}. A IA recebe só totais por médico.`;
}

function bind() {
  $("#mes").onchange = $("#tipo").onchange = onPeriodChange;
  const drop = $("#drop"), file = $("#file");
  file.onchange = () => { if (file.files[0]) readFile(file.files[0]); file.value = ""; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
  $("#calc").onclick = onCalc; $("#aiMap").onclick = aiMap; $("#analyze").onclick = aiAnalyze;
  $("#ajAdd").onclick = addAjuste;
  $("#copyApproval").onclick = () => copy($("#approvalMsg").value);
  $("#apPor").oninput = () => { $("#apPor").dataset.touched = "1"; };
  $("#approve").onclick = approve; $("#reopen").onclick = reopen;
  $("#printAll").onclick = () => printDemos(medicosView());
  $("#csvAll").onclick = csvResumo; $("#csvDet").onclick = csvDetalhe;

  $("#addExa").onclick = () => { draftRules.exames.push({ chave: "", modo: "fixo", valor: "" }); editable("#exaTable", draftRules.exames, EXA_COLS); };
  $("#addEsp").onclick = () => { draftRules.especiais.push({ nome: "", pct: "", base: "liquido", nota: "" }); editable("#espTable", draftRules.especiais, ESP_COLS); };
  $("#addPayMap").onclick = () => { draftRules.paymentMap.push({ contem: "", forma: "semtaxa" }); editable("#payMapTable", draftRules.paymentMap, PAY_COLS); };
  $("#saveRules").onclick = () => { if (saveRulesWith(readRulesForm(), "#rAprov", "#rulesErr")) renderRules(); };

  const medCols = () => renderMedicosTable();
  function renderMedicosTable() { editable("#medTable", draftMedicos, [{ k: "nome", l: "Nome no relatório" }, { k: "aliases", l: "Outros nomes" }, { k: "fornecedor", l: "Fornecedor no financeiro" }, { k: "tipo", l: "PF ou PJ", opts: [["PF", "PF"], ["PJ", "PJ"]] }, { k: "chavePix", l: "Chave PIX" }]); }
  $("#addMed").onclick = () => { draftMedicos.push({ nome: "", aliases: "", fornecedor: "", tipo: "PF", chavePix: "" }); medCols(); };
  $("#medFromCalc").onclick = () => {
    const nomes = (result?.medicos || medicosView()).map(m => m.nome);
    if (!nomes.length) return toast("Carregue e calcule um relatório primeiro");
    let n = 0;
    for (const nome of nomes) if (!findCadastro(nome, { medicos: draftMedicos })) { draftMedicos.push({ nome, aliases: "", fornecedor: "", tipo: "PF", chavePix: "" }); n++; }
    medCols(); toast(n ? `${n} médico(s) adicionados. Preencha o fornecedor e salve.` : "Todos já estão cadastrados");
  };
  $("#saveMed").onclick = () => {
    const r = structuredClone(cfg.rules);
    r.medicos = draftMedicos.filter(m => String(m.nome || "").trim()).map(m => ({ ...m, nome: m.nome.trim() }));
    if (saveRulesWith(r, "#mAprov", "#medErr")) renderMedicos();
  };

  $("#send").onclick = sendChat; $("#stop").onclick = () => chatCtl?.abort();
  $("#ask").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } };
  $("#chips").innerHTML = SUG.map(s => `<button class="chip" type="button">${esc(s)}</button>`).join("");
  $$("#chips .chip").forEach(c => c.onclick = () => { $("#ask").value = c.textContent; sendChat(); });

  $("#aiMode").onchange = aiModeVis;
  $("#saveCfg").onclick = saveConfigForm;
  $("#aiTest").onclick = async () => {
    $("#aiTestMsg").textContent = "Testando…";
    try { const c = readConfigForm(); await testConnection(c.ai); $("#aiTestMsg").textContent = "Conexão ok. Salve as configurações."; }
    catch (e) { $("#aiTestMsg").textContent = e instanceof AIError ? e.message : (e.message || "Falhou"); }
  };
  $("#backup").onclick = () => download(`repassemed_backup_${todayISO()}.json`, JSON.stringify(store.exportAll(), null, 2), "application/json");
  $("#restore").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const ok = await confirmDlg("Restaurar backup", `Isso substitui todos os dados deste navegador pelos do arquivo (${(data.periodos || []).length} períodos). Continuar?`, { okLabel: "Restaurar" });
      if (!ok) return;
      const r = store.importAll(data);
      cfg = store.loadConfig(); applyBranding(); renderConfig(); renderBanner(); fillTipoOptions(); onPeriodChange();
      toast(`Backup restaurado: ${r.periodos} períodos`);
    } catch (err) { toast(err.message || "Arquivo inválido"); }
  };
  $("#wipe").onclick = async () => {
    const txt = await confirmDlg("Apagar todos os dados", 'Isso apaga configurações, regras e todos os períodos deste navegador. Faça um backup antes. Digite APAGAR para confirmar.', { input: true, placeholder: "APAGAR", okLabel: "Apagar" });
    if (txt !== "APAGAR") { if (txt) toast("Texto não confere. Nada foi apagado."); return; }
    store.wipeAll(); location.reload();
  };
  window.addEventListener("hashchange", route);
}

function init() {
  applyBranding();
  bind();
  fillTipoOptions();
  const s = suggestedPeriod(todayISO(), cfg.periodicidade === "mensal");
  selectPeriod(s.y, s.m, s.tipo);
  renderBanner();
  route();
}

init();
