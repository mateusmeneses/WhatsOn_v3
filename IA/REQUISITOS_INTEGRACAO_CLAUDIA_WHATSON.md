# Requisitos de integração: Claudia (suporte N1) × WhatsOn

**Para:** programador / equipe de desenvolvimento do WhatsOn (Connect Tecnologia)
**Ambiente citado:** https://hmlwhatson.connectmulti.com.br (homologação; versão observada v2026.10.27.1)
**Solicitante:** Whatyson Almeida
**Data:** 28/10/2026
**Substitui/amplia:** `ESPECIFICACAO_WEBHOOK_WHATSON.md` (23/10/2026). Este documento consolida o webhook e a API daquele arquivo e acrescenta novos pedidos. Onde houver diferença, vale este.

> **Segurança:** este documento não contém senhas, tokens nem dados de clientes. Telefones e nomes dos exemplos são fictícios. Credenciais devem ser trocadas por canal seguro, nunca por e-mail, chat ou neste arquivo.

---

## 1. Contexto e objetivo

A **Claudia** é a agente de suporte N1 que atende pelo WhatsOn com o usuário CLAUDIA. Hoje ela só consegue trabalhar **pelo navegador**, acionada de duas formas:

- **Rotina por horário:** a cada 30 min em dias úteis (6:30 às 20:00) e a cada 1 h nos fins de semana.
- **Webhook:** aviso do WhatsOn quando algo acontece (versão simples, já em uso).

Cada execução abre o painel, lê telas, clica e digita. Isso é:

| Problema | Consequência |
|---|---|
| **Caro** | Cada execução com navegador consome muito processamento, mesmo quando "não há nada a fazer". Nos logs de 26 e 27/10 houve cerca de **105 e 113 execuções por aviso** em cada dia, muitas só para concluir "nada a fazer". |
| **Frágil** | Depende de tela, de clique e de rascunho do painel. Um erro de tela vira erro com o cliente. |
| **Lento** | Cada leitura e cada ação leva segundos a minutos. |

**Objetivo:** a Claudia passar a **ler e agir por API**, acionada por **webhook completo e só de eventos acionáveis**, e usar o navegador só como contingência. Resultado esperado: menos execuções, menos erros, respostas mais rápidas, nenhuma mistura entre conversas.

---

## 2. Problemas observados (motivação)

Casos reais de 19 a 28/10/2026, anonimizados.

