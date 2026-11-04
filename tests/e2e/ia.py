"""Teste da integração com a IA usando uma API simulada (streaming, JSON e erros)."""
import sys, json
from playwright.sync_api import sync_playwright, expect
BASE, XLSX = sys.argv[1], sys.argv[2]
erros, pedidos = [], []

def sse(text):
    parts = [text[i:i+7] for i in range(0, len(text), 7)]
    ev = ["event: message_start\ndata: " + json.dumps({"type": "message_start"}) + "\n\n"]
    ev += ["event: content_block_delta\ndata: " + json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": p}}) + "\n\n" for p in parts]
    ev.append("event: message_stop\ndata: " + json.dumps({"type": "message_stop"}) + "\n\n")
    return "".join(ev)

modo = {"auth_fail": False}
def api(route):
    req = route.request
    body = json.loads(req.post_data)
    pedidos.append({"headers": req.headers, "body": body})
    if modo["auth_fail"]:
        return route.fulfill(status=401, content_type="application/json", body=json.dumps({"error": {"type": "authentication_error", "message": "invalid x-api-key"}}))
    if body.get("stream"):
        return route.fulfill(status=200, content_type="text/event-stream", body=sse("Para conciliar, use Buscar lançamento em cada PIX."))
    txt = "ok"
    if "Cabeçalhos" in body["messages"][0]["content"]:
        txt = '```json\n{"medico":"Profissional","procedimento":"Procedimento","valor":"Valor","tipo":"Tipo","pagamento":"Forma de Pagamento","convenio":"Convênio","data":"Data","paciente":"Paciente","quantidade":""}\n```'
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"content": [{"type": "text", "text": txt}]}))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(locale="pt-BR")
    ctx.route("https://cdn.sheetjs.com/**", lambda r: r.fulfill(path=XLSX, content_type="application/javascript"))
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    ctx.route("https://api.anthropic.com/**", api)
    page = ctx.new_page()
    page.on("pageerror", lambda e: erros.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "401" not in m.text and erros.append(m.text))
    page.goto(BASE + "/index.html"); page.wait_for_function("window.XLSX !== undefined")

    page.click("a[data-tab=config]")
    page.select_option("#aiMode", "direct")
    page.fill("#aiKey", "chave-errada"); page.click("#saveCfg")
    expect(page.locator("#cfgMsg")).to_contain_text("sk-ant-")
    page.fill("#aiKey", "sk-ant-teste-123"); page.click("#saveCfg")
    expect(page.locator("#cfgMsg")).to_have_text("Configurações salvas.")
    page.click("#aiTest"); expect(page.locator("#aiTestMsg")).to_contain_text("Conexão ok")
    h = pedidos[-1]["headers"]
    assert h["x-api-key"] == "sk-ant-teste-123" and h["anthropic-dangerous-direct-browser-access"] == "true" and h["anthropic-version"] == "2023-06-01"

    # mapeamento de colunas pela IA, sem nomes de pacientes
    page.click("a[data-tab=quinzena]")
    page.set_input_files("#file", "sample/producao_exemplo.csv")
    page.select_option("#map select[data-k=medico]", "")
    page.click("#aiMap"); expect(page.locator("#mapMsg")).to_contain_text("ajustadas pela IA")
    assert page.locator("#map select[data-k=medico]").input_value() == "Profissional"
    enviado = json.dumps(pedidos[-1]["body"], ensure_ascii=False)
    assert "Paciente Exemplo" not in enviado, "nome de paciente vazou para a IA"

    # chat em streaming, com contexto sem pacientes
    page.click("#calc")
    page.click("a[data-tab=assistente]")
    page.fill("#ask", "Como concilio?"); page.click("#send")
    expect(page.locator("#msgs .msg.bot").last).to_have_text("Para conciliar, use Buscar lançamento em cada PIX.")
    enviado = json.dumps(pedidos[-1]["body"], ensure_ascii=False)
    assert "Paciente Exemplo" not in enviado and "Dr. Fábio Leal" in enviado
    # segunda pergunta mantém histórico alternado (user/assistant/user)
    page.fill("#ask", "E se o PIX voltar?"); page.click("#send")
    expect(page.locator("#msgs .msg.bot").last).to_have_text("Para conciliar, use Buscar lançamento em cada PIX.")
    roles = [m["role"] for m in pedidos[-1]["body"]["messages"]]
    assert roles == ["user", "assistant", "user"], roles

    # erro de autenticação vira mensagem clara
    modo["auth_fail"] = True
    page.fill("#ask", "teste"); page.click("#send")
    expect(page.locator("#msgs .msg.bot").last).to_contain_text("Chave da API inválida")

    # backup nunca leva a chave
    page.click("a[data-tab=config]")
    with page.expect_download() as d: page.click("#backup")
    assert json.load(open(d.value.path()))["config"]["ai"]["apiKey"] == ""
    b.close()
print("ERROS:", erros or "nenhum"); print("OK" if not erros else "FALHOU"); sys.exit(1 if erros else 0)
