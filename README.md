# WhatsOn — Gerenciador de Atendimento

Sistema multiempresa de atendimento por WhatsApp: várias conversas, filas por setor, equipe com permissões,
chatbot de menu e indicadores para acompanhar a operação. O WhatsApp é acessado pela
[Evolution API](https://github.com/EvolutionAPI/evolution-api) (serviço separado); o backend não fala o protocolo
do WhatsApp.

## O que o sistema faz

**Atendimento**
- Lista de atendimentos por situação (aguardando, em atendimento, finalizados, bot) com tempo de espera de cada
  cliente, contador no menu e mensagens não lidas no título da aba.
- Chat completo: texto, imagem, áudio, vídeo e documento; edição e exclusão de mensagens; mensagens agendadas;
  assinatura do atendente; transferir para fila ou atendente; requerer atendimento de outro técnico com recado
  interno; finalizar (com ou sem mensagem de encerramento); reabrir; histórico com a linha do tempo.
- Encerramento automático por inatividade: em Configurações, tempo sem resposta do cliente (0 = desligado) e a
  mensagem enviada ao finalizar.
- Busca rápida (`Ctrl+K`) por páginas e conversas, e aviso sonoro opcional.

**Gestão**
- Filas com horário de expediente, mostrando equipe, fila de espera e se estão abertas agora.
- Usuários (administrador, supervisor, atendente) com permissões de visibilidade, vínculo com filas e presença
  (online / visto há…).
- Conexões WhatsApp por QR code, com o movimento do dia de cada número.
- Chatbot de menu numérico em árvore, com simulador, transferência por fila/atendente e tempo limite.
- Contatos com histórico (atendimentos e último contato).

**Indicadores**
- **Dashboard** (administrador e supervisor): situação ao vivo, atendimentos, tempo de resposta (mediana, média e
  % no prazo), espera até aceitar, tempo de resolução, mensagens por dia, mapa de calor de horários, equipe e
  presença, mensagens mais demoradas, clientes aguardando, clientes mais ativos, movimentação, bot e conexões, com
  comparação ao período anterior e exportação em CSV.
- **Meu desempenho** (todos): os próprios números, comparados à equipe.
- **Visão geral da plataforma** (super-admin): empresas, uso, conexões, parceiros e quem está online.
- Como cada número é calculado: [docs/dashboard.md](docs/dashboard.md).

**Plataforma e integrações**
- Painel do super-admin: empresas (criar, bloquear, entrar) e parceiros.
- API externa (`/api/v1`, token por conexão) e API de parceiros (`/api/partner/v1`) — veja [docs](#documentação).

## Perfis

| Perfil | Acessa |
|---|---|
| Atendente | Atendimento (filas e permissões dadas pelo admin), Contatos, Meu desempenho |
| Supervisor | Tudo do atendente + todos os atendimentos, Dashboard, Usuários (consulta) |
| Administrador | Tudo da empresa: Filas, Usuários, Conexões, Chatbot, Integração API, Configurações |
| Super-admin | Painel da plataforma: Visão geral, Empresas, Parceiros (e pode entrar em qualquer empresa) |

## Arquitetura

```
frontend (React + Vite + Tailwind)  ──►  backend (Node.js + Express)  ──►  PostgreSQL
        ▲ Socket.io (tempo real)               │  BullMQ + Redis (filas)
        └──────────────────────────────────────┤
                                                └──►  Evolution API (WhatsApp)
```

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 24, TypeScript, Express, Sequelize 6, Postgres 16, BullMQ/Redis 7, Socket.io, Zod, pino |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Query, Zustand, Radix Dialog, gráficos SVG próprios |
| WhatsApp | Evolution API v2.3.7 (conexão por QR code) |
| Testes | Jest + Supertest (backend), Vitest + Testing Library (frontend) |
| Infra | Docker Compose: `postgres`, `redis`, `evolution`, `backend`, `frontend` (Nginx) |

```
backend/    API, workers, modelos e migrations (src/modules/*)
frontend/   Aplicação web (src/features/*, src/components/*)
docker/     Inicialização do Postgres
docs/       Documentação (contratos, integrações, specs e planos)
scripts/    Deploy com gate de testes
img/        Logomarca e favicon
```

## Como rodar

### Com Docker (tudo junto)

```bash
cp .env.example .env     # troque as chaves e senhas antes de usar em produção
docker compose up -d --build
```

- Frontend: http://localhost:3000 · API: http://localhost:4000 · Evolution: http://127.0.0.1:8080
- Primeiro acesso: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` do `.env` (a senha padrão é só para testes).
  Para ter o painel da plataforma, preencha `SUPERADMIN_EMAIL` e `SUPERADMIN_PASSWORD` (mín. 8 caracteres).
- Fila de jobs (Bull Board): `/admin/queues` no backend (usuário/senha em `BULL_BOARD_USER` / `BULL_BOARD_PASS`).
- Roteiro para conectar um número e testar de ponta a ponta: [docs/smoke-test.md](docs/smoke-test.md).

### Desenvolvimento

Suba só a infraestrutura e rode backend e frontend localmente:

```bash
docker compose up -d postgres redis evolution

cd backend && cp .env.example .env && npm ci && npm run migrate && npm run dev      # http://localhost:4000
cd frontend && npm ci && npm run dev                                                 # http://localhost:5173
```

O Vite encaminha `/api`, `/media` e `/socket.io` para o backend. As migrations rodam sozinhas na subida do backend
(`npm run migrate` aplica manualmente).

### Testes

```bash
cd backend  && npm test            # Jest (precisa de Postgres em :5433 e Redis em :6380; ver backend/.env.test)
cd frontend && npm test            # Vitest
cd frontend && npm run build       # typecheck + build de produção
```

## Versão e deploy

A versão segue `yyyy.MM.dd.N` (fonte: `version.txt`) e aparece no rodapé, na tela de login e em
`GET /api/version`. As novidades ficam em `frontend/public/changelog.json` (mantendo as 3 versões mais recentes).

```bash
bash scripts/deploy.sh 1               # Linux/macOS: roda todos os testes e só então sobe os containers
powershell -File scripts\deploy.ps1    # Windows (idem)
powershell -File scripts\deploy-hml.ps1  # homologação
```

## Documentação

| Documento | Assunto |
|---|---|
| [docs/dashboard.md](docs/dashboard.md) | Indicadores: endpoints, definições e desempenho |
| [docs/realtime-contract.md](docs/realtime-contract.md) | Eventos de tempo real (Socket.io) |
| [docs/api-externa.md](docs/api-externa.md) · [docs/manual-integracao-api.md](docs/manual-integracao-api.md) | API externa por token de conexão |
| [docs/guia-integracao-parceiros.md](docs/guia-integracao-parceiros.md) | Sistemas parceiros (criam empresas e conexões) |
| [docs/smoke-test.md](docs/smoke-test.md) | Teste de ponta a ponta com a Evolution API real |
| [docs/superpowers/specs](docs/superpowers/specs) · [plans](docs/superpowers/plans) | Especificações e planos de implementação |
| [progresso.md](progresso.md) | Estado do projeto, histórico e próximos passos |

## Identidade visual

Logomarca em `img/` e `frontend/src/assets/brand`; fonte Inter; cores: azul `#0a6ad6`, azul-marinho `#0a3f9a`,
verde `#0e9f45` e noite `#06142e`. Os tokens estão em `frontend/src/index.css` e `frontend/tailwind.config.ts`.
