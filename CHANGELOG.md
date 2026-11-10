# Histórico de versões

## 1.1.0 – 09/11/2026
- Lê o relatório em PDF direto do sistema da clínica (ex.: "Relatório de Atendimento"), sem precisar converter para Excel. O PDF é lido só no navegador.
- pdf.js (Mozilla, Apache 2.0) na versão fixa 4.10.38, carregado só ao abrir um PDF; a política de segurança da página libera apenas esse endereço.
- Correção: a coluna "Data Pagamento" não é mais confundida com a forma de pagamento.
- Correção: "Cartão de crédito 1X" passa a ser crédito à vista (antes caía como parcelado).
- Reconhece a coluna "PROF. EXECUT." como médico.
- Novo alerta bloqueante: atendimentos com data fora do período escolhido.
- Proxy da IA com a origem do GitHub Pages configurada.
- 6 testes novos (34 no total), com dados fictícios.

## 1.0.0 – 04/11/2026
- Cálculo de repasse de consultas e exames em centavos inteiros, com prova real.
- Regras: imposto, percentual da consulta, taxas de cartão, exames fixos ou percentuais, regras especiais por médico, convênio por atendimento ou recebimento, formas de pagamento personalizadas.
- Fluxo em 6 etapas com travas: alerta vermelho bloqueia a aprovação, aprovação libera o pagamento, médico PJ sem nota fiscal não é pago.
- Ajustes manuais com motivo; reabertura de período com motivo; auditoria por período; histórico de regras.
- Calendário de pagamento com dias úteis, feriados nacionais e móveis, e feriados locais.
- Demonstrativos impressos, mensagens prontas, CSV de resumo e de detalhe.
- Assistente de IA (direto ou via proxy) sem envio de dados de pacientes.
- Backup e restauração em JSON.
