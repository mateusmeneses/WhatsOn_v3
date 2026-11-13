# Melhorias no webhook WhatsOn → Claudia (modo econômico)

**Para:** programador do WhatsOn
**De:** Whatyson / Claudia (suporte N1)
**Data:** 13/11/2026
**Referência:** `docs/claudia-webhook.md` e "Configuração da Claudia: modo econômico, só por webhook" (13/11/2026)

## Objetivo

O padrão do modo econômico (`CLAUDIA_WEBHOOK_MODO=economico`, formato `v2`, `CLAUDIA_WEBHOOK_INCLUIR_TEXTO=true`) está aprovado e a Claudia vai segui-lo.
O que ainda gasta mais tokens é a Claudia **abrir o painel no navegador** para agir ou conferir algo. As melhorias abaixo são para que ela **atenda sem abrir o navegador** e **seja acordada só quando precisa decidir algo**.

Prioridade: **Alta** = maior economia; **Média** = evita execuções desnecessárias; **Baixa** = ajuste fino.

---

## 1. Alta: API de ações para a Claudia

Hoje o v2 permite **ler** o caso pelo aviso, mas para **agir** a Claudia ainda abre o painel. Pedimos endpoints REST autenticados (pode ser o mesmo Token de API de Conexões, ou um token específico do usuário Claudia):

| Ação | Sugestão de endpoint |
|---|---|
| Aceitar conversa | `POST /api/v1/conversas/{id}/aceitar` |
| Enviar mensagem de texto | `POST /api/v1/conversas/{id}/mensagens` `{ "texto": "..." }` |
| Salvar Observação | `POST /api/v1/conversas/{id}/observacoes` `{ "texto": "..." }` |
| Transferir | `POST /api/v1/conversas/{id}/transferir` `{ "usuario_id": n }` ou `{ "fila_id": n }` |
| Finalizar (com ou sem mensagem de encerramento) | `POST /api/v1/conversas/{id}/finalizar` `{ "enviar_mensagem": true/false }` |
| Ler histórico (quando o aviso não basta) | `GET /api/v1/conversas/{id}/mensagens?limite=n` |
| Ler Observações | `GET /api/v1/conversas/{id}/observacoes` |

Requisitos:
- Ações feitas pela API ficam registradas como **usuário Claudia**.
- Transferência deve **recusar** usuário offline (retornar erro claro), para cumprir a regra "nunca transferir para quem não está logado".
- Resposta com o estado final da conversa (status, atendente) para a Claudia confirmar sem reabrir.

## 2. Alta: presença dos atendentes no aviso

Antes de transferir, a Claudia precisa saber quem está logado, e hoje abre **Gestão → Usuários** só para isso. Incluir no aviso v2:

```json
"atendentes_online": [
  { "id": 12, "nome": "Nadilson", "online": true },
  { "id": 15, "nome": "Yure", "online": false, "visto_em": "2026-11-13T08:40:00-03:00" },
  { "id": 9, "nome": "Mateus Meneses", "online": true }
]
```

Alternativa: `GET /api/v1/usuarios/presenca`.

## 3. Média: o WhatsOn resolver sozinho o que é automático

Esses casos acordam a Claudia, mas a decisão é sempre a mesma. O próprio sistema pode resolver **sem gerar aviso**:

| Situação | Ação automática do WhatsOn |
|---|---|
| `mensagem_pos_finalizacao` com `apenas_reacao = true` ("obrigado", "ok", 👍, figurinha) | Manter finalizada / finalizar sem mensagem. Não avisar a Claudia |
| `inatividade_cliente` 15 min | Enviar lembrete padrão configurável. Não avisar a Claudia |
| `inatividade_cliente` 30 min | Finalizar com a mensagem padrão. Não avisar a Claudia |
| Conversa nova com `faixa_horario = fora` | Enviar mensagem automática com o horário de retorno e **manter em Aguardando** (não aceitar) |

