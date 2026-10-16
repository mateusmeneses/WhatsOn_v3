# Especificação Técnica — Integração do Assistente IA **Wts** ao Suporte Multicomercio

| Item | Valor |
|---|---|
| Documento | Especificação de integração (contrato técnico) |
| Público | Programador Node.js responsável pelo webhook WhatsApp + sistema de OS |
| Versão | 0.1 (rascunho para validação) |
| Data | 15/10/2026 |
| Status | **Proposta — sujeita a acordo entre as partes** |

---

## 0. Objetivo e escopo

Integrar o assistente de IA **Wts** ao atendimento de suporte da Multicomercio via WhatsApp, de forma que:

- A IA faça o **atendimento de nível 1** (dúvidas de uso, procedimentos dos manuais, orientações básicas).
- A IA **escalone para o nível 2 (suporte humano)** quando o caso for complexo, quando não tiver certeza da resposta ou quando o cliente pedir um atendente.
- Toda conversa e todo escalonamento fiquem **registrados no sistema de Ordens de Serviço (OS)** existente (Node.js + PostgreSQL).

### Histórico e meta de desempenho

O monitoramento de WhatsApp foi **testado anteriormente via WhatsApp Web** (automação de navegador). Essa abordagem é frágil (sessão cai, QR code, risco de bloqueio do número, sem garantias de entrega). O objetivo desta fase é migrar para a **API oficial do WhatsApp (WhatsApp Business Cloud API da Meta, ou provedor BSP homologado)**, com meta de **resposta ao cliente em menos de 30 segundos** (do recebimento do webhook ao envio da resposta).

### Divisão de responsabilidades

| Responsável | Entrega |
|---|---|
| **Programador Node (Multicomercio)** | Webhook WhatsApp (verificação + recebimento), cliente HTTP da API da IA, roteamento nível 1 / nível 2, envio de resposta ao WhatsApp, persistência no PostgreSQL, vínculo com a tabela de OS existente, fila humana. |
| **Lado Wts (serviço de IA)** | Endpoint HTTP da IA, base de conhecimento, classificação de intenção, cálculo de confiança, decisão sugerida de escalonamento. |
| **Multicomercio (empresa)** | Fornece a **API key** para chamar a API da IA. Fornece as credenciais da conta WhatsApp Business. |

### Base de conhecimento da IA (lado Wts)

Do ponto de vista do programador Node, a base de conhecimento é **responsabilidade do serviço Wts** e é transparente para a integração. As fontes previstas são:

- **Manuais de operação do Multicomercio (PDF)** — usados para responder dúvidas de procedimento ("como emitir NF-e", "como fechar caixa" etc.).
- **Vídeos de treinamento** — transcrições/resumos usados como referência; a IA pode indicar o vídeo correspondente na resposta.
- **Repositório GitHub `MULTICOMERCIO_CSHARP`** — referência técnica para entender regras de negócio, mensagens de erro e comportamento do sistema. **A IA não altera código nem executa ações no ERP do cliente**; o repositório serve apenas para embasar o diagnóstico e o encaminhamento ao nível 2.

> O backend Node **não** precisa enviar esses materiais. Ele envia apenas a mensagem, o histórico recente e o contexto do cliente.

---

## 1. Visão geral da arquitetura

Componentes:

1. **WhatsApp Cloud API / provedor (BSP)** — recebe mensagens do cliente e chama o webhook do backend; recebe as respostas via API de envio.
2. **Backend Node.js (webhook)** — ponto central. Valida assinatura, deduplica, consulta contexto do cliente/OS, chama a IA, decide o roteamento, envia resposta e grava tudo no banco.
3. **Serviço IA Wts** — API HTTP que recebe a mensagem e devolve resposta + metadados (confiança, intenção, escalonar ou não).
4. **PostgreSQL (sistema de OS)** — tabelas existentes de OS + novas tabelas de conversas, mensagens, escalonamentos e logs.
5. **Fila humana (nível 2)** — conversas escalonadas aparecem para os atendentes (painel do sistema de OS e/ou notificação interna). Enquanto a conversa estiver com humano, a IA **não responde**.

```mermaid
flowchart LR
    C[Cliente<br/>WhatsApp] -->|mensagem| WA[WhatsApp Cloud API<br/>ou provedor BSP]
    WA -->|POST webhook<br/>X-Hub-Signature-256| N[Backend Node.js<br/>/webhook/whatsapp]

    N -->|1. dedup + log| DB[(PostgreSQL<br/>OS + conversas_ia<br/>mensagens_ia<br/>logs_integracao)]
    N -->|2. POST /v1/support/chat<br/>X-Api-Key| IA[Serviço IA Wts]
    IA -->|replyText, confidence,<br/>escalate, intent| N

    N -->|3a. nível 1:<br/>resposta automática| WA
    N -->|3b. nível 2:<br/>aviso ao cliente| WA
    WA -->|resposta| C

    N -->|grava mensagens,<br/>vincula/abre OS| DB
    N -->|3b. escalonamento| Q[Fila humana<br/>nível 2]
    Q -->|registro do<br/>escalonamento| DB
    H[Atendente nível 2] -->|assume conversa| Q
    H -->|responde via painel| N
```

### Princípios de projeto

- **Responder 200 rápido ao webhook** (< 2 s) e processar de forma assíncrona. A Meta reenvia o evento se não receber 200, o que gera duplicidade.
- **Idempotência** pelo `id` da mensagem do WhatsApp (`wamid...`), com restrição `UNIQUE` no banco.
- **Falha segura**: se a IA estiver fora do ar, der timeout ou erro, a conversa é **escalonada para humano** com uma mensagem padrão ao cliente — nunca deixar o cliente sem retorno.
- **A IA nunca executa ações no ERP do cliente.** Ela orienta ou escalona.

---

## 2. Fluxo completo

### 2.1 Passo a passo (caminho feliz)

| # | Etapa | Responsável | Detalhes |
|---|---|---|---|
| 1 | Cliente envia mensagem no WhatsApp | Cliente | Texto (fase 1). Áudio/imagem/documento: fase 2 — por ora, registrar e responder com mensagem padrão ou escalonar. |
| 2 | Meta/BSP chama `POST /webhook/whatsapp` | WhatsApp | Payload com `entry[].changes[].value.messages[]`. Também chegam eventos de `statuses` (entregue/lido) — registrar e ignorar no fluxo. |
| 3 | Validar assinatura `X-Hub-Signature-256` | Node | HMAC-SHA256 do **corpo bruto** com o App Secret. Inválida → 401 e log. |
| 4 | Responder **200 OK** imediatamente | Node | Processamento continua em background (fila em memória, BullMQ/Redis, ou `setImmediate` na fase de protótipo). |
| 5 | Deduplicar pelo `wamid` | Node | `INSERT ... ON CONFLICT (wa_message_id) DO NOTHING`. Se já existia → encerra. |
| 6 | Localizar/abrir conversa | Node | Busca `conversas_ia` aberta pelo telefone (E.164). Se não houver, cria. Identifica `clientId` (cadastro de clientes) e OS aberta, se existir. |
| 7 | Verificar estado da conversa | Node | Se `status = 'em_atendimento_humano'` ou `'aguardando_humano'` → **não chama a IA**; apenas grava a mensagem e notifica o atendente. |
| 8 | Verificar pedido explícito de humano | Node | Regra local (palavras-chave: "atendente", "humano", "falar com alguém", "pessoa") → escalonar direto, sem chamar a IA (economia + latência). A IA também detecta isso (redundância). |
| 9 | Chamar a API da IA | Node → Wts | `POST /v1/support/chat` com mensagem, `conversationId`, telefone, últimas N mensagens (sugestão: 10) e contexto. Timeout: **15 s**. 1 retry apenas em erro 5xx/rede, se ainda houver tempo dentro do orçamento de 30 s. |
| 10 | Decidir roteamento | Node | Ver critérios em 2.2. |
| 11a | **Nível 1**: enviar `replyText` ao cliente | Node → WhatsApp | `POST /{PHONE_NUMBER_ID}/messages`. |
| 11b | **Nível 2**: enviar mensagem de transição + escalonar | Node | Mensagem ao cliente ("Vou te transferir para um especialista..."), insere em `escalonamentos`, muda status da conversa, notifica fila humana. |
| 12 | Registrar no sistema de OS | Node | Grava mensagens (entrada e saída) em `mensagens_ia`, metadados da IA (confiança, intenção), e: se houver OS aberta → anexa log; se escalonou e não há OS → **abre OS** usando `suggestedOsFields`. |
| 13 | Registrar log técnico | Node | `logs_integracao` com latência da IA, latência total, status HTTP, erros. |