| # | Problema | Exemplo observado | Impacto | Resolvido por |
|---|---|---|---|---|
| 1 | **Rascunho de uma conversa aparece na caixa de outra** | Ao aceitar a conversa B, a caixa de texto já trazia o texto escrito para a conversa A. Ele saiu junto com a saudação em B, com nome, final de telefone e problema do cliente A. A mensagem foi apagada logo depois, mas **dado de um cliente chegou a outro**. | **Vazamento de dados (LGPD).** Crítico. | 3.5, 4, 6.1 |
| 2 | **Execuções simultâneas no mesmo navegador** | Dois avisos juntos fizeram a tela pular entre conversas. Em outro caso, um aviso interno saiu digitado na **caixa de busca** da lista e não chegou ao destinatário. | Mensagem errada ou perdida | 3 (API sem tela) |
| 3 | **Avisos de "conexão caiu/voltou" sem ação possível** | Em um dia, 4 a 5 quedas curtas (segundos a poucos minutos) entre ~19h e ~22h30, todas recuperadas sozinhas. Cada uma acordava uma execução completa. A faixa "Reconectando ao servidor..." também aparece em telas já abertas. | Custo sem benefício | 4.3 |
| 4 | **Robô de pedidos de terceiros reabrindo conversas** | O número de um cliente que usa um robô de cardápio/promoção (Anota AI) manda disparos automáticos (cardápio, links, "4") que passam pelo menu do WhatsOn, reabrem a conversa várias vezes e chegam a "Falar com atendente". | Técnico chamado à toa; execuções repetidas | 3.9, 6.5 |
| 5 | **Sessão expirando** | Redirecionamento para `/login` no meio do dia; em outra ocasião a aba ficou em outro sistema com sessão expirada. | Falha de atendimento até alguém notar | 3.1 (token) |
| 6 | **Assinatura "Claudia:" inconsistente** | Com "Assinar mensagens" ligado, algumas bolhas saíram sem assinatura. Outras saíram sem assinatura por operador humano em outra sessão, e não dá para distinguir de quem veio. | Cliente sem saber quem fala; log ambíguo | 3.4, 6.2 |
| 7 | **Alertas duplicados do mesmo evento** | `conversa_aguardando` e `mensagem_pos_finalizacao` para a mesma conversa no mesmo minuto; reenvio do mesmo marco de 10/20 min. | Execuções redundantes | 4.4 |
| 8 | **Conversa reaberta finaliza sozinha por temporizador antigo** | Conversa reaberta foi finalizada por inatividade pouco depois, com mensagem automática, como se o contador anterior continuasse. | Cliente encerrado sem querer | 6.4 |
| 9 | **Bot do menu responde "Opção inválida" a mensagens automáticas e a comprovantes** | Clientes respondendo ao lembrete automático de fatura ("já paguei", PDF de comprovante) ficaram presos na aba Bot, sem ir para Financeiro. Mensagens automáticas de outros sistemas também recebem "Opção inválida". | Cliente sem atendimento por tempo indeterminado | 4.2, 6.5 |
| 10 | **Relógio do painel 1 h atrasado** | Em 24/10 o horário exibido estava 1 h abaixo do real. | Cálculo errado de 10/20 min e de faixa de horário | 4.6, 6.3 |
| 11 | **Cliente sem identificação na conversa** | Cabeçalho sem empresa; a Claudia precisa pedir empresa/CNPJ e o sistema usado. A nova função de mostrar empresa/contrato/software ajuda, mas só aparece na tela. | Perguntas desnecessárias; mais mensagens | 3.2, 5 |
| 12 | **Avisos de pagamento registrado e de OS** | Avisos automáticos entram como "mensagem nova" e acordam a rotina. | Execuções sem ação | 4.3 |

---

## 3. API REST

### 3.1 Regras gerais

| Item | Pedido |
|---|---|
| Base URL | `https://<host>/api/v1` (homologação e produção separadas; ver seção 8) |
| Autenticação | **Token próprio da Claudia** (`Authorization: Bearer <token>`), revogável, com expiração e rotação. **Não** usar a senha do painel nem sessão de navegador. |
| Permissões (escopos) | Somente atendimento: `conversas:ler`, `mensagens:ler`, `mensagens:enviar`, `conversas:aceitar`, `conversas:transferir`, `conversas:finalizar`, `observacoes:escrever`, `atendentes:ler`, `contatos:bloquear`. **Sem** acesso a administração, usuários, filas, configurações, relatórios financeiros. |
| Visibilidade | A Claudia vê conversas de **todas** as filas (perfil supervisor), mas só **age** (envia, finaliza, transfere) em conversa **sem atendente** ou **atribuída a ela**. O servidor deve **recusar com 409** envio em conversa com técnico humano. |
| Idempotência | Todo `POST`/`PUT` aceita `Idempotency-Key` (UUID). Repetição com a mesma chave devolve a resposta original, sem repetir a ação. Validade 24 h. |
| Rate limit | Pedir limite documentado (sugestão: 60 req/min por token) e cabeçalhos `X-RateLimit-Remaining` e `Retry-After`. |
| Formato | JSON UTF-8; datas ISO 8601 **com fuso** (`-03:00`); IDs de conversa numéricos como no painel. |
| Erros | `{"erro": {"codigo": "conversa_com_atendente", "mensagem": "..."}}` com HTTP 400/401/403/404/409/422/429. |
| Log de auditoria | Toda chamada registrada no WhatsOn (token, endpoint, conversa, resultado) e consultável pelo administrador. |
| Versão | Prefixo `/v1`; mudanças que quebrem contrato só em `/v2`. |

### 3.2 Endpoints

