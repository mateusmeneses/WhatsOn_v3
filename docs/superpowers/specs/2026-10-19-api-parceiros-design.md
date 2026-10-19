# API de Parceiros — design

Data: 2026-10-19

## 1. Intenção

O Whatson passa a servir de **infraestrutura de WhatsApp para outros sistemas** (o ERP MultiComércio primeiro,
qualquer outro depois). O cliente final **nunca acessa o Whatson**: dentro do sistema dele, numa tela de
configuração, ele clica em conectar, escaneia o QR code ali mesmo e, a partir daí, o sistema dele envia mensagens
pela API do Whatson.

Hoje a API externa (`/api/v1`) já faz QR, status, desconectar e envio, mas exige que alguém entre no painel,
crie a empresa, crie a conexão e gere o token. O que falta é o passo anterior, feito **máquina a máquina**:
o sistema parceiro cria a empresa e a conexão no Whatson e recebe o token da conexão.

Entregável final além do código: um **guia de implementação em Markdown** escrito para uma IA, que com ele
consiga gerar toda a integração em qualquer sistema (endpoints, parâmetros, erros, armazenamento, tela,
polling do QR, envio), com um apêndice concreto do MultiComércio.

## 2. Decisões do usuário

- A conexão é criada **a partir do sistema parceiro**, não pelo painel do Whatson.
- **Um número de WhatsApp por empresa** (por enquanto). No MultiComércio, um número para a empresa toda, todas
  as filiais.
- A empresa é identificada pelo **CNPJ**. Chamar de novo com o mesmo CNPJ não duplica nada. No MultiComércio,
  o CNPJ enviado é o da **filial matriz** (`EhMatriz`).
- Uso **só de envio**. Respostas dos clientes ficam guardadas no Whatson sem ninguém ver; não precisam voltar ao
  parceiro.
- O cliente final precisa de: conectar (QR), ver status, desconectar e trocar de número.
- **Chave por parceiro**, cadastrada pelo super-admin no painel. O parceiro guarda a chave **no próprio banco
  central**, cifrada, e a envia em cada chamada de provisionamento. O token de cada conexão fica no banco/dados
  do cliente no parceiro, cifrado.

## 3. Objetivos

1. Super-admin cadastra parceiros e obtém para cada um uma chave secreta (mostrada uma única vez).
2. Com a chave, o parceiro cria-ou-obtém uma empresa pelo CNPJ, que já nasce com uma conexão e o token de API.
3. O parceiro consulta a empresa pelo CNPJ e regenera o token da conexão.
4. Daí em diante o parceiro usa a `/api/v1` existente, sem mudanças de contrato.
5. Guia de implementação para IA em `docs/guia-integracao-parceiros.md`.

## 4. Não-objetivos

- Mais de uma conexão por empresa de parceiro.
- Webhook de mensagens recebidas ou de mudança de status para o parceiro (o parceiro faz polling do status).
- Excluir empresa pela API de parceiro. Encerrar cliente = super-admin **bloqueia** no painel.
- Login de usuários nas empresas criadas por parceiro (elas nascem sem usuários).
- Mudar o contrato da `/api/v1`.

## 5. Anti-objetivos (seria falha mesmo funcionando)

- Um parceiro conseguir ver, alterar ou obter token de empresa que **não criou** (inclusive de empresa criada à
  mão no painel ou por outro parceiro).
- Alguém sem chave válida conseguir criar empresa ou obter token só sabendo um CNPJ (CNPJ é público).
- A chave do parceiro ficar legível no banco do Whatson ou voltar em alguma resposta depois de criada.
- Mensagens automáticas (bot, fora de expediente) sendo enviadas aos contatos de empresas de parceiro.
- Chamadas repetidas do parceiro (retry, duplo clique) criarem empresas ou instâncias duplicadas.

## 6. Desenho

### 6.1 Dados (migration `0010-partners`)

Tabela `partners`:

| coluna | tipo | |
|---|---|---|
| id | serial PK | |
| name | string, não nulo | nome do sistema parceiro ("MultiComércio") |
| keyHash | string, não nulo, único | SHA-256 hex da chave |
| keyPrefix | string, não nulo | primeiros 12 caracteres da chave, para reconhecer no painel |
| status | string, não nulo, default `active` | `active` ou `revoked` |
| lastUsedAt | timestamp, nulo | atualizado a cada chamada autenticada (no máx. 1x/min, para não escrever a cada request) |
| createdAt / updatedAt | timestamps | |

