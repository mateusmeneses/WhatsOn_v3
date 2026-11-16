# API de mensagens recebidas — integração WhatsOn × CRM Multicomercio

| Item | Valor |
|---|---|
| Público | Dev do CRM Multicomercio |
| Base URL | `{BACKEND_PUBLIC_URL}/api/v1` (homologação/uso real: `https://hmlwhatson.connectmulti.com.br/api/v1` — confirmar) |
| Formato | JSON, UTF-8. Campos em português. Datas ISO 8601 com fuso `-03:00` (America/Sao_Paulo) |
| Código-fonte | `backend/src/modules/externalApi/`, `backend/src/modules/claudia/` |

## 1. Visão geral

O CRM recebe mensagens de clientes de duas formas, que se combinam:

| Modo | Como | Para quê |
|---|---|---|
| **Push (webhook)** | WhatsOn faz `POST` na URL do CRM a cada evento de conversa (cliente escreveu, conversa aguardando, etc.) | Saber **na hora** que há mensagem nova |
| **Pull (API)** | CRM chama `GET /conversas/:id/mensagens` | Ler o **histórico/texto** da conversa |
| **Replay** | CRM chama `GET /webhook/eventos` | Recuperar avisos que perdeu (CRM fora do ar) |

Fluxo recomendado: webhook avisa → CRM pega o `conversa.id` → `GET /conversas/{id}/mensagens` traz as mensagens.

> **Pontos de atenção (ler antes de integrar)**
> 1. Hoje a API de leitura e o webhook são o canal da **Claudia** (módulo `claudia`): valem **só para a empresa `CLAUDIA_COMPANY_ID`** e a leitura roda como o usuário `CLAUDIA_USER_ID`. Para o CRM usar o mesmo canal, a empresa e o usuário precisam estar configurados no `.env` do backend.
> 2. O destino do webhook é **uma única URL global** (`CLAUDIA_WEBHOOK_URL`). Se a Claudia e o CRM precisarem receber ao mesmo tempo, é preciso criar um segundo destino (não existe hoje) ou o CRM consumir via **pull/replay**.
> 3. **Não existe endpoint de "listar conversas"**. O `id` da conversa só vem do webhook (ou do replay).
> 4. O texto das mensagens **não vai no webhook** por padrão (`CLAUDIA_WEBHOOK_INCLUIR_TEXTO=false`). O texto completo sempre está disponível no pull.

## 2. Autenticação (pull e replay)

Token de API **por conexão** (número de WhatsApp). O admin gera em *Conexões → API*
(`POST /api/connections/:id/api-token`, perfil admin).

```
Authorization: Bearer <apiToken>
```

| HTTP | `error.code` | Quando |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Cabeçalho ausente |
| 403 | `INVALID_API_TOKEN` | Token não existe/foi regenerado |
| 403 | empresa bloqueada | Empresa suspensa no admin |
| 429 | `RATE_LIMITED` | Passou do limite (padrão **60 req/min por token**, env `EXTERNAL_API_RATE_LIMIT`). Cabeçalho `Retry-After` (s). Respostas trazem `X-RateLimit-Limit` / `X-RateLimit-Remaining` |
| 404 | `NOT_FOUND` | API da Claudia não ativa na empresa, ou conversa inexistente |
| 404 | `CLAUDIA_USER_NOT_FOUND` | `CLAUDIA_USER_ID` não existe na empresa |
| 403 | `FORBIDDEN` | Usuário da API não enxerga esta conversa |
| 400 | `VALIDATION_ERROR` | Parâmetro inválido (`message` lista os campos) |