| Método e caminho | Uso | Prioridade |
|---|---|---|
| `GET /conversas?status=&fila=&atendente=&desde=&pagina=` | Listar por aba/status (`bot`, `aguardando`, `atendendo`, `finalizado`) | P0 |
| `GET /conversas/{id}` | Detalhe: contato, empresa, contrato, software, atendente, fila, status, Observações, rascunho, temporizadores | P0 |
| `GET /conversas/{id}/mensagens?apos_id=&limite=` | Mensagens com paginação e anexos (links) | P0 |
| `POST /conversas/{id}/mensagens` | Enviar mensagem como Claudia | P0 |
| `POST /conversas/{id}/aceitar` | Assumir conversa (opcionalmente já com mensagem) | P0 |
| `POST /conversas/{id}/transferir` | Para atendente ou fila | P0 |
| `POST /conversas/{id}/finalizar` | Finalizar, com ou sem mensagem de encerramento | P0 |
| `GET /conversas/{id}/observacoes` · `POST` (acrescentar) | Resumo do caso para o técnico | P0 |
| `GET /atendentes?status=online,externo,ausente` | Quem está online, externo ou ausente, e quantas conversas tem | P0 |
| `POST /conversas/{id}/etiquetas` | Marcar (ex.: `financeiro`, `robo`, `spam`) | P1 |
| `POST /contatos/{telefone}/bloqueio` · `DELETE` | Lista de ignorar/robô | P1 |
| `POST /atendentes/{id}/mensagem-interna` | Aviso interno a um atendente (ex.: transferência sem aceite) sem passar pela conversa do cliente | P1 |
| `GET /contatos/{telefone}/historico` | Atendimentos anteriores do mesmo cliente (resumo, sem mensagens de outros clientes) | P1 |
| `GET /saude` | Estado da conexão com o WhatsApp e do tempo real | P1 |

### 3.3 Detalhe da conversa

`GET /conversas/386`

```json
{
  "id": 386,
  "status": "aguardando",
  "fila": "Suporte técnico",
  "menu_escolhido": ["1", "8", "4"],
  "atendente": null,
  "criada_em": "2026-10-28T09:14:02-03:00",
  "aguardando_desde": "2026-10-28T09:14:40-03:00",
  "contato": {
    "nome": "Contato Exemplo",
    "telefone_final": "1133",
    "cadastrado": true,
    "automatico": false
  },
  "empresa": {
    "nome": "Empresa Exemplo Ltda",
    "cnpj_mascarado": "12.345.***/****-90",
    "contrato": "ativo",
    "software": "Novo Multicomércio (Nuvem)"
  },
  "financeiro_em_aberto": null,
  "observacoes": "Texto atual das Observações...",
  "rascunho": null,
  "temporizadores": {
    "sem_aceite_desde": null,
    "inatividade_desde": null,
    "proximo_marco": null
  },
  "etiquetas": []
}
```

Notas:
- `telefone_final` (4 últimos dígitos) por padrão. O número completo só se o escopo `contatos:telefone_completo` for concedido, e só quando necessário para identificar o cliente.
- `financeiro_em_aberto` é `true`/`false`/`null`, sem valores (ver seção 5).

### 3.4 Mensagens e envio

`GET /conversas/386/mensagens?apos_id=9120&limite=20`

```json
{
  "mensagens": [
    {
      "id": 9121,
      "em": "2026-10-28T09:14:30-03:00",
      "origem": "cliente",
      "tipo": "texto",
      "texto": "Bom dia, como faço para emitir NF?",
      "anexos": [],
      "automatica": false
    },
    {
      "id": 9122,
      "em": "2026-10-28T09:14:35-03:00",
      "origem": "cliente",
      "tipo": "imagem",
      "texto": null,
      "anexos": [{"tipo": "imagem", "url": "https://.../anexo/abc", "expira_em": "2026-10-28T10:14:35-03:00"}],
      "automatica": false
    }
  ],
  "proxima_pagina": null
}
```

- `origem`: `cliente`, `bot`, `sistema` (OS, fatura, pagamento registrado, encerramento), `claudia`, `atendente`.
- `automatica: true` para mensagens de sistema e do bot, para a Claudia ignorá-las sem abrir a conversa.
- Links de anexo com **URL assinada e prazo curto**, acessíveis pelo token da Claudia.

`POST /conversas/386/mensagens` (header `Idempotency-Key: <uuid>`)

```json
{
  "texto": "Bom dia! Para emitir a nota:\n\n*Passo 1:* abra o pedido e clique em Confirmar.",
  "assinar": true
}
```

