# WHATSON2 — Subprojeto 1: Núcleo + Chatbot simples

**Data:** 2026-10-13
**Status:** Aprovado em conversa, aguardando revisão da spec escrita

## 1. Contexto e objetivo

WHATSON2 substitui o WHATSON v1 (SaaS multiempresa de multiatendimento WhatsApp, baseado em Whaticket com Baileys embutido no backend). É uma reescrita do zero, mantendo o mesmo estilo de arquitetura (backend Node/TS em camadas, Postgres, Redis, Socket.io, frontend React, Docker), com duas mudanças centrais:

- O WhatsApp passa a ser acessado pela **Evolution API** rodando como serviço separado. O backend não fala o protocolo do WhatsApp.
- **Nova identidade visual**: "Clean SaaS" (claro, arejado, acento índigo).

O v1 serve apenas como referência de regras de negócio. Nenhum código é copiado.

### Prioridades

1. Confiabilidade: nenhuma mensagem perdida ou duplicada, nenhum cliente preso no bot.
2. Simplicidade: chatbot de menu numérico, sem integrações externas.

### Roadmap (cada item é um subprojeto com spec → plano → implementação próprios)

1. **Núcleo + chatbot simples** — este documento.
2. Produtividade: respostas rápidas, tags/kanban, agendamentos, notas internas, avaliação.
3. SaaS/gestão: planos, assinaturas, financeiro, dashboard, relatórios.

### Fora de escopo (explicitamente removidos)

- Integrações: Typebot, n8n, Dify, OpenAI, Dialogflow, webhooks de terceiros.
- Campanhas / disparo em massa.
- API oficial da Meta (Cloud API). A interface `WhatsAppProvider` permite adicioná-la depois.
- Flowbuilder visual e chatbot por palavras-chave (a estrutura em árvore permite evoluir depois).
- Atendimento de grupos (ignorados no núcleo).
- Testes E2E (Playwright).

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript, Express, Sequelize v6 (sequelize-typescript), Postgres 16 |
| Filas | BullMQ sobre Redis 7 |
| Tempo real | Socket.io |
| Logs | pino (JSON estruturado) |
| Frontend | React + Vite + TypeScript, Tailwind CSS, shadcn/ui, React Query, Zustand |
| WhatsApp | Evolution API (modo Baileys, conexão por QR code) |
| Infra | Docker Compose: `postgres`, `redis`, `evolution-api`, `backend`, `frontend` (Nginx) |
| Testes | Jest (backend), Vitest + Testing Library (frontend) |

A Evolution API usa um database próprio dentro do mesmo container Postgres.

Estrutura do repositório (monorepo):

```
backend/
frontend/
docker/
docs/
docker-compose.yml
```

## 3. Arquitetura

```
┌──────────┐  webhook   ┌──────────────────────────── backend ─────────────────────────────┐
│ Evolution│ ─────────► │ POST /webhooks/evolution/:token ──► fila "inbound" (responde 200)
│   API    │ ◄───────── │                                        │
└──────────┘   REST     │   worker inbound ─► MessageService ─► TicketService ─► ChatbotEngine
     ▲                  │                          │                    │
     │                  │                      Postgres            Socket.io ──► frontend
     └── fila "outbound" ◄── API REST (/tickets, /messages, ...) ◄─────────────── React
                        └──────────────────────────────────────────────────────────────────┘
```

### Módulos do backend

Cada módulo segue rotas → controller → service → models.

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login JWT + refresh token; perfis `admin`, `supervisor`, `agent` |
| `companies` | Multiempresa. Todo registro (exceto `companies`) tem `companyId`; middleware injeta e filtra |
| `users` | Atendentes, perfil, vínculo com filas |
| `connections` | Criar/excluir instância na Evolution, QR code, status, reconexão |
| `whatsapp-provider` | Interface `WhatsAppProvider` + implementação `EvolutionProvider`. Único módulo que conhece a Evolution |
| `contacts` | Contatos, criados automaticamente na primeira mensagem |
| `queues` | Filas/setores e horário de expediente |
| `tickets` | Ciclo de vida do atendimento |
| `messages` | Entrada/saída, mídia, ack |
| `chatbot` | Árvore de opções e motor do menu |
| `realtime` | Socket.io com salas por empresa, fila e ticket |

### Interface `WhatsAppProvider`

