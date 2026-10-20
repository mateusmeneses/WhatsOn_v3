# Guia de integração para sistemas parceiros — Whatson

> **Para quem é este guia:** uma IA (ou dev) que vai implementar, **num sistema qualquer**, a integração com o
> Whatson para envio de mensagens de WhatsApp. O guia é autossuficiente: tudo o que a integração precisa
> (rotas, campos, erros, armazenamento, tela, fluxo do QR code e envio) está aqui. O **Apêndice A** traz o
> mapeamento concreto para o ERP MultiComércio.

## 1. Visão geral

O Whatson é a infraestrutura de WhatsApp. O **cliente final nunca acessa o Whatson**: dentro do sistema
parceiro (ex.: o ERP), numa tela de configuração, ele conecta o WhatsApp lendo um QR code, e o sistema passa a
enviar mensagens (avisos, boletos, notas, recibos) pela API do Whatson.

```
 Tela de configuração (navegador do cliente)
          │  só fala com o servidor do parceiro
          ▼
 Servidor do sistema parceiro ──── chave de parceiro ───▶ Whatson /api/partner/v1  (criar empresa/conexão/token)
          │
          └──────────────────── token da conexão ──────▶ Whatson /api/v1          (QR, status, envio)
```

Regras fixas:

- **Uma empresa do Whatson por cliente do parceiro**, identificada pelo **CNPJ**.
- **Um número de WhatsApp por empresa.**
- **Só envio.** Respostas dos contatos ficam guardadas no Whatson; o parceiro não recebe nada de volta (não há
  webhook). Ninguém responde automaticamente.
- Todas as chamadas ao Whatson saem **do servidor do parceiro**, nunca do navegador.

## 2. Os dois segredos

| Segredo | Formato | Quem emite | Para quê | Onde o parceiro guarda |
|---|---|---|---|---|
| **Chave de parceiro** | `wpk_` + 48 hex (52 caracteres) | super-admin do Whatson, no painel **Parceiros** | criar/obter empresas e tokens (`/api/partner/v1`) | **um único lugar central** do sistema parceiro, cifrado (não por cliente) |
| **Token da conexão** | 64 hex | a própria API de parceiros | QR code, status, desconectar e enviar (`/api/v1`) | **junto dos dados de cada cliente**, cifrado |

- A chave de parceiro é mostrada **uma única vez** no painel. Se vazar, o super-admin a regenera e a anterior para
  de valer na hora.
- O token da conexão pode ser recuperado a qualquer momento por `GET /api/partner/v1/companies/{cnpj}` e trocado
  por `POST /api/partner/v1/companies/{cnpj}/api-token`.
- Nenhum dos dois pode ir para o navegador, para logs ou para mensagens de erro exibidas ao usuário.

## 3. Configuração do sistema parceiro

| Parâmetro | Exemplo | Observação |
|---|---|---|
| `WHATSON_BASE_URL` | `https://hmlwhatson.connectmulti.com.br` | sem barra no fim; sempre HTTPS |
| `WHATSON_PARTNER_KEY` | `wpk_3f9a…` | cifrada em repouso; decifrada só na hora da chamada |

Ambos ficam no armazenamento central do parceiro (banco central/configuração do servidor). Ofereça, numa tela
administrativa do parceiro (não do cliente final), um botão **Testar chave** que chama
`GET /api/partner/v1/companies/{um CNPJ válido qualquer}`: `404` = chave válida (empresa só não existe);
`403 INVALID_PARTNER_KEY` = chave errada ou revogada.

Por cliente, o parceiro guarda (tabela própria, ex. `IntegracaoWhatsapp`):

| Campo | Tipo | Origem |
|---|---|---|
| `Cnpj` | texto(14) | CNPJ enviado (sem pontuação) |
| `WhatsonEmpresaId` | inteiro | `company.id` |
| `WhatsonConexaoId` | inteiro | `connection.id` |
| `TokenCripto` | texto | `apiToken` **cifrado** |
| `Status` | texto | último `connection.status` visto (`connected`/`qrcode`/`disconnected`) ou `blocked` |
| `Numero` | texto, nulo | `connection.number` quando conectado |
| `AtualizadoEm` | data/hora | última sincronização |

## 4. Convenções da API

