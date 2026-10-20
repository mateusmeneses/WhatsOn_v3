# Progresso do projeto

Estado em **20/10/2026** · versão **2026.10.20.2** · branch de trabalho `claude/trusting-knuth-wm4p0o`.

## Resumo

O núcleo de atendimento, as integrações (API externa e parceiros) e a camada de indicadores estão prontos e
cobertos por testes. A última entrega acrescentou o **Dashboard**, o **Meu desempenho**, a **Visão geral da
plataforma**, presença em tempo real e uma rodada de melhorias de experiência, acessibilidade e desempenho.

| Verificação | Resultado |
|---|---|
| Testes do backend (Jest) | 349 passando (36 suítes) |
| Testes do frontend (Vitest) | 196 passando (37 arquivos) |
| Build do frontend (`tsc` + Vite) | ok |
| Acessibilidade (axe-core, WCAG 2.1 AA) | 0 violações em 11 telas, diálogos e busca |
| Dashboard com 800 mil mensagens | 0,5 s (7 dias) a 2,6 s (90 dias), com cache de 20 s |

## Linha do tempo

| Data | Entrega |
|---|---|
| 13–14/10 | Especificação e plano do núcleo; backend e frontend do núcleo (tickets, filas, chatbot, conexões) |
| 15/10 | Envio de áudio, edição e exclusão de mensagens, agendamento, reabertura; deploy com gate de testes; homologação; Evolution API v2.3.7 |
| 16/10 | API externa `/api/v1` e página Integração API; painel super-admin (empresas); técnicos do atendimento |
| 17/10 | Permissões de visibilidade, assinatura, histórico do atendimento, soft delete de contatos; versionamento `yyyy.MM.dd.N` |
| 19/10 | Requerer atendimento com recado interno; parceiros (CNPJ, API `/api/partner/v1`, tela Parceiros) |
| 20/10 | Mensagens da API não abrem atendimento; **Dashboard e melhorias** (abaixo) |

## Entrega de 20/10 — indicadores e experiência

**Indicadores**
- [x] Dashboard (`/dashboard`, administrador e supervisor): situação ao vivo, KPIs com comparação ao período
  anterior, tempo de resposta (mediana/média/no prazo), espera até aceitar, resolução, mensagens por dia, mapa de
  calor, equipe e presença, mensagens mais demoradas, clientes aguardando, clientes mais ativos, movimentação,
  bot, conexões e exportação CSV
- [x] Meu desempenho (`/meu-desempenho`, todos): números pessoais comparados à equipe
- [x] Visão geral da plataforma (`/visao-geral`, super-admin): empresas, uso, conexões, parceiros e presença
- [x] Presença em tempo real (Socket.io) e campos `lastLoginAt`/`lastSeenAt`
- [x] Meta de primeira resposta configurável por empresa (1–240 min, padrão 5)
- [x] Documentação das métricas: [docs/dashboard.md](docs/dashboard.md)

**Experiência**
- [x] Novo menu lateral (rótulos, grupos, recolhível, usuário logado) e componentes refinados na identidade da marca
- [x] Filas, Conexões e Contatos com dados ao vivo; atalhos do dashboard para a aba certa do Atendimento
- [x] Contador de aguardando no menu, não lidas no título da aba e tempo de espera na lista
- [x] Busca rápida `Ctrl+K` e aviso sonoro opcional
- [x] Acessibilidade: contraste AA, abas por teclado, link "Ir para o conteúdo", gráficos com visão em tabela

**Desempenho**
- [x] Tempo de resposta em uma única passada com função de janela (antes: 3 varreduras + 1 busca por mensagem)
- [x] Migrations `0011` (presença e índices por período), `0012` (meta de resposta) e `0013` (índices de cobertura)
- [x] Cache de 20 s com deduplicação nos painéis pesados

## Migrations desta entrega

| # | Conteúdo |
|---|---|
| 0011 | `users.lastLoginAt`, `users.lastSeenAt` e índices por período em tickets, mensagens e eventos |
| 0012 | `companies.responseSlaMinutes` (padrão 5) |
| 0013 | Índices `messages(companyId, ticketId, createdAt, id)`, `messages(connectionId, createdAt)` e `tickets(contactId)` |

Rodam sozinhas na subida do backend.

## Decisões e observações

- Os números de tempo de resposta usam a **mediana** como destaque, para uma mensagem noturna não distorcer a média.
- Rodadas respondidas pelo bot não contam como resposta humana; rodadas sem resposta aparecem em "cliente aguardando".
- O tempo de espera na lista de aguardando conta desde a última mensagem registrada, o que coincide com a espera
  real na prática, mas não considera uma eventual resposta de atendente anterior.
- Os painéis podem mostrar dados até 20 s defasados (cache); o auto-refresh é de 30 s.
- Os testes do dashboard usam dados controlados; os prints de validação usaram dados de demonstração criados só no
  ambiente de desenvolvimento (nada disso está no repositório).
- Ainda não validado com WhatsApp real nesta rodada (a Evolution API não estava disponível no ambiente de
  desenvolvimento); o roteiro está em [docs/smoke-test.md](docs/smoke-test.md).

## Próximos passos sugeridos

- [ ] Conferir o Dashboard na base real e ajustar a meta de resposta de cada empresa
- [ ] Notificação do navegador (canto da tela) para quando o sistema está em segundo plano
- [ ] Modo escuro
- [ ] Teste com leitor de tela e revisão de acessibilidade do chat (áudio e anexos)
- [ ] Se empresas muito grandes passarem de ~3 s no Dashboard de 90 dias: pré-calcular o tempo de resposta
  na gravação da mensagem (exige preencher o histórico)
- [ ] Roteiro de ponta a ponta com a Evolution API real após o deploy

## Fora de escopo (decisão original)

Campanhas e disparo em massa, API oficial da Meta, atendimento de grupos, integrações de terceiros (Typebot, n8n,
Dify, OpenAI, Dialogflow) e testes E2E. A interface `WhatsAppProvider` permite evoluir depois.