Tabela `companies` ganha:

| coluna | tipo | |
|---|---|---|
| cnpj | string(14), nulo, **único** | só caracteres válidos, sem pontuação, maiúsculo |
| partnerId | int, nulo, FK `partners.id` `ON DELETE RESTRICT` | parceiro dono; nulo = empresa criada no painel |

Empresas existentes ficam com `cnpj` e `partnerId` nulos.

### 6.2 Chave do parceiro

- Formato: `wpk_` + 48 caracteres hex (`randomBytes(24)`). Ex.: `wpk_3f9a…`.
- Gravada só como SHA-256 (chave tem alta entropia; não precisa de bcrypt e a busca fica por índice).
- Mostrada **uma única vez**: ao criar o parceiro e ao regenerar a chave. Regenerar invalida a anterior na hora.
- Revogar (`status = revoked`) recusa todas as chamadas de provisionamento do parceiro. **Não** derruba os tokens
  de conexão já emitidos: as empresas dos clientes continuam enviando. Para parar um cliente, bloqueia-se a empresa.
- Header: `Authorization: Bearer <chave>`.

### 6.3 CNPJ

- Aceita com ou sem pontuação; remove tudo que não for `[0-9A-Za-z]` e passa para maiúsculo.
- Deve ter 14 caracteres: 12 alfanuméricos + 2 dígitos verificadores, validados pelo módulo 11 com valor de cada
  caractere = código ASCII − 48. Isso cobre o CNPJ numérico tradicional e o **CNPJ alfanumérico** emitido pela
  Receita a partir de julho/2026.
- Rejeita sequências de um único caractere repetido (`00000000000000`).
- Inválido → 400 `INVALID_CNPJ`.

### 6.4 API de parceiros — `/api/partner/v1`

Montada em `app.ts` **antes** de `/api` (como a `/api/v1`), com autenticação pela chave e limite de
requisições por parceiro (janela fixa no Redis, mesmo padrão de `rateLimitByConnection`, padrão 60/min,
variável `PARTNER_API_RATE_LIMIT`).

Representação devolvida (`PartnerCompany`):

```json
{
  "company": { "id": 12, "cnpj": "12345678000195", "name": "Loja X Ltda", "status": "active", "createdAt": "..." },
  "connection": { "id": 30, "status": "qrcode", "number": null },
  "apiToken": "64 hex"
}
```

`company.status`: `active` ou `blocked`. `connection.status`: `connected`, `qrcode` ou `disconnected`.

#### `POST /companies` — criar ou obter

Body:

```json
{ "cnpj": "12.345.678/0001-95", "name": "Loja X Ltda", "tradeName": "Loja X", "email": "a@b.com", "phone": "79999990000" }
```

- `cnpj` e `name` obrigatórios (`name` 1–80). `tradeName`, `email`, `phone` opcionais.
- O nome da empresa no Whatson = `tradeName` se vier, senão `name` (cortado em 80).
- `email` e `phone` são guardados só para o super-admin identificar o cliente (colunas `contactEmail`,
  `contactPhone` na empresa, nulas). *(Decisão do builder ok: se preferir não guardar, documentar.)*
- Comportamento:
  - CNPJ não existe → cria empresa (`partnerId` = parceiro), cria a conexão `"WhatsApp"` (padrão da empresa,
    sem fila, sem bot) com instância na Evolution, gera o token → **201**.
  - CNPJ existe **deste parceiro** → atualiza nome/contatos se vieram diferentes; se a empresa não tem conexão
    (falha anterior na Evolution), cria agora; se a conexão não tem token, gera → **200**. Nunca troca um token
    existente.
  - CNPJ existe de **outro parceiro ou do painel** → **409** `CNPJ_IN_USE`, sem revelar nada da empresa.
  - Empresa bloqueada → **200** com `company.status = "blocked"` (não desbloqueia, não cria nada).
