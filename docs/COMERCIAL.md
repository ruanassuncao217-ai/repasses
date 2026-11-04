# Guia comercial do RepasseMed (uso interno da Assunção IF)

## O problema que você vende

Em clínica com vários médicos, o repasse costuma ser calculado em planilha por uma pessoa só. Isso traz quatro riscos: erro de percentual ou de taxa de cartão, atendimento esquecido ou duplicado, pagamento sem aprovação formal e briga com o médico sem demonstrativo. Cada um custa dinheiro ou relacionamento.

## A proposta em uma frase

"Sua equipe calcula o repasse em minutos, o sistema trava erros antes de pagar, o diretor aprova por escrito e cada médico recebe um demonstrativo."

## Diferenciais que você pode afirmar (estão no sistema e testados)

- Cálculo em centavos inteiros com prova real: a soma bate ao centavo em 3.000 atendimentos (teste automático).
- Seis travas: alerta vermelho bloqueia a aprovação; sem aprovação não se paga; PJ sem nota não se paga; período aprovado não muda quando a regra muda; reabrir exige motivo; mudança de regra exige aprovador.
- Calendário de pagamento com feriados nacionais, móveis e locais.
- Auditoria por período e histórico de regras.
- Dados de pacientes ficam no computador da clínica; a IA não os recebe.

## O que NÃO prometer

- Não é sistema contábil nem emite nota fiscal.
- Não integra automaticamente com o Conta Azul ou outro ERP na versão 1.0. O lançamento é guiado, campo a campo.
- Não tem login nem acesso simultâneo de várias pessoas em computadores diferentes.
- Não substitui a contabilidade em questões tributárias (retenções de PJ, INSS de autônomo, ISS).

## Modelos de cobrança (sugestões, valide com o seu mercado)

Os valores abaixo são **estimativas minhas** para clínicas pequenas e médias de Teresina e região, não pesquisa de mercado. Teste com 2 ou 3 clientes antes de fixar a tabela.

| Modelo | Como funciona | Faixa sugerida (a validar) |
| --- | --- | --- |
| Implantação | Configuração das regras, cadastro dos médicos, primeiro período rodado junto, treinamento | Valor único, de 1 a 2 mensalidades |
| Licença mensal | Uso do sistema + atualizações + suporte por WhatsApp | Por faixa de médicos (ex.: até 5, 6 a 15, acima de 15) |
| IA | Incluída no plano via proxy (o custo da API é seu) ou o cliente usa a própria chave | Repasse o custo com margem; monitore o uso por token |
| BPO completo | Você executa o repasse no lugar da clínica | Mensalidade maior, combinada com o seu BPO financeiro |

Para precificar a IA, acompanhe o custo real por clínica no painel da Anthropic, separado pelo nome do token no proxy, durante os primeiros meses.

## Roteiro de implantação (por clínica)

1. Reunião de regras com o diretor: percentual da consulta, exames, exceções por médico, convênio, glosa, adiantamento e calendário.
2. Pedir 1 relatório de produção real do sistema da clínica e o contrato da maquininha (taxas).
3. Configurar no RepasseMed, gerar o token do proxy e testar com o relatório real.
4. **Rodar o primeiro período em paralelo com a planilha atual** e conferir médico a médico. Só desligar a planilha quando os dois baterem.
5. Treinar quem executa (1 hora) e entregar o Manual da clínica.
6. Combinar a rotina de backup semanal.

## LGPD e contrato

O relatório de produção traz nome de paciente e procedimento, que podem configurar **dado pessoal sensível (saúde)**. Pontos para o contrato:

- A clínica é a **controladora**. Você é **operador** apenas se acessar os dados (implantação, suporte, BPO).
- O RepasseMed guarda os dados no computador da clínica e não os envia a servidor. A IA recebe só totais por médico.
- Prever confidencialidade, finalidade (só cálculo de repasse) e descarte após o suporte.
- Incluir a limitação de responsabilidade da licença: o cálculo segue as regras cadastradas e aprovadas pela clínica.

Isso não é parecer jurídico. **Você deve validar o contrato com um advogado** antes da primeira venda.

## Próximas versões que aumentam o valor

- Login, vários usuários e dados na nuvem com sincronização (ex.: Supabase).
- Integração direta com o Conta Azul para criar as contas a pagar.
- Importadores prontos para os sistemas de clínica mais usados na região.
- Painel do diretor no celular, com aprovação por botão.
- Portal do médico para consultar os próprios demonstrativos.
