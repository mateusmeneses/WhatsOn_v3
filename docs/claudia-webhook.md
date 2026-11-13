# Avisos (webhook) do WhatsOn para a Claudia

Referência técnica do que o WhatsOn envia à Claudia e de como configurar. Atende à especificação de 23/10/2026
(`IA/ESPECIFICACAO_WEBHOOK_WHATSON.md`, formato **v1**) e à seção 4 dos requisitos de 28/10/2026
(`IA/REQUISITOS_INTEGRACAO_CLAUDIA_WHATSON.md`, formato **v2**).

## 1. Configuração (variáveis de ambiente do backend)

| Variável | Padrão | Uso |
|---|---|---|
| `CLAUDIA_WEBHOOK_URL` | — | Endereço que recebe o `POST`. Vazio = avisos desligados. |
| `CLAUDIA_WEBHOOK_KEY` | — | Chave da rotina, enviada como está no cabeçalho abaixo. |
| `CLAUDIA_WEBHOOK_KEY_HEADER` | `Authorization` | Cabeçalho da chave. |
| `CLAUDIA_WEBHOOK_EXTRA_HEADERS` | — | Cabeçalhos extras em JSON. |
| `CLAUDIA_WEBHOOK_BODY` | `json` | `json` = aviso no corpo; `text` = `{"text": "<aviso em JSON>"}`. |
| `CLAUDIA_COMPANY_ID` | — | Empresa atendida pela Claudia. |
| `CLAUDIA_USER_ID` | — | Usuário da Claudia no WhatsOn. |
| `CLAUDIA_WATCH_NUMBERS` | — | Números vigiados (`mensagem_mateus` / `mensagem_numero_especial`). |
| `CLAUDIA_WEBHOOK_FORMATO` | `v1` | `v1` ou `v2` (seção 3). |
| `CLAUDIA_WEBHOOK_SECRET` | — | Segredo do HMAC (16+ caracteres). Com ele, todo aviso é assinado (seção 5). |
| `CLAUDIA_WEBHOOK_INCLUIR_TEXTO` | `false` | v2: inclui o texto das mensagens em `mensagens_recentes`. |
| `CLAUDIA_CONEXAO_MINUTOS` | `10` | v2: minutos de conexão fora até virar `conexao_prolongada`. |
| `CLAUDIA_AMBIENTE` | `producao` | v2: campo `ambiente`. |
| `CLAUDIA_WEBHOOK_MODO` | `completo` | `economico`: só conversas com a Claudia ou de produtos dela (seção 4). |
| `CLAUDIA_PRODUTOS` | `multicomercio` | Termos do **Produto** do contato ou da opção do menu do bot que a Claudia atende (vírgula; ignora acento e maiúscula). |
| `CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO` | `120` | Janela de agrupamento das conversas sem atendente (60–600 s). Com atendente: 60 s. |
| `CLAUDIA_AUTO_REACAO` | `false` | "obrigado"/👍 até 24 h depois de finalizar: a conversa nova é finalizada sem mensagem e sem aviso. |
| `CLAUDIA_AUTO_INATIVIDADE` | `false` | Conversa com a Claudia: lembrete aos 15 min e finaliza aos 30, sem aviso. |
| `CLAUDIA_TEXTO_LEMBRETE` | texto padrão | Lembrete dos 15 min. |
| `CLAUDIA_TEXTO_INATIVIDADE` | — | Mensagem ao finalizar aos 30 min (vazio = mensagem de inatividade da empresa). |
| `CLAUDIA_AUTO_FORA_HORARIO` | `false` | Conversa aguardando com a fila fora do expediente: manda o texto abaixo (uma vez), fica em Aguardando, sem aviso. |
| `CLAUDIA_TEXTO_FORA_HORARIO` | — | Texto de fora do horário (vazio = o da conexão). |
| `ALERTA_CONEXAO_DESTINOS` | — | `whatsapp:5579…,whatsapp:5579…`: queda de conexão maior que `CLAUDIA_CONEXAO_MINUTOS` e a volta, direto às pessoas. |
| `ALERTA_SEM_ACEITE_DESTINOS` | os de conexão | Destinos do alerta de transferência sem aceite. |
| `CLAUDIA_ALERTA_TECNICOS` | — | IDs (vírgula) dos técnicos vigiados no alerta de sem aceite. |