Operações mínimas: `createInstance`, `deleteInstance`, `getQrCode`, `getConnectionState`, `logout`, `sendText`, `sendMedia`, `downloadMedia`, `parseWebhook(payload) → InboundEvent`. O restante do backend trabalha apenas com tipos internos (`InboundMessage`, `AckUpdate`, `ConnectionUpdate`).

### Telas do frontend (núcleo)

Login · Atendimento (lista de tickets + chat) · Contatos · Filas · Editor do chatbot (com simulador) · Conexões · Usuários · Configurações da empresa.

## 4. Modelo de dados

Todas as tabelas, exceto `companies` e a tabela de junção `user_queues`, têm `companyId`, `createdAt` e `updatedAt`.

| Tabela | Campos-chave |
|---|---|
| `companies` | `name`, `status`, `timezone` |
| `users` | `name`, `email` (único global), `passwordHash`, `profile` (`admin`/`supervisor`/`agent`), `online` |
| `user_queues` | `userId`, `queueId` |
| `connections` | `name`, `instanceName` (único), `status` (`disconnected`/`qrcode`/`connected`), `number`, `webhookToken` (único), `isDefault`, `defaultQueueId`, `outOfHoursMessage`, `closingMessage`, `transferMessage`, `botTimeoutMinutes` (padrão 30). A saudação é a mensagem do nó raiz do chatbot |
| `queues` | `name`, `color`, `schedule` (JSON: por dia da semana, lista de intervalos `HH:mm-HH:mm`; vazio = sempre aberto) |
| `contacts` | `name`, `number` (único por empresa), `profilePicUrl`, `isGroup` |
| `tickets` | `contactId`, `connectionId`, `queueId?`, `userId?`, `status` (`bot`/`pending`/`open`/`closed`), `chatbotNodeId?`, `chatbotAttempts`, `lastMessage`, `lastMessageAt`, `unreadCount`, `closedAt?` |
| `messages` | `ticketId`, `connectionId`, `providerMessageId`, `fromMe`, `body`, `type` (`text`/`image`/`audio`/`video`/`document`/`sticker`/`location`), `mediaUrl?`, `mediaMime?`, `ack` (`pending`/`sent`/`delivered`/`read`/`failed`), `quotedMessageId?`, `sentByUserId?`, `isBot` |
| `chatbot_nodes` | `connectionId`, `parentId?`, `order`, `key` ("1", "2", ...), `title`, `action` (`submenu`/`reply`/`transfer_queue`/`transfer_agent`/`close`), `message`, `mediaUrl?`, `queueId?`, `userId?` |
| `ticket_logs` | `ticketId`, `event` (`created`/`accepted`/`transferred`/`closed`/`bot_timeout`), `userId?`, `fromQueueId?`, `toQueueId?` |

Restrições importantes:

- Índice único `messages(connectionId, providerMessageId)`, que é a base da idempotência.
- No máximo 1 ticket não-fechado por `(contactId, connectionId)`, garantido por índice único parcial `WHERE status <> 'closed'`.
- `chatbot_nodes(parentId, key)` único entre nós não-raiz.
- No máximo 1 nó raiz (`parentId IS NULL`) por conexão.

## 5. Ciclo do ticket

```
mensagem de contato sem ticket aberto
        │
        ▼
   [bot] ──(transfer_queue / transfer_agent)──► [pending] ──(aceitar)──► [open] ──(finalizar)──► [closed]
     │  ▲                                          ▲                       │
     │  └─ submenu / reply / inválida              └──── (transferir) ─────┘
     └─(close / timeout / mensagem fromMe) ─────────────────────────────────────────► [closed] ou [open]
```

Regras:

- Mensagem recebida após `closed` cria ticket novo, que passa de novo pelo bot.
- Conexão sem nó raiz de chatbot → ticket nasce em `pending` na `defaultQueueId`.
- Mensagem `fromMe` (enviada pelo celular) é registrada no ticket. Se o ticket estiver em `bot`, ele passa para `open` sem `userId` (atendido pelo "celular") e o bot para.
- Aceitar: `UPDATE ... WHERE id = ? AND status = 'pending'`. Se 0 linhas forem afetadas, o atendente recebe um erro de conflito ("ticket já aceito").
- Transferir: para outra fila (volta a `pending`) ou para outro atendente (`pending` com `userId` definido, visível apenas para ele).
- Finalizar: envia `closingMessage` se configurada e grava `closedAt`.
- Cada transição grava `ticket_logs`.
- Mensagens de grupo (`isGroup`) são descartadas no worker de entrada.