Resposta `201`:

```json
{"id": 9130, "em": "2026-10-28T09:15:02-03:00", "assinada": true, "status_envio": "enviada"}
```

Requisitos:
- `assinar` (true/false) é decidido **na requisição**; quando `true`, o servidor insere a assinatura "Claudia:" e o texto enviado **não** deve começar com ela. A resposta confirma `assinada`.
- Quebras de linha (`\n`) e `*negrito*`/`_itálico_` do padrão WhatsApp preservados.
- **Não** usar nem gravar rascunho: envio direto, sem tocar na caixa de texto de nenhum usuário.
- `409` se a conversa tiver atendente humano ativo (ver 3.1).
- `status_envio`: `enviada`, `entregue`, `lida`, `falhou` (consultável depois em `GET /mensagens`).

### 3.5 Ações de atendimento

`POST /conversas/386/aceitar`

```json
{"mensagem": {"texto": "Olá! Sou a Claudia, do suporte. Como posso ajudar?", "assinar": true}}
```
Aceita **e** responde numa única chamada atômica. `mensagem` é opcional.

`POST /conversas/386/transferir`

```json
{
  "para": {"tipo": "atendente", "id": 12},
  "observacao": "Resumo do caso (mesmo texto gravado em Observações).",
  "mensagem_cliente": {"texto": "Um técnico vai dar continuidade em instantes.", "assinar": true}
}
```
`para.tipo`: `atendente` ou `fila`. A Observação e a mensagem são gravadas/enviadas **antes** da troca, na mesma transação.

`POST /conversas/386/finalizar`

```json
{"enviar_mensagem_finalizacao": false, "motivo": "encerramento_pos_finalizacao"}
```
`enviar_mensagem_finalizacao=false` cobre o caso do cliente que só manda "👍" ou "obrigado" depois de já finalizado.

`POST /conversas/386/observacoes`

```json
{"texto": "Atualização 15:33: transferido porque o responsável saiu.", "modo": "acrescentar"}
```
`modo`: `acrescentar` (padrão, com data/hora e autor do servidor) ou `substituir`. Nunca apagar o que já existe sem `substituir` explícito. Histórico de versões das Observações.

### 3.6 Atendentes

`GET /atendentes?status=online`

```json
{
  "atendentes": [
    {"id": 12, "nome": "Técnico A", "status": "online", "externo": false, "conversas_em_atendimento": 1, "ultima_transferencia_recebida_em": "2026-10-28T08:19:00-03:00"},
    {"id": 13, "nome": "Técnico B", "status": "online", "externo": true, "conversas_em_atendimento": 0, "ultima_transferencia_recebida_em": null}
  ]
}
```
Hoje a distribuição é manual: "menos conversas, pulando externos, desempate por quem está há mais tempo sem receber". Esses campos permitem aplicar a regra sem abrir tela. **Pedido adicional:** endpoint `POST /conversas/{id}/transferir` com `"para": {"tipo": "automatico"}` para o servidor escolher pelo mesmo critério.

### 3.7 Bloqueio/ignorar contato (robôs)

`POST /contatos/5579XXXXXXXX/bloqueio`

```json
{"tipo": "robo", "motivo": "disparos automáticos de terceiros", "acao": "ignorar_menu"}
```
`acao`: `ignorar_menu` (não passar pelo menu do bot nem criar atendimento), `silenciar_webhook` (continua visível, mas sem webhook) ou `bloquear`. Reversível pelo administrador.

---

## 4. Webhook melhorado

Mantém tudo que já foi pedido em `ESPECIFICACAO_WEBHOOK_WHATSON.md` e muda o que está abaixo.

### 4.1 Eventos acionáveis apenas