Após mudar o `.env`, recriar o backend (`docker compose up -d backend`).

## 2. Eventos

| Evento interno (v1) | Nome no v2 | Quando |
|---|---|---|
| `conversa_aguardando` | igual | Conversa nova entra em Aguardando, ou o bot a devolve para lá |
| `transferida_para_claudia` | igual | Alguém transfere a conversa para a Claudia (na hora) |
| `mensagem_cliente` | igual | Cliente escreve em conversa com a Claudia. No v2, também em conversa aguardando sem atendente (salvo nos 60 s seguintes ao `conversa_aguardando` dela) |
| `mensagem_pos_finalizacao` | igual | Primeira mensagem até 24 h depois de finalizar. v2: `apenas_reacao` = só emoji, figurinha ou "obrigado/ok" |
| `bot_parado` | igual | "Opção inválida" no bot, ou 3 min parado no menu |
| `transferencia_sem_aceite` | igual | 10 e 20 min sem aceite, **contados só no expediente da fila** (fila sem horário = o tempo todo) |
| `inatividade_cliente` | igual | 15 e 30 min sem o cliente responder à Claudia. Reabrir, aceitar ou transferir recomeça a contagem |
| `mensagem_mateus` | `mensagem_numero_especial` | Mensagem de um número vigiado |
| `conexao` | `conexao_prolongada` | Conexão fora por mais de 2 min (v1) / `CLAUDIA_CONEXAO_MINUTOS` (v2); `status` = `fora` / `voltou` |
| — | `lote` | v2: mais de 5 avisos em 30 s; os excedentes saem num só aviso com `conversas` |

**Nunca geram aviso:** mensagens enviadas pela Claudia, por técnicos ou pelo sistema (OS, fatura, pagamento,
encerramento), conversas de grupo e contatos marcados como **Robô / mensagens automáticas** (Contatos → Editar).

**Agrupamento:** no máximo 1 aviso por conversa a cada 60 s. O primeiro sai na hora; os do meio viram um aviso só no
fim da janela, com o evento mais importante em `evento` e todos em `eventos` (v2). No v2, os eventos da mesma
mensagem (ex.: `conversa_aguardando` + `mensagem_pos_finalizacao`) também saem num aviso só.

**Reenvio:** resposta não-2xx ou erro → de novo após 30 s, 2 min e 10 min, com o **mesmo** `id_evento` e o mesmo
corpo (no v2 só `tentativa` muda). Cada tentativa fica em `claudia_webhook_logs`.

## 3. Formatos

### v1 (atual)

```json
{
  "evento": "conversa_aguardando",
  "id_evento": "6f1c2a9e-0b7d-4c1e-9a55-2f0d7e3b1c44",
  "ocorrido_em": "2026-10-23T16:12:05-03:00",
  "conversa": 386,
  "telefone": "5579999999999",
  "contato": "Nome do contato",
  "fila": "Suporte técnico",
  "atendente": null,
  "tipo_ultima_mensagem": "texto",
  "minutos_sem_aceite": null,
  "minutos_sem_resposta": null,
  "status": null
}
```

### v2

