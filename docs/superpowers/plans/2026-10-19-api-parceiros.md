# API de Parceiros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistemas parceiros (ERP MultiComércio e outros) criam, por chave de parceiro, empresa + conexão + token no Whatson pelo CNPJ e depois usam a `/api/v1` existente.

**Architecture:** Novo módulo `backend/src/modules/partners/` com (a) CRUD de parceiros para o super-admin em `/api/admin/partners` e (b) API máquina-a-máquina `/api/partner/v1` autenticada por chave (SHA-256 no banco). Empresas ganham `cnpj` único e `partnerId`. Frontend ganha a tela Parceiros e CNPJ em Empresas. Guia Markdown para IA no fim.

**Tech Stack:** Express + zod + Sequelize (sequelize-typescript) + Postgres + Redis; Jest/supertest + FakeProvider; React + TanStack Query + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-19-api-parceiros-design.md`

## Global Constraints

- Chave: `wpk_` + 48 hex (`randomBytes(24)`), gravada só como SHA-256 hex em `partners.keyHash`; `keyPrefix` = primeiros 12 caracteres.
- Chave mostrada só na criação e na regeneração; nenhuma outra resposta devolve chave nem hash.
- CNPJ normalizado: remove tudo fora de `[0-9A-Za-z]`, maiúsculo, 14 caracteres, DV módulo 11 com valor = ASCII − 48; rejeita caractere único repetido. Erro `INVALID_CNPJ` (400).
- Rate limit da API de parceiros: `PARTNER_API_RATE_LIMIT`, padrão 60/min, por parceiro.
- Conexão criada pelo parceiro: nome `"WhatsApp"`, padrão, sem fila, sem bot.
- Erros no formato `{ error: { code, message } }`, mensagens em português.
- Toda tabela nova entra em `TABLES` de `backend/test/helpers/db.ts`.

## Review Focus

- Mesmo CNPJ formatado e cru (`12.345.678/0001-95` × `12345678000195`) → mesma empresa. Teste na Task 3.
- Duas chamadas `POST /companies` simultâneas com o mesmo CNPJ → 1 empresa, 1 conexão, 1 `createInstance`. Teste na Task 3.
- Chave regenerada: a antiga recebe 403 na hora. Teste na Task 3.
- Token antigo após `POST /:cnpj/api-token` → 403 na `/api/v1`. Teste na Task 3.
- CNPJ informado no painel e depois enviado por parceiro → 409 sem vazar dados. Teste na Task 3.

---

### Task 1: Dados — migration, modelos, CNPJ

**Files:**
- Create: `backend/src/database/migrations/0010-partners.ts`, `backend/src/models/Partner.ts`, `backend/src/shared/cnpj.ts`
- Modify: `backend/src/database/migrations/index.ts`, `backend/src/models/Company.ts`, `backend/src/models/index.ts`, `backend/test/helpers/db.ts`
- Test: `backend/test/unit/cnpj.test.ts`

**Interfaces:**
- Produces: `normalizeCnpj(raw: string): string` (lança `AppError("INVALID_CNPJ", 400)`); `formatCnpj(cnpj: string): string` (`12.345.678/0001-95`); model `Partner { id, name, keyHash, keyPrefix, status: "active" | "revoked", lastUsedAt: Date | null }`; `Company` com `cnpj: string | null`, `partnerId: number | null`, `contactEmail: string | null`, `contactPhone: string | null`.

- [ ] **Step 1: Teste unitário** — `normalizeCnpj("12.345.678/0001-95") === "12345678000195"`; `normalizeCnpj("12ABC34501DE35")` aceito (CNPJ alfanumérico de exemplo da Receita: `12.ABC.345/01DE-35`); `"12345678000196"`, `"11111111111111"`, `"123"` lançam `INVALID_CNPJ`; minúsculas viram maiúsculas.
- [ ] **Step 2:** `npx jest test/unit/cnpj.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `cnpj.ts`. DV: pesos `5,4,3,2,9,8,7,6,5,4,3,2` (1º) e `6,5,4,3,2,9,8,7,6,5,4,3,2` (2º); resto <2 → 0, senão 11−resto; DVs têm de ser dígitos.
- [ ] **Step 4:** Migration `0010-partners`: cria `partners` (colunas do spec §6.1, índice único em `keyHash`); `companies` add `cnpj` STRING(14) null unique, `partnerId` INTEGER null FK `partners` `ON DELETE RESTRICT`, `contactEmail`, `contactPhone` STRING null. `down` desfaz. Registrar no índice, modelo `Partner`, campos em `Company` (`@ForeignKey`/`@BelongsTo(() => Partner)`), `partners` em `TABLES` (antes de `companies`).
- [ ] **Step 5:** `npx jest test/unit/cnpj.test.ts` PASS e `npm run typecheck` limpo.
- [ ] **Step 6:** Commit `feat(parceiros): tabela de parceiros, CNPJ e parceiro na empresa`.

