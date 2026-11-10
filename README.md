# RepasseMed

Sistema de cálculo, aprovação e controle do **repasse médico** para clínicas.
Desenvolvido por **Assunção Inteligência Financeira**.

A clínica carrega o relatório de produção do seu sistema (Excel ou CSV). O RepasseMed calcula o repasse de cada médico e aponta os erros antes da aprovação. Depois controla lançamento, pagamento, conciliação e demonstrativos, com auditoria de cada ação. Um assistente de IA tira dúvidas do processo e analisa o período.

## O que ele faz

| Etapa | O que o sistema faz |
| --- | --- |
| Carregar | Lê Excel/CSV (UTF-8 ou ANSI), acha o cabeçalho sozinho, reconhece as colunas e lembra o mapeamento do período anterior |
| Calcular | Consulta: % × (valor − imposto − taxa do cartão). Exame: valor fixo ou % do líquido. Regras especiais por médico. Convênio no atendimento ou só após o recebimento |
| Conferir | Bloqueia a aprovação com 6 tipos de alerta vermelho. Mostra 6 de atenção (duplicidade, estorno, valor zerado…). Prova real: a soma das linhas tem de bater com o total ao centavo |
| Ajustar | Adiantamento, glosa, complemento e correção, sempre com motivo |
| Aprovar | Gera a mensagem para o aprovador e registra quem aprovou e quando. Congela regras e valores do período |
| Lançar e pagar | Dados prontos para a conta a pagar, data de pagamento em dia útil (feriados nacionais e locais), PIX travado para médico PJ sem nota fiscal |
| Fechar | Conciliação e envio de demonstrativos por médico, impressão em PDF, exportação CSV |
| Controlar | Histórico com gráfico, variação entre períodos, auditoria por período e histórico de mudanças de regra |
| IA | Mapeia colunas, analisa o período e responde dúvidas. **Nunca recebe nomes de pacientes** |

## Arquitetura

Site estático, sem servidor, publicado no GitHub Pages:

```
index.html          página única
css/app.css         visual (claro e escuro)
js/engine.js        motor de cálculo: módulo puro, em centavos inteiros e BigInt
js/periodo.js       períodos, dias úteis, Páscoa e feriados móveis
js/storage.js       dados no navegador (localStorage), backup e restauração
js/pdf.js           leitor de relatórios em PDF (pdf.js 4.10.38)
js/ai.js            cliente da API da Anthropic (direto ou via proxy)
js/app.js           interface e fluxo
worker/proxy.js     proxy opcional da IA (Cloudflare Workers) para revenda
tests/              testes do motor, calendário e proxy (node) e ponta a ponta (Playwright)
sample/             relatório de exemplo para demonstração
```

**Onde ficam os dados:** no navegador do computador da clínica. Nada vai para servidor. O backup é um arquivo JSON baixado pela tela de Configurações e nunca leva a chave da IA.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub, por exemplo `repassemed`.
   - O GitHub Pages é grátis em repositório **público**. Em repositório **privado**, o Pages exige plano pago (GitHub Pro ou Team). Verifique as condições atuais em docs.github.com.
2. Envie todos os arquivos deste projeto para a branch `main`, pelo site (Add file → Upload files) ou pelo git:
   ```bash
   git init && git add . && git commit -m "RepasseMed 1.0.0"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/repassemed.git
   git push -u origin main
   ```
3. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. A cada envio para `main`, a ação **Testar e publicar** roda os testes. **Se algum teste falhar, nada é publicado.** Se todos passarem, publica o site em `https://SEU-USUARIO.github.io/repassemed/`.
5. Domínio próprio (opcional), por exemplo `repasse.assuncao.net.br`: Settings → Pages → Custom domain, e um registro CNAME no seu DNS apontando para `SEU-USUARIO.github.io`.

## Rodar e testar no computador

```bash
python3 -m http.server 8765     # abra http://localhost:8765
npm test                        # 28 testes do motor, calendário e proxy
```

Teste ponta a ponta (opcional, precisa de Python com Playwright e de uma cópia do SheetJS em `vendor-test/xlsx.full.min.js`):

```bash
pip install playwright && python3 -m playwright install chromium
npm run test:e2e
```

## Assistente de IA

Configurações → Assistente de IA:

- **Chave neste navegador:** cole a chave da API da Anthropic (`sk-ant-…`). Ela fica só nesse navegador. É o modo simples, para uso interno.
- **Servidor proxy:** a chave fica no servidor, nunca no computador do cliente. É o modo recomendado para revenda. Veja abaixo.

### Proxy da IA (Cloudflare Workers)

```bash
cd worker
npm install -g wrangler
wrangler login
# edite wrangler.toml: ALLOWED_ORIGINS = "https://SEU-USUARIO.github.io"
wrangler secret put ANTHROPIC_API_KEY     # cole sk-ant-...
wrangler secret put CLINIC_TOKENS         # ex.: cardiolima:8f3kq...,integrale:a91xz...
wrangler deploy
```

Em cada clínica, informe o endereço do worker e o token dela. O proxy recusa outras origens e tokens inválidos, força os modelos permitidos e limita o tamanho das respostas. O uso de cada clínica é identificado pelo nome do token. Para cortar uma clínica, tire o token dela e publique de novo.

## Dependências externas

- **SheetJS 0.20.3** (leitura de Excel), carregado de `cdn.sheetjs.com`. Sem internet, o sistema abre mas não lê planilhas.
- **Google Fonts** (tipografia). Sem elas, o sistema usa a fonte do sistema operacional.
- **API da Anthropic**, apenas se a IA estiver ligada.

## Limitações conhecidas

- Os dados ficam em **um navegador de um computador**. Não há sincronização entre computadores nem login de usuários. Para trocar de computador, use backup e restauração.
- "Aprovado por" e "Executado por" são declarados na tela. Não há autenticação. A auditoria registra o que foi informado.
- Limpar os dados do navegador apaga tudo. Por isso, faça backup semanal.

## Licença

Software proprietário. Veja `LICENSE`.