### 2.2 Critérios de escalonamento para o nível 2

O backend escalona quando **qualquer** condição abaixo for verdadeira:

| Código do motivo | Critério | Quem detecta |
|---|---|---|
| `CLIENTE_PEDIU_HUMANO` | Cliente pede explicitamente atendente/humano. | Regra local no Node **e** IA (`intent = pedido_humano`). |
| `BAIXA_CONFIANCA` | `confidence < IA_CONFIDENCE_THRESHOLD` (padrão sugerido: **0.70**). IA sem certeza da resposta. | Node (com base no retorno da IA). |
| `IA_SOLICITOU` | IA retornou `escalate = true` (ex.: não encontrou resposta na base). | IA. |
| `BUG_SUSPEITO` | Relato de erro, travamento, mensagem de exceção, comportamento inesperado do sistema. | IA (`category = bug`). |
| `PERSONALIZACAO` | Pedido de customização, relatório novo, alteração de regra de negócio. | IA (`category = personalizacao`). |
| `ACAO_NO_ERP` | Requer ação no ambiente do cliente: acesso remoto, ajuste de banco, liberação de licença, correção de dados fiscais, cancelamento de nota etc. | IA (`category = acao_erp`). |
| `LIMITE_TENTATIVAS` | Cliente indica que a orientação não resolveu por **2 vezes** seguidas na mesma conversa, ou mais de N trocas sem resolução (sugestão: 6). | Node (contador em `conversas_ia`). |
| `FALHA_IA` | Timeout, erro 5xx, resposta inválida ou API key rejeitada. | Node. |
| `MIDIA_NAO_SUPORTADA` | Áudio, imagem, vídeo ou documento na fase 1. | Node. |

Regra de ouro: **na dúvida, escalona.** Uma resposta errada do nível 1 custa mais que um escalonamento desnecessário.

### 2.3 Retorno do nível 2 para a IA

- O atendente assume a conversa (status `em_atendimento_humano`) e responde pelo painel; o backend envia via API do WhatsApp e grava em `mensagens_ia` com `origem = 'humano'`.
- Ao encerrar, o atendente marca a conversa como `resolvida`. Próxima mensagem do cliente após encerramento abre nova conversa (volta para a IA).
- **Janela de 24 h do WhatsApp**: mensagens livres só podem ser enviadas até 24 h após a última mensagem do cliente. Fora disso, é preciso usar **template aprovado**. O painel deve alertar o atendente.

### 2.4 Diagrama de sequência

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente
    participant WA as WhatsApp API
    participant N as Backend Node
    participant DB as PostgreSQL
    participant IA as IA Wts
    participant H as Fila Nível 2

    C->>WA: Mensagem
    WA->>N: POST /webhook/whatsapp
    N->>N: Valida assinatura
    N-->>WA: 200 OK (imediato)
    N->>DB: INSERT mensagem (ON CONFLICT wamid DO NOTHING)
    alt Mensagem duplicada
        N->>N: Encerra processamento
    else Conversa já com humano
        N->>H: Notifica atendente
    else Fluxo IA
        N->>IA: POST /v1/support/chat
        IA-->>N: replyText, confidence, escalate, category
        alt Nível 1 (confiança OK, sem escalonamento)
            N->>WA: Envia replyText
            WA->>C: Resposta
        else Nível 2
            N->>WA: Mensagem de transferência
            N->>DB: INSERT escalonamentos + abre/vincula OS
            N->>H: Entra na fila humana
        end
        N->>DB: Grava resposta, metadados e log
    end
```

---

## 3. Contrato proposto da API do Wts

> **Importante:** este é um **contrato proposto**, a ser validado e acordado com o lado Wts antes da implementação definitiva. Nomes de campos, URL base, limites e códigos de erro podem mudar. Até a confirmação, o programador deve desenvolver contra o **mock** descrito na seção 6, isolando a chamada em um único módulo (`iaClient`) para facilitar ajustes.

### 3.1 Endpoint

```
POST {IA_API_BASE_URL}/v1/support/chat
Content-Type: application/json
```

### 3.2 Autenticação

A empresa fornecerá uma **API key**. Aceitar um dos dois formatos (a definir qual será o oficial):

```
X-Api-Key: <IA_API_KEY>
```
ou
```
Authorization: Bearer <IA_API_KEY>
```

- A chave fica **somente** em variável de ambiente (`IA_API_KEY`). Nunca em código, log ou repositório.
- Cabeçalho opcional recomendado: `X-Request-Id: <uuid>` para correlação de logs entre as partes.
- Cabeçalho opcional: `Idempotency-Key: <wamid>` — se o lado Wts suportar, uma mesma chave retorna a mesma resposta sem reprocessar.

### 3.3 Request

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `message` | string | sim | Texto da mensagem do cliente (máx. sugerido: 4000 caracteres). |
| `conversationId` | string | sim | ID da conversa no sistema Multicomercio (`conversas_ia.id`). Estável durante a conversa. |
| `messageId` | string | sim | ID da mensagem do WhatsApp (`wamid`). Usado para idempotência/rastreio. |
| `phone` | string | sim | Telefone do cliente em **E.164** (ex.: `+5511999998888`). |
| `customerName` | string | não | Nome do perfil do WhatsApp ou do cadastro. |
| `recentHistory` | array | não | Últimas mensagens da conversa, ordem cronológica (sugestão: até 10). |
| `recentHistory[].role` | string | sim | `cliente` \| `ia` \| `humano`. |
| `recentHistory[].text` | string | sim | Texto da mensagem. |
| `recentHistory[].timestamp` | string | sim | ISO 8601 com fuso (ex.: `2026-10-15T14:02:11-03:00`). |
| `context` | object | não | Contexto de negócio. |
| `context.product` | string | não | Produto/módulo (ex.: `MULTICOMERCIO`, `MULTICOMERCIO_PDV`). |
| `context.productVersion` | string | não | Versão instalada no cliente, se conhecida. |
| `context.clientId` | string | não | ID do cliente no cadastro Multicomercio. |
| `context.clientName` | string | não | Razão social / nome fantasia. |
| `context.openTicketId` | string \| null | não | ID da OS aberta relacionada, se houver. |
| `context.channel` | string | não | Fixo `whatsapp`. |
| `options.language` | string | não | Padrão `pt-BR`. |
| `options.maxReplyChars` | integer | não | Limite de tamanho da resposta (padrão sugerido: 1000; WhatsApp aceita até 4096). |

Exemplo:

```json
{
  "message": "Como faço para reimprimir uma NFC-e que já foi emitida?",
  "conversationId": "c0a8012e-7f3b-4d1a-9b6e-3c2f1a9d0e44",
  "messageId": "wamid.HBgNNTUxMTk5OTk5ODg4OBUCABIYFDNBQjQ1NkM3",
  "phone": "+5511999998888",
  "customerName": "João - Mercado Bom Preço",
  "recentHistory": [
    { "role": "cliente", "text": "Boa tarde", "timestamp": "2026-10-15T14:01:50-03:00" },
    { "role": "ia", "text": "Boa tarde! Sou o assistente de suporte Multicomercio. Como posso ajudar?", "timestamp": "2026-10-15T14:01:55-03:00" }
  ],
  "context": {
    "product": "MULTICOMERCIO",
    "productVersion": "8.4.2",
    "clientId": "10452",
    "clientName": "Mercado Bom Preço LTDA",
    "openTicketId": null,
    "channel": "whatsapp"
  },
  "options": { "language": "pt-BR", "maxReplyChars": 1000 }
}
```

### 3.4 Response (200 OK)

| Campo | Tipo | Sempre presente | Descrição |
|---|---|---|---|
| `replyText` | string | sim | Texto a enviar ao cliente. Se `escalate = true`, pode conter mensagem de transição sugerida. |
| `escalate` | boolean | sim | `true` se a IA recomenda nível 2. |
| `escalateReason` | string \| null | sim | Código do motivo (ver tabela 2.2) quando `escalate = true`. |
| `escalateSummary` | string \| null | não | Resumo do problema para o atendente humano (economiza tempo do nível 2). |
| `category` | string | sim | `duvida_uso` \| `fiscal` \| `financeiro` \| `instalacao` \| `bug` \| `personalizacao` \| `acao_erp` \| `pedido_humano` \| `saudacao` \| `outro`. |
| `intent` | string | não | Intenção mais específica (ex.: `reimpressao_nfce`). |
| `confidence` | number | sim | 0 a 1. Confiança da IA na resposta. |
| `sources` | array | não | Referências usadas (ex.: `{ "type": "manual", "title": "Manual PDV - cap. 5" }`, `{ "type": "video", "title": "Treinamento NFC-e" }`). Apenas para log/auditoria; o Node não precisa exibir. |
| `suggestedOsFields` | object \| null | não | Sugestão de preenchimento de OS quando escalonar ou quando o caso merecer registro. |
| `suggestedOsFields.titulo` | string | — | Título curto. |
| `suggestedOsFields.descricao` | string | — | Descrição do problema. |
| `suggestedOsFields.prioridade` | string | — | `baixa` \| `media` \| `alta` \| `urgente`. |
| `suggestedOsFields.modulo` | string | — | Módulo do sistema afetado. |
| `suggestedOsFields.tipo` | string | — | `duvida` \| `erro` \| `personalizacao` \| `servico`. |
| `requestId` | string | sim | ID da requisição no lado Wts (para suporte entre as partes). |
| `latencyMs` | integer | não | Tempo de processamento no lado Wts. |

Exemplo — nível 1:

```json
{
  "replyText": "Para reimprimir uma NFC-e: 1) Acesse Vendas > Consultar NFC-e; 2) Filtre pela data; 3) Selecione a nota e clique em Reimprimir. Se a impressora não responder, verifique se ela está definida como padrão no Windows.",
  "escalate": false,
  "escalateReason": null,
  "escalateSummary": null,
  "category": "fiscal",
  "intent": "reimpressao_nfce",
  "confidence": 0.91,
  "sources": [{ "type": "manual", "title": "Manual de Operação PDV" }],
  "suggestedOsFields": null,
  "requestId": "req_01J9Z6Q7Y3",
  "latencyMs": 2350
}
```

Exemplo — nível 2:

```json
{
  "replyText": "Entendi. Esse erro precisa ser analisado por um especialista. Vou transferir seu atendimento para nossa equipe técnica, que continuará por aqui.",
  "escalate": true,
  "escalateReason": "BUG_SUSPEITO",
  "escalateSummary": "Cliente relata erro 'Object reference not set' ao fechar caixa no PDV após atualização para 8.4.2.",
  "category": "bug",
  "intent": "erro_fechamento_caixa",
  "confidence": 0.55,
  "sources": [],
  "suggestedOsFields": {
    "titulo": "Erro ao fechar caixa no PDV (v8.4.2)",
    "descricao": "Erro 'Object reference not set to an instance of an object' ao fechar caixa. Ocorre desde a atualização.",
    "prioridade": "alta",
    "modulo": "PDV",
    "tipo": "erro"
  },
  "requestId": "req_01J9Z6R2K8",
  "latencyMs": 3120
}
```

> **Regra no Node:** mesmo que `escalate = false`, o backend escalona se `confidence < IA_CONFIDENCE_THRESHOLD`. A decisão final é **do backend**.

### 3.5 Erros

Formato padrão do corpo de erro:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Campo 'phone' deve estar no formato E.164.",
    "requestId": "req_01J9Z6S9AB"
  }
}
```

