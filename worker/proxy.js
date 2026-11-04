/**
 * RepasseMed – proxy da IA para Cloudflare Workers.
 *
 * Por que existe: na revenda, a chave da Anthropic não deve ficar no
 * navegador do cliente. Este worker guarda a chave como segredo, aceita só
 * a origem do seu GitHub Pages e só clínicas com token válido, e repassa o
 * pedido para a API.
 *
 * Segredos (wrangler secret put ...):
 *   ANTHROPIC_API_KEY   chave sk-ant-...
 *   CLINIC_TOKENS       tokens separados por vírgula, um por clínica (ex.: "cardiolima:8f3k...,integrale:a91x...")
 * Variáveis (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS     ex.: "https://seuusuario.github.io"
 *   ALLOWED_MODELS      ex.: "claude-sonnet-5-5,claude-haiku-5-5"
 *   MAX_TOKENS          ex.: "1500"
 */
export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      "access-control-allow-origin": okOrigin ? origin : "null",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, anthropic-version, x-clinic-token",
      "access-control-max-age": "86400",
      "vary": "origin",
    };
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (req.method !== "POST") return json(405, { error: { type: "method", message: "Use POST" } });
    if (!okOrigin) return json(403, { error: { type: "forbidden", message: "Origem não autorizada" } });

    const token = req.headers.get("x-clinic-token") || "";
    const tokens = (env.CLINIC_TOKENS || "").split(",").map(s => s.trim()).filter(Boolean);
    const clinica = tokens.map(t => t.split(":")).find(([, t]) => t && t === token);
    if (!clinica) return json(403, { error: { type: "forbidden", message: "Token da clínica inválido" } });

    let body;
    try { body = await req.json(); } catch { return json(400, { error: { type: "invalid_request_error", message: "JSON inválido" } }); }
    const models = (env.ALLOWED_MODELS || "claude-sonnet-5-5").split(",").map(s => s.trim());
    if (!models.includes(body.model)) body.model = models[0];
    const max = parseInt(env.MAX_TOKENS || "1500", 10);
    body.max_tokens = Math.min(Number(body.max_tokens) || max, max);
    // só o necessário segue adiante
    const clean = { model: body.model, max_tokens: body.max_tokens, system: body.system, messages: body.messages, stream: !!body.stream, metadata: { user_id: clinica[0] } };

    const up = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": env.ANTHROPIC_API_KEY },
      body: JSON.stringify(clean),
    });
    const h = new Headers(cors);
    h.set("content-type", up.headers.get("content-type") || "application/json");
    return new Response(up.body, { status: up.status, headers: h });
  },
};
