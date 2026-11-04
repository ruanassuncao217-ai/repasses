# Manual do RepasseMed para a clínica

Para quem executa o repasse (ex.: auxiliar financeira) e para quem aprova (ex.: diretor clínico).

## Antes do primeiro período (uma vez só)

1. **Configurações:** nome da clínica, CNPJ, quem aprova, quem executa, periodicidade e dias de pagamento. Informe os feriados municipais e estaduais da sua cidade. Ligue a IA, se contratada.
2. **Regras:** imposto, percentual da consulta e taxas de cartão (débito, crédito e parcelado, tiradas do contrato da maquininha). Preencha também a tabela de exames, as regras especiais por médico e como o convênio entra.
3. **Médicos:** carregue um relatório e clique em "Adicionar os médicos do relatório carregado". Depois preencha, para cada um, o fornecedor no sistema financeiro, se é PF ou PJ e a chave PIX.
4. Toda mudança de regra pede o nome de quem aprovou e fica no histórico.

## A cada período

| Etapa | O que fazer | Trava do sistema |
| --- | --- | --- |
| 1. Carregar | Exporte a produção do período do sistema da clínica e carregue o arquivo. Confira as colunas e clique em Calcular | Sem as colunas Médico, Procedimento e Valor, não calcula |
| 2. Conferir | Leia os alertas. Vermelho tem de ser corrigido na origem e o arquivo carregado de novo. Inclua os ajustes com motivo | Com alerta vermelho, a aprovação fica bloqueada |
| 3. Aprovar | Copie a mensagem, envie ao aprovador e registre a resposta | Sem aprovação, as etapas 4 a 6 ficam bloqueadas |
| 4. Lançar | Crie uma conta a pagar por médico, copiando os campos do cartão. Marque "Lançado". Médico PJ: anexe a nota e marque "Nota fiscal recebida" | — |
| 5. Pagar e conciliar | Faça um PIX por médico com o valor e a descrição exatos. Marque "Pago". No dia seguinte, concilie o extrato vinculando cada PIX à conta a pagar e marque "Conciliado" | PJ sem nota não pode ser marcado como pago; conciliado só depois de pago |
| 6. Demonstrativos | Copie a mensagem ou imprima o PDF de cada médico, envie com o comprovante e marque "Enviado" | O período fecha sozinho quando tudo está conciliado e enviado |

## Situações comuns

- **O médico diz que o valor está errado.** Abra a etapa 2 e clique no nome dele para ver cada atendimento e a regra aplicada. Se houver erro já pago, a correção entra como **ajuste** no período seguinte, com motivo e aprovação.
- **Esqueceram um atendimento.** Ajuste "Acréscimo / Complemento" no período seguinte.
- **Adiantamento.** Só com aprovação. Entra como ajuste "Desconto" no período em que for descontado.
- **Preciso corrigir um período já aprovado.** Use "Reabrir período" e informe o motivo. A aprovação anterior fica guardada na auditoria e é preciso aprovar de novo.
- **Mudou uma regra.** Os períodos já aprovados não mudam. A regra nova vale para os próximos.

## Cuidados

- **Faça backup toda semana** (Configurações → Baixar backup). Os dados ficam só neste navegador deste computador.
- Não limpe os dados de navegação do navegador usado no RepasseMed.
- Para usar em outro computador: baixe o backup no antigo e restaure no novo.
- O detalhe dos atendimentos (com nomes de pacientes) fica só neste computador. A IA nunca recebe nomes de pacientes.