| `evento` | Quando disparar | Prioridade |
|---|---|---|
| `conversa_aguardando` | Conversa nova entra em Aguardando (inclusive devolvida pelo bot) | P0 |
| `mensagem_cliente` | Mensagem **humana** do cliente em conversa **com a Claudia** ou **sem atendente** | P0 |
| `mensagem_pos_finalizacao` | Cliente escreve até 24 h após a finalização (com `apenas_reacao: true/false`) | P1 |
| `bot_parado` | Cliente 3 min no menu do bot sem avançar, ou mensagem que o bot não entendeu (texto livre, arquivo, áudio, comprovante) | P0 |
| `transferencia_sem_aceite` | 10 e 20 min sem aceite, **só em horário de técnicos** (ver 4.6) | P0 |
| `inatividade_cliente` | 15 e 30 min sem resposta em conversa com a Claudia | P1 |
| `conexao_prolongada` | Queda do WhatsApp ou do tempo real **maior que N min** (N configurável, sugestão 10) e `voltou` ao normalizar | P0 |
| `mensagem_numero_especial` | Mensagem nova de número da lista de "atenção" (ex.: coordenação) | P1 |

**Não** disparar: avisos de OS, lembretes e avisos de pagamento registrado enviados pelo sistema, encerramento automático, mensagens da própria Claudia ou de técnicos, e contatos marcados como `robo`/`silenciar_webhook`.

### 4.2 Payload completo

O corpo traz o necessário para a Claudia decidir **sem consultar nada antes** (ou sem abrir navegador). Texto de mensagem é permitido neste novo formato, porque o endpoint é autenticado por HMAC e a chamada é só da Claudia; se o time preferir, ofereça as duas opções por configuração (`incluir_texto: true/false`).

```json
{
  "evento": "mensagem_cliente",
  "id_evento": "6f1c2a9e-0b7d-4c1e-9a55-2f0d7e3b1c44",
  "tentativa": 1,
  "ocorrido_em": "2026-10-28T09:14:35-03:00",
  "ambiente": "homologacao",
  "conversa": {
    "id": 386,
    "status": "aguardando",
    "fila": "Suporte técnico",
    "menu_escolhido": ["1", "8", "4"],
    "atendente": null,
    "aguardando_desde": "2026-10-28T09:14:40-03:00"
  },
  "contato": {"nome": "Contato Exemplo", "telefone_final": "1133", "cadastrado": true, "automatico": false},
  "empresa": {"nome": "Empresa Exemplo Ltda", "contrato": "ativo", "software": "Novo Multicomércio (Nuvem)"},
  "mensagens_recentes": [
    {"id": 9121, "em": "2026-10-28T09:14:30-03:00", "origem": "cliente", "tipo": "texto", "texto": "Bom dia, como faço para emitir NF?", "anexos": 0}
  ],
  "faixa_horario": "tecnicos",
  "minutos_sem_aceite": null,
  "minutos_sem_resposta": null
}
```

`mensagens_recentes`: as últimas 1 a 5 mensagens desde o último evento da conversa. Anexos só como **quantidade e tipo**; links se buscam pela API.

### 4.3 Remover ruído

| Fonte | Pedido |
|---|---|
| Conexão caiu/voltou | Substituir pelo evento `conexao_prolongada` (4.1). Quedas curtas só no log do servidor. |
| Avisos de OS, fatura, pagamento registrado, encerramento automático | Marcar `automatica: true` e **não** disparar webhook. |
| Contatos `robo` | Não disparar; ver 3.7. |

### 4.4 Deduplicação e agrupamento

- `id_evento` único; reenvios usam o **mesmo** id e `tentativa` incrementado.
- **Um aviso por conversa por janela de 60 s:** o primeiro na hora e os demais agrupados em `mensagens_recentes` do mesmo evento.
- Não disparar `conversa_aguardando` e `mensagem_cliente` para a mesma conversa na mesma janela (enviar só o mais relevante, com lista `eventos`).
- Marcos de 10/20/15/30 min disparam **uma vez** por conversa e por marco.
- Rajada (mais de 5 eventos em 30 s): evento `lote` com a lista de conversas.

### 4.5 Segurança do webhook

| Item | Pedido |
|---|---|
| Assinatura | Cabeçalho `X-WhatsOn-Assinatura: sha256=<HMAC-SHA256 do corpo>` com segredo compartilhado (trocar por canal seguro) |
| Anti-replay | Cabeçalho `X-WhatsOn-Timestamp`; a Claudia rejeita eventos com mais de 5 min |
| Entrega | `2xx` = recebido. Reenvio com o mesmo `id_evento` após 30 s, 2 min, 10 min; depois desistir e registrar |
| Reentrega manual | Endpoint `GET /webhook/eventos?desde=` para a Claudia recuperar eventos perdidos (substitui parte da "rede de segurança" de 30 min) |

