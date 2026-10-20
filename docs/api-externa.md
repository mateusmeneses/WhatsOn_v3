# API externa (`/api/v1`)

API para outros sistemas (ex.: ERP MULTICOMERCIO) conectarem um número e enviarem mensagens.
Cada token pertence a **uma conexão**: tudo que é feito com ele usa aquele número.

Guia completo (fluxos, erros, segurança e clientes em várias linguagens): [manual-integracao-api.md](manual-integracao-api.md).
Sistema parceiro que cria as empresas e conexões sozinho (sem o cliente acessar o Whatson): [guia-integracao-parceiros.md](guia-integracao-parceiros.md).
No painel, a página **Integração API** traz o manual e um console de testes.

## Token

1. No painel, **Conexões** → botão de chave (🔑) da conexão → **Gerar token** (só admin).
2. Copie o token e configure no sistema externo.
3. **Regenerar token** invalida o anterior na hora.

Envie em todas as requisições:

```
Authorization: Bearer <TOKEN>
```

| Situação | Status | `error.code` |
|---|---|---|
| Sem cabeçalho / sem token | 401 | `UNAUTHENTICATED` |
| Token não existe (ou foi regenerado) | 403 | `INVALID_API_TOKEN` |
| Limite de requisições excedido | 429 | `RATE_LIMITED` |

O token de webhook da conexão e o JWT do painel **não** valem nesta API.

## Erros

Mesmo formato das demais rotas:

```json
{ "error": { "code": "CONNECTION_NOT_CONNECTED", "message": "A conexão não está ativa; leia o QR code primeiro" } }
```

Códigos comuns: `VALIDATION_ERROR` (400), `INVALID_PHONE` (400), `INVALID_MEDIA_URL` (400),
`MEDIA_DOWNLOAD_FAILED` (400), `MEDIA_TOO_LARGE` (400), `UPLOAD_ERROR` (400), `NUMBER_NOT_ON_WHATSAPP` (404),
`CONNECTION_NOT_CONNECTED` (409), `PROVIDER_ERROR` (502).

## Limite de requisições

Janela fixa de 1 minuto por token, padrão **60 requisições/min** (variável `EXTERNAL_API_RATE_LIMIT`).
Respostas trazem `X-RateLimit-Limit` e `X-RateLimit-Remaining`; o 429 traz `Retry-After` (segundos).

## Números

Aceita qualquer formatação (`(11) 98888-7777`, `+55 11 98888-7777`, `5511988887777`): ficam só os dígitos
e, com 10 ou 11 dígitos (DDD + número), o DDI `55` é adicionado. Antes de enviar, o número é verificado
no WhatsApp; o contato é gravado com o número que o WhatsApp devolve.

## Exemplos

```bash
BASE=https://whatson.connectmulti.com.br
TOKEN=cole-o-token-aqui
```

### Status da conexão

```bash
curl -s "$BASE/api/v1/connection/status" -H "Authorization: Bearer $TOKEN"
```

```json
{ "status": "connected", "number": "5511999990000" }
```

`status`: `connected`, `qrcode` (aguardando leitura) ou `disconnected`.

### QR code

```bash
curl -s "$BASE/api/v1/connection/qrcode" -H "Authorization: Bearer $TOKEN"
```

```json
{ "qrcode": "data:image/png;base64,iVBORw0...", "status": "qrcode" }
```

O QR expira em poucos segundos: consulte de novo até `status` virar `connected`
(pelo `/connection/status`). Se a conexão já está ativa, volta `{ "qrcode": null, "status": "connected" }`.
Se a instância sumiu da Evolution, ela é recriada automaticamente.

### Desconectar

```bash
curl -s -X POST "$BASE/api/v1/connection/logout" -H "Authorization: Bearer $TOKEN"
```

```json
{ "status": "disconnected" }
```

### Enviar texto

```bash
curl -s -X POST "$BASE/api/v1/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"number": "5511988887777", "body": "Seu pedido saiu para entrega"}'
```

Resposta `201`:

```json
{
  "ticketId": 42,
  "contactId": 17,
  "number": "5511988887777",
  "messages": [{ "id": 901, "type": "text", "ack": "pending" }]
}
```

A mensagem entra no atendimento do contato (o aberto, ou um novo) e aparece no histórico do painel.
O envio ao WhatsApp é assíncrono: `ack` começa em `pending` e passa a `sent`/`delivered`/`read` no painel.

### Enviar arquivos (multipart)

Campo `medias` (até 10 arquivos, 16 MB cada). `body` vai como legenda do primeiro arquivo.

```bash
curl -s -X POST "$BASE/api/v1/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -F "number=5511988887777" \
  -F "body=Segue o boleto" \
  -F "medias=@boleto.pdf;type=application/pdf"
```

### Enviar mídia por URL

```bash
curl -s -X POST "$BASE/api/v1/messages/send-media-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"number": "5511988887777", "url": "https://exemplo.com/nota.pdf", "caption": "NF-e 1234", "fileName": "nota-1234.pdf"}'
```

`caption` e `fileName` são opcionais (sem `fileName`, usa o nome do arquivo na URL).
Só URLs `http`/`https` públicas (endereços internos são recusados), até 16 MB e 3 redirecionamentos.

### Verificar número

```bash
curl -s -X POST "$BASE/api/v1/contacts/check" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"number": "5531988887777"}'
```

```json
{ "exists": true, "jid": "553188887777@s.whatsapp.net" }
```

## Diferenças para a API do Whatson antigo

| Whatson antigo | `/api/v1` |
|---|---|
| `POST /api/messages/send` (multipart `medias`) | `POST /api/v1/messages/send` (JSON ou multipart `medias`) |
| `POST /api/messages/send/linkImage` | `POST /api/v1/messages/send-media-url` (qualquer tipo de mídia) |
| `POST /api/messages/checkNumber` | `POST /api/v1/contacts/check` |
| — | `GET /api/v1/connection/status`, `GET /api/v1/connection/qrcode`, `POST /api/v1/connection/logout` |

O token continua sendo `Authorization: Bearer <token>` por conexão, mas é um token novo, gerado no painel.
