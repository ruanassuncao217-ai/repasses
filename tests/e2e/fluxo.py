"""
Teste ponta a ponta do RepasseMed (Playwright + Chromium).
Uso: python3 tests/e2e/fluxo.py http://localhost:8765 /caminho/xlsx.full.min.js
"""
import sys, json, re
from playwright.sync_api import sync_playwright, expect

BASE, XLSX = sys.argv[1], sys.argv[2]
erros = []

def money(txt):
    t = re.sub(r"[^\d,-]", "", txt)
    return round(float(t.replace(",", ".")) * 100)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(accept_downloads=True, locale="pt-BR", timezone_id="America/Fortaleza")
    ctx.route("https://cdn.sheetjs.com/**", lambda r: r.fulfill(path=XLSX, content_type="application/javascript"))
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    page = ctx.new_page()
    page.on("pageerror", lambda e: erros.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and erros.append(f"console: {m.text}"))
    page.add_init_script("window.print = () => { window.__printed = (window.__printed||0) + 1; }")
    page.goto(BASE + "/index.html")
    page.wait_for_function("window.XLSX !== undefined")

    # 1) Configurações
    page.click("a[data-tab=config]")
    page.fill("#cNome", "Clínica Teste")
    page.fill("#cAprov", "Dr. Carlos")
    page.fill("#cResp", "Amanda")
    page.click("#saveCfg")
    expect(page.locator("#cfgMsg")).to_have_text("Configurações salvas.")
    expect(page.locator("#clinicName")).to_have_text("Clínica Teste")

    # 2) Regras
    page.click("a[data-tab=regras]")
    page.fill("#rDeb", "1,5"); page.fill("#rCred", "3"); page.fill("#rParc", "4,5")
    for chave, modo, valor in [("holter", "fixo", "80,00"), ("ecocardiograma", "fixo", "120"), ("mapa", "percentual", "50"), ("teste ergometrico", "fixo", "90")]:
        page.click("#addExa")
        row = page.locator("#exaTable tbody tr").last
        row.locator("input[data-k=chave]").fill(chave)
        row.locator("select[data-k=modo]").select_option(modo)
        row.locator("input[data-k=valor]").fill(valor)
    page.click("#addEsp")
    r = page.locator("#espTable tbody tr").last
    r.locator("input[data-k=nome]").fill("Marcelo"); r.locator("input[data-k=pct]").fill("60"); r.locator("input[data-k=nota]").fill("a confirmar base")
    page.click("#saveRules")
    expect(page.locator("#rulesErr")).to_contain_text("Informe quem aprovou")
    page.fill("#rAprov", "Dr. Carlos, WhatsApp")
    page.click("#saveRules")
    expect(page.locator("#rulesLog")).to_contain_text("Dr. Carlos, WhatsApp")

    # 3) Período de nov/26, 1ª quinzena
    page.click("a[data-tab=quinzena]")
    page.fill("#mes", "2026-11"); page.dispatch_event("#mes", "change")
    page.select_option("#tipo", "Q1")
    expect(page.locator("#periodDates")).to_contain_text("23/11/2026")  # 20/11 é feriado
    page.set_input_files("#file", "sample/producao_exemplo.csv")
    expect(page.locator("#fileInfo")).to_contain_text("14 linhas")
    assert page.locator("#map select[data-k=medico]").input_value() == "Profissional"
    assert page.locator("#map select[data-k=convenio]").input_value() == "Convênio"
    page.click("#calc")
    expect(page.locator("#alertSummary")).not_to_have_text("Aguardando cálculo")
    alerts = page.locator("#alerts").inner_text()
    assert "duplicidade" in alerts, alerts
    assert "Valor zerado" in alerts, alerts
    assert "sem cadastro" in alerts.lower(), alerts
    assert "a confirmar" in alerts, alerts
    total_tela = money(page.locator("#resumo .total").inner_text())

    # valor esperado calculado à mão, em centavos (regras: imposto 15%, consulta 75%, débito 1,5%, crédito 3%, parcelado 4,5%)
    esperado = (
        19125      # André consulta PIX 300 × 0,85 × 0,75
        + 18450    # André consulta crédito 300 × 0,82 × 0,75
        + 8000     # André Holter fixo
        + 9563     # André consulta GEAP 150 × 0,85 × 0,75 = 95,625 → 95,63
        + 11475    # Maria Clara consulta Humana 180 × 0,85 × 0,75
        + 12000    # Maria Clara ecocardiograma fixo
        + 17850    # Marcelo consulta dinheiro 350 × 0,85 × 0,60
        + 11270    # Marcelo MAPA parcelado 280 × (1 − 0,15 − 0,045) × 0,50 = 112,70
        + 0        # Fábio retorno valor zero
        + 9000     # Fábio teste ergométrico fixo
        + 19125 * 2  # Fábio 2 consultas PIX (duplicidade é só alerta)
        + 18788    # Vitória consulta débito 300 × 0,835 × 0,75 = 187,875 → 187,88
        + 12000    # Vitória ecocardiograma fixo
    )
    assert total_tela == esperado, (total_tela, esperado)
    print("total na tela confere com o cálculo manual:", total_tela)

    # 4) Cadastro dos médicos a partir do relatório
    page.click("a[data-tab=medicos]")
    page.click("#medFromCalc")
    linhas = page.locator("#medTable tbody tr")
    assert linhas.count() == 5, linhas.count()
    for i in range(5):
        nome = linhas.nth(i).locator("input[data-k=nome]").input_value()
        linhas.nth(i).locator("input[data-k=fornecedor]").fill(nome.upper())
    linhas.nth(0).locator("select[data-k=tipo]").select_option("PJ")
    page.fill("#mAprov", "Dr. Carlos")
    page.click("#saveMed")
    page.click("a[data-tab=quinzena]")
    page.click("#calc")
    assert "sem cadastro" not in page.locator("#alerts").inner_text().lower()

    # 5) Ajuste manual
    page.click("#ajBox summary")
    page.fill("#ajMed", "Dr. Fábio Leal"); page.select_option("#ajTipo", "desconto")
    page.fill("#ajVal", "50,00"); page.fill("#ajMot", "Adiantamento aprovado")
    page.click("#ajAdd")
    total_aj = money(page.locator("#resumo .total").inner_text())
    assert total_aj == total_tela - 5000, (total_aj, total_tela)

    # 6) Aprovação
    msg = page.locator("#approvalMsg").input_value()
    assert "Dr. Carlos, segue o repasse" in msg and "Adiantamento aprovado" in msg and "a confirmar" in msg, msg
    expect(page.locator("#approve")).to_be_enabled()
    page.click("#approve")
    page.click("#dlgOk")
    expect(page.locator("#approvalPill")).to_contain_text("Aprovado por Dr. Carlos")
    expect(page.locator("#periodStatus")).to_have_text("Aprovado, em pagamento")
    assert page.locator("#drop").is_hidden()

    # 7) Lançar, pagar, conciliar, enviar
    cards = page.locator("#caCards .card")
    n = cards.count(); assert n == 5, n
    pj = page.locator("#caCards input[data-f=nf]")
    assert pj.count() == 1
    first_pay = page.locator("#payTable tbody tr").first
    for c in page.locator("#caCards input[data-f=lancado]").all(): c.check()
    # PJ sem NF: pagamento travado
    pj_row = page.locator("#payTable tbody tr", has=page.locator(".pill.warn"))
    assert pj_row.count() == 1
    assert pj_row.locator("input[data-f=pago]").is_disabled()
    pj.check()
    for c in page.locator("#payTable input[data-f=pago]").all(): c.check()
    for c in page.locator("#payTable input[data-f=conciliado]").all(): c.check()
    for c in page.locator("#demoCards input[data-f=enviado]").all(): c.check()
    expect(page.locator("#periodStatus")).to_have_text("Fechado")

    # 8) Demonstrativo, impressão e CSV
    page.locator("#demoCards [data-print]").first.click()
    assert page.evaluate("window.__printed") == 1
    assert "Demonstrativo de repasse médico" in page.locator("#print").inner_text()
    with page.expect_download() as dl:
        page.click("#csvDet")
    assert dl.value.suggested_filename == "repasse_2026-11-Q1_detalhe.csv"
    with page.expect_download() as dl2:
        page.click("#csvAll")
    conteudo = open(dl2.value.path(), encoding="utf-8-sig").read()
    assert conteudo.count("\n") == 5, conteudo

    # 9) Persistência após recarregar
    page.reload(); page.wait_for_function("window.XLSX !== undefined")
    page.fill("#mes", "2026-11"); page.dispatch_event("#mes", "change"); page.select_option("#tipo", "Q1")
    expect(page.locator("#periodStatus")).to_have_text("Fechado")
    assert money(page.locator("#resumo .total").inner_text()) == total_aj

    # 10) Regra muda depois: período aprovado não muda
    page.click("a[data-tab=regras]")
    page.fill("#rConsulta", "80"); page.fill("#rAprov", "Dr. Carlos"); page.click("#saveRules")
    page.click("a[data-tab=quinzena]")
    page.fill("#mes", "2026-11"); page.dispatch_event("#mes", "change"); page.select_option("#tipo", "Q1")
    assert money(page.locator("#resumo .total").inner_text()) == total_aj

    # 11) Histórico
    page.click("a[data-tab=historico]")
    expect(page.locator("#histTable")).to_contain_text("1ª quinzena de nov/26")
    expect(page.locator("#histTable")).to_contain_text("Fechado")

    # 12) Reabrir exige motivo
    page.click("a[data-tab=quinzena]")
    page.fill("#mes", "2026-11"); page.dispatch_event("#mes", "change"); page.select_option("#tipo", "Q1")
    page.click("#reopen"); page.click("#dlgOk")
    expect(page.locator("#approvalPill")).to_contain_text("Aprovado")  # sem motivo, nada muda
    page.click("#reopen"); page.fill("#dlgInput", "Teste de reabertura"); page.click("#dlgOk")
    expect(page.locator("#approvalPill")).to_have_text("Não aprovado")
    expect(page.locator("#periodStatus")).to_have_text("Em conferência")
    assert "Período reaberto" in page.locator("#audTable").text_content()
    # recalculado com a regra nova (80%)
    assert money(page.locator("#resumo .total").inner_text()) > total_aj

    # 13) Backup e restauração
    page.click("a[data-tab=config]")
    with page.expect_download() as dl3:
        page.click("#backup")
    bk = json.load(open(dl3.value.path(), encoding="utf-8"))
    assert bk["app"] == "RepasseMed" and len(bk["periodos"]) == 1 and bk["config"]["ai"]["apiKey"] == ""

    # 14) IA desligada responde de forma clara
    page.click("a[data-tab=assistente]")
    page.fill("#ask", "teste"); page.click("#send")
    expect(page.locator("#msgs")).to_contain_text("A IA está desligada")

    # 15) Celular: sem rolagem horizontal da página
    page.set_viewport_size({"width": 390, "height": 800})
    page.click("a[data-tab=quinzena]")
    largura = page.evaluate("document.documentElement.scrollWidth")
    assert largura <= 392, largura
    page.screenshot(path="/tmp/mobile.png", full_page=False)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.screenshot(path="/tmp/desktop.png", full_page=True)

    b.close()

erros = sorted(set(e[:160] for e in erros))
print("ERROS DE PÁGINA:", erros if erros else "nenhum")
print("OK" if not erros else "FALHOU")
sys.exit(1 if erros else 0)
