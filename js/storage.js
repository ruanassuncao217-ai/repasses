/**
 * RepasseMed – armazenamento local (navegador).
 *
 * Os dados ficam no computador da clínica (localStorage), separados por
 * "espaço" (uma clínica por espaço). Nada vai para servidor. Backup e
 * restauração são feitos por arquivo JSON (exportAll / importAll).
 */
import { SCHEMA_VERSION, defaultRules } from "./engine.js";
import { DEFAULT_PAGAMENTO } from "./periodo.js";

const NS = "repassemed:v1:";

export function defaultConfig() {
  return {
    schema: SCHEMA_VERSION,
    clinica: { nome: "", cnpj: "", aprovador: "", responsavel: "", cidade: "" },
    periodicidade: "quinzenal", // "quinzenal" | "mensal"
    pagamento: { ...DEFAULT_PAGAMENTO },
    feriadosExtras: [],
    guardarDetalhe: true,
    ai: { mode: "off", apiKey: "", proxyUrl: "", proxyToken: "", model: "claude-sonnet-5-5" },
    rules: defaultRules(),
    rulesLog: [],
    atualizadoEm: "",
  };
}

function safeGet(key) {
  try { const v = localStorage.getItem(NS + key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(NS + key, JSON.stringify(val)); return true; }
  catch (e) {
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) throw new Error("O armazenamento do navegador está cheio. Faça um backup e apague o detalhe de quinzenas antigas.");
    throw e;
  }
}

/** Mescla profunda simples: mantém campos novos de versões futuras com padrão. */
function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
    return out;
  }
  return over === undefined ? base : over;
}

export function loadConfig() {
  return merge(defaultConfig(), safeGet("config") || {});
}
export function saveConfig(cfg) {
  cfg.atualizadoEm = new Date().toISOString();
  safeSet("config", cfg);
}

export function loadPeriod(id) { return safeGet("periodo:" + id); }
export function savePeriod(doc) {
  doc.atualizadoEm = new Date().toISOString();
  safeSet("periodo:" + doc.id, doc);
  const idx = new Set(safeGet("indice") || []);
  idx.add(doc.id);
  safeSet("indice", [...idx].sort());
}
export function deletePeriod(id) {
  try { localStorage.removeItem(NS + "periodo:" + id); } catch { /* ignora */ }
  safeSet("indice", (safeGet("indice") || []).filter(x => x !== id));
}
export function listPeriods() {
  return (safeGet("indice") || []).map(loadPeriod).filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
}

/** Registro de auditoria (append-only) por período. */
export function audit(doc, acao, detalhe = "", operador = "") {
  doc.auditoria ||= [];
  doc.auditoria.push({ em: new Date().toISOString(), acao, detalhe, operador });
}

/** Uso aproximado do armazenamento, em KB. */
export function usageKB() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(NS)) n += (localStorage.getItem(k) || "").length; } } catch { /* ignora */ }
  return Math.round(n * 2 / 1024);
}

/** Backup completo. A chave da API nunca vai no arquivo. */
export function exportAll() {
  const cfg = loadConfig();
  const semSegredo = { ...cfg, ai: { ...cfg.ai, apiKey: "", proxyToken: "" } };
  return { app: "RepasseMed", schema: SCHEMA_VERSION, exportadoEm: new Date().toISOString(), config: semSegredo, periodos: listPeriods() };
}

/** Restaura um backup. Valida antes de gravar qualquer coisa. */
export function importAll(data, { manterChave = true } = {}) {
  if (!data || data.app !== "RepasseMed") throw new Error("Este arquivo não é um backup do RepasseMed.");
  if (typeof data.schema !== "number" || data.schema > SCHEMA_VERSION) throw new Error("Backup de uma versão mais nova do sistema. Atualize o sistema antes de restaurar.");
  if (!data.config || !Array.isArray(data.periodos)) throw new Error("Backup incompleto.");
  for (const p of data.periodos) if (!p || !/^\d{4}-\d{2}-(Q1|Q2|M)$/.test(p.id)) throw new Error("Backup com período inválido.");
  const atual = loadConfig();
  const cfg = merge(defaultConfig(), data.config);
  if (manterChave) cfg.ai.apiKey = atual.ai.apiKey, cfg.ai.proxyToken = atual.ai.proxyToken;
  saveConfig(cfg);
  for (const id of safeGet("indice") || []) { try { localStorage.removeItem(NS + "periodo:" + id); } catch { /* ignora */ } }
  safeSet("indice", []);
  for (const p of data.periodos) savePeriod(p);
  return { periodos: data.periodos.length };
}

/** Apaga tudo (com confirmação na interface). */
export function wipeAll() {
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(NS)) keys.push(k); } } catch { /* ignora */ }
  keys.forEach(k => localStorage.removeItem(k));
}