- Concorrência: duas chamadas simultâneas com o mesmo CNPJ resultam em **uma** empresa e **uma** conexão
  (índice único em `cnpj` + tratamento de `UniqueConstraintError` relendo a existente; criação da conexão dentro
  de lock por empresa, ex. `SELECT … FOR UPDATE` na empresa).
- Falha na Evolution ao criar a instância → **502** `PROVIDER_ERROR`; a empresa fica criada sem conexão e a
  próxima chamada completa (idempotente).

#### `GET /companies/:cnpj`

Devolve `PartnerCompany` (200). Não existe ou não é do parceiro → **404** `NOT_FOUND`. Serve para a tela do
parceiro mostrar a situação e para recuperar o token se o parceiro o perdeu.

#### `POST /companies/:cnpj/api-token`

Gera um token novo para a conexão (o anterior para de valer na hora) e devolve `PartnerCompany`. 404 como acima.
Empresa bloqueada → 403 `COMPANY_BLOCKED`.

#### Erros

Formato padrão `{ "error": { "code", "message" } }`:

| situação | status | code |
|---|---|---|
| sem header | 401 | `UNAUTHENTICATED` |
| chave inexistente, regenerada ou parceiro revogado | 403 | `INVALID_PARTNER_KEY` |
| body inválido | 400 | `VALIDATION_ERROR` |
| CNPJ inválido | 400 | `INVALID_CNPJ` |
| CNPJ de outro dono | 409 | `CNPJ_IN_USE` |
| empresa não encontrada para o parceiro | 404 | `NOT_FOUND` |
| empresa bloqueada (regenerar token) | 403 | `COMPANY_BLOCKED` |
| Evolution falhou | 502 | `PROVIDER_ERROR` |
| limite excedido | 429 | `RATE_LIMITED` |

O token de conexão e o JWT do painel **não** valem na API de parceiros, e a chave de parceiro **não** vale na
`/api/v1`.

### 6.5 Depois do token: `/api/v1` sem mudanças

O parceiro usa o `apiToken` com as rotas existentes: `GET /connection/status`, `GET /connection/qrcode`,
`POST /connection/logout`, `POST /messages/send`, `POST /messages/send-media-url`, `POST /contacts/check`.
Trocar de número = `logout` + novo QR, com o mesmo token. Empresa bloqueada → a `/api/v1` já devolve
`COMPANY_BLOCKED`.

### 6.6 Comportamento das empresas de parceiro

- Nascem sem usuários, sem filas e sem nós de chatbot. Sem bot, mensagens recebidas abrem ticket `pending`
  e nada é respondido automaticamente (comportamento atual de `findOrCreateTicket`); nada a mudar, só cobrir
  com teste.
- Envios pela `/api/v1` seguem como hoje (ticket `open`).
- O super-admin continua podendo entrar na empresa pelo painel para olhar conversas. O painel **não** é travado
  para empresas de parceiro *(decisão do builder)*: se o super-admin criar filas, bot ou outras conexões ali, é
  responsabilidade dele. A API de parceiros sempre usa a **conexão padrão** (`isDefault`) da empresa; se não houver
  nenhuma conexão, cria. Se houver conexões mas nenhuma padrão, usa a de menor id.

### 6.7 Painel super-admin

- Nova tela **Parceiros** (link na sidebar do super-admin, ao lado de Empresas):
  - lista: nome, prefixo da chave, status, último uso, quantidade de empresas;
  - **Novo parceiro** (só nome) → diálogo mostrando a chave completa uma vez, com botão copiar e aviso
    "guarde agora; ela não será mostrada de novo";
  - por parceiro: **Regenerar chave** (confirmação; mostra a nova uma vez), **Revogar / Reativar**, editar nome.
- Rotas em `/api/admin/partners` (super-admin): `GET`, `POST`, `PUT /:id`, `POST /:id/regenerate-key`,
  `POST /:id/revoke`, `POST /:id/activate`.
- Tela **Empresas**: mostra o CNPJ (formatado) e o nome do parceiro de cada empresa quando houver.
- Criar/editar empresa no painel ganha campo **CNPJ opcional** (mesma validação; duplicado → 409 `CNPJ_IN_USE`)
  *(decisão do builder)*. Assim o super-admin pode registrar o CNPJ de um cliente que já usa o painel, e o
  parceiro recebe 409 em vez de criar uma empresa duplicada. Transferir empresa do painel para um parceiro fica
  fora deste escopo.