| HTTP | `error.code` | Significado | Ação no Node |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | Payload inválido / campo obrigatório ausente. | Não repetir. Logar, escalonar (`FALHA_IA`). Corrigir o payload. |
| 401 | `UNAUTHORIZED` | API key ausente ou inválida. | Não repetir. Escalonar. **Alerta crítico** para a equipe técnica. |
| 403 | `FORBIDDEN` | Chave sem permissão para o recurso/produto. | Igual ao 401. |
| 409 | `DUPLICATE_REQUEST` | Mesmo `Idempotency-Key` em processamento. | Aguardar 1 s e repetir 1 vez, ou ignorar se já houver resposta gravada. |
| 413 | `PAYLOAD_TOO_LARGE` | Mensagem/histórico grande demais. | Reduzir `recentHistory` e repetir 1 vez. |
| 422 | `UNSUPPORTED_CONTENT` | Conteúdo não processável. | Escalonar. |
| 429 | `RATE_LIMITED` | Limite de requisições. Header `Retry-After` (segundos). | Repetir após `Retry-After` se couber no orçamento de 30 s; senão escalonar. |
| 500 | `INTERNAL_ERROR` | Erro no serviço Wts. | 1 retry com backoff (500 ms); depois escalonar. |
| 503 | `SERVICE_UNAVAILABLE` | Serviço indisponível/manutenção. | 1 retry; depois escalonar. |
| 504 / timeout local | `TIMEOUT` | Sem resposta dentro de `IA_TIMEOUT_MS`. | Escalonar. |

### 3.6 Requisitos não funcionais (propostos)

- Latência p95 da IA: **≤ 10 s**; timeout do cliente: **15 s**.
- Disponibilidade alvo: 99,5% em horário comercial.
- HTTPS obrigatório (TLS 1.2+).
- Limite sugerido: 60 req/min por API key (a confirmar).
- Dados pessoais (telefone, nome) trafegados apenas para fins de atendimento (LGPD). Definir com o lado Wts a política de retenção.

### 3.7 Endpoint auxiliar (opcional, a acordar)

```
GET {IA_API_BASE_URL}/v1/health   → 200 { "status": "ok" }
```
Usado pelo backend para monitoramento e para o modo degradado (se a IA estiver fora, escalonar direto sem esperar timeout).

---

## 4. Protótipo Node.js comentado

Estrutura sugerida:

```
src/
  config.js           # leitura e validação de variáveis de ambiente
  db.js               # pool PostgreSQL
  iaClient.js         # cliente HTTP da API da IA Wts
  whatsappClient.js   # envio de mensagens pela Cloud API
  roteamento.js       # regras nível 1 x nível 2
  repositorio.js      # acesso ao banco (conversas, mensagens, OS, logs)
  webhook.js          # rotas GET/POST do webhook
  server.js           # bootstrap do Express
```

Dependências: `express`, `pg`, `dotenv`. Node **18+** (usa `fetch` nativo e `AbortController`).

```bash
npm install express pg dotenv
```

### 4.1 `src/config.js`

```js
// Carrega variáveis de ambiente do arquivo .env (apenas em desenvolvimento/homologação).
require('dotenv').config();

// Função auxiliar: falha cedo se uma variável obrigatória não existir.
function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }
  return valor;
}

module.exports = {
  porta: Number(process.env.PORT || 3000),

  // --- IA Wts ---
  ia: {
    baseUrl: obrigatoria('IA_API_BASE_URL'),
    apiKey: obrigatoria('IA_API_KEY'), // NUNCA logar este valor
    authHeader: process.env.IA_AUTH_HEADER || 'x-api-key', // 'x-api-key' ou 'bearer'
    timeoutMs: Number(process.env.IA_TIMEOUT_MS || 15000),
    limiarConfianca: Number(process.env.IA_CONFIDENCE_THRESHOLD || 0.7),
    tamanhoHistorico: Number(process.env.IA_HISTORY_SIZE || 10),
  },

  // --- WhatsApp Cloud API ---
  whatsapp: {
    apiVersion: process.env.WA_API_VERSION || 'v21.0', // confirmar versão vigente no painel da Meta
    phoneNumberId: obrigatoria('WA_PHONE_NUMBER_ID'),
    accessToken: obrigatoria('WA_ACCESS_TOKEN'),
    verifyToken: obrigatoria('WA_VERIFY_TOKEN'), // token que você define e cadastra no painel
    appSecret: obrigatoria('WA_APP_SECRET'),     // usado para validar X-Hub-Signature-256
  },

  // --- Banco ---
  databaseUrl: obrigatoria('DATABASE_URL'),

  // --- Flags ---
  dryRun: process.env.DRY_RUN === 'true', // true = não envia ao WhatsApp, só loga
  produtoPadrao: process.env.PRODUTO_PADRAO || 'MULTICOMERCIO',
};
```

