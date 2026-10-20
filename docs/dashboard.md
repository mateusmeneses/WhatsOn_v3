# Dashboard e indicadores

Telas e endpoints de indicadores. Todos os horários são agrupados no **fuso da empresa** (Configurações); a
Visão geral da plataforma usa `America/Sao_Paulo`.

| Tela | Endpoint | Quem acessa |
|---|---|---|
| Dashboard (`/dashboard`) | `GET /api/dashboard?period=` | administrador e supervisor |
| Meu desempenho (`/meu-desempenho`) | `GET /api/dashboard/me?period=` | todos (só os próprios dados) |
| Visão geral da plataforma (`/visao-geral`) | `GET /api/admin/overview?period=` | super-admin |
| Menu e título da aba | `GET /api/tickets/summary` | todos (respeita a visibilidade) |

`period`: `today`, `yesterday`, `7d`, `30d`, `90d` ou `custom` com `from` e `to` (`AAAA-MM-DD`, até 366 dias).
Cada indicador vem com o valor do **período anterior de mesma duração** para a comparação.

## Como cada número é calculado

- **Atendimentos criados / finalizados**: por `createdAt` e `closedAt` do atendimento.
- **Tempo de resposta**: o cliente "abre uma rodada" quando manda uma mensagem e a anterior no atendimento foi
  nossa (ou não existe). O tempo é até a **próxima mensagem nossa**. Rodadas respondidas pelo **bot** não contam;
  rodadas sem resposta não entram na média (aparecem em "cliente aguardando resposta"). Mostramos a **mediana**
  (mais justa: uma mensagem noturna não distorce) e a média.
- **Respostas no prazo**: % das respostas dentro da meta da empresa (Configurações, padrão 5 min).
- **Espera até aceitar**: do último momento em que o atendimento ficou aguardando (criado, transferido ou
  reaberto) até um atendente aceitar. Atendimentos assumidos direto pelo celular não entram.
- **Tempo de resolução**: `closedAt − createdAt` dos atendimentos finalizados no período.
- **Cliente aguardando resposta (agora)**: atendimentos aguardando/em atendimento cuja última mensagem do cliente
  veio depois da última mensagem nossa.
- **Presença (online agora)**: sockets conectados do painel, em tempo real. `lastLoginAt` (login com senha) e
  `lastSeenAt` (última conexão/desconexão) alimentam o "visto há…".
- **Resolvidos pelo bot**: atendimentos que passaram pelo bot, foram finalizados e nunca tiveram aceite,
  reabertura ou requerimento.

## Desempenho em bases grandes

Medido com 100 mil atendimentos, 800 mil mensagens e 300 mil eventos de uma empresa (90 dias):

| Período | Dashboard | Meu desempenho |
|---|---|---|
| hoje | ~0,3 s | ~0,1 s |
| 7 dias | ~0,5 s | ~0,4 s |
| 30 dias | ~1,9 s | ~1,2 s |
| 90 dias | ~2,6 s | ~1,7 s |

- O tempo de resposta usa uma única passada com função de janela (sem consulta por mensagem) sobre o índice de
  cobertura `messages_company_ticket_created` (migration `0013`).
- As respostas dos painéis ficam em **cache de 20 s** (30 s na Visão geral) com deduplicação: quem abre o mesmo
  painel ao mesmo tempo dispara uma só consulta. O cache é desligado nos testes.
- A tela atualiza sozinha a cada 30 s e quando chegam eventos de presença ou de atendimento.
