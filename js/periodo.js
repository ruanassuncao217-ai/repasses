/**
 * RepasseMed – períodos de repasse, datas de pagamento e dias úteis.
 * Módulo puro, testado em tests/periodo.test.mjs.
 * Datas são tratadas como datas civis (sem fuso) no formato "AAAA-MM-DD".
 */

export const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const pad = n => String(n).padStart(2, "0");
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Converte "AAAA-MM-DD" em {y,m,d}. */
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** Dia da semana (0 = domingo) de uma data civil, sem depender do fuso. */
export function weekday(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(isoStr, n) {
  const p = parseISO(isoStr);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/**
 * Feriados nacionais e pontos facultativos bancários do ano.
 * Carnaval (segunda e terça) e Corpus Christi não são feriados nacionais por lei,
 * mas os bancos não abrem; por isso contam como dia não útil para pagamento.
 */
export function feriadosNacionais(y) {
  const p = easter(y);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map(md => `${y}-${md}`);
  return new Set([
    ...fixos,
    addDays(p, -48), // segunda de Carnaval
    addDays(p, -47), // terça de Carnaval
    addDays(p, -2),  // Sexta-feira Santa
    addDays(p, 60),  // Corpus Christi
  ]);
}

/** É dia útil bancário? `extras` = feriados locais ("AAAA-MM-DD"). */
export function isBusinessDay(isoStr, extras = []) {
  const p = parseISO(isoStr);
  if (!p) return false;
  const w = weekday(p.y, p.m, p.d);
  if (w === 0 || w === 6) return false;
  if (feriadosNacionais(p.y).has(isoStr)) return false;
  return !extras.includes(isoStr);
}

/** Próximo dia útil a partir de uma data (a própria, se for útil). */
export function nextBusinessDay(isoStr, extras = []) {
  let d = isoStr;
  for (let i = 0; i < 15; i++) { if (isBusinessDay(d, extras)) return d; d = addDays(d, 1); }
  return d;
}

/** n-ésimo dia útil do mês (n ≥ 1). */
export function nthBusinessDay(y, m, n, extras = []) {
  let count = 0;
  for (let d = 1; d <= lastDayOfMonth(y, m); d++) {
    const s = iso(y, m, d);
    if (isBusinessDay(s, extras)) { count++; if (count === n) return s; }
  }
  return iso(y, m, lastDayOfMonth(y, m));
}

export const DEFAULT_PAGAMENTO = { q1Dia: 20, q2DiaUtil: 5, mensalDiaUtil: 5 };

/**
 * Monta o período.
 * @param {number} y ano
 * @param {number} m mês (1–12)
 * @param {"Q1"|"Q2"|"M"} tipo  1ª quinzena, 2ª quinzena ou mês inteiro
 * @param {object} pag regra de pagamento (DEFAULT_PAGAMENTO)
 * @param {string[]} extras feriados locais
 */
export function buildPeriod(y, m, tipo, pag = DEFAULT_PAGAMENTO, extras = []) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error("Mês inválido");
  if (!["Q1", "Q2", "M"].includes(tipo)) throw new Error("Tipo de período inválido");
  const last = lastDayOfMonth(y, m);
  const ini = tipo === "Q2" ? 16 : 1;
  const fim = tipo === "Q1" ? 15 : last;
  const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
  let pagamento;
  if (tipo === "Q1") pagamento = nextBusinessDay(iso(y, m, Math.min(Math.max(1, pag.q1Dia | 0), last)), extras);
  else if (tipo === "Q2") pagamento = nthBusinessDay(ny, nm, Math.max(1, pag.q2DiaUtil | 0), extras);
  else pagamento = nthBusinessDay(ny, nm, Math.max(1, pag.mensalDiaUtil | 0), extras);
  const yy = String(y).slice(2);
  const nomeQ = tipo === "Q1" ? "1ª quinzena" : tipo === "Q2" ? "2ª quinzena" : "mês";
  return {
    id: `${y}-${pad(m)}-${tipo}`,
    y, m, tipo,
    inicio: iso(y, m, ini),
    fim: iso(y, m, fim),
    label: tipo === "M" ? `${MESES_LONGO[m - 1]} de ${y}` : `${nomeQ} de ${MESES[m - 1]}/${yy}`,
    curto: tipo === "M" ? `${MESES[m - 1]}/${yy}` : `${tipo === "Q1" ? "1ª" : "2ª"} quinz. ${MESES[m - 1]}/${yy}`,
    pix: `Repasse ${tipo === "M" ? "" : tipo.replace("Q", "") + "Q "}${MESES[m - 1]}/${yy}`.replace("  ", " "),
    competencia: `${pad(m)}/${y}`,
    pagamento,
    aprovacaoAte: addDaysBusinessBack(pagamento, 2, extras),
  };
}

/** Volta n dias úteis. */
export function addDaysBusinessBack(isoStr, n, extras = []) {
  let d = isoStr, c = 0;
  while (c < n) { d = addDays(d, -1); if (isBusinessDay(d, extras)) c++; }
  return d;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function br(isoStr) {
  const p = parseISO(isoStr);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : String(isoStr ?? "");
}

/** Período anterior (para comparação). */
export function previousPeriodId(id) {
  const m = /^(\d{4})-(\d{2})-(Q1|Q2|M)$/.exec(id);
  if (!m) return null;
  let y = +m[1], mo = +m[2];
  const t = m[3];
  if (t === "Q2") return `${y}-${pad(mo)}-Q1`;
  mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
  return `${y}-${pad(mo)}-${t === "Q1" ? "Q2" : "M"}`;
}

/** Período sugerido para hoje (a quinzena que acabou de fechar). */
export function suggestedPeriod(today, mensal = false) {
  const p = parseISO(today);
  if (mensal) {
    const m = p.m === 1 ? 12 : p.m - 1, y = p.m === 1 ? p.y - 1 : p.y;
    return { y, m, tipo: "M" };
  }
  if (p.d <= 10) {
    const m = p.m === 1 ? 12 : p.m - 1, y = p.m === 1 ? p.y - 1 : p.y;
    return { y, m, tipo: "Q2" };
  }
  if (p.d <= 25) return { y: p.y, m: p.m, tipo: "Q1" };
  return { y: p.y, m: p.m, tipo: "Q2" };
}