### 4.6 Temporizadores de 10/20 min calculados no servidor

Hoje a Claudia calcula o tempo olhando o relógio da tela (que já ficou 1 h atrasado) e o contador do cartão. Pedido:

- O **servidor** conta o tempo sem aceite desde a transferência e dispara `transferencia_sem_aceite` com `minutos_sem_aceite` = 10 e 20.
- Contar **somente em horário de técnicos: 8h–12h e 14h–17h30, dias úteis** (feriados pela tabela de feriados/plantão do WhatsOn). Fora disso, não contar.
- O marco é **cancelado** se algum técnico aceitar, responder ou se a conversa for finalizada/transferida de novo (reinicia).
- O mesmo vale para `inatividade_cliente` (15 e 30 min), com **reinício** ao reabrir a conversa (ver 6.4).
- Incluir `ocorrido_em` sempre com a hora real do servidor.

---

## 5. Acesso ao banco para consultas (somente leitura)

**Preferência:** expor os dados abaixo **pela API** (seção 3) ou por **views**. Acesso direto a tabelas só se não houver outra forma. Se for banco, a Claudia precisa só de consulta.

### 5.1 Dados necessários

| # | Dado | Para quê | Onde |
|---|---|---|---|
| 1 | Dados cadastrais do cliente: razão social/fantasia, CNPJ, contrato (ativo/suspenso/cancelado), **software em uso** (Novo Multicomércio Nuvem, Simples Comércio etc.) | Não pedir CNPJ/sistema de novo; escolher o roteiro certo | `vw_claudia_cliente` |
| 2 | Situação financeira em aberto: **sim/não** e **quantidade de dias em atraso em faixa** (ex.: `0`, `1-15`, `16+`), **sem valores, sem boletos, sem dados bancários** | Saber se o assunto é financeiro e como tratar | `vw_claudia_financeiro_resumo` |
| 3 | Histórico de atendimentos anteriores **do mesmo cliente**: data, fila, assunto/categoria, técnico, resultado | Continuar um caso sem perguntar tudo de novo | `vw_claudia_historico` |
| 4 | Status de OS/atendimentos no Manager: número, status, previsão, responsável | Responder "como está minha OS" sem abrir o Manager | `vw_claudia_os` |
| 5 | Atendentes e horários: quem trabalha em qual faixa, status (online/externo/ausente), fila, folgas e plantão | Distribuição e cálculo da faixa de horário | `vw_claudia_atendentes` |
| 6 | Consulta de estoque/produto | **Só se necessário** (hoje não é prioridade). Avaliar caso a caso, por cliente e somente leitura | a definir |

### 5.2 Exemplo de consulta (ilustrativa)

```sql
-- vw_claudia_cliente (colunas mínimas)
SELECT id_cliente, razao_social, cnpj, contrato_situacao, software_em_uso
FROM   vw_claudia_cliente
WHERE  telefone_hash = :hash_do_telefone;   -- busca por hash, não por número cru
```

A busca deve devolver **apenas o cliente do telefone/conversa informado**. Não deve haver listagem geral.

### 5.3 LGPD e cuidados

| Cuidado | Como |
|---|---|
| Somente leitura | Usuário dedicado (`claudia_ro`), `GRANT SELECT` apenas nas views. Sem acesso a tabelas, `INSERT`, `UPDATE`, `DELETE`, DDL ou procedures |
| Colunas mínimas | Só o que está na tabela 5.1; sem CPF, e-mail pessoal, endereço, valores, boletos, senhas, tokens, certificado |
| Isolamento entre clientes | Toda consulta **exige** um identificador do cliente da conversa; sem consulta por lista ou por texto livre. A Claudia **nunca** repassa dado de um cliente a outro |
| Log de acesso | Registrar usuário, consulta, parâmetros e data; relatório mensal ao administrador |
| Limites | Máximo de linhas por consulta (ex.: 50), timeout (ex.: 5 s), e IP de origem restrito |
| Rede/credenciais | Conexão por TLS, credencial entregue por canal seguro, rotação a cada 90 dias, **fora** de código e logs |
| Retenção | A Claudia não replica a base: consulta e usa na hora; resumo de caso guardado por até 6 meses (já é a regra atual) |
| Homologação primeiro | Testar em base de homologação com dados fictícios |