Corpo de erro padrão:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "limite: Number must be less than or equal to 100" } }
```

## 3. Push — webhook enviado ao CRM

### 3.1 Requisição que o CRM recebe

```
POST {URL do CRM}
Content-Type: application/json; charset=utf-8
<CLAUDIA_WEBHOOK_KEY_HEADER>: <CLAUDIA_WEBHOOK_KEY>        (padrão: Authorization)
X-WhatsOn-Timestamp: 1763300000                           (só com secret configurado)
X-WhatsOn-Assinatura: sha256=<hex>                         (só com secret configurado)
```

**Validar assinatura** (recomendado): `HMAC-SHA256(secret, corpoBrutoExato)` em hex, comparado com o valor após `sha256=` (comparação em tempo constante). Usar o corpo **bruto**, antes de parsear o JSON. Rejeitar timestamps com mais de ~5 min de diferença.

**Resposta esperada:** qualquer `2xx` em até **10 s**. Outro status/timeout = falha e reenvio.

### 3.2 Reenvio e idempotência

- Tentativas: imediata, +30 s, +2 min, +10 min (4 no total).
- O mesmo aviso reenviado mantém o **mesmo `id_evento`** e o mesmo conteúdo (só `tentativa` muda no v2). **Deduplicar por `id_evento`.**
- Uma conversa gera **no máximo 1 aviso por 60 s** (120 s se ainda sem atendente). Eventos no meio da janela viram um aviso só, com `eventos[]` listando todos. Não conte "1 aviso = 1 mensagem".
- Rajada: mais de 5 avisos em 30 s viram um aviso `lote` com `conversas[]`.

### 3.3 Eventos

| `evento` | Quando |
|---|---|
| `mensagem_cliente` | Cliente escreveu em conversa em atendimento |
| `mensagem_pos_finalizacao` | Cliente escreveu depois da conversa finalizada (`apenas_reacao` indica "ok/obrigado"/figurinha) |
| `conversa_aguardando` | Conversa nova/transferida esperando aceite |
| `bot_parado` | Cliente travou no menu do bot |
| `transferencia_sem_aceite` | Transferência sem aceite no prazo |
| `inatividade_cliente` | Cliente parou de responder |
| `transferida_para_claudia` | Conversa passou para a Claudia |
| `mensagem_numero_especial` (v1: `mensagem_mateus`) | Mensagem de número vigiado |
| `conexao_prolongada` (v1: `conexao`) | Conexão WhatsApp fora do ar |
| `lote` | Rajada agrupada |

Para **só mensagens recebidas**, o CRM trata `mensagem_cliente` e `mensagem_pos_finalizacao` e ignora o resto (ou usa os demais para status da conversa).

### 3.4 Corpo — formato v2 (`CLAUDIA_WEBHOOK_FORMATO=v2`, recomendado)

```json
{
  "evento": "mensagem_cliente",
  "id_evento": "3f0c9c1e-6d2a-4c53-9a77-1b9c1d7e2a10",
  "tentativa": 1,
  "ocorrido_em": "2026-11-16T10:32:05-03:00",
  "ambiente": "producao",
  "eventos": ["mensagem_cliente"],
  "conversa": {
    "id": 4821,
    "status": "atendendo",
    "fila": "Suporte",
    "menu_escolhido": ["Suporte", "Multicomercio"],
    "atendente": "Whatyson",
    "aguardando_desde": null
  },
  "contato": {
    "nome": "João - Mercado Bom Preço",
    "telefone_final": "8888",
    "cadastrado": true,
    "automatico": false
  },
  "empresa": { "nome": "Mercado Bom Preço LTDA", "contrato": null, "software": "Multicomercio" },
  "mensagens_recentes": [
    {
      "id": 99120,
      "em": "2026-11-16T10:32:01-03:00",
      "origem": "cliente",
      "tipo": "texto",
      "texto": null,
      "anexos": 0,
      "anexo": null
    }
  ],
  "faixa_horario": "tecnicos",
  "minutos_sem_aceite": null,
  "minutos_sem_resposta": null,
  "status": null,
  "apenas_reacao": null,
  "ultima_mensagem_origem": "cliente",
  "observacoes_resumo": null,
  "atendentes_online": [{ "id": 3, "nome": "Whatyson", "online": true }],
  "conversas": null
}
```

Notas:
- `mensagens_recentes`: de 1 a 5 mensagens desde o aviso anterior da conversa. `texto` é **`null` salvo** `CLAUDIA_WEBHOOK_INCLUIR_TEXTO=true`.
- `contato.telefone_final`: só os 4 últimos dígitos (privacidade). Com `CLAUDIA_WEBHOOK_INCLUIR_TELEFONE=true` o aviso traz também `contato.telefone` (número completo, só dígitos, ex.: `5579999998888`).
- Com `CLAUDIA_WEBHOOK_INCLUIR_ANEXO_URL=true` cada item de `mensagens_recentes` traz `anexo_url` (URL absoluta do arquivo, ou `null` sem anexo).
- `origem`: `cliente` · `atendente` · `claudia` · `bot` · `sistema`.
- `tipo`: `texto` · `audio` · `imagem` · `video` · `arquivo` · `figurinha` · `localizacao`.
- `anexo`: `imagem` · `audio` · `video` · `pdf` · `figurinha` · `arquivo` (a URL do arquivo vem só no pull).
- `ambiente`: valor de `CLAUDIA_AMBIENTE` (ex.: `producao`, `homologacao`).

### 3.5 Corpo — formato v1 (padrão atual)

Plano, **sem texto e sem histórico**. Traz o telefone completo:

```json
{
  "evento": "mensagem_cliente",
  "id_evento": "3f0c9c1e-6d2a-4c53-9a77-1b9c1d7e2a10",
  "ocorrido_em": "2026-11-16T10:32:05-03:00",
  "conversa": 4821,
  "telefone": "5579999998888",
  "contato": "João - Mercado Bom Preço",
  "fila": "Suporte",
  "atendente": "Whatyson",
  "tipo_ultima_mensagem": "texto",
  "minutos_sem_aceite": null,
  "minutos_sem_resposta": null,
  "status": null
}
```

Com `CLAUDIA_WEBHOOK_BODY=text` o JSON vai embrulhado: `{ "text": "<json como string>" }`.

> **Para o CRM, preferir v2** (traz mensagens, cadastro, status). Se o CRM precisar casar a conversa pelo **telefone completo**, usar v1 ou alinhar com a equipe WhatsOn a inclusão do telefone no v2.

## 4. Pull — ler mensagens de uma conversa

```
GET /api/v1/conversas/{id}/mensagens?limite=20
Authorization: Bearer <apiToken>
```

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `id` (path) | inteiro > 0 | — | `conversa.id` recebido no webhook |
| `limite` | 1–100 | 20 | Quantidade de mensagens (as **mais recentes**, em ordem cronológica) |

**200 OK**

```json
{
  "mensagens": [
    {
      "id": 99118,
      "em": "2026-11-16T10:30:12-03:00",
      "origem": "cliente",
      "tipo": "imagem",
      "texto": "Segue o erro",
      "apagada": false,
      "anexo": {
        "tipo": "imagem",
        "nome": "erro.png",
        "url": "https://hmlwhatson.connectmulti.com.br/media/xyz/erro.png"
      }
    },
    {
      "id": 99120,
      "em": "2026-11-16T10:32:01-03:00",
      "origem": "cliente",
      "tipo": "texto",
      "texto": "Como reimprimo a NFC-e?",
      "apagada": false,
      "anexo": null
    }
  ],
  "mais_antigas": true
}
```

| Campo | Descrição |
|---|---|
| `id` | ID da mensagem no WhatsOn (crescente). Usar para deduplicar |
| `em` | Data/hora da mensagem |
| `origem` | `cliente` (**recebida**) · `atendente` · `claudia` · `bot` · `sistema`. Filtrar `origem == "cliente"` para só as recebidas |
| `tipo` | `texto` · `audio` · `imagem` · `video` · `arquivo` · `figurinha` · `localizacao` |
| `texto` | Corpo/legenda. `null` se vazio ou apagada |
| `apagada` | `true` se o cliente/atendente apagou a mensagem (texto vem `null`) |
| `anexo` | `null` ou `{ tipo, nome, url }`. `url` é absoluta (baixar com GET) |
| `mais_antigas` | `true` se há mensagens anteriores às devolvidas |

**Limitações:**
- Não há cursor/paginação para trás na API externa: `mais_antigas = true` só indica que existe mais; aumente `limite` (máx. 100).
- Para sincronizar incrementalmente, guarde o maior `id` já importado e descarte os `id` menores ou iguais.
- A `url` do anexo no exemplo é ilustrativa; usar a que vier na resposta.

## 5. Replay — recuperar avisos perdidos

```
GET /api/v1/webhook/eventos?desde=2026-11-16T08:00:00-03:00&apos_id=0&limite=100
Authorization: Bearer <apiToken>
```

| Parâmetro | Descrição |
|---|---|
| `desde` | ISO 8601 **com offset**. Padrão: últimas 24 h |
| `apos_id` | Cursor: só `seq` maiores que este |
| `limite` | 1–500 (padrão 100) |

**200 OK**

```json
{
  "eventos": [
    {
      "seq": 1507,
      "registrado_em": "2026-11-16T10:32:05-03:00",
      "entregue": true,
      "aviso": { "...": "corpo exatamente como foi enviado no webhook" }
    }
  ],
  "proximo_apos_id": null
}
```

Paginar enquanto `proximo_apos_id != null`, repassando-o em `apos_id`. `entregue = false` indica aviso que nunca recebeu 2xx do CRM. Deduplicar por `aviso.id_evento`.

## 6. Exemplo de integração (Node.js)

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.WHATSON_WEBHOOK_SECRET;
const BASE = process.env.WHATSON_BASE_URL;      // https://.../api/v1
const TOKEN = process.env.WHATSON_API_TOKEN;
const vistos = new Set();                        // em produção: tabela com id_evento UNIQUE

const app = express();
app.post("/webhooks/whatson", express.raw({ type: "*/*" }), async (req, res) => {
  const esperado = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const recebido = req.get("x-whatson-assinatura") || "";
  const ok = esperado.length === recebido.length &&
    crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
  if (!ok) return res.sendStatus(401);

  res.sendStatus(200);                           // responder rápido (< 10 s)

  const aviso = JSON.parse(req.body.toString("utf8"));
  if (vistos.has(aviso.id_evento)) return;
  vistos.add(aviso.id_evento);

  if (!["mensagem_cliente", "mensagem_pos_finalizacao"].includes(aviso.evento)) return;

  const r = await fetch(`${BASE}/conversas/${aviso.conversa.id}/mensagens?limite=20`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const { mensagens } = await r.json();
  for (const m of mensagens.filter((x) => x.origem === "cliente")) {
    // gravar no CRM de forma idempotente por m.id
  }
});
```