### 4.2 `src/db.js`

```js
const { Pool } = require('pg');
const config = require('./config');

// Pool único de conexões para toda a aplicação.
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

module.exports = { pool };
```

### 4.3 `src/iaClient.js` — cliente HTTP da IA

```js
const crypto = require('crypto');
const config = require('./config');

// Erro específico da integração com a IA, carregando o código e se vale repetir.
class IaError extends Error {
  constructor(message, { status, code, retryable, retryAfterMs } = {}) {
    super(message);
    this.name = 'IaError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
    this.retryAfterMs = retryAfterMs;
  }
}

// Monta os cabeçalhos de autenticação conforme o formato acordado com o Wts.
function cabecalhosAuth() {
  if (config.ia.authHeader === 'bearer') {
    return { Authorization: `Bearer ${config.ia.apiKey}` };
  }
  return { 'X-Api-Key': config.ia.apiKey };
}

// Faz UMA chamada ao endpoint /v1/support/chat com timeout.
async function chamarUmaVez(payload, requestId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ia.timeoutMs);

  try {
    const resp = await fetch(`${config.ia.baseUrl}/v1/support/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'Idempotency-Key': payload.messageId, // se o Wts suportar
        ...cabecalhosAuth(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const corpo = await resp.json().catch(() => null);

    if (!resp.ok) {
      const code = corpo?.error?.code || `HTTP_${resp.status}`;
      const retryAfter = Number(resp.headers.get('retry-after')) || 0;
      throw new IaError(corpo?.error?.message || 'Erro na API da IA', {
        status: resp.status,
        code,
        // Só vale repetir em 429 e 5xx. Erros 4xx de payload/autenticação não.
        retryable: resp.status === 429 || resp.status >= 500,
        retryAfterMs: retryAfter * 1000,
      });
    }

    validarResposta(corpo);
    return corpo;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new IaError('Timeout ao chamar a IA', { code: 'TIMEOUT', retryable: false });
    }
    if (err instanceof IaError) throw err;
    // Erro de rede (DNS, conexão recusada etc.)
    throw new IaError(`Falha de rede: ${err.message}`, { code: 'NETWORK', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// Validação mínima do contrato: se vier algo fora do esperado, tratamos como falha.
function validarResposta(r) {
  const ok =
    r &&
    typeof r.replyText === 'string' &&
    typeof r.escalate === 'boolean' &&
    typeof r.confidence === 'number' &&
    r.confidence >= 0 && r.confidence <= 1;
  if (!ok) {
    throw new IaError('Resposta da IA fora do contrato', { code: 'INVALID_RESPONSE' });
  }
}

/**
 * Envia a mensagem do cliente para a IA.
 * Faz no máximo 1 nova tentativa, respeitando o orçamento de tempo total (meta < 30 s).
 */
async function perguntarIa(payload, { prazoFinal } = {}) {
  const requestId = crypto.randomUUID();
  const inicio = Date.now();

  try {
    const r = await chamarUmaVez(payload, requestId);
    return { resposta: r, requestId, latenciaMs: Date.now() - inicio, tentativas: 1 };
  } catch (err) {
    const espera = err.retryAfterMs || 500;
    const cabeNoPrazo = !prazoFinal || Date.now() + espera + config.ia.timeoutMs < prazoFinal;

    if (err.retryable && cabeNoPrazo) {
      await new Promise((ok) => setTimeout(ok, espera));
      const r = await chamarUmaVez(payload, requestId); // se falhar de novo, propaga o erro
      return { resposta: r, requestId, latenciaMs: Date.now() - inicio, tentativas: 2 };
    }
    err.requestId = requestId;
    err.latenciaMs = Date.now() - inicio;
    throw err;
  }
}

module.exports = { perguntarIa, IaError };
```

### 4.4 `src/whatsappClient.js` — envio de mensagens

```js
const config = require('./config');

/**
 * Envia mensagem de texto pela WhatsApp Cloud API.
 * Em DRY_RUN apenas loga e retorna um id fictício (útil em homologação).
 */
async function enviarTexto(telefoneE164, texto) {
  // A Cloud API espera o número sem o "+".
  const to = telefoneE164.replace(/^\+/, '');

  if (config.dryRun) {
    console.log(`[DRY_RUN] Mensagem para ${to}: ${texto}`);
    return { waMessageId: `dryrun-${Date.now()}` };
  }

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: texto.slice(0, 4096), preview_url: false }, // limite do WhatsApp
    }),
  });

  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Erros comuns: token expirado, número fora da janela de 24 h (exige template), número não cadastrado no sandbox.
    throw new Error(`WhatsApp API ${resp.status}: ${JSON.stringify(corpo.error || corpo)}`);
  }
  return { waMessageId: corpo.messages?.[0]?.id };
}

module.exports = { enviarTexto };
```

### 4.5 `src/roteamento.js` — regras nível 1 x nível 2

```js
const config = require('./config');

// Palavras/expressões que indicam pedido explícito de atendimento humano.
const PEDIDO_HUMANO = [
  /\batendente\b/i,
  /\bhumano\b/i,
  /falar com (algu[eé]m|uma pessoa|o suporte|t[eé]cnico)/i,
  /\bpessoa de verdade\b/i,
  /quero (um|o) (atendente|t[eé]cnico)/i,
];

// Categorias que, por regra de negócio, sempre vão para o nível 2.
const CATEGORIAS_NIVEL2 = {
  bug: 'BUG_SUSPEITO',
  personalizacao: 'PERSONALIZACAO',
  acao_erp: 'ACAO_NO_ERP',
  pedido_humano: 'CLIENTE_PEDIU_HUMANO',
};

// Verificação local, ANTES de chamar a IA (rápida e sem custo).
function clientePediuHumano(texto) {
  return PEDIDO_HUMANO.some((re) => re.test(texto || ''));
}

/**
 * Decide o nível com base na resposta da IA e no estado da conversa.
 * Retorna { nivel: 1 | 2, motivo: string | null }.
 * A decisão final é SEMPRE do backend, mesmo que a IA diga escalate=false.
 */
function decidirNivel(respostaIa, conversa) {
  if (respostaIa.escalate) {
    return { nivel: 2, motivo: respostaIa.escalateReason || 'IA_SOLICITOU' };
  }
  if (CATEGORIAS_NIVEL2[respostaIa.category]) {
    return { nivel: 2, motivo: CATEGORIAS_NIVEL2[respostaIa.category] };
  }
  if (respostaIa.confidence < config.ia.limiarConfianca) {
    return { nivel: 2, motivo: 'BAIXA_CONFIANCA' };
  }
  if ((conversa.tentativas_sem_resolucao || 0) >= 2) {
    return { nivel: 2, motivo: 'LIMITE_TENTATIVAS' };
  }
  return { nivel: 1, motivo: null };
}

// Mensagem padrão enviada ao cliente quando o atendimento vai para o nível 2.
const MSG_TRANSFERENCIA =
  'Vou transferir seu atendimento para um especialista da nossa equipe de suporte. ' +
  'Ele continuará a conversa por aqui em breve. Obrigado pela paciência!';

module.exports = { clientePediuHumano, decidirNivel, MSG_TRANSFERENCIA };
```

### 4.6 `src/repositorio.js` — acesso ao PostgreSQL

```js
const { pool } = require('./db');

/**
 * Grava a mensagem recebida de forma idempotente.
 * Retorna null se o wamid já existir (reenvio do webhook pela Meta).
 */