### Visibilidade dos tickets

- `agent`: vê `pending` das suas filas, `pending` atribuídos a ele e seus `open`.
- `supervisor` e `admin`: veem todos os tickets da empresa.
- Tickets em `bot` aparecem em uma aba separada, somente leitura, para supervisor e admin.

## 6. Chatbot

### Estrutura

Árvore de `chatbot_nodes` por conexão. A raiz é o nó sem `parentId` (único por conexão); a mensagem dela é a saudação, e os filhos da raiz formam o menu principal. Só a raiz e nós `submenu` podem ter filhos.

### Montagem do menu

O texto é gerado automaticamente a partir dos filhos ordenados:

```
{message do nó atual}

1 - Financeiro
2 - Suporte
0 - Voltar          ← apenas quando o nó atual não é a raiz
```

### Motor

Função pura `step(state, input, context) → { actions[], nextState }`, sem I/O.

- `state`: `chatbotNodeId`, `chatbotAttempts`.
- `context`: árvore da conexão, horário atual e expediente das filas.
- `actions`: `sendText`, `sendMedia`, `setTicketPending(queueId, userId?)`, `closeTicket`, `scheduleTimeout`.

Comportamento:

1. Ticket novo em `bot` → envia o menu da raiz; `chatbotNodeId = raiz`.
2. Entrada igual à `key` de um filho do nó atual (comparação após `trim`):
   - `submenu` → envia o menu do filho; o nó atual passa a ser o filho.
   - `reply` → envia `message` (+ mídia, se houver) e reenvia o menu do nó atual.
   - `transfer_queue` → envia `message` (ou `transferMessage` da conexão); ticket vai para `pending` em `queueId`.
   - `transfer_agent` → igual ao anterior, com `userId` definido.
   - `close` → envia `message` e fecha o ticket.
3. Entrada `0` em um submenu → volta ao pai e envia o menu dele.
4. Entrada inválida → "Opção inválida." + menu atual; `chatbotAttempts++`. Ao chegar em **3**, transfere para `defaultQueueId`.
5. Qualquer opção válida zera `chatbotAttempts`.
6. Transferência para fila **fora do expediente** → envia `outOfHoursMessage`; o ticket fica `pending` mesmo assim.
7. **Timeout**: a cada mensagem do cliente em `bot`, um job BullMQ atrasado (`botTimeoutMinutes`) é reagendado com id determinístico por ticket. Se ele disparar e o ticket ainda estiver em `bot`, o ticket fecha com log `bot_timeout`.

Mensagens não-texto (áudio, imagem) recebidas em `bot` contam como entrada inválida.

### Editor (frontend)

- Árvore com indentação: expandir/recolher, adicionar filho, arrastar para reordenar.
- Painel lateral com formulário do nó selecionado: título, key, ação, mensagem, mídia, fila ou atendente de destino.
- **Simulador**: chat de teste na própria tela, que executa o mesmo `step` (exposto por endpoint `POST /chatbot/simulate`) sem enviar nada ao WhatsApp.

## 7. Confiabilidade

### Entrada

- `POST /webhooks/evolution/:webhookToken`: valida o token, enfileira o payload bruto na fila `inbound` e responde `200`. Não faz nenhum acesso ao banco além do lookup do token (cacheado em memória/Redis).
- **Idempotência**: insert com índice único `(connectionId, providerMessageId)`. Se o registro já existir, o evento é ignorado sem erro.
- **Ordem por contato**: a entrada é dividida em `INBOUND_SHARDS` filas (`inbound-0..N`), cada uma com concorrência 1. O shard é escolhido por hash de `connectionId:número`, então eventos do mesmo contato (mensagens e acks) são processados em ordem FIFO, um de cada vez, e contatos diferentes rodam em paralelo em shards diferentes.
- O webhook é configurado sem base64; o worker baixa a mídia com `downloadMedia`, mantendo os jobs pequenos no Redis.
- Retry: 5 tentativas com backoff exponencial. Depois disso, o job vai para a dead-letter (jobs falhos retidos no BullMQ), visível no Bull Board (rota admin protegida), com ação de reprocessar.

### Saída