- Responsivo, no mesmo estilo da tela Empresas.

### 6.8 Guia de implementação — `docs/guia-integracao-parceiros.md`

Público: uma IA (ou dev) que vai implementar a integração num sistema qualquer, sem acesso a este repositório.
Deve ser autossuficiente:

1. Visão geral e os dois segredos (chave de parceiro × token de conexão), quem guarda cada um e onde.
2. Configuração: URL base, chave; armazenamento central cifrado; nunca no front-end.
3. Referência completa da API de parceiros e da `/api/v1` (todas as rotas, campos, exemplos de request/response,
   erros e o que o sistema deve fazer em cada um).
4. Fluxo da tela de configuração, estado a estado: não configurado → criando → aguardando QR (polling do QR a
   cada ~3 s e do status, parando ao conectar, com tempo limite) → conectado (número) → desconectado/trocar
   número → empresa bloqueada. Botão "Enviar mensagem de teste".
5. Envio de mensagens: normalização de número, texto, mídia por upload e por URL, tratamento de
   `CONNECTION_NOT_CONNECTED`, `NUMBER_NOT_ON_WHATSAPP`, `RATE_LIMITED` (respeitar `Retry-After`), retry com
   backoff só para 5xx/rede, log de cada envio.
6. Segurança: chamadas só do servidor, TLS, segredos cifrados, não logar segredos, permissões na tela.
7. Checklist de aceite (o que testar para dizer que a integração está pronta).
8. **Apêndice MultiComércio** (repositório `D:\PROJETOS\MULTICOMERCIO`, branch `main`, com nomes reais de
   classes/tabelas daquele código): ASP.NET Core MVC + Dapper + SQL Server, banco por tenant. Chave do parceiro e URL
   no **MultiMaster** (cifrada em AES como os segredos da Cora); token, id da conexão e status em tabela no banco
   do tenant; CNPJ = filial com `EhMatriz`; tela no padrão da configuração da Cora (botão Testar Conexão,
   permissões `MODULO.Recurso.Acao`, log de chamadas); onde plugar envio nos pontos que hoje usam `wa.me`
   (recibo, boleto, DAV do delivery) fica como sugestão, não obrigação.

O guia de integração existente (`docs/manual-integracao-api.md`) continua valendo para a `/api/v1`; o novo
guia pode referenciá-lo, mas precisa ser completo sozinho.

## 7. Restrições

- Mesma stack e padrões do backend: Express + zod + Sequelize, `AppError`, migrations numeradas em
  `database/migrations/index.ts`, testes de integração com Jest/supertest e `FakeProvider`.
- Novas tabelas entram no `TABLES` de `test/helpers/db.ts`.
- Deploy só com todos os testes verdes (gate existente).

## 8. Testes exigidos

- Auth: sem header 401; chave inválida, regenerada ou revogada 403; token de conexão e JWT não valem; chave de
  parceiro não vale na `/api/v1`.
- `POST /companies`: cria empresa + conexão + token (201) chamando `createInstance` uma vez; repetir devolve o
  mesmo token (200) sem nova instância; CNPJ formatado e cru resolvem a mesma empresa; CNPJ inválido 400; CNPJ
  alfanumérico válido aceito; CNPJ de outro parceiro e de empresa do painel → 409; empresa bloqueada → 200
  `blocked`; falha da Evolution → 502 e chamada seguinte completa; chamadas simultâneas → uma empresa e uma
  conexão.
- `GET` e `regenerate`: isolamento entre parceiros (404); token antigo para de valer na `/api/v1`.
- Empresa de parceiro: mensagem recebida não gera resposta automática.
- Admin: CRUD de parceiros só para super-admin; chave mostrada só na criação/regeneração; `GET` nunca devolve
  hash nem chave.
- Rate limit por parceiro.
- Frontend: tela Parceiros (criar mostra a chave uma vez; regenerar; revogar).

## 9. Deixado para o builder

- Nomes internos de arquivos/módulos (sugestão: `modules/partners/`), formato exato dos componentes React.
- Throttle do `lastUsedAt`.
- Texto exato das mensagens de erro (português, no tom das existentes).