## 7. Configuração necessária no WhatsOn (equipe WhatsOn)

Variáveis do `.env` do backend:

| Variável | Para quê |
|---|---|
| `CLAUDIA_WEBHOOK_URL` | URL do CRM que recebe os avisos |
| `CLAUDIA_WEBHOOK_KEY` / `CLAUDIA_WEBHOOK_KEY_HEADER` | Chave e nome do cabeçalho (padrão `Authorization`) |
| `CLAUDIA_WEBHOOK_SECRET` | Segredo (≥ 16 chars) para a assinatura HMAC |
| `CLAUDIA_WEBHOOK_FORMATO` | `v2` (recomendado) |
| `CLAUDIA_WEBHOOK_INCLUIR_TEXTO` | `true` para o texto ir no webhook |
| `CLAUDIA_WEBHOOK_INCLUIR_TELEFONE` | `true` para enviar `contato.telefone` completo (v2) |
| `CLAUDIA_WEBHOOK_INCLUIR_ANEXO_URL` | `true` para enviar `anexo_url` (v2) |
| `CLAUDIA_COMPANY_ID` | Empresa cujas conversas são enviadas |
| `CLAUDIA_USER_ID` | Usuário sob o qual o pull roda (precisa ver as conversas) |
| `CLAUDIA_WEBHOOK_MODO` | `completo` envia todas as conversas; `economico` filtra por produto (`CLAUDIA_PRODUTOS`) |
| `EXTERNAL_API_RATE_LIMIT` | Req/min por token (padrão 60) |

E o admin gera o token em *Conexões → API* da conexão desejada.
