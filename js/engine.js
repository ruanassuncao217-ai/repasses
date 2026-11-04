/**
 * RepasseMed – motor de cálculo de repasse médico.
 *
 * Módulo puro: não acessa DOM, rede nem armazenamento. Tudo que entra é dado,
 * tudo que sai é dado. É o único lugar onde o dinheiro é calculado, e é coberto
 * pelos testes em tests/engine.test.mjs.
 *
 * Regra de ouro: todo valor monetário é tratado em CENTAVOS INTEIROS.
 * Percentuais são tratados em PONTOS-BASE inteiros (1% = 100 pb).
 * Multiplicações usam BigInt para nunca perder precisão.
 */

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

/** Minúsculas, sem acentos, espaços colapsados. */
export function normalize(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave estável de um médico a partir do nome. */
export function medicoKey(nome) {
  return normalize(nome).replace(/^(dr|dra|dr\(a\))\.?\s+/, "");
}

/* ------------------------------------------------------------------ */
/* Dinheiro e percentuais                                              */
/* ------------------------------------------------------------------ */

/**
 * Converte um valor de planilha em centavos inteiros.
 * Aceita números, "R$ 1.234,56", "1234.56", "1.234", "(50,00)", "-50".
 * Retorna NaN quando o texto não é um valor reconhecível.
 */
export function parseMoney(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return NaN;
    return parseMoney(v.toFixed(6));
  }
  let s = String(v).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/R\$|\s/gi, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // vírgula decimal (padrão brasileiro)
    if ((s.match(/,/g) || []).length > 1) return NaN;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    if (lastComma >= 0) {
      // 1,234.56 (padrão americano)
      s = s.replace(/,/g, "");
    } else {
      const parts = s.split(".");
      // "1.234" ou "1.234.567" = milhar; "12.5" = decimal
      if (parts.length > 2 || parts[parts.length - 1].length === 3) s = parts.join("");
    }
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return NaN;
  const [intPart, decPart = ""] = s.split(".");
  const dec = (decPart + "000").slice(0, 3);
  let cents = BigInt(intPart || "0") * 100n + BigInt(dec.slice(0, 2));
  if (Number(dec[2]) >= 5) cents += 1n; // arredonda meio para cima
  const n = Number(cents);
  return neg ? -n : n;
}

