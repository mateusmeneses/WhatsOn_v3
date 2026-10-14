# Smoke test — WHATSON2 backend com Evolution API real

Pré-requisito: `docker compose up -d --build` rodando e um celular com WhatsApp para conectar.

1. **Login**: `POST /api/auth/login` com o admin do seed. Guarde o `accessToken` (`TOKEN`).
2. **Fila**: `POST /api/queues` `{ "name": "Suporte" }` → anote o `id` (`QUEUE`).
3. **Conexão**: `POST /api/connections` `{ "name": "Principal", "defaultQueueId": QUEUE }` → status `qrcode`.
4. **QR code**: `GET /api/connections/:id/qrcode` → abra o `qr` (data URL) no navegador e leia com o WhatsApp.
   Em até 1 minuto `GET /api/connections` deve mostrar `status: "connected"` e o `number`.
5. **Chatbot**:
   - `POST /api/connections/:id/chatbot/nodes` `{ "parentId": null, "message": "Olá! Escolha uma opção:" }` → `ROOT`.
   - `POST /api/connections/:id/chatbot/nodes` `{ "parentId": ROOT, "key": "1", "title": "Suporte", "action": "transfer_queue", "queueId": QUEUE }`.
6. **Entrada**: de outro celular, mande "oi" para o número conectado.
   Esperado: chega o menu; `GET /api/tickets?status=bot` (admin) mostra o ticket.
7. **Escolha**: responda "1". Esperado: mensagem de transferência; `GET /api/tickets?status=pending` mostra o ticket na fila.
8. **Atendimento**: `POST /api/tickets/:id/accept`, depois `POST /api/tickets/:ticketId/messages` `{ "body": "Oi, em que posso ajudar?" }`.
   Esperado: mensagem chega no celular; `ack` evolui para `sent` → `delivered` → `read`.
9. **Mídia**: do celular, envie uma foto, um áudio e um PDF. Esperado: as três aparecem em
   `GET /api/tickets/:ticketId/messages` com `mediaUrl` acessível em `http://localhost:4000{mediaUrl}`.
   Envie um arquivo pelo atendente: `POST /api/media` (multipart `file`) e depois `POST /api/tickets/:ticketId/messages` `{ "media": <resposta do upload> }`.
10. **Resiliência**: `docker compose restart backend` e, enquanto ele reinicia, mande 3 mensagens do celular.
    Esperado: as 3 aparecem uma única vez e na ordem certa depois que o backend volta.
11. **Finalizar**: `POST /api/tickets/:id/close`. Mande "oi" de novo → novo ticket passa pelo bot.
12. **Queda de conexão**: desconecte o aparelho em "Aparelhos conectados" no WhatsApp.
    Esperado: em até 1 minuto `GET /api/connections` mostra `disconnected`.
13. **Painel de filas**: abra `http://localhost:4000/admin/queues` (usuário/senha do `.env`) e confirme que não há jobs falhos.