- JSON em UTF-8, `Content-Type: application/json` (exceto upload multipart).
- Autenticação: `Authorization: Bearer <chave ou token>`.
- Datas em ISO-8601 UTC.
- Erros sempre no formato:

```json
{ "error": { "code": "CNPJ_IN_USE", "message": "CNPJ já cadastrado em outra empresa" } }
```

  Decida pelo `code`, nunca pelo `message` (o texto pode mudar).
- **Limite de requisições:** janela de 1 minuto, padrão **60/min** por chave de parceiro e **60/min** por token de
  conexão. Respostas trazem `X-RateLimit-Limit` e `X-RateLimit-Remaining`; o `429 RATE_LIMITED` traz
  `Retry-After` (segundos) — espere esse tempo antes de tentar de novo.
- **Retry:** só em erro de rede, `502`, `503`, `504` e `429` (este respeitando `Retry-After`). Backoff
  exponencial (1 s, 2 s, 4 s; no máx. 3 tentativas). **Nunca** repita automaticamente `400`, `401`, `403`, `404`,
  `409`. Timeout de requisição: 30 s.

## 5. API de parceiros — `/api/partner/v1`

Autenticada pela **chave de parceiro**. Cada parceiro só enxerga as empresas que ele mesmo criou.

### 5.1 Objeto `PartnerCompany` (resposta das três rotas)

```json
{
  "company": {
    "id": 12,
    "cnpj": "12345678000195",
    "name": "Loja X",
    "status": "active",
    "createdAt": "2026-10-19T14:03:11.000Z"
  },
  "connection": { "id": 30, "status": "qrcode", "number": null },
  "apiToken": "9f2c…64 hex"
}
```

| Campo | Valores |
|---|---|
| `company.status` | `active` ou `blocked` (bloqueada pelo super-admin: nada funciona até desbloquear) |
| `connection` | pode ser `null` só em empresa bloqueada que nunca terminou de ser criada |
| `connection.status` | `connected` (pronto para enviar), `qrcode` (aguardando leitura), `disconnected` |
| `connection.number` | número conectado (ex. `5579999990000`) ou `null` |
| `apiToken` | token da `/api/v1`; `null` nas mesmas condições de `connection` |

### 5.2 CNPJ

- Pode ser enviado com ou sem pontuação (`12.345.678/0001-95` ou `12345678000195`). O Whatson remove a
  pontuação, passa para maiúsculo e valida os dígitos verificadores.
- Aceita o **CNPJ alfanumérico** (Receita Federal, a partir de julho/2026), ex. `12.ABC.345/01DE-35`.
- Na resposta vem sempre normalizado (14 caracteres, sem pontuação). Guarde essa forma.
- Na URL (`/companies/{cnpj}`), use a forma normalizada.

### 5.3 `POST /api/partner/v1/companies` — criar ou obter

Cria a empresa, a conexão de WhatsApp e o token. **Idempotente pelo CNPJ**: chamar de novo (retry, duplo clique,
cliente reconfigurando) devolve a mesma empresa e o **mesmo token**, sem criar nada duplicado.

