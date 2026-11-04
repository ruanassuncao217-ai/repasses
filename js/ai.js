/**
 * RepasseMed – assistente de IA (Claude, da Anthropic).
 *
 * Dois modos:
 *  - "direct": o navegador chama a API da Anthropic com a chave da clínica,
 *    guardada só neste navegador. Simples; indicado para uso interno.
 *  - "proxy": o navegador chama um proxy (worker/proxy.js no Cloudflare),
 *    que guarda a chave como segredo. Indicado para revenda: a chave nunca
 *    fica no computador do cliente.
 *
 * A IA NUNCA recebe nomes de pacientes: o app envia só totais por médico,
 * alertas e cabeçalhos de colunas com amostras mascaradas.
 */

const API = "https://api.anthropic.com/v1/messages";

export class AIError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function endpoint(cfg) {
  if (cfg.mode === "proxy") {
    if (!/^https:\/\//.test(cfg.proxyUrl || "")) throw new AIError("config", "Informe o endereço https do proxy nas Configurações.");
    return cfg.proxyUrl;
  }
  if (cfg.mode === "direct") {
    if (!/^sk-ant-/.test(cfg.apiKey || "")) throw new AIError("config", "Informe a chave da API da Anthropic nas Configurações.");
    return API;
  }
  throw new AIError("off", "A IA está desligada. Ative em Configurações.");
}

function headers(cfg) {
  const h = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (cfg.mode === "direct") {
    h["x-api-key"] = cfg.apiKey;
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (cfg.proxyToken) {
    h["x-clinic-token"] = cfg.proxyToken;
  }
  return h;
}

function friendly(status, body) {
  const t = body?.error?.type || "";
  if (status === 401 || t === "authentication_error") return new AIError("auth", "Chave da API inválida ou sem permissão.");
  if (status === 403) return new AIError("forbidden", "Acesso negado pelo proxy. Confira o token da clínica.");
  if (status === 429 || t === "rate_limit_error") return new AIError("rate", "Limite de uso da IA atingido. Tente de novo em alguns minutos.");
  if (status === 529 || t === "overloaded_error") return new AIError("overloaded", "A IA está sobrecarregada agora. Tente de novo em instantes.");
  if (status === 400) return new AIError("bad", body?.error?.message || "Pedido inválido para a IA.");
  return new AIError("upstream", `A IA não respondeu (erro ${status}).`);
}

/**
 * Pergunta à IA. Com onText, recebe o texto à medida que é escrito.
 * @returns {Promise<string>} resposta completa
 */
export async function ask(cfg, { system, messages, maxTokens = 1200, onText, signal }) {
  const url = endpoint(cfg);
  const body = { model: cfg.model || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages, stream: !!onText };
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: headers(cfg), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new AIError("cancelled", "Interrompido.");
    throw new AIError("network", "Sem conexão com a IA. Verifique a internet.");
  }
  if (!res.ok) {
    let j = null; try { j = await res.json(); } catch { /* ignora */ }
    throw friendly(res.status, j);
  }
  if (!onText) {
    const j = await res.json();
    return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          text += ev.delta.text;
          onText(text);
        } else if (ev.type === "error") {
          throw friendly(500, ev);
        }
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") throw Object.assign(new AIError("cancelled", "Interrompido."), { partial: text });
    throw e;
  }
  return text;
}

/** Pede JSON e faz o parse tolerante (bloco ```json ou primeiro {…}). */
export async function askJSON(cfg, { system, prompt, maxTokens = 600, signal }) {
  const text = await ask(cfg, { system, messages: [{ role: "user", content: prompt }], maxTokens, signal });
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const cand = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(cand); }
  catch { throw new AIError("json", "A IA respondeu fora do formato esperado."); }
}

/** Mascara amostras de texto (nomes) antes de enviar à IA. */
export function maskSample(v) {
  if (v instanceof Date) return "[data]";
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  if (/^[\d\s.,R$/:-]*$/.test(s)) return s;
  return s.length > 3 ? s.slice(0, 3) + "…" : s;
}

export async function testConnection(cfg) {
  const t = await ask(cfg, { system: "Responda apenas: ok", messages: [{ role: "user", content: "teste" }], maxTokens: 5 });
  return t.trim().length > 0;
}
