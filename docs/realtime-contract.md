# Contrato de tempo real (Socket.io)

Referência curta para o frontend. Servidor: mesmo host/porta da API (padrão `http://localhost:4000`).

## Conexão

```ts
const socket = io(API_URL, { auth: { token: accessToken } });
```

- O token é o **access token** JWT (o mesmo do header `Authorization`). Token inválido/expirado → erro de conexão `UNAUTHENTICATED` (renove o token e reconecte).
- **Aguarde o evento `ready`** antes de emitir qualquer coisa. Ele chega depois que o servidor colocou o socket nas salas da empresa, do usuário, de supervisores (admin/supervisor) e das filas do usuário.

## Salas de ticket (mensagens)

```ts
socket.emit("ticket:join", ticketId, (ok: boolean) => { /* ok=false: sem permissão ou ticket inexistente */ });
socket.emit("ticket:leave", ticketId);
```

- Entre na sala ao abrir a conversa e saia ao fechá-la. Eventos de mensagem só chegam a quem está na sala do ticket.
- Use o ack de `ticket:join`: se vier `false`, não espere mensagens daquele ticket.

## Eventos recebidos

| Evento | Payload | Quem recebe |
| --- | --- | --- |
| `ticket:update` | ticket completo (com `contact`, `queue`, `user`) | supervisores, fila do ticket (atual e anterior), usuário atribuído (atual e anterior); tickets pendentes sem fila vão para a empresa toda |
| `message:new` | mensagem | sala `ticket:<id>` |
| `message:update` | mensagem (ack, edição, mídia) | sala `ticket:<id>` |
| `message:delete` | `{ id, ticketId }` | sala `ticket:<id>` |
| `connection:update` | conexão (sem segredos) | supervisores |
| `connection:qrcode` | `{ connectionId, qr }` | supervisores |
| `connection:alert` | `{ connectionId, name }` (conexão caiu) | supervisores |

`ticket:update` é a fonte de verdade de status/fila/atendente: substitua o ticket local pelo payload; se ele deixou de ser visível para o usuário, remova-o da lista.

## Reconexão

- Os eventos **não são reenviados**. A cada reconexão (após `ready`), refaça as consultas REST (lista de tickets e mensagens do ticket aberto) e emita `ticket:join` de novo para o ticket aberto.
- **Mudança de filas do usuário**: as salas de fila são definidas na conexão. Depois que as filas de um usuário mudam (ou o perfil muda), o cliente precisa **desconectar e reconectar** o socket para passar a receber os eventos das novas filas.