```json
{
  "evento": "mensagem_cliente",
  "id_evento": "6f1c2a9e-0b7d-4c1e-9a55-2f0d7e3b1c44",
  "tentativa": 1,
  "ocorrido_em": "2026-10-28T09:14:35-03:00",
  "ambiente": "producao",
  "eventos": ["mensagem_cliente"],
  "conversa": {
    "id": 386,
    "status": "aguardando",
    "fila": "Suporte técnico",
    "menu_escolhido": ["Suporte técnico", "Novo Multicomércio"],
    "atendente": null,
    "aguardando_desde": "2026-10-28T09:14:40-03:00"
  },
  "contato": { "nome": "Contato Exemplo", "telefone_final": "1133", "cadastrado": true, "automatico": false },
  "empresa": { "nome": "Empresa Exemplo Ltda", "contrato": null, "software": "Novo Multicomércio (Nuvem)" },
  "mensagens_recentes": [
    { "id": 9121, "em": "2026-10-28T09:14:30-03:00", "origem": "cliente", "tipo": "texto", "texto": null, "anexos": 0 }
  ],
  "faixa_horario": "tecnicos",
  "minutos_sem_aceite": null,
  "minutos_sem_resposta": null,
  "status": null,
  "apenas_reacao": null,
  "conversas": null
}
```

- `conversa.status`: `bot`, `aguardando`, `atendendo`, `finalizado`.
- `menu_escolhido`: opções do menu do bot, em ordem.
- `empresa`: Empresa e Produto do cadastro do contato; `contrato` ainda não existe no WhatsOn (sempre `null`).
- `mensagens_recentes`: de 1 a 5 mensagens desde o aviso anterior da conversa. `origem`: `cliente`, `bot`, `claudia`,
  `atendente`, `sistema`. `texto` só com `CLAUDIA_WEBHOOK_INCLUIR_TEXTO=true`. Anexos só como quantidade.
- `faixa_horario`: `tecnicos` se a fila está no expediente agora, senão `fora`.
- `mensagens_recentes[].anexo`: tipo do anexo (`imagem`, `audio`, `video`, `pdf`, `figurinha`, `arquivo`) ou `null`.
- `ultima_mensagem_origem`: `cliente` ou `atendente` (última mensagem humana; bot e avisos automáticos não contam).
- `observacoes_resumo`: Observações da conversa (últimos 500 caracteres) ou `null`.
- `atendentes_online`: `[{"id", "nome", "online": true}]` ou `{"online": false, "visto_em"}` para cada usuário da
  empresa, menos a Claudia. "Online" = painel aberto agora.
- `lote`: `conversa`, `contato` etc. vêm `null` e `conversas` traz `[{"id": 386, "evento": "conversa_aguardando"}, …]`.

## 4. Modo econômico

`CLAUDIA_WEBHOOK_MODO=economico` faz o WhatsOn avisar **só** de:

1. conversas atribuídas à Claudia (inclui `transferida_para_claudia`, `mensagem_cliente`, `inatividade_cliente`);
2. conversas de contatos cujo **Produto** contém um termo de `CLAUDIA_PRODUTOS` (padrão `multicomercio`).

3. conversas cuja opção escolhida no menu do bot contém um desses termos (ex.: "Suporte › Novo Multicomércio").

Avisos de conexão e de número vigiado não saem.

### Automações (o WhatsOn resolve sem acordar a Claudia)

| Variável | Situação | O que o WhatsOn faz |
|---|---|---|
| `CLAUDIA_AUTO_REACAO` | Só "obrigado", "ok", 👍 ou figurinha até 24 h depois de finalizar | Finaliza a conversa nova sem mensagem |
| `CLAUDIA_AUTO_INATIVIDADE` | Cliente parado na conversa com a Claudia | 15 min: lembrete. 30 min: finaliza com a mensagem de inatividade |
| `CLAUDIA_AUTO_FORA_HORARIO` | Conversa aguardando sem atendente, fila fora do expediente | Manda a mensagem de horário (uma vez) e mantém em Aguardando |
| `ALERTA_SEM_ACEITE_DESTINOS` + `CLAUDIA_ALERTA_TECNICOS` | 10/20 min sem aceite | Alerta por WhatsApp aos destinos só se o técnico é da lista, está online e o cliente espera resposta. `transferencia_sem_aceite` deixa de ir para a Claudia |
| `ALERTA_CONEXAO_DESTINOS` | Conexão fora por mais de `CLAUDIA_CONEXAO_MINUTOS` | Alerta por WhatsApp de queda e de volta (vale também no modo econômico) |