Configuração sugerida: `CLAUDIA_AUTO_REACAO=true`, `CLAUDIA_AUTO_INATIVIDADE=true`, `CLAUDIA_AUTO_FORA_HORARIO=true`, cada uma com o texto da mensagem configurável.

## 4. Média: inatividade não pode fechar caso que espera o suporte

Em 10/11, conversas aceitas fora do horário foram **finalizadas automaticamente após 30 min** (#1466, #1467, #1469), embora quem devesse a resposta fosse o suporte, não o cliente.
Pedido: a finalização automática por inatividade só deve contar quando **a última mensagem é do atendente** (o suporte está esperando o cliente). Se a última mensagem for do cliente, **não finalizar**.

## 5. Média: filtro do modo econômico também pelo menu

Contato sem **Produto** preenchido nunca acorda a Claudia, mesmo escolhendo Multicomércio no menu do bot. Isso pode deixar cliente novo sem atendimento.
Pedido: no modo econômico, considerar também `menu_escolhido` contendo um termo de `CLAUDIA_PRODUTOS`.

## 6. Média: janela de agrupamento maior em Aguardando

Clientes costumam mandar 3 ou 4 mensagens seguidas. Com a janela de 60 s isso vira 2 ou 3 execuções.
Pedido: variável `CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO` (sugestão: 120 a 180 s) para conversas **sem atendente**; manter 60 s nas conversas com a Claudia.

## 7. Média: alerta de queda de conexão direto para as pessoas

O modo econômico corta `conexao_prolongada`, mas queda de conexão **sempre** deve chegar ao Whatyson e ao Mateus.
Pedido: o próprio WhatsOn avisa por e-mail e/ou WhatsApp (número configurável) quando a conexão fica fora mais de `CLAUDIA_CONEXAO_MINUTOS` e quando volta, **sem passar pela Claudia**.
Sugestão: `ALERTA_CONEXAO_DESTINOS=email:...,whatsapp:...`

## 8. Baixa: alertas de 10/20 min sem aceite direto pelo sistema

`transferencia_sem_aceite` hoje acorda a Claudia só para repassar o alerta. As regras são fixas e podem ficar no sistema:
- Só para conversas com **Nadilson ou Yure**, e só se o técnico estiver **online**.
- Só quando o **suporte deve a resposta** (última mensagem é do cliente).
- **Nunca** para conversas com Mateus Meneses (Financeiro).
- Destino: Whatyson e Mateus.

Assim a Claudia não precisa acordar para esse evento.

## 9. Baixa: ajustes no payload v2

- `empresa.contrato`: hoje sempre `null`; preencher quando houver o vínculo com o Manager.
- `mensagens_recentes`: indicar o **tipo** do anexo (imagem, áudio, PDF) e não só a quantidade, para a Claudia saber se precisa abrir.
- `ultima_mensagem_origem` (`cliente` / `atendente`): facilita saber quem deve a resposta sem ler as mensagens.
- `observacoes_resumo`: as últimas Observações da conversa (texto curto), para evitar abrir o painel só para lê-las.

---

## Teste de aceite das melhorias

1. Mandar um "obrigado" depois de finalizar: a conversa fica finalizada e **nenhum** aviso chega.
2. Conversa fora do horário: o cliente recebe a mensagem de retorno, a conversa fica em Aguardando e nada é finalizado por inatividade.
3. Cliente sem Produto escolhe Multicomércio no menu: chega `conversa_aguardando`.
4. Aviso v2 traz `atendentes_online` correto.
5. A Claudia aceita, responde, salva Observação e transfere **só pela API**, e tudo aparece no painel como feito pela Claudia.
6. Tentar transferir pela API para usuário offline: retorna erro.
7. Derrubar a conexão por mais de 10 min: Whatyson e Mateus recebem o alerta direto, e a Claudia não é acordada.
8. Depois de 1 semana, comparar o número de execuções da Claudia com a semana anterior.