```bash
curl -s -X POST "$WHATSON_BASE_URL/api/partner/v1/companies" \
  -H "Authorization: Bearer $WHATSON_PARTNER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "cnpj": "12.345.678/0001-95",
        "name": "Loja X Comércio Ltda",
        "tradeName": "Loja X",
        "email": "contato@lojax.com",
        "phone": "79999990000"
      }'
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `cnpj` | sim | CNPJ válido (numérico ou alfanumérico) |
| `name` | sim | razão social, 1–200 caracteres |
| `tradeName` | não | nome fantasia, até 200; se vier, vira o nome da empresa no Whatson |
| `email` | não | e-mail de contato do cliente (só para o suporte identificar) |
| `phone` | não | telefone de contato, até 30 |

Respostas:

| Status | Quando | Corpo |
|---|---|---|
| `201` | empresa criada agora | `PartnerCompany`, `connection.status = "qrcode"` |
| `200` | CNPJ já era deste parceiro (nome/contatos são atualizados) | `PartnerCompany` |
| `200` | empresa bloqueada | `PartnerCompany` com `company.status = "blocked"` (nada é alterado) |
| `400 VALIDATION_ERROR` | campo faltando/inválido | erro |
| `400 INVALID_CNPJ` | CNPJ inválido | erro |
| `409 CNPJ_IN_USE` | CNPJ pertence a empresa de outro parceiro ou cadastrada direto no Whatson | erro (sem dados da empresa) — orientar o usuário a falar com o suporte |
| `502 PROVIDER_ERROR` | o servidor de WhatsApp falhou ao criar a instância | erro — **tente de novo**: a próxima chamada completa a criação |

### 5.4 `GET /api/partner/v1/companies/{cnpj}` — consultar

Devolve `PartnerCompany` (`200`). `404 NOT_FOUND` se o CNPJ não existe ou é de outro parceiro. Use para
recuperar o token perdido ou sincronizar o estado.

### 5.5 `POST /api/partner/v1/companies/{cnpj}/api-token` — trocar o token

Gera um token novo; **o anterior para de valer na hora**. Grave o novo antes de qualquer outra chamada. Devolve
`PartnerCompany`. Erros: `404 NOT_FOUND`, `403 COMPANY_BLOCKED`.

### 5.6 Erros de autenticação (todas as rotas)

| Status | `code` | Significado |
|---|---|---|
| `401` | `UNAUTHENTICATED` | cabeçalho `Authorization` ausente |
| `403` | `INVALID_PARTNER_KEY` | chave errada, regenerada ou parceiro revogado — alertar o administrador do parceiro |
| `429` | `RATE_LIMITED` | aguardar `Retry-After` |

O token da conexão **não** vale aqui, e a chave de parceiro **não** vale na `/api/v1`.

## 6. API da conexão — `/api/v1`

Autenticada pelo **token da conexão** (`apiToken`). Tudo o que é feito com ele usa o número daquela empresa.

### 6.1 `GET /api/v1/connection/status`

```json
{ "status": "connected", "number": "5579999990000" }
```

`status`: `connected`, `qrcode` ou `disconnected`. Chamada barata: use para o polling da tela.

### 6.2 `GET /api/v1/connection/qrcode`

```json
{ "qrcode": "data:image/png;base64,iVBORw0KGgo…", "status": "qrcode" }
```

- `qrcode` é uma imagem PNG em data URL: renderize direto num `<img src="…">`.
- O QR **expira em poucos segundos**: busque de novo a cada ~3 s enquanto estiver na tela.
- Se já está conectado: `{ "qrcode": null, "status": "connected" }`.
- Também serve para reconectar uma conexão `disconnected` (gera um QR novo).

### 6.3 `POST /api/v1/connection/logout`

Desconecta o número (usado em **Desconectar** e **Trocar número**). Resposta: `{ "status": "disconnected" }`.
O token continua o mesmo; para conectar outro número, basta exibir um QR novo.

### 6.4 `POST /api/v1/messages/send` — texto (JSON)

```bash
curl -s -X POST "$WHATSON_BASE_URL/api/v1/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"number": "79988887777", "body": "Seu pedido saiu para entrega"}'
```

Resposta `201`:

```json
{
  "ticketId": 42,
  "contactId": 17,
  "number": "5579988887777",
  "messages": [{ "id": 901, "type": "text", "ack": "pending" }]
}
```

- `body` até 4096 caracteres.
- O envio ao WhatsApp é **assíncrono**: `201` significa "aceito e na fila", não "entregue".
- Guarde `messages[].id` no log do parceiro para rastreio.

### 6.5 `POST /api/v1/messages/send` — arquivos (multipart)

Campo `medias` (até 10 arquivos, 16 MB cada), `number` e `body` opcional (legenda do primeiro arquivo).

```bash
curl -s -X POST "$WHATSON_BASE_URL/api/v1/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -F "number=79988887777" \
  -F "body=Segue o boleto" \
  -F "medias=@boleto.pdf;type=application/pdf"