Os alertas saem por outra conexão conectada da empresa. Se a única conexão é a que caiu, o alerta não sai (fica no log
do servidor). E-mail ainda não é suportado: destinos `email:` são ignorados.

### Inatividade (todas as empresas)

A finalização automática por inatividade só conta quando a última mensagem **humana** é do atendente. Mensagem
automática do bot (ex.: "fora do horário") depois da do cliente não faz mais o atendimento ser finalizado, e lembretes
automáticos não recomeçam a contagem.

## 5. Assinatura (HMAC)

Com `CLAUDIA_WEBHOOK_SECRET`, todo aviso leva:

| Cabeçalho | Valor |
|---|---|
| `X-WhatsOn-Timestamp` | Segundos Unix do envio desta tentativa |
| `X-WhatsOn-Assinatura` | `sha256=` + HMAC-SHA256 (hex) do **corpo exato** da requisição, com o segredo |

Para conferir: calcular o HMAC sobre os bytes recebidos (antes de fazer parse), comparar em tempo constante e recusar
`X-WhatsOn-Timestamp` com mais de 5 min de diferença.

```js
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-whatson-assinatura"]))
  && Math.abs(Date.now() / 1000 - Number(req.headers["x-whatson-timestamp"])) <= 300;
```

## 6. API de ações da Claudia

Base `/api/v1`, `Authorization: Bearer <token de API de uma conexão da empresa da Claudia>`. Toda ação é feita como o
usuário `CLAUDIA_USER_ID` (histórico, assinatura "*Claudia:*" e permissões dele; dê a ela perfil **supervisor** para ver
todas as filas). Outra empresa ou Claudia desligada → `404`. Erros: `{"error": {"code", "message"}}`.

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `POST /conversas/{id}/aceitar` | — | `{"conversa"}` |
| `POST /conversas/{id}/mensagens` | `{"texto": "...", "assinar": true}` | `201 {"mensagem": {"id", "em", "status_envio"}, "conversa"}` |
| `GET /conversas/{id}/mensagens?limite=20` | — | `{"mensagens": [{"id", "em", "origem", "tipo", "texto", "apagada", "anexo": {"tipo", "nome", "url"}}], "mais_antigas"}` |
| `GET /conversas/{id}/observacoes` | — | `{"observacoes": "..."}` |
| `POST /conversas/{id}/observacoes` | `{"texto": "..."}` | `201 {"observacoes"}`: acrescenta `[AAAA-MM-DD HH:MM] Claudia: texto`, nunca apaga |
| `POST /conversas/{id}/transferir` | `{"usuario_id": n}` ou `{"fila_id": n}` | `{"conversa"}`; atendente fora do painel → `409 USUARIO_OFFLINE` |
| `POST /conversas/{id}/finalizar` | `{"enviar_mensagem": false}` | `{"conversa"}` |
| `GET /usuarios/presenca` | — | `{"atendentes": [...]}` (mesmo formato de `atendentes_online`) |

`conversa` = `{"id", "status", "fila": {"id", "nome"}, "atendente": {"id", "nome"}}`, já no estado final.
`assinar` só é respeitado para perfil admin; os demais perfis sempre assinam. Responder exige a conversa aceita.

## 7. Recuperar avisos perdidos

`GET /api/v1/webhook/eventos?desde=<ISO 8601>&apos_id=<n>&limite=<1-500>`, com
`Authorization: Bearer <token de API de uma conexão da empresa da Claudia>` (Conexões → Token de API).

```json
{
  "eventos": [
    { "seq": 41, "registrado_em": "2026-11-13T09:14:35-03:00", "entregue": true, "aviso": { "evento": "…" } }
  ],
  "proximo_apos_id": null
}
```

- Ordem de envio; `desde` padrão = últimas 24 h; `limite` padrão 100.
- `entregue`: alguma tentativa teve resposta 2xx.
- `proximo_apos_id`: passar em `apos_id` para a próxima página (`null` = acabou).
- Avisos ficam guardados 30 dias. Outra empresa ou avisos desligados → `404`.