---

## 6. Ajustes de painel e UX

| # | Pedido | Motivo | Prioridade |
|---|---|---|---|
| 6.1 | **Rascunho isolado por conversa**: o texto digitado em uma conversa nunca aparece em outra; limpar ao trocar de conversa ou persistir separadamente por conversa e por usuário | Problemas 1 e 2 | **P0** |
| 6.2 | **"Assinar mensagens" configurável por usuário**, com estado visível por mensagem (assinada ou não) | Problema 6 | P1 |
| 6.3 | **Data/hora do servidor** (com fuso) visível na tela e nas mensagens; corrigir o relógio atrasado | Problema 10 | P1 |
| 6.4 | **Reabrir conversa reinicia os temporizadores** (inatividade, lembrete de 15 min, finalização de 30 min); cancelar temporizadores antigos | Problema 8 | **P0** |
| 6.5 | **Flag "contato automático/robô"** no contato e na conversa (marcável manualmente e por regra); mensagens de robô não passam pelo menu e não geram "Opção inválida" | Problemas 4 e 9 | P1 |
| 6.6 | **Aceitar + responder numa ação** (botão ou atalho) | Menos passos e menos risco de rascunho | P1 |
| 6.7 | **Bot do menu:** respostas a mensagens automáticas (lembrete de fatura) e envio de comprovante/PDF encaminham direto para Financeiro, em vez de "Opção inválida" | Problema 9 | P1 |
| 6.8 | Mostrar na conversa a **empresa, contrato e software** também nas conversas sem cadastro prévio (com "não cadastrado") e **expor esses campos na API** | Problema 11 | P1 |
| 6.9 | Recarga automática ao detectar "Reconectando" persistente e sessão do painel renovada em uso (evitar redirecionamento para `/login`) | Problema 5 | P2 |
| 6.10 | Renderizar `*negrito*` e `_itálico_` na tela do painel como o WhatsApp, ou indicar que só renderiza no celular | Dúvida recorrente nos logs | P2 |

---

## 7. Prioridade, critérios de aceite e perguntas

### 7.1 Prioridades

| Prioridade | Itens |
|---|---|
| **P0** (corrigir/entregar primeiro) | 6.1 rascunho isolado · 6.4 temporizadores ao reabrir · API de leitura e ações (3.2 P0) com token, idempotência e rate limit · webhook com payload completo, dedup e HMAC (4.1 a 4.5) · `conexao_prolongada` (4.3) · temporizadores 10/20 min no servidor (4.6) |
| **P1** | Etiquetas, bloqueio de robô, mensagem interna, histórico por contato, `/saude`, views do banco (seção 5), assinatura configurável, relógio/data, flag robô, aceitar+responder, bot → Financeiro, empresa/contrato/software na API |
| **P2** | 6.9, 6.10, consulta de estoque/produto, reentrega por consulta (`/webhook/eventos`) além do P0 |

### 7.2 Critérios de aceite

| # | Critério | Como testar |
|---|---|---|
| 1 | Rascunho nunca vaza entre conversas | Escrever texto na conversa A, abrir B, aceitar e responder em B: nada de A aparece |
| 2 | Envio por API **não** usa a caixa de texto do painel | Enviar por API enquanto um usuário digita em outra conversa: nada é alterado nem enviado a mais |
| 3 | Idempotência | Repetir um `POST /mensagens` com a mesma chave: **uma** mensagem |
| 4 | Recusa em conversa com técnico | `POST /mensagens` em conversa atribuída a técnico: `409` |
| 5 | Assinatura | `assinar=true` → mensagem sai com "Claudia:" **uma vez**; `assinar=false` → sem |
| 6 | Webhook sem ruído | Em 1 dia de teste, **zero** eventos de queda curta, OS, fatura ou pagamento registrado; zero eventos de contato `robo` |
| 7 | Webhook autêntico | Evento com HMAC inválido ou antigo é recusado pela Claudia; reenvio usa o mesmo `id_evento` |
| 8 | Marcos de 10/20 min | Transferir às 9:00 e não aceitar: `minutos_sem_aceite=10` às 9:10 e `=20` às 9:20, uma vez cada; às 17:25, o marco de 20 min só conta até 17:30 e retoma no próximo horário de técnicos |
| 9 | Reabertura | Reabrir conversa antiga: a finalização por inatividade só ocorre após os 30 min **novos** |
| 10 | Banco só leitura | `INSERT`/`UPDATE` falham; consulta sem identificador do cliente é recusada; acesso aparece no log |
| 11 | Desempenho | `GET /conversas/{id}` e `POST /mensagens` respondem em até 2 s (p95) |
| 12 | Redução de uso | Após 1 semana, execuções por webhook e por horário da Claudia caem **≥ 60%** em relação à semana de referência de 19 a 27/10 |