/** Percentual (ex.: 15, "15,5", "7.25%") em pontos-base inteiros. */
export function pctToBp(p) {
  if (p === null || p === undefined || p === "") return 0;
  const s = String(p).replace("%", "").trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** Divisão inteira com arredondamento meio-para-longe-de-zero (BigInt). */
function divRound(num, den) {
  const neg = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (b * 2n);
  return neg ? -q : q;
}

/**
 * valorCents × (1 − descontosBp) × pctBp, arredondado ao centavo.
 * descontosBp = imposto + taxa, em pontos-base.
 */
export function applyPct(valorCents, pctBp, descontosBp = 0) {
  const num = BigInt(valorCents) * BigInt(10000 - descontosBp) * BigInt(pctBp);
  return Number(divRound(num, 100000000n));
}

/** Formata centavos como "R$ 1.234,56". */
export function formatBRL(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cent = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}R$ ${reais},${cent}`;
}

/** Formata centavos como "1234,56" (para colar em sistemas). */
export function formatPlain(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  return `${neg ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Leitura do relatório                                                */
/* ------------------------------------------------------------------ */

export const FIELDS = [
  { k: "medico", label: "Médico", req: true, syn: ["medico", "profissional", "executante", "prestador", "doutor", "responsavel"] },
  { k: "procedimento", label: "Procedimento", req: true, syn: ["procedimento", "servico", "descricao", "item", "exame"] },
  { k: "valor", label: "Valor", req: true, syn: ["valor", "total", "bruto", "preco", "vl"] },
  { k: "tipo", label: "Tipo (consulta ou exame)", req: false, syn: ["tipo", "categoria", "grupo", "classe"] },
  { k: "pagamento", label: "Forma de pagamento", req: false, syn: ["pagamento", "forma", "pagto", "recebimento", "meio"] },
  { k: "convenio", label: "Convênio / plano", req: false, syn: ["convenio", "plano", "operadora"] },
  { k: "data", label: "Data", req: false, syn: ["data", "dt", "atendimento"] },
  { k: "paciente", label: "Paciente", req: false, syn: ["paciente", "cliente", "nome"] },
  { k: "quantidade", label: "Quantidade", req: false, syn: ["qtd", "quantidade", "qtde", "quant"] },
];

/** Encontra a linha de cabeçalho nas primeiras 20 linhas (relatórios costumam ter título). */
export function detectHeaderRow(aoa) {
  let best = 0, bestScore = -1;
  const lim = Math.min(aoa.length, 20);
  for (let i = 0; i < lim; i++) {
    const cells = (aoa[i] || []).map(normalize);
    let score = 0;
    for (const f of FIELDS) if (cells.some(c => c && f.syn.some(s => c.includes(s)))) score++;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** Converte matriz (linhas × colunas) em {headers, rows}. */
export function tableFromMatrix(aoa) {
  if (!Array.isArray(aoa) || !aoa.length) return { headers: [], rows: [] };
  const hr = detectHeaderRow(aoa);
  const seen = new Map();
  const headers = (aoa[hr] || []).map((h, i) => {
    let name = String(h ?? "").trim() || `Coluna ${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
  const rows = aoa.slice(hr + 1)
    .filter(r => Array.isArray(r) && r.some(c => String(c ?? "").trim() !== ""))
    .filter(r => !/^total/.test(normalize(r.find(c => String(c ?? "").trim() !== ""))))
    .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ""; }); return o; });
  return { headers, rows };
}

/** Sugere qual cabeçalho corresponde a cada campo. Nunca usa um cabeçalho duas vezes. */
export function autoMap(headers) {
  const used = new Set(), m = {};
  for (const f of FIELDS) {
    let hit = headers.find(h => !used.has(h) && f.syn.includes(normalize(h)));
    if (!hit) for (const s of f.syn) { hit = headers.find(h => !used.has(h) && normalize(h).includes(s)); if (hit) break; }
    m[f.k] = hit || "";
    if (hit) used.add(hit);
  }
  return m;
}

/** Lista de campos obrigatórios ainda sem coluna. */
export function missingRequired(mapping) {
  return FIELDS.filter(f => f.req && !mapping?.[f.k]).map(f => f.label);
}

/* ------------------------------------------------------------------ */
/* Regras                                                              */
/* ------------------------------------------------------------------ */

export const FORMAS = {
  semtaxa: "Sem taxa (PIX, dinheiro, transferência)",
  debito: "Cartão débito",
  credito: "Cartão crédito à vista",
  parcelado: "Cartão crédito parcelado",
  convenio: "Convênio",
  desconhecida: "Não reconhecida",
};

export function defaultRules() {
  return {
    impostoPct: 15,
    consultaPct: 75,
    taxas: { debito: 0, credito: 0, parcelado: 0 },
    descontarTaxa: true, // desconta a taxa do cartão antes do percentual da consulta
    convenioPolicy: "atendimento", // "atendimento" | "recebimento"
    convenioWords: ["convenio", "plano", "unimed", "humana", "iapep", "ipmt", "geap", "bradesco", "sulamerica", "amil", "cassi", "hapvida", "postal saude", "capesesp", "fusex", "saude caixa"],
    paymentMap: [],   // [{contem, forma}]
    especiais: [],    // [{nome, pct, base: "liquido"|"bruto", nota}]
    exames: [],       // [{chave, modo: "fixo"|"percentual", valor}]
    medicos: [],      // [{nome, aliases, fornecedor, tipo: "PF"|"PJ", chavePix}]
  };
}

/** Valida as regras e devolve lista de problemas (vazia = ok). */
export function validateRules(r) {
  const p = [];
  const pct = (v, nome, max = 100) => {
    const bp = pctToBp(v);
    if (!Number.isFinite(bp) || bp < 0 || bp > max * 100) p.push(`${nome} deve estar entre 0 e ${max}%.`);
  };
  pct(r.impostoPct, "Imposto");
  pct(r.consultaPct, "Repasse da consulta");
  for (const k of ["debito", "credito", "parcelado"]) pct(r.taxas?.[k], `Taxa de ${FORMAS[k].toLowerCase()}`, 30);
  if (pctToBp(r.impostoPct) + Math.max(...["debito", "credito", "parcelado"].map(k => pctToBp(r.taxas?.[k]) || 0)) >= 10000)
    p.push("Imposto + taxa de cartão não podem somar 100% ou mais.");
  (r.especiais || []).forEach((e, i) => {
    if (!String(e.nome || "").trim()) p.push(`Regra especial ${i + 1}: informe o nome do médico.`);
    pct(e.pct, `Regra especial de ${e.nome || i + 1}`);
    if (!["liquido", "bruto"].includes(e.base)) p.push(`Regra especial de ${e.nome || i + 1}: base inválida.`);
  });
  (r.exames || []).forEach((e, i) => {
    if (!String(e.chave || "").trim()) p.push(`Exame ${i + 1}: informe o texto do procedimento.`);
    if (e.modo === "percentual") pct(e.valor, `Exame ${e.chave || i + 1}`);
    else {
      const c = parseMoney(e.valor);
      if (!Number.isFinite(c) || c < 0) p.push(`Exame ${e.chave || i + 1}: valor fixo inválido.`);
    }
  });
  const chaves = (r.exames || []).map(e => normalize(e.chave)).filter(Boolean);
  const dup = chaves.filter((c, i) => chaves.indexOf(c) !== i);
  if (dup.length) p.push(`Exame repetido na tabela: ${[...new Set(dup)].join(", ")}.`);
  const nomes = (r.medicos || []).map(m => medicoKey(m.nome)).filter(Boolean);
  const dupM = nomes.filter((c, i) => nomes.indexOf(c) !== i);
  if (dupM.length) p.push(`Médico repetido no cadastro: ${[...new Set(dupM)].join(", ")}.`);
  return p;
}

/* ------------------------------------------------------------------ */
/* Classificação                                                       */
/* ------------------------------------------------------------------ */

const NAO_CONVENIO = /^(particular|nenhum|nenhuma|nao|n\/a|na|-|sem convenio|privado)$/;

export function classifyPayment(pagTxt, convTxt, rules) {
  const pag = normalize(pagTxt), conv = normalize(convTxt);
  for (const m of rules.paymentMap || []) {
    const c = normalize(m.contem);
    if (c && (pag.includes(c) || conv.includes(c)) && FORMAS[m.forma]) return m.forma;
  }
  if (conv && !NAO_CONVENIO.test(conv)) return "convenio";
  if (/debito/.test(pag)) return "debito";
  if (/parcel|\b\d{1,2}\s*x\b/.test(pag)) return "parcelado";
  if (/credito|cartao/.test(pag)) return "credito";
  if (/pix|dinheiro|especie|transferencia|\bted\b|\bdoc\b|boleto|particular|deposito/.test(pag)) return "semtaxa";
  const words = (rules.convenioWords || []).map(normalize).filter(Boolean);
  if (pag && words.some(w => pag.includes(w))) return "convenio";
  return "desconhecida";
}

/** Exame da tabela cujo texto aparece no procedimento (o mais específico vence). */
export function findExame(proc, rules) {
  const p = normalize(proc);
  const hits = (rules.exames || []).filter(e => e.chave && p.includes(normalize(e.chave)));
  hits.sort((a, b) => normalize(b.chave).length - normalize(a.chave).length);
  return hits[0] || null;
}

export function classifyType(tipoTxt, proc, rules) {
  const t = normalize(tipoTxt);
  const exame = findExame(proc, rules);
  if (/exame|diagnostic/.test(t)) return { tipo: "exame", exame };
  if (/consulta|retorno/.test(t)) return { tipo: "consulta", exame: null };
  if (exame) return { tipo: "exame", exame };
  if (/consulta|retorno/.test(normalize(proc))) return { tipo: "consulta", exame: null };
  return { tipo: "?", exame: null };
}

export function findEspecial(nome, rules) {
  const k = medicoKey(nome);
  const hits = (rules.especiais || []).filter(e => e.nome && k.includes(medicoKey(e.nome)));
  hits.sort((a, b) => medicoKey(b.nome).length - medicoKey(a.nome).length);
  return hits[0] || null;
}

export function findCadastro(nome, rules) {
  const k = medicoKey(nome);
  for (const m of rules.medicos || []) {
    const nomes = [m.nome, ...String(m.aliases || "").split(",")].map(medicoKey).filter(Boolean);
    if (nomes.includes(k)) return m;
  }
  for (const m of rules.medicos || []) {
    const n = medicoKey(m.nome);
    if (n && (k.includes(n) || n.includes(k))) return m;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Cálculo                                                             */
/* ------------------------------------------------------------------ */

export const ALERTS = {
  SEM_MEDICO: { level: "bad", msg: "Atendimento sem médico" },
  VALOR_INVALIDO: { level: "bad", msg: "Valor que não é número" },
  SEM_REGRA: { level: "bad", msg: "Procedimento sem regra (não é consulta e não está na tabela de exames)" },
  EXAME_SEM_VALOR: { level: "bad", msg: "Exame sem valor na tabela de exames" },
  TAXA_ZERADA: { level: "bad", msg: "Pagamento em cartão com taxa zerada nas regras" },
  TOTAL_NEGATIVO: { level: "bad", msg: "Médico com total negativo (descontos maiores que o repasse)" },
  VALOR_ZERO: { level: "warn", msg: "Valor zerado (confira se é cortesia ou retorno)" },
  VALOR_NEGATIVO: { level: "warn", msg: "Valor negativo (estorno): reduz o repasse" },
  DUPLICADO: { level: "warn", msg: "Possível duplicidade (mesmo médico, paciente, data e procedimento)" },
  FORMA_DESCONHECIDA: { level: "warn", msg: "Forma de pagamento não reconhecida: calculada sem taxa" },
  SEM_CADASTRO: { level: "warn", msg: "Médico sem cadastro de fornecedor" },
  CONVENIO_FORA: { level: "info", msg: "Convênios fora desta quinzena (entram quando o plano pagar)" },
  PJ_NOTA: { level: "info", msg: "Médico PJ: exigir nota fiscal antes de pagar" },
  REGRA_A_CONFIRMAR: { level: "info", msg: "Regra especial marcada como \"a confirmar\"" },
  AJUSTE: { level: "info", msg: "Ajustes manuais incluídos no total" },
};

function dateKey(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return normalize(v);
}

/**
 * Calcula o repasse.
 * @param {object} p
 * @param {object[]} p.rows      linhas do relatório (objetos cabeçalho→valor)
 * @param {object}   p.mapping   campo→cabeçalho
 * @param {object}   p.rules     regras (ver defaultRules)
 * @param {object[]} [p.ajustes] [{id, medico, tipo:"desconto"|"acrescimo", valor (centavos), motivo, categoria:"consultas"|"exames"}]
 */
export function compute({ rows, mapping, rules, ajustes = [] }) {
  const miss = missingRequired(mapping);
  if (miss.length) throw new Error(`Colunas obrigatórias sem correspondência: ${miss.join(", ")}`);
  const problems = validateRules(rules);
  if (problems.length) throw new Error(`Regras inválidas: ${problems.join(" ")}`);

  const impBp = pctToBp(rules.impostoPct);
  const consBp = pctToBp(rules.consultaPct);
  const taxaBp = {
    semtaxa: 0, convenio: 0, desconhecida: 0,
    debito: pctToBp(rules.taxas?.debito), credito: pctToBp(rules.taxas?.credito), parcelado: pctToBp(rules.taxas?.parcelado),
  };
  const descontarTaxa = rules.descontarTaxa !== false;
  if (!descontarTaxa) taxaBp.debito = taxaBp.credito = taxaBp.parcelado = 0;

  const alerts = new Map();
  const alert = (code, linha = null, extra = "") => {
    const key = code + (extra ? "|" + extra : "");
    if (!alerts.has(key)) alerts.set(key, { code, level: ALERTS[code].level, msg: ALERTS[code].msg + (extra ? `: ${extra}` : ""), linhas: [] });
    if (linha !== null) alerts.get(key).linhas.push(linha);
  };

  const medicos = new Map();
  const getMed = nome => {
    const key = medicoKey(nome);
    if (!medicos.has(key)) {
      const cad = findCadastro(nome, rules);
      medicos.set(key, {
        key, nome: String(nome).trim(), fornecedor: cad?.fornecedor || "", tipo: cad?.tipo || "", cadastrado: !!cad,
        nCons: 0, nExa: 0, brutoCons: 0, brutoExa: 0, repCons: 0, repExa: 0, ajustesCons: 0, ajustesExa: 0, total: 0, linhas: [],
      });
    }
    return medicos.get(key);
  };

  const seen = new Set();
  const cardUsed = { debito: 0, credito: 0, parcelado: 0 };
  let foraN = 0, foraV = 0;
  const g = (r, k) => (mapping[k] ? r[mapping[k]] : "");

  const linhas = rows.map((r, i) => {
    const l = {
      i,
      medico: String(g(r, "medico") ?? "").trim(),
      procedimento: String(g(r, "procedimento") ?? "").trim(),
      paciente: String(g(r, "paciente") ?? "").trim(),
      data: g(r, "data"),
      valor: parseMoney(g(r, "valor")),
      qtd: 1,
      forma: classifyPayment(g(r, "pagamento"), g(r, "convenio"), rules),
      convenio: String(g(r, "convenio") ?? "").trim(),
      tipo: "?", regra: "", repasse: 0, status: "ok",
    };
    if (mapping.quantidade) {
      const q = Number(String(g(r, "quantidade")).replace(",", "."));
      l.qtd = Number.isFinite(q) && q > 0 ? q : 1;
    }
    if (l.data instanceof Date) l.data = l.data.toISOString().slice(0, 10);

    if (!l.medico) { alert("SEM_MEDICO", i); l.status = "erro"; return l; }
    if (!Number.isFinite(l.valor)) { alert("VALOR_INVALIDO", i); l.status = "erro"; l.valor = 0; return l; }
    if (l.valor === 0) alert("VALOR_ZERO", i);
    if (l.valor < 0) alert("VALOR_NEGATIVO", i);

    if (l.paciente) {
      const dk = [medicoKey(l.medico), normalize(l.paciente), dateKey(l.data), normalize(l.procedimento), l.valor].join("|");
      if (seen.has(dk)) alert("DUPLICADO", i); else seen.add(dk);
    }
    if (l.forma === "desconhecida") alert("FORMA_DESCONHECIDA", i);

    if (l.forma === "convenio" && rules.convenioPolicy === "recebimento") {
      foraN++; foraV += l.valor; l.status = "fora"; l.regra = "Convênio: entra após o pagamento do plano"; return l;
    }

    const { tipo, exame } = classifyType(g(r, "tipo"), l.procedimento, rules);
    l.tipo = tipo;
    if (tipo === "?") { alert("SEM_REGRA", i); l.status = "erro"; return l; }
    if (tipo === "exame" && !exame) { alert("EXAME_SEM_VALOR", i, l.procedimento); l.status = "erro"; return l; }
    if (cardUsed[l.forma] !== undefined) cardUsed[l.forma]++;

    const descBp = impBp + taxaBp[l.forma];
    const m = getMed(l.medico);
    if (tipo === "exame") {
      if (exame.modo === "percentual") {
        l.repasse = applyPct(l.valor, pctToBp(exame.valor), descBp);
        l.regra = `Exame ${exame.chave}: ${exame.valor}% do líquido`;
      } else {
        const fixo = parseMoney(exame.valor);
        const sinal = l.valor < 0 ? -1 : 1; // estorno de exame devolve o fixo
        l.repasse = sinal * Math.round(fixo * l.qtd);
        l.regra = `Exame ${exame.chave}: fixo ${formatBRL(fixo)}${l.qtd !== 1 ? ` × ${l.qtd}` : ""}`;
      }
      m.nExa += l.qtd; m.brutoExa += l.valor; m.repExa += l.repasse;
    } else {
      const esp = findEspecial(l.medico, rules);
      const pBp = esp ? pctToBp(esp.pct) : consBp;
      if (esp && esp.base === "bruto") {
        l.repasse = applyPct(l.valor, pBp, 0);
        l.regra = `${esp.pct}% do bruto (regra especial)`;
      } else {
        l.repasse = applyPct(l.valor, pBp, descBp);
        l.regra = `${esp ? esp.pct : rules.consultaPct}% de (valor − ${rules.impostoPct}% imposto${taxaBp[l.forma] ? ` − ${rules.taxas[l.forma]}% taxa` : ""})${esp ? " (regra especial)" : ""}`;
      }
      if (esp && /confirmar/i.test(esp.nota || "")) alert("REGRA_A_CONFIRMAR", null, esp.nome);
      m.nCons += l.qtd; m.brutoCons += l.valor; m.repCons += l.repasse;
    }
    m.linhas.push(i);
    return l;
  });

  if (descontarTaxa) for (const k of Object.keys(cardUsed)) if (cardUsed[k] && taxaBp[k] === 0) alert("TAXA_ZERADA", null, FORMAS[k]);
  if (foraN) alert("CONVENIO_FORA", null, `${foraN} atendimento(s), ${formatBRL(foraV)}`);

  // ajustes manuais (adiantamento, glosa, complemento, correção)
  const ajustesValidos = [];
  for (const a of ajustes) {
    const v = Math.abs(Math.trunc(Number(a.valor) || 0));
    if (!a.medico || !v) continue;
    const m = getMed(a.medico);
    const s = a.tipo === "desconto" ? -v : v;
    if (a.categoria === "exames") m.ajustesExa += s; else m.ajustesCons += s;
    ajustesValidos.push({ ...a, valor: v });
  }
  if (ajustesValidos.length) alert("AJUSTE", null, `${ajustesValidos.length}`);

  const lista = [...medicos.values()].map(m => {
    m.total = m.repCons + m.repExa + m.ajustesCons + m.ajustesExa;
    if (!m.cadastrado) alert("SEM_CADASTRO", null, m.nome);
    if (m.tipo === "PJ" && m.total > 0) alert("PJ_NOTA", null, `${m.nome}, ${formatBRL(m.total)}`);
    if (m.total < 0) alert("TOTAL_NEGATIVO", null, m.nome);
    return m;
  }).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));

  const order = { bad: 0, warn: 1, info: 2 };
  const alertList = [...alerts.values()].sort((a, b) => order[a.level] - order[b.level]);

  const sum = f => lista.reduce((s, m) => s + m[f], 0);
  const totals = {
    medicos: lista.length,
    linhas: linhas.length,
    linhasCalculadas: linhas.filter(l => l.status === "ok").length,
    bruto: sum("brutoCons") + sum("brutoExa"),
    repCons: sum("repCons") + sum("ajustesCons"),
    repExa: sum("repExa") + sum("ajustesExa"),
    ajustes: sum("ajustesCons") + sum("ajustesExa"),
    total: sum("total"),
  };
  return {
    linhas, medicos: lista, alerts: alertList, totals, ajustes: ajustesValidos,
    bloqueado: alertList.some(a => a.level === "bad"),
  };
}

/** Prova real: a soma dos repasses por linha + ajustes bate com o total. */
export function checkIntegrity(result) {
  const porLinha = result.linhas.filter(l => l.status === "ok").reduce((s, l) => s + l.repasse, 0);
  const esperado = porLinha + result.totals.ajustes;
  const porMedico = result.medicos.reduce((s, m) => s + m.total, 0);
  return { ok: esperado === result.totals.total && porMedico === result.totals.total, porLinha, esperado, porMedico, total: result.totals.total };
}

/* ------------------------------------------------------------------ */
/* Exportação                                                          */
/* ------------------------------------------------------------------ */

/** CSV com ";" (Excel pt-BR), BOM UTF-8 e escape correto. */
export function toCSV(rows) {
  const cell = c => {
    let s = String(c ?? "");
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = "'" + s; // evita injeção de fórmula
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map(r => r.map(cell).join(";")).join("\r\n");
}