async function registrarMensagemEntrada(client, { conversaId, waMessageId, texto, tipo, recebidaEm }) {
  const { rows } = await client.query(
    `INSERT INTO mensagens_ia (conversa_id, wa_message_id, direcao, origem, tipo, texto, criada_em)
     VALUES ($1, $2, 'entrada', 'cliente', $3, $4, $5)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [conversaId, waMessageId, tipo, texto, recebidaEm]
  );
  return rows[0] || null;
}

// Busca a conversa aberta do telefone ou cria uma nova.
async function obterOuCriarConversa(client, { telefone, nomePerfil }) {
  const existente = await client.query(
    `SELECT * FROM conversas_ia
      WHERE telefone = $1 AND status <> 'resolvida'
      ORDER BY criada_em DESC LIMIT 1
      FOR UPDATE`, // trava a linha para evitar corrida entre mensagens simultâneas
    [telefone]
  );
  if (existente.rows[0]) return existente.rows[0];

  // Tenta identificar o cliente no cadastro existente pelo telefone.
  // ATENÇÃO: ajustar nome da tabela/coluna conforme o sistema de OS real.
  const cli = await client.query(
    `SELECT id FROM clientes WHERE telefone_whatsapp = $1 LIMIT 1`,
    [telefone]
  ).catch(() => ({ rows: [] }));

  const { rows } = await client.query(
    `INSERT INTO conversas_ia (telefone, nome_perfil, cliente_id, status)
     VALUES ($1, $2, $3, 'ia')
     RETURNING *`,
    [telefone, nomePerfil, cli.rows[0]?.id || null]
  );
  return rows[0];
}

// Últimas N mensagens no formato esperado pela IA (ordem cronológica).
async function historicoRecente(client, conversaId, limite) {
  const { rows } = await client.query(
    `SELECT origem AS role, texto AS text, criada_em AS timestamp
       FROM mensagens_ia
      WHERE conversa_id = $1 AND texto IS NOT NULL
      ORDER BY criada_em DESC
      LIMIT $2`,
    [conversaId, limite]
  );
  return rows.reverse().map((m) => ({ ...m, timestamp: new Date(m.timestamp).toISOString() }));
}

// Grava mensagem de saída (IA ou humano) com os metadados da IA.
async function registrarMensagemSaida(client, { conversaId, waMessageId, origem, texto, ia }) {
  await client.query(
    `INSERT INTO mensagens_ia
       (conversa_id, wa_message_id, direcao, origem, tipo, texto,
        ia_confianca, ia_categoria, ia_intencao, ia_request_id)
     VALUES ($1, $2, 'saida', $3, 'text', $4, $5, $6, $7, $8)`,
    [conversaId, waMessageId, origem, texto,
     ia?.confidence ?? null, ia?.category ?? null, ia?.intent ?? null, ia?.requestId ?? null]
  );
}

/**
 * Registra o escalonamento e abre/vincula a OS.
 * ATENÇÃO: a tabela "ordens_servico" e suas colunas são ILUSTRATIVAS.
 * Ajustar para o modelo real do sistema de OS.
 */
async function escalonar(client, { conversa, motivo, resumo, osSugerida }) {
  let osId = conversa.os_id;

  if (!osId) {
    const os = await client.query(
      `INSERT INTO ordens_servico (cliente_id, titulo, descricao, prioridade, origem, status)
       VALUES ($1, $2, $3, $4, 'whatsapp_ia', 'aberta')
       RETURNING id`,
      [
        conversa.cliente_id,
        osSugerida?.titulo || `Atendimento WhatsApp ${conversa.telefone}`,
        osSugerida?.descricao || resumo || 'Escalonado pela IA para o nível 2.',
        osSugerida?.prioridade || 'media',
      ]
    );
    osId = os.rows[0].id;
  }

  await client.query(
    `INSERT INTO escalonamentos (conversa_id, os_id, motivo, resumo_ia, dados_os_sugeridos, status)
     VALUES ($1, $2, $3, $4, $5, 'pendente')`,
    [conversa.id, osId, motivo, resumo, osSugerida ? JSON.stringify(osSugerida) : null]
  );

  await client.query(
    `UPDATE conversas_ia SET status = 'aguardando_humano', os_id = $2, atualizada_em = now()
      WHERE id = $1`,
    [conversa.id, osId]
  );

  return osId;
}

// Anexa um registro de histórico na OS existente (tabela ilustrativa — ajustar).
async function registrarLogNaOs(client, osId, texto) {
  if (!osId) return;
  await client.query(
    `INSERT INTO ordens_servico_historico (os_id, autor, descricao) VALUES ($1, 'IA Wts', $2)`,
    [osId, texto]
  );
}

// Log técnico da integração (fora da transação, para não se perder em rollback).
async function registrarLog({ conversaId, waMessageId, etapa, sucesso, httpStatus, latenciaMs, erroCodigo, detalhe }) {
  await pool.query(
    `INSERT INTO logs_integracao
       (conversa_id, wa_message_id, etapa, sucesso, http_status, latencia_ms, erro_codigo, detalhe)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [conversaId, waMessageId, etapa, sucesso, httpStatus, latenciaMs, erroCodigo,
     detalhe ? JSON.stringify(detalhe) : null]
  ).catch((e) => console.error('Falha ao gravar log_integracao', e.message));
}

module.exports = {
  registrarMensagemEntrada, obterOuCriarConversa, historicoRecente,
  registrarMensagemSaida, escalonar, registrarLogNaOs, registrarLog,
};
```

### 4.7 `src/webhook.js` — verificação + recebimento + orquestração

```js
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { pool } = require('./db');
const { perguntarIa } = require('./iaClient');
const { enviarTexto } = require('./whatsappClient');
const { clientePediuHumano, decidirNivel, MSG_TRANSFERENCIA } = require('./roteamento');
const repo = require('./repositorio');

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /webhook/whatsapp — verificação do webhook (feita uma vez pela Meta ao cadastrar)
// -----------------------------------------------------------------------------
router.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge); // devolver o challenge em texto puro
  }
  return res.sendStatus(403);
});

// Valida X-Hub-Signature-256 usando o corpo BRUTO da requisição.
function assinaturaValida(req) {
  const assinatura = req.get('x-hub-signature-256') || '';
  const esperado =
    'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(req.rawBody).digest('hex');
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// -----------------------------------------------------------------------------
// POST /webhook/whatsapp — recebimento de mensagens e status
// -----------------------------------------------------------------------------
router.post('/webhook/whatsapp', (req, res) => {
  if (!assinaturaValida(req)) {
    repo.registrarLog({ etapa: 'webhook_assinatura', sucesso: false, httpStatus: 401 });
    return res.sendStatus(401);
  }

  // Responde 200 IMEDIATAMENTE. Se demorar, a Meta reenvia e gera duplicidade.
  res.sendStatus(200);

  // Extrai as mensagens do payload (pode vir mais de uma por chamada).
  const mensagens = [];
  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const nomePerfil = v.contacts?.[0]?.profile?.name || null;
      for (const m of v.messages || []) mensagens.push({ m, nomePerfil });
      // v.statuses (sent/delivered/read/failed) pode ser registrado em logs_integracao se desejado.
    }
  }

  // Processa em background. Em produção, preferir uma fila (ex.: BullMQ + Redis).
  for (const item of mensagens) {
    setImmediate(() =>
      processarMensagem(item).catch((err) => console.error('Erro ao processar mensagem', err))
    );
  }
});