### Task 2: Parceiros no admin + CNPJ no painel

**Files:**
- Create: `backend/src/modules/partners/partners.service.ts`, `backend/src/modules/partners/partnerKey.ts`
- Modify: `backend/src/modules/admin/admin.routes.ts`, `backend/src/modules/admin/admin.service.ts`
- Test: `backend/test/integration/partnersAdmin.test.ts` (+ casos de CNPJ em `superAdmin.test.ts`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `generatePartnerKey(): { key: string; keyHash: string; keyPrefix: string }`, `hashPartnerKey(key: string): string` em `partnerKey.ts`.
  - `PartnerView { id, name, keyPrefix, status, lastUsedAt, createdAt, companyCount }`.
  - `listPartners(): Promise<PartnerView[]>`, `createPartner(name): Promise<{ partner: PartnerView; key: string }>`, `updatePartner(id, { name })`, `regeneratePartnerKey(id): Promise<{ partner: PartnerView; key: string }>`, `setPartnerStatus(id, "active" | "revoked"): Promise<PartnerView>`.
  - Rotas: `GET/POST /api/admin/partners`, `PUT /api/admin/partners/:id`, `POST /:id/regenerate-key`, `POST /:id/revoke`, `POST /:id/activate`.
  - `CompanyView` ganha `cnpj: string | null`, `partner: { id: number; name: string } | null`; `createSchema`/`updateSchema` do admin ganham `cnpj` opcional (string; vazia ou `null` limpa) normalizado por `normalizeCnpj`; duplicado → `AppError("CNPJ_IN_USE", 409, "CNPJ já cadastrado em outra empresa")`.

- [ ] **Step 1: Testes** — super-admin cria parceiro → 201 com `key` casando `/^wpk_[0-9a-f]{48}$/` e `partner.keyPrefix === key.slice(0, 12)`; `GET` lista sem `key` nem `keyHash` (assert no JSON serializado); regenerar muda `keyPrefix`; revoke/activate alternam `status`; usuário admin de empresa → 403; `companyCount` conta empresas do parceiro. Empresas: criar com `cnpj: "12.345.678/0001-95"` grava `12345678000195` e lista com `cnpj`; segundo com mesmo CNPJ → 409 `CNPJ_IN_USE`; CNPJ inválido → 400 `INVALID_CNPJ`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. Rotas de parceiro no `adminRoutes` existente (já protegido por `requireSuperAdmin`). Tratar `UniqueConstraintError` em `cnpj` distinguindo do de e-mail pelo campo (`err.fields`).
- [ ] **Step 4:** `npx jest test/integration/partnersAdmin.test.ts test/integration/superAdmin.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(parceiros): cadastro de parceiros e CNPJ das empresas no painel super-admin`.

### Task 3: API de parceiros `/api/partner/v1`

**Files:**
- Create: `backend/src/modules/partners/partnerKey.middleware.ts`, `backend/src/modules/partners/partnerApi.routes.ts`, `backend/src/modules/partners/partnerApi.service.ts`
- Modify: `backend/src/app.ts` (montar antes de `/api`), `backend/src/config/env.ts` (`PARTNER_API_RATE_LIMIT`), `backend/src/modules/externalApi/rateLimit.ts` (generalizar), `backend/src/types/express.d.ts` ou equivalente (`req.partner`), `.env.example` e `backend/.env.example`
- Test: `backend/test/integration/partnerApi.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`hashPartnerKey`, `normalizeCnpj`), `createConnection`, `generateApiToken`, `regenerateConnectionApiToken` de `connections.service.ts`.
- Produces:
  - `partnerKeyAuth` middleware (`Bearer`, ausente → 401 `UNAUTHENTICATED`; hash não encontrado ou `revoked` → 403 `INVALID_PARTNER_KEY`; atualiza `lastUsedAt` se nulo ou > 60 s).
  - `rateLimitBy(prefix: string, idOf: (req) => number | undefined, limit: number)`; `rateLimitByConnection` vira wrapper dele (comportamento e testes atuais intactos). Chave Redis `partnerapi:rl:<partnerId>:<janela>`.
  - `PartnerCompany` = JSON do spec §6.4.
  - `upsertPartnerCompany(partner, input): Promise<{ created: boolean; result: PartnerCompany }>`, `getPartnerCompany(partner, cnpj)`, `regeneratePartnerCompanyToken(partner, cnpj)`.

- [ ] **Step 1: Testes** (FakeProvider, `beforeEach` como `externalApi.test.ts`):
  - auth: sem header 401; chave aleatória 403 `INVALID_PARTNER_KEY`; chave antiga após regenerar 403; parceiro revogado 403; token de conexão e JWT 403; chave de parceiro em `/api/v1/connection/status` → 403 `INVALID_API_TOKEN`.
  - `POST /companies` novo → 201, `company.cnpj === "12345678000195"`, `company.status === "active"`, `connection.status === "qrcode"`, `apiToken` 64 hex, `fake.instances.size === 1`, empresa com `partnerId` e conexão `isDefault`, nome = `tradeName`.
  - repetir com CNPJ formatado → 200, mesmo `apiToken`, `fake.instances.size === 1`; `name` novo atualiza a empresa.
  - `Promise.all` de 3 POST iguais → todos 2xx com mesmo `apiToken`; `Company.count() === 1`, `Connection.count() === 1`.
  - CNPJ de empresa do painel (criada com `cnpj`) ou de outro parceiro → 409 `CNPJ_IN_USE`, corpo sem `company`.
  - CNPJ inválido 400 `INVALID_CNPJ`; sem `name` 400 `VALIDATION_ERROR`.
  - `fake.failNext("createInstance")` → 502; empresa existe sem conexão; POST seguinte → 200 com conexão e token.
  - empresa bloqueada → POST 200 `company.status === "blocked"`; `POST /:cnpj/api-token` → 403 `COMPANY_BLOCKED`.
  - `GET /companies/:cnpj` (formatado na URL codificada ou cru) → 200 mesmo token; de outro parceiro → 404.
  - `POST /companies/:cnpj/api-token` → token novo; antigo em `/api/v1/connection/status` → 403; novo → 200.
  - rate limit: com `rateLimitBy` montado em app de teste com limite 2 (padrão do `externalApi.test.ts`), 3ª chamada → 429 com `Retry-After`.
  - inbound: mensagem de texto recebida na conexão da empresa do parceiro (via `handleInboundEvent` + fixture `textMessage`) → ticket `pending`, `fake.sent.length === 0`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. Upsert: `findOrCreate` não; fazer `Company.findOne({ where: { cnpj } })` → se ausente `Company.create` capturando `UniqueConstraintError` e relendo; depois, numa transação, `Company.findByPk(id, { lock: true })` e escolher conexão (`isDefault` desc, `id` asc); sem conexão → `createConnection(companyId, { name: "WhatsApp", isDefault: true })` **dentro** do lock (a chamada à Evolution fica no lock; aceitável: só concorre o mesmo CNPJ); sem token → `generateApiToken()`. Status 201 só quando a empresa foi criada nesta chamada.
- [ ] **Step 4:** `npx jest test/integration/partnerApi.test.ts test/integration/externalApi.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(parceiros): API /api/partner/v1 para criar empresa, conexão e token pelo CNPJ`.

### Task 4: Frontend — tela Parceiros e CNPJ em Empresas

**Files:**
- Create: `frontend/src/features/admin/PartnersPage.tsx`, `frontend/src/features/admin/PartnerKeyDialog.tsx`, `frontend/src/features/admin/PartnersPage.test.tsx`
- Modify: `frontend/src/features/admin/adminApi.ts`, `frontend/src/types/api.ts`, `frontend/src/app/routes.tsx`, `frontend/src/features/admin/AdminShell.tsx` (link "Parceiros"), `frontend/src/features/admin/CompaniesPage.tsx`, `frontend/src/features/admin/CompanyDialog.tsx`

**Interfaces:**
- Consumes: rotas da Task 2.
- Produces: tipos `AdminPartner` (= `PartnerView`), `AdminCompany` com `cnpj` e `partner`; funções `fetchPartners`, `createPartner(name)`, `updatePartner(id, name)`, `regeneratePartnerKey(id)`, `setPartnerStatus(id, revoked: boolean)`; rota `/admin/partners`.

- [ ] **Step 1: Testes** (padrão de `CompaniesPage.test.tsx`): lista parceiros com prefixo e status; "Novo parceiro" → diálogo mostra a chave completa e o aviso "Guarde agora"; "Regenerar chave" pede confirmação e mostra a nova; "Revogar" chama a rota. Empresas: coluna CNPJ formatado e nome do parceiro; diálogo envia `cnpj`.
- [ ] **Step 2:** `npx vitest run src/features/admin` (ou o runner do projeto) → FAIL.
- [ ] **Step 3:** Implementar no estilo da tela Empresas (responsiva, mesmos componentes).
- [ ] **Step 4:** testes PASS + `npm run typecheck` / build do frontend limpos.
- [ ] **Step 5:** Commit `feat(parceiros): tela Parceiros e CNPJ na tela Empresas`.

### Task 5: Guia de integração para IA

**Files:**
- Create: `docs/guia-integracao-parceiros.md`
- Modify: `docs/api-externa.md` (link para o guia no topo)

**Interfaces:**
- Consumes: contratos finais das Tasks 2–3 e `/api/v1` (`docs/api-externa.md`, `backend/src/modules/externalApi/`).

- [ ] **Step 1:** Escrever o guia cobrindo os 8 itens do spec §6.8, com exemplos `curl` reais e respostas JSON idênticas às dos testes; apêndice MultiComércio verificado em `D:\PROJETOS\MULTICOMERCIO` (`main`): MultiMaster, cifra AES da Cora, `FilialCadastro`/`EhMatriz`, `RequirePermission`, padrão de tela/serviço da Cora.
- [ ] **Step 2:** Conferir cada rota, campo e código de erro do guia contra o código (grep dos `code` em `partners/` e `externalApi/`).
- [ ] **Step 3:** Commit `docs(parceiros): guia de integração para sistemas parceiros`.

### Task 6: Verificação final

- [ ] `cd backend && npm test` e `npm run typecheck`; `cd frontend && npm test` e build — tudo verde.
- [ ] Smoke local: criar parceiro no painel, `curl POST /api/partner/v1/companies`, `GET /api/v1/connection/qrcode` com o token devolvido.