- Mensagem do atendente: grava com `ack = pending` → emite via socket → enfileira em `outbound` → `EvolutionProvider.send*` → grava o `providerMessageId` retornado e `ack = sent` → os acks seguintes chegam por webhook.
- Após esgotar os retries: `ack = failed`. A UI mostra ícone de erro e botão "reenviar", que cria um novo job.
- O bot usa a mesma fila de saída.
- A saída também é dividida em `OUTBOUND_SHARDS` filas (`outbound-0..N`, concorrência 1, shard por `ticketId`), garantindo que as mensagens de um ticket (ex.: resposta do bot seguida do menu) cheguem na ordem.
- Eco: se o WhatsApp devolver como `fromMe` uma mensagem que nós mesmos enviamos antes de gravarmos o id, ela é reconciliada com a mensagem pendente (mesmo contato, mesmo texto, últimos 2 minutos) em vez de duplicar.

### Conexões

- Os eventos `connection.update` e `qrcode.updated` atualizam o status e são emitidos por socket para a tela de Conexões.
- Job recorrente a cada 1 minuto: consulta `getConnectionState` de cada conexão e corrige divergências no banco. Uma transição para `disconnected` gera alerta por socket para os admins.

### Geral

- Erros: classe `AppError(code, httpStatus, message)` e handler central com resposta `{ error: { code, message } }`.
- Logs pino com `companyId`, `ticketId` e `jobId` quando aplicável.
- `GET /health`: verifica Postgres, Redis e Evolution (200 ou 503).
- Graceful shutdown: para de aceitar requests, fecha os workers aguardando os jobs ativos e fecha as conexões.
- Frontend: ao reconectar o socket, invalida as queries do React Query (lista de tickets e chat aberto) para ressincronizar.

## 8. Identidade visual — "Clean SaaS"

| Token | Valor |
|---|---|
| `primary` | `#6d5dfc` |
| `primary-soft` | `#efedff` |
| `sidebar` | `#1e1b3a` |
| `background` | `#f7f7fb` |
| `surface` | `#ffffff` |
| `border` | `#ececf3` |
| `text` | `#1e1b3a` |
| Fonte | Inter |

- Layout: barra lateral escura estreita com ícones, coluna da lista de tickets e área do chat.
- Bolhas do chat: entrada em branco com borda, saída em `primary` com texto branco.
- Tokens definidos como CSS variables e mapeados no tema Tailwind/shadcn. A estrutura já fica preparada para um tema escuro futuro, que não é implementado no núcleo.
- Responsivo até tablet (≥ 768px). Mobile fica fora do núcleo.

## 9. Testes

**Unitários**
- Motor do chatbot: opção válida em cada ação, inválida, 3 tentativas → fila padrão, voltar (`0`), fora do expediente, mídia como entrada inválida.
- Cálculo de expediente com timezone da empresa.
- `EvolutionProvider.parseWebhook` para cada tipo de evento e mensagem (com fixtures de payload).

**Integração** (Postgres + Redis reais via docker compose de teste; `WhatsAppProvider` mockado)
- Webhook → fila → contato, ticket e mensagem criados; bot responde.
- Webhook duplicado → 1 mensagem.
- 2 mensagens simultâneas do mesmo contato → 1 ticket, ordem preservada.
- Corrida no aceitar ticket → um sucesso e um conflito.
- Isolamento multiempresa: usuário da empresa A não acessa recursos da B (tickets, contatos, filas, conexões).
- Falha no envio → retries → `ack = failed`.

**Frontend**
- Testing Library: lista de tickets (abas e atualização por socket), chat (envio otimista e estado de falha), editor do chatbot (criar, editar, reordenar nós).

**Smoke manual com a Evolution real**: roteiro documentado em `docs/smoke-test.md`.

## 10. Critérios de pronto

1. `docker compose up` sobe tudo do zero; o seed cria 1 empresa e 1 admin.
2. O admin conecta um número via QR code na tela de Conexões.
3. O admin monta o menu no editor e testa no simulador.
4. Um cliente envia mensagem → o bot responde → o cliente escolhe uma fila → o ticket aparece em `pending`, em tempo real, para os atendentes da fila.
5. O atendente aceita, troca texto, imagem, áudio e documento nos dois sentidos, transfere e finaliza.
6. Reiniciar o backend no meio de um atendimento não perde nem duplica mensagens.
7. Todo o fluxo funciona na identidade Clean SaaS, responsivo até tablet.
8. Todas as suítes de teste passam.