// -----------------------------------------------------------------------------
// Orquestração de uma mensagem
// -----------------------------------------------------------------------------
async function processarMensagem({ m, nomePerfil }) {
  const inicio = Date.now();
  const prazoFinal = inicio + 28000; // margem dentro da meta de 30 s
  const telefone = `+${m.from}`;      // Cloud API envia sem "+"; normalizamos para E.164
  const texto = m.type === 'text' ? m.text?.body?.trim() : null;
  const recebidaEm = new Date(Number(m.timestamp) * 1000);

  const client = await pool.connect();
  let conversa;
  try {
    await client.query('BEGIN');

    conversa = await repo.obterOuCriarConversa(client, { telefone, nomePerfil });

    // 1) Idempotência: se o wamid já foi gravado, é reenvio do webhook -> ignora.
    const nova = await repo.registrarMensagemEntrada(client, {
      conversaId: conversa.id, waMessageId: m.id, texto, tipo: m.type, recebidaEm,
    });
    if (!nova) {
      await client.query('ROLLBACK');
      await repo.registrarLog({ conversaId: conversa.id, waMessageId: m.id, etapa: 'dedup', sucesso: true });
      return;
    }

    // 2) Conversa já está com humano: só registra e notifica o atendente.
    if (['aguardando_humano', 'em_atendimento_humano'].includes(conversa.status)) {
      await client.query('COMMIT');
      // notificarAtendente(conversa) -> implementar (socket, e-mail interno, painel)
      return;
    }

    // 3) Mídia não suportada na fase 1 -> escala.
    if (!texto) {
      await finalizarNivel2(client, conversa, { motivo: 'MIDIA_NAO_SUPORTADA' });
      await client.query('COMMIT');
      return;
    }

    // 4) Pedido explícito de humano -> escala sem chamar a IA.
    if (clientePediuHumano(texto)) {
      await finalizarNivel2(client, conversa, { motivo: 'CLIENTE_PEDIU_HUMANO' });
      await client.query('COMMIT');
      return;
    }

    // 5) Monta payload e chama a IA.
    const historico = await repo.historicoRecente(client, conversa.id, config.ia.tamanhoHistorico);
    const payload = {
      message: texto,
      conversationId: String(conversa.id),
      messageId: m.id,
      phone: telefone,
      customerName: nomePerfil || undefined,
      recentHistory: historico.slice(0, -1), // exclui a mensagem atual (já vai em "message")
      context: {
        product: config.produtoPadrao,
        clientId: conversa.cliente_id ? String(conversa.cliente_id) : undefined,
        openTicketId: conversa.os_id ? String(conversa.os_id) : null,
        channel: 'whatsapp',
      },
      options: { language: 'pt-BR', maxReplyChars: 1000 },
    };

    let resultado;
    try {
      resultado = await perguntarIa(payload, { prazoFinal });
      await repo.registrarLog({
        conversaId: conversa.id, waMessageId: m.id, etapa: 'ia_chamada', sucesso: true,
        httpStatus: 200, latenciaMs: resultado.latenciaMs,
        detalhe: { requestId: resultado.requestId, tentativas: resultado.tentativas },
      });
    } catch (err) {
      // Falha segura: qualquer erro da IA -> nível 2.
      await repo.registrarLog({
        conversaId: conversa.id, waMessageId: m.id, etapa: 'ia_chamada', sucesso: false,
        httpStatus: err.status || null, latenciaMs: err.latenciaMs, erroCodigo: err.code,
        detalhe: { mensagem: err.message, requestId: err.requestId },
      });
      await finalizarNivel2(client, conversa, { motivo: 'FALHA_IA' });
      await client.query('COMMIT');
      return;
    }

    const r = { ...resultado.resposta, requestId: resultado.requestId };
    const { nivel, motivo } = decidirNivel(r, conversa);

    if (nivel === 1) {
      // 6a) Nível 1: envia a resposta da IA.
      const envio = await enviarTexto(telefone, r.replyText);
      await repo.registrarMensagemSaida(client, {
        conversaId: conversa.id, waMessageId: envio.waMessageId, origem: 'ia', texto: r.replyText, ia: r,
      });
      await repo.registrarLogNaOs(client, conversa.os_id, `IA respondeu (conf. ${r.confidence}): ${r.replyText}`);
    } else {
      // 6b) Nível 2: transfere, abre/vincula OS.
      await finalizarNivel2(client, conversa, {
        motivo, ia: r,
        textoCliente: r.escalate && r.replyText ? r.replyText : MSG_TRANSFERENCIA,
      });
    }

    await client.query('COMMIT');
    await repo.registrarLog({
      conversaId: conversa.id, waMessageId: m.id, etapa: 'fim', sucesso: true,
      latenciaMs: Date.now() - inicio, detalhe: { nivel, motivo },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await repo.registrarLog({
      conversaId: conversa?.id, waMessageId: m.id, etapa: 'erro_geral', sucesso: false,
      erroCodigo: 'UNHANDLED', detalhe: { mensagem: err.message },
    });
    // Observação: como houve ROLLBACK, a mensagem não ficou gravada; um reenvio da Meta
    // será processado novamente. Avaliar alerta para a equipe nesses casos.
    throw err;
  } finally {
    client.release();
  }
}

// Envia mensagem de transferência, registra escalonamento e abre/vincula OS.
async function finalizarNivel2(client, conversa, { motivo, ia = null, textoCliente = MSG_TRANSFERENCIA }) {
  const osId = await repo.escalonar(client, {
    conversa, motivo, resumo: ia?.escalateSummary || null, osSugerida: ia?.suggestedOsFields || null,
  });
  const envio = await enviarTexto(conversa.telefone, textoCliente);
  await repo.registrarMensagemSaida(client, {
    conversaId: conversa.id, waMessageId: envio.waMessageId, origem: 'ia', texto: textoCliente, ia,
  });
  await repo.registrarLogNaOs(client, osId, `Escalonado para nível 2. Motivo: ${motivo}`);
  // notificarFilaHumana({ conversaId: conversa.id, osId, motivo }) -> implementar
}

module.exports = router;
```

### 4.8 `src/server.js`

```js
const express = require('express');
const config = require('./config');
const webhook = require('./webhook');

const app = express();

// Guarda o corpo bruto: necessário para validar X-Hub-Signature-256.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', dryRun: config.dryRun }));
app.use(webhook);

app.listen(config.porta, () => {
  console.log(`Webhook ouvindo na porta ${config.porta} (DRY_RUN=${config.dryRun})`);
});
```

### 4.9 Observações para produção

- Substituir `setImmediate` por fila persistente (BullMQ/Redis ou tabela-fila no PostgreSQL com `SELECT ... FOR UPDATE SKIP LOCKED`) para não perder mensagens em restart.
- **Envio ao WhatsApp dentro da transação**: no protótipo, se o `COMMIT` falhar após o envio, o cliente recebe a mensagem mas o registro se perde. Em produção, considerar padrão *outbox* (gravar a mensagem pendente e enviar em seguida).
- Logs: nunca gravar `IA_API_KEY`, `WA_ACCESS_TOKEN` ou `WA_APP_SECRET`. Mascarar telefone em logs de aplicação (ex.: `+5511*****8888`).
- Usar token de **usuário de sistema** (System User) da Meta em produção, não o token temporário de 24 h do painel.

---

## 5. Modelo de dados sugerido

> Nomes das tabelas/colunas do **sistema de OS existente** (`ordens_servico`, `clientes`, `ordens_servico_historico`) são **ilustrativos**. Ajustar as FKs para os nomes e tipos reais. Se a PK da OS não for `BIGINT`, alinhar o tipo de `os_id`.

```sql
-- =====================================================================
-- Conversas atendidas pela IA (uma por ciclo de atendimento)
-- =====================================================================
CREATE TABLE conversas_ia (
    id                        BIGSERIAL PRIMARY KEY,
    telefone                  VARCHAR(20)  NOT NULL,          -- E.164, ex.: +5511999998888
    nome_perfil               VARCHAR(150),
    cliente_id                BIGINT,                         -- FK para cadastro de clientes (quando identificado)
    os_id                     BIGINT,                         -- FK para a OS existente (quando houver)
    status                    VARCHAR(30)  NOT NULL DEFAULT 'ia'
                              CHECK (status IN ('ia','aguardando_humano','em_atendimento_humano','resolvida')),
    atendente_id              BIGINT,                         -- usuário do nível 2 que assumiu
    tentativas_sem_resolucao  SMALLINT     NOT NULL DEFAULT 0,
    criada_em                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizada_em             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    encerrada_em              TIMESTAMPTZ
    -- , CONSTRAINT fk_conversa_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    -- , CONSTRAINT fk_conversa_os      FOREIGN KEY (os_id)      REFERENCES ordens_servico(id)
);

CREATE INDEX idx_conversas_ia_telefone_status ON conversas_ia (telefone, status);
CREATE INDEX idx_conversas_ia_os ON conversas_ia (os_id);

-- No máximo uma conversa não resolvida por telefone
CREATE UNIQUE INDEX uq_conversas_ia_ativa_por_telefone
    ON conversas_ia (telefone) WHERE status <> 'resolvida';

-- =====================================================================
-- Mensagens (entrada do cliente e saída da IA/humano)
-- =====================================================================
CREATE TABLE mensagens_ia (
    id               BIGSERIAL PRIMARY KEY,
    conversa_id      BIGINT       NOT NULL REFERENCES conversas_ia(id) ON DELETE CASCADE,
    wa_message_id    VARCHAR(128),                 -- wamid do WhatsApp; base da idempotência
    direcao          VARCHAR(10)  NOT NULL CHECK (direcao IN ('entrada','saida')),
    origem           VARCHAR(10)  NOT NULL CHECK (origem IN ('cliente','ia','humano')),
    tipo             VARCHAR(20)  NOT NULL DEFAULT 'text', -- text, audio, image, document...
    texto            TEXT,
    ia_confianca     NUMERIC(4,3) CHECK (ia_confianca BETWEEN 0 AND 1),
    ia_categoria     VARCHAR(40),
    ia_intencao      VARCHAR(80),
    ia_request_id    VARCHAR(80),
    status_entrega   VARCHAR(20),                  -- sent, delivered, read, failed (via webhook de status)
    criada_em        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Idempotência: o mesmo wamid nunca é processado duas vezes
CREATE UNIQUE INDEX uq_mensagens_ia_wamid ON mensagens_ia (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX idx_mensagens_ia_conversa_data ON mensagens_ia (conversa_id, criada_em);

-- =====================================================================
-- Escalonamentos para o nível 2
-- =====================================================================
CREATE TABLE escalonamentos (
    id                   BIGSERIAL PRIMARY KEY,
    conversa_id          BIGINT       NOT NULL REFERENCES conversas_ia(id),
    os_id                BIGINT,                    -- OS aberta ou vinculada no escalonamento
    motivo               VARCHAR(40)  NOT NULL
                         CHECK (motivo IN ('CLIENTE_PEDIU_HUMANO','BAIXA_CONFIANCA','IA_SOLICITOU',
                                           'BUG_SUSPEITO','PERSONALIZACAO','ACAO_NO_ERP',
                                           'LIMITE_TENTATIVAS','FALHA_IA','MIDIA_NAO_SUPORTADA')),
    resumo_ia            TEXT,                      -- escalateSummary vindo da IA
    dados_os_sugeridos   JSONB,                     -- suggestedOsFields vindo da IA
    status               VARCHAR(20)  NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente','assumido','concluido','cancelado')),
    atendente_id         BIGINT,
    criado_em            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    assumido_em          TIMESTAMPTZ,
    concluido_em         TIMESTAMPTZ
    -- , CONSTRAINT fk_escalonamento_os FOREIGN KEY (os_id) REFERENCES ordens_servico(id)
);

CREATE INDEX idx_escalonamentos_fila ON escalonamentos (status, criado_em);

-- =====================================================================
-- Logs técnicos da integração (auditoria, latência, erros)
-- =====================================================================
CREATE TABLE logs_integracao (
    id              BIGSERIAL PRIMARY KEY,
    conversa_id     BIGINT,
    wa_message_id   VARCHAR(128),
    etapa           VARCHAR(40)  NOT NULL,  -- webhook_assinatura, dedup, ia_chamada, wa_envio, fim, erro_geral
    sucesso         BOOLEAN      NOT NULL,
    http_status     SMALLINT,
    latencia_ms     INTEGER,
    erro_codigo     VARCHAR(60),
    detalhe         JSONB,                  -- NUNCA gravar chaves/tokens aqui
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_integracao_data ON logs_integracao (criado_em);
CREATE INDEX idx_logs_integracao_wamid ON logs_integracao (wa_message_id);
```

### 5.1 Vínculo com a OS existente

- Se o cliente já tem **OS aberta** (consulta por `cliente_id` + status aberto no sistema atual), preencher `conversas_ia.os_id` ao criar a conversa e enviar `context.openTicketId` à IA.
- Ao escalonar sem OS, **abrir nova OS** com `suggestedOsFields` (ou valores padrão) e gravar o `os_id` em `conversas_ia` e `escalonamentos`.
- Recomenda-se adicionar no sistema de OS uma coluna/valor de origem (ex.: `origem = 'whatsapp_ia'`) para relatórios.

### 5.2 Consultas úteis

```sql
-- Fila do nível 2 (mais antigos primeiro)
SELECT e.id, e.motivo, e.resumo_ia, c.telefone, c.nome_perfil, e.os_id, e.criado_em
  FROM escalonamentos e JOIN conversas_ia c ON c.id = e.conversa_id
 WHERE e.status = 'pendente'
 ORDER BY e.criado_em;

-- Taxa de resolução no nível 1 (últimos 30 dias)
SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM escalonamentos e WHERE e.conversa_id = c.id))::numeric
       / NULLIF(count(*), 0) AS taxa_nivel1
  FROM conversas_ia c
 WHERE c.criada_em >= now() - interval '30 days';

-- Latência p95 ponta a ponta
SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS p95_ms
  FROM logs_integracao WHERE etapa = 'fim' AND criado_em >= now() - interval '7 days';
```

---

## 6. Configuração (`.env.example`) e testes em homologação

### 6.1 `.env.example`

```dotenv
# ---------------- Aplicação ----------------
PORT=3000
NODE_ENV=homologacao
# true = não envia mensagens reais ao WhatsApp (apenas loga)
DRY_RUN=true
PRODUTO_PADRAO=MULTICOMERCIO

# ---------------- IA Wts (contrato proposto) ----------------
# Homologação: apontar para o mock local (http://localhost:4010)
IA_API_BASE_URL=http://localhost:4010
# Chave fornecida pela empresa. NUNCA commitar o valor real.
IA_API_KEY=coloque_a_chave_aqui
# x-api-key | bearer (conforme acordado com o Wts)
IA_AUTH_HEADER=x-api-key
IA_TIMEOUT_MS=15000
IA_CONFIDENCE_THRESHOLD=0.70
IA_HISTORY_SIZE=10

# ---------------- WhatsApp Cloud API (Meta) ----------------
WA_API_VERSION=v21.0
WA_PHONE_NUMBER_ID=000000000000000
WA_ACCESS_TOKEN=coloque_o_token_aqui
# Valor livre definido por você e cadastrado no painel da Meta
WA_VERIFY_TOKEN=defina_um_token_de_verificacao
WA_APP_SECRET=coloque_o_app_secret_aqui

# ---------------- Banco ----------------
DATABASE_URL=postgres://usuario:senha@localhost:5432/os_homologacao
```

Adicionar `.env` ao `.gitignore`. Em produção, usar o gerenciador de segredos do servidor/hospedagem.

### 6.2 Ambiente de homologação do WhatsApp

1. Criar app no **Meta for Developers** (tipo *Business*) e adicionar o produto **WhatsApp**.
2. Usar o **número de teste** fornecido pela Meta (sandbox) e cadastrar até 5 números destinatários de teste (celulares da equipe). Mensagens só chegam para números cadastrados.
3. Expor o webhook local com HTTPS (ex.: `ngrok http 3000` ou `cloudflared tunnel`) e configurar no painel:
   - URL de callback: `https://<seu-tunel>/webhook/whatsapp`
   - Token de verificação: o mesmo de `WA_VERIFY_TOKEN`
   - Assinar o campo **`messages`**.
4. O token temporário do painel expira em ~24 h; para testes longos, gerar token de **System User**.
5. Para iniciar conversa a partir da empresa (fora da janela de 24 h), é necessário template aprovado — no teste, sempre iniciar a conversa **pelo celular de teste**.

> Se a empresa optar por um **provedor BSP** (Twilio, 360dialog, Gupshup etc.) em vez da Cloud API direta, o formato do webhook e do envio muda. Isolar essa diferença em `webhook.js` (parser) e `whatsappClient.js` (envio).

### 6.3 Mock da API da IA

Enquanto o endpoint do Wts não estiver confirmado, usar este mock (`mock-ia.js`). Ele simula os cenários de teste por palavra-chave:

```js
// mock-ia.js — servidor falso da API da IA para homologação. Rodar: node mock-ia.js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/v1/support/chat', (req, res) => {
  // Simula autenticação
  if (!req.get('x-api-key') && !req.get('authorization')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'API key ausente' } });
  }
  const msg = (req.body.message || '').toLowerCase();
  const base = { requestId: `mock_${Date.now()}`, sources: [], suggestedOsFields: null, escalateSummary: null };

  if (msg.includes('timeout')) return; // nunca responde -> testa timeout
  if (msg.includes('erro500')) return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'falha simulada' } });

  if (msg.includes('nfc-e') || msg.includes('nfce')) {
    return res.json({ ...base, replyText: 'Para reimprimir a NFC-e, acesse Vendas > Consultar NFC-e e clique em Reimprimir.',
      escalate: false, escalateReason: null, category: 'fiscal', intent: 'reimpressao_nfce', confidence: 0.92 });
  }
  if (msg.includes('erro') || msg.includes('travou')) {
    return res.json({ ...base, replyText: 'Vou encaminhar para um especialista.', escalate: true,
      escalateReason: 'BUG_SUSPEITO', category: 'bug', confidence: 0.6,
      escalateSummary: 'Cliente relata erro no sistema.',
      suggestedOsFields: { titulo: 'Erro relatado via WhatsApp', descricao: req.body.message, prioridade: 'alta', modulo: 'N/D', tipo: 'erro' } });
  }
  // Padrão: resposta de baixa confiança -> deve escalar pelo limiar
  return res.json({ ...base, replyText: 'Não tenho certeza, pode detalhar?', escalate: false,
    escalateReason: null, category: 'outro', confidence: 0.4 });
});

app.listen(4010, () => console.log('Mock IA em http://localhost:4010'));
```

### 6.4 Teste local sem WhatsApp (simulando o webhook)

Com `DRY_RUN=true`, simular um POST da Meta assinando o corpo com o `WA_APP_SECRET`:

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"contacts":[{"profile":{"name":"Teste"}}],"messages":[{"from":"5511999998888","id":"wamid.TESTE001","timestamp":"1760550000","type":"text","text":{"body":"Como reimprimir NFC-e?"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WA_APP_SECRET" | sed 's/^.* //')

curl -i -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"

# Verificação do webhook (GET)
curl "http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=$WA_VERIFY_TOKEN&hub.challenge=12345"
# Esperado: 12345
```

Repetir o mesmo POST (mesmo `wamid.TESTE001`) para validar a idempotência.

### 6.5 Sequência recomendada de homologação

1. Mock IA + `DRY_RUN=true` + curl → valida lógica, banco e roteamento.
2. Mock IA + `DRY_RUN=false` + número de teste da Meta → valida envio real e latência.
3. API real do Wts (quando disponível) + número de teste → valida contrato e qualidade das respostas.
4. Piloto com poucos clientes reais em horário comercial, com nível 2 acompanhando.

---

## 7. Cenários de teste e critérios de aceite

| # | Cenário | Entrada / Pré-condição | Resultado esperado | Critério de aceite |
|---|---|---|---|---|
| T01 | Verificação do webhook | GET com `hub.verify_token` correto | Retorna `hub.challenge` com 200 | Painel da Meta aceita o webhook. Token errado → 403. |
| T02 | Assinatura inválida | POST com `X-Hub-Signature-256` incorreta | 401, nada processado | Registro em `logs_integracao` (`webhook_assinatura`, `sucesso=false`). Nenhuma linha em `mensagens_ia`. |
| T03 | FAQ dos manuais → resposta automática | "Como reimprimir NFC-e?" | IA responde com `confidence ≥ 0,70`, `escalate=false` | Cliente recebe resposta em **< 30 s**; mensagens de entrada e saída gravadas com `ia_confianca` e `ia_categoria`; sem escalonamento. |
| T04 | Cliente pede humano | "Quero falar com um atendente" | Escalona sem chamar a IA | Mensagem de transferência enviada; `escalonamentos.motivo = 'CLIENTE_PEDIU_HUMANO'`; conversa `aguardando_humano`; nenhuma chamada à IA nos logs. |
| T05 | Baixa confiança | IA retorna `confidence = 0,40`, `escalate=false` | Backend escalona mesmo assim | `motivo = 'BAIXA_CONFIANCA'`; cliente não recebe a resposta incerta, recebe a mensagem de transferência. |
| T06 | Bug / caso complexo | "O sistema travou com erro ao fechar caixa" | IA retorna `escalate=true`, `category=bug` | `motivo = 'BUG_SUSPEITO'`; OS criada com `suggestedOsFields`; `resumo_ia` preenchido. |
| T07 | Ação no ERP do cliente | "Cancela a nota 1234 pra mim" | Escalona (`ACAO_NO_ERP`) | IA não promete executar a ação; OS aberta; fila humana notificada. |
| T08 | Registro na OS (cliente com OS aberta) | Cliente com OS aberta no sistema | `openTicketId` enviado à IA; histórico anexado à OS | `conversas_ia.os_id` = OS existente; nenhuma OS duplicada; histórico visível na OS. |
| T09 | Registro na OS (sem OS) + escalonamento | Cliente sem OS, caso escalonado | Nova OS aberta | OS com origem `whatsapp_ia`, título/descrição preenchidos; `escalonamentos.os_id` preenchido. |
| T10 | Idempotência (reenvio do webhook) | Mesmo payload/`wamid` enviado 2-3 vezes | Processado uma única vez | 1 linha em `mensagens_ia` para o `wamid`; 1 chamada à IA; cliente recebe **uma** resposta; log `dedup` nos reenvios. |
| T11 | Mensagens simultâneas do mesmo cliente | 2 mensagens com < 1 s de intervalo | Uma única conversa ativa | Índice `uq_conversas_ia_ativa_por_telefone` respeitado; sem erro não tratado. |
| T12 | Conversa com humano | Conversa `em_atendimento_humano` recebe nova mensagem | IA **não** é chamada | Mensagem gravada; atendente notificado; sem resposta automática. |
| T13 | Timeout da IA | Mock não responde | Após `IA_TIMEOUT_MS`, escalona | `motivo = 'FALHA_IA'`; cliente recebe transferência dentro de 30 s; log com `erro_codigo = 'TIMEOUT'`. |
| T14 | Erro 5xx da IA | Mock retorna 500 | 1 retry, depois escalona | 2 tentativas no log; escalonamento `FALHA_IA`. |
| T15 | API key inválida | `IA_API_KEY` errada | 401 da IA, escalona | Sem retry; log `UNAUTHORIZED`; alerta para a equipe; chave **não** aparece em nenhum log. |
| T16 | Mídia não suportada | Cliente envia áudio/imagem | Escalona | `motivo = 'MIDIA_NAO_SUPORTADA'`; mensagem gravada com `tipo` correto. |
| T17 | DRY_RUN | `DRY_RUN=true` | Nada enviado ao WhatsApp | Console mostra `[DRY_RUN]`; banco gravado normalmente com `wa_message_id` fictício. |
| T18 | Latência (carga leve) | 20 mensagens em 1 minuto | Todas respondidas | p95 ponta a ponta (`logs_integracao`, etapa `fim`) **< 30 s**. |
| T19 | Encerramento e nova conversa | Atendente marca `resolvida`; cliente manda nova mensagem | Nova conversa criada, volta para a IA | Nova linha em `conversas_ia` com `status = 'ia'`. |

### 7.1 Critérios gerais de aceite da entrega

- [ ] Todos os cenários T01–T19 executados em homologação com evidência (log/print/consulta SQL).
- [ ] Webhook responde 200 em < 2 s em 100% dos testes.
- [ ] Tempo de resposta ponta a ponta p95 < 30 s.
- [ ] Nenhum segredo (API key, token, app secret) em código, repositório ou logs.
- [ ] Toda falha da IA resulta em escalonamento (nenhum cliente fica sem retorno).
- [ ] Toda conversa escalonada tem OS vinculada.
- [ ] Chamada à IA isolada em `iaClient.js`, permitindo ajustar o contrato sem tocar no restante.

---

## 8. Pendências a acordar com o lado Wts

| # | Item | Responsável |
|---|---|---|
| 1 | Confirmar URL base, caminho `/v1/support/chat` e formato de autenticação (`X-Api-Key` ou `Bearer`). | Wts |
| 2 | Confirmar campos de request/response e enumerações (`category`, `escalateReason`). | Wts + Dev Node |
| 3 | Suporte a `Idempotency-Key`. | Wts |
| 4 | Limites de taxa, SLA de latência e disponibilidade. | Wts |
| 5 | Política de retenção/privacidade dos dados enviados (LGPD). | Wts + Multicomercio |
| 6 | Limiar de confiança definitivo (inicial: 0,70) — ajustar após piloto. | Multicomercio |
| 7 | Cloud API direta da Meta ou provedor BSP. | Multicomercio |
| 8 | Nomes reais das tabelas de OS/clientes para as FKs. | Dev Node |