```

Envie o `type` (MIME) correto de cada arquivo e um nome de arquivo com extensão.

### 6.6 `POST /api/v1/messages/send-media-url` — mídia por URL

```json
{ "number": "79988887777", "url": "https://exemplo.com/nota.pdf", "caption": "NF-e 1234", "fileName": "nota-1234.pdf" }
```

Só URLs `http`/`https` **públicas** (endereços internos são recusados), até 16 MB e 3 redirecionamentos. Use
quando o arquivo já está publicado (ex. link público de recibo); senão, prefira o upload multipart.

### 6.7 `POST /api/v1/contacts/check` — verificar número

```json
{ "number": "79988887777" }
```

Resposta: `{ "exists": true, "jid": "557988887777@s.whatsapp.net" }`. O envio já faz essa verificação; use esta
rota só para validar o cadastro do contato antes (ex. ao salvar o celular do cliente).

### 6.8 Números

Aceita qualquer formatação (`(79) 98888-7777`, `+55 79 98888-7777`, `5579988887777`): ficam só os dígitos e,
com 10 ou 11 dígitos (DDD + número), o DDI `55` é adicionado. Mande o número mais completo que o sistema tiver.

### 6.9 Erros da `/api/v1`

| Status | `code` | O que o sistema parceiro faz |
|---|---|---|
| `401` | `UNAUTHENTICATED` | bug de integração (token não enviado) |
| `403` | `INVALID_API_TOKEN` | token inválido/trocado: chamar `GET /api/partner/v1/companies/{cnpj}`, gravar o token devolvido e repetir **uma** vez |
| `403` | `COMPANY_BLOCKED` | marcar status `blocked`; mostrar "WhatsApp suspenso, fale com o suporte"; não tentar de novo |
| `409` | `CONNECTION_NOT_CONNECTED` | marcar status `disconnected`; avisar que é preciso conectar na tela de configuração; não tentar de novo |
| `404` | `NUMBER_NOT_ON_WHATSAPP` | o destinatário não tem WhatsApp; registrar no log/documento; não tentar de novo |
| `400` | `VALIDATION_ERROR`, `INVALID_PHONE`, `INVALID_MEDIA_URL`, `MEDIA_DOWNLOAD_FAILED`, `MEDIA_TOO_LARGE`, `UPLOAD_ERROR` | erro de dados; mostrar a mensagem ao usuário; não tentar de novo |
| `429` | `RATE_LIMITED` | aguardar `Retry-After` e repetir |
| `502` | `PROVIDER_ERROR` | retry com backoff (seção 4) |

## 7. Tela de configuração (cliente final)

Uma tela "WhatsApp" na configuração do sistema parceiro, visível para quem tem permissão de configurar.
O navegador só conversa com o **servidor do parceiro**; o servidor do parceiro chama o Whatson.

### 7.1 Rotas do servidor do parceiro (sugestão)

| Rota do parceiro | O que faz no Whatson |
|---|---|
| `POST /whatsapp/conectar` | `POST /api/partner/v1/companies` com os dados da empresa → grava token/ids → devolve estado |
| `GET /whatsapp/estado` | `GET /api/v1/connection/status` → atualiza `Status`/`Numero` → devolve `{ status, number }` |
| `GET /whatsapp/qrcode` | `GET /api/v1/connection/qrcode` → devolve `{ qrcode, status }` |
| `POST /whatsapp/desconectar` | `POST /api/v1/connection/logout` |
| `POST /whatsapp/teste` | `POST /api/v1/messages/send` para o número informado |

Nenhuma dessas rotas devolve chave ou token ao navegador.

### 7.2 Estados da tela

| Estado | Como se chega | O que a tela mostra | Ações |
|---|---|---|---|
| **Não configurado** | não há registro local do cliente | texto curto explicando | **Conectar WhatsApp** |
| **Preparando** | clicou em Conectar; `POST /companies` em andamento | spinner | — |
| **Aguardando leitura** | `connection.status` = `qrcode` ou `disconnected` | QR code + passo a passo: "WhatsApp no celular → Aparelhos conectados → Conectar um aparelho → aponte para o código" | **Cancelar** |
| **Conectado** | `status` = `connected` | número formatado e "Conectado" | **Enviar mensagem de teste**, **Trocar número**, **Desconectar** |
| **Desconectado** | caiu a conexão (celular sem internet, sessão encerrada) | aviso | **Conectar novamente** (mostra QR) |
| **Suspenso** | `company.status` = `blocked` ou `COMPANY_BLOCKED` | "WhatsApp suspenso. Fale com o suporte." | — |
| **Erro** | `409 CNPJ_IN_USE`, `403 INVALID_PARTNER_KEY`, falha persistente | mensagem amigável + código para o suporte | **Tentar novamente** |

### 7.3 Fluxo do QR (polling)

1. Ao entrar em **Aguardando leitura**, chame `/whatsapp/qrcode` e exiba a imagem.
2. A cada **3 s**: chame `/whatsapp/estado`. Se `connected` → vá para **Conectado** e pare. Senão, chame
   `/whatsapp/qrcode` e troque a imagem.
3. Pare o polling ao sair da tela, ao cancelar, ou após **2 minutos** sem leitura (mostre "O código expirou" com
   botão **Gerar novo código**).
4. Nunca rode polling em segundo plano fora dessa tela.

### 7.4 Ao abrir a tela

- Sem registro local → **Não configurado**.
- Com registro → chame `/whatsapp/estado` e mostre o estado. Se der `INVALID_API_TOKEN`, recupere o token pela
  API de parceiros (seção 6.9) e tente de novo.

### 7.5 Trocar número / Desconectar

Confirme antes ("As mensagens deixarão de ser enviadas até conectar de novo"). **Trocar número** = `logout` e já
mostrar o QR. O token não muda.

### 7.6 Mensagem de teste

Campo de número (pré-preenchido com o celular do usuário logado, se houver) e texto fixo, ex.:
"Mensagem de teste do <Sistema>: WhatsApp conectado com sucesso." Mostre sucesso no `201` ou o erro traduzido.

## 8. Envio de mensagens pelo sistema

- Centralize num **serviço único** (ex. `WhatsappService.EnviarTexto(numero, texto)`,
  `EnviarArquivo(numero, bytes, nomeArquivo, mime, legenda)`, `EnviarUrl(numero, url, legenda, nomeArquivo)`), que:
  1. carrega o registro do cliente e decifra o token;
  2. se `Status` local é `blocked`, falha na hora sem chamar o Whatson; se é `disconnected`, chama mesmo assim (o
     estado local pode estar velho) e trata o `409`;
  3. aplica retry/backoff só nos casos da seção 4;
  4. trata cada erro conforme a tabela 6.9;
  5. grava **log de cada envio**: data/hora, usuário, documento de origem (ex. título, pedido), número, tipo,
     status HTTP, `code` de erro, `messages[].id`, duração — **sem** token, chave ou conteúdo de arquivo.
- Envios em lote: sequenciais, respeitando o limite de 60/min (ou fila com controle de taxa); mostre o progresso e
  o resultado por item.
- Onde o sistema hoje abre `wa.me` (link manual), ofereça o envio pela API quando a integração estiver
  **Conectada**, mantendo o `wa.me` como alternativa quando não estiver.

## 9. Segurança

- Chamadas ao Whatson **só do servidor**, sempre HTTPS; nunca desligar validação de certificado.
- Chave de parceiro e tokens **cifrados em repouso**; decifrar só em memória, na hora do uso.
- Não registrar segredos em log, exceção, tela ou resposta HTTP.
- As rotas do parceiro (seção 7.1) exigem usuário autenticado e permissão de configurar WhatsApp; a de teste,
  permissão de enviar.
- As rotas do parceiro operam **sempre no cliente/empresa da sessão** — nunca aceite CNPJ ou id de cliente vindo do
  navegador.

## 10. Checklist de aceite

- [ ] Chave de parceiro configurada e cifrada; **Testar chave** mostra válida/inválida.
- [ ] Conectar cria a empresa (`201`) e mostra o QR; clicar de novo não duplica (`200`, mesmo token).
- [ ] Ler o QR leva a **Conectado** em até ~3 s, com o número exibido.
- [ ] Mensagem de teste chega no celular de destino.
- [ ] Desconectar → estado **Desconectado**; Conectar novamente → QR → **Conectado**.
- [ ] Trocar número funciona sem trocar o token.
- [ ] Enviar com o WhatsApp desconectado mostra o aviso de conexão (409) e não tenta de novo.
- [ ] Número sem WhatsApp → erro claro, registrado no log.
- [ ] Token trocado no Whatson → o sistema se recupera sozinho pela API de parceiros.
- [ ] Empresa bloqueada → tela **Suspenso** e envios falham sem retry.
- [ ] Nenhuma resposta ao navegador e nenhum log contém chave ou token.
- [ ] Polling do QR para ao sair da tela e após 2 minutos.

---

## Apêndice A — ERP MultiComércio

Repositório `D:\PROJETOS\MULTICOMERCIO` (branch `main`). ASP.NET Core MVC, Dapper (SQL parametrizado), SQL
Server com **um banco por empresa (tenant)** e o banco central **MULTIMASTER**. Leia `ARCHITECTURE.md`,
`ARMADILHAS.md` e `DESIGN-SYSTEM.md` do repositório antes de codar.

### A.1 Onde fica cada coisa

| Item | Onde | Como |
|---|---|---|
| URL base e **chave de parceiro** | `connect-secrets.json` (já fora do git) em `Whatson:BaseUrl` e `Whatson:ChavePartnerCripto` **ou**, se precisar trocar sem redeploy, numa tabela de configuração no **MULTIMASTER** | a chave sempre cifrada com o `CertCryptoService` (AES-256, chave `Fiscal:CertKey`), o mesmo usado nos segredos da Cora (`ContaBancaria.IntegracaoClientSecretCripto`) |
| Registro por cliente (seção 3) | tabela nova no **banco do tenant**, ex. `dbo.IntegracaoWhatsapp` (uma linha) | script SQL numerado na sequência de `database-analysis/scripts` (último hoje: `609_…`), aplicado em todos os tenants como os demais scripts |
| Token da conexão | coluna `TokenCripto` dessa tabela | cifrado com `CertCryptoService` |
| CNPJ enviado | `dbo.Filial` da **matriz** (`EhMatriz = 1`), entidade `FilialCadastro.Cnpj` | um número para a empresa toda; filiais usam a mesma conexão |
| Razão social / fantasia / e-mail / telefone | entidade `Empresa` (`RazaoSocial`, `NomeFantasia`, `Email`, `Telefone`) | vão em `name`, `tradeName`, `email`, `phone` |

### A.2 Código

- **Cliente HTTP:** registrar `builder.Services.AddHttpClient("whatson", c => c.Timeout = TimeSpan.FromSeconds(30))`
  em `Program.cs`, no mesmo padrão de `"cora"`.
- **Serviço:** `WhatsonClient` (chamadas HTTP cruas, tipadas com os DTOs das seções 5 e 6) e `WhatsappService`
  (regras das seções 7 e 8: resolver tenant/matriz, cifrar/decifrar, retry, log), no mesmo desenho de
  `Connect.Web/Bancos/Cora` (`CoraTokenService`, `CoraBancoProvider`) e `BancoContextoResolver`.
- **Erros:** converter códigos do Whatson em `BusinessException` com mensagem em português para a tela.
- **Log:** gravar cada chamada (rota, status, `code`, duração, usuário, documento de origem) como a integração
  Cora já faz com request/response, **removendo** cabeçalho `Authorization`.
- **Controller + tela:** `WhatsappController` com as rotas da seção 7.1 e a view no padrão visual `sv-*`
  (`wwwroot/css/sv.css`, helpers de `sv-app.js`), com botão **Testar** como o **Testar Conexão** da conta bancária.
- **Permissões:** novas constantes em `Permissoes` no formato `MODULO.Recurso.Acao`, ex.
  `CONFIG.Whatsapp.Configurar` e `CONFIG.Whatsapp.EnviarTeste`, aplicadas com `[RequirePermission(...)]` em cada
  action e concedidas por script SQL (padrão dos scripts de permissão existentes).
- **Módulo opcional por empresa:** se o envio por API for um recurso contratado, criar flag `UsaWhatsappApi` no
  MULTIMASTER seguindo `UsaDelivery` (`MultiMasterFlagsSql`, `MultiMasterRouting`, `MultiMasterAdmin`).

### A.3 Pontos de envio sugeridos (não obrigatórios na primeira entrega)

Hoje o sistema usa `wa.me`/compartilhamento manual em: recibo de Contas a Receber
(`ContaReceberController.RegistrarReciboWhatsApp`), boleto (tela `ContaReceber/DetalheBoleto`), pedido da Força de
Vendas (`FvPedidosController.RegistrarWhatsApp`) e DAV do Delivery. Com a integração **Conectada**, esses pontos
podem enviar pelo `WhatsappService` (PDF por upload multipart; recibo também pelo link público `/r/{token}` via
`send-media-url`), mantendo o registro de envio que já existe (`RegistrarEnvio(id, "WHATSAPP", destino)`).
