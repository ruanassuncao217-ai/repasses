# Histórico de versões

## 1.0.0 – 04/11/2026
- Cálculo de repasse de consultas e exames em centavos inteiros, com prova real.
- Regras: imposto, percentual da consulta, taxas de cartão, exames fixos ou percentuais, regras especiais por médico, convênio por atendimento ou recebimento, formas de pagamento personalizadas.
- Fluxo em 6 etapas com travas: alerta vermelho bloqueia a aprovação, aprovação libera o pagamento, médico PJ sem nota fiscal não é pago.
- Ajustes manuais com motivo; reabertura de período com motivo; auditoria por período; histórico de regras.
- Calendário de pagamento com dias úteis, feriados nacionais e móveis, e feriados locais.
- Demonstrativos impressos, mensagens prontas, CSV de resumo e de detalhe.
- Assistente de IA (direto ou via proxy) sem envio de dados de pacientes.
- Backup e restauração em JSON.