### 7.3 Perguntas em aberto (para o programador responder)

| # | Pergunta |
|---|---|
| 1 | Qual será a **URL base** da API e do webhook, em **homologação** e em **produção**? A API já existe parcialmente ("Integração API" no menu)? Há documentação (OpenAPI/Swagger)? |
| 2 | Qual o **formato do token** (Bearer, API key, OAuth client credentials), validade e processo de rotação? Como será entregue com segurança? |
| 3 | Quais **limites** (rate limit, tamanho de mensagem e de anexo, retenção de anexos) valem? |
| 4 | O envio por API pode ser **atômico** (aceitar+responder, transferir+observação) como proposto? Se não, qual a ordem recomendada? |
| 5 | Como o WhatsOn **identifica** a empresa/contrato/software de um telefone (qual tabela ou integração com o Manager)? Já pode ir para a API e para o webhook? |
| 6 | O servidor já tem **tabela de feriados/plantão e horários dos técnicos**? Dá para usá-la nos temporizadores? |
| 7 | É possível marcar um contato como **robô/ignorar** (3.7) ou isso exige alteração no bot? Prazo? |
| 8 | Preferem entregar o dado cadastral por **API** ou por **views** no banco? Qual SGBD e como será a conexão (VPN, IP fixo)? |
| 9 | O temporizador de inatividade reabre/reinicia ao reabrir conversa? Onde ele está implementado hoje? |
| 10 | **Prazos** estimados por prioridade (P0, P1, P2) e quando haverá um ambiente de homologação para testes? |
| 11 | O webhook pode incluir o **texto** das mensagens (4.2) ou deve ficar só com ponteiros e a Claudia lê via API? |

---

## 8. Resultado esperado

| Hoje | Depois da integração |
|---|---|
| Execuções por horário e por webhook abrem o navegador, muitas só para "nada a fazer" (≈ 105 a 113 avisos/dia nos dias de maior volume) | Só avisos acionáveis; ação por chamada de API, sem navegador |
| Primeira resposta em ~2 a 10 min, dependendo da rodada | Primeira resposta em **~1 a 2 min** (ou menos), calculada a partir do aviso |
| Risco de rascunho cruzado e de mensagem na caixa errada | **Zero** uso de rascunho; conversa isolada; envio idempotente |
| Alertas de 10/20 min dependem de relógio da tela e da próxima rodada | Marcos exatos, calculados pelo servidor em horário de técnicos |
| Pedido de CNPJ/sistema a cada conversa nova | Empresa, contrato e software já no aviso e na API |
| Quedas curtas e robôs acordam a rotina | Só queda prolongada; robôs ignorados |
| Sessão expira e exige login por tela | Token estável com rotação controlada |
| Dados de cliente consultados por tela | Consulta mínima, somente leitura e auditada |

A rotina por horário continua só como **rede de segurança** (cada 30 min em dias úteis, usando `GET /conversas` e `/webhook/eventos`), sem abrir o navegador.

---

## 9. Próximos passos

1. O programador responde as perguntas da seção 7.3 e informa os prazos.
2. Entrega do P0 em **homologação** (token de teste e segredo HMAC por canal seguro).
3. Teste conjunto com os critérios de aceite 1 a 9.
4. Liberação do P1 (views, robô, etiquetas) e novo teste (critérios 10 a 12).
5. Troca para produção com tokens novos e revisão da lista de contatos `robo`.
