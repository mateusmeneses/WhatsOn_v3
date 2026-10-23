# Especificação: avisos do WhatsOn para a Claudia (webhook)

**Para:** equipe de desenvolvimento do WhatsOn (Connect Tecnologia)
**Solicitante:** Whatyson Almeida
**Data:** 23/10/2026
**Objetivo:** o WhatsOn avisar a Claudia na hora em que algo acontece, em vez de a Claudia abrir o painel a cada 10 minutos para conferir. Isso deixa o primeiro atendimento mais rápido (segundos, não minutos) e reduz bastante o custo de processamento, porque a Claudia só trabalha quando há trabalho.

---

## 1. Como funciona

1. Quando ocorrer um dos eventos da seção 3, o WhatsOn faz um `POST` HTTPS para o endereço da Claudia.
2. A Claudia acorda, abre a conversa indicada e atende pelas regras normais.
3. Sem eventos, a Claudia não roda. Fica só uma checagem de segurança a cada 30 minutos (seção 7).

## 2. Endereço e autenticação

| Item | Valor |
|---|---|
| URL | `<<URL DO WEBHOOK — o Whatyson copia no painel da rotina "WhatsOn por aviso (webhook)">>` |
| Método | `POST` |
| Content-Type | `application/json; charset=utf-8` |
| Chave | `<<CHAVE DO REMETENTE — copiada do mesmo painel; enviar exatamente como o painel indicar>>` |

- Guardar URL e chave como configuração secreta do servidor (variável de ambiente), nunca no código ou no front-end.
- Chamadas sem a chave correta são recusadas.
- Timeout sugerido: 10 s.

## 3. Eventos

| `evento` | Quando disparar | Prioridade |
|---|---|---|
| `conversa_aguardando` | Uma conversa entra na fila **Aguardando** (nova ou devolvida pelo bot) | Alta |
| `bot_parado` | Conversa na aba **Bot** sem avançar no menu há 3 min, ou cliente respondeu com texto livre/arquivo/áudio que o bot não entendeu ("Opção inválida") | Alta |
| `mensagem_cliente` | Cliente manda mensagem numa conversa que está **com a Claudia** | Alta |
| `mensagem_pos_finalizacao` | Cliente manda mensagem até 24 h depois de a conversa ser finalizada | Média |
| `transferencia_sem_aceite` | Conversa transferida a um técnico não foi aceita após **10 min**, e de novo após **20 min** (enviar `minutos_sem_aceite`) | Alta |
| `inatividade_cliente` | Conversa com a Claudia sem resposta do cliente há **15 min** e há **30 min** (enviar `minutos_sem_resposta`) | Média |
| `mensagem_mateus` | Mensagem nova do número 79 98879-1352 (Mateus Meneses) | Alta |
| `conexao` | O WhatsOn perder a conexão com o WhatsApp ou o servidor de tempo real ficar fora (enviar `status`: `fora` / `voltou`) | Alta |

Não enviar evento para: avisos automáticos de OS, lembretes automáticos de fatura enviados pelo sistema, mensagens de encerramento automático, avisos de pagamento registrado e mensagens enviadas pela própria Claudia ou por técnicos.

## 4. Corpo do aviso (JSON)

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

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `evento` | texto | sim | Um dos valores da seção 3 |
| `id_evento` | texto (UUID) | sim | Único por evento; reenvios usam o mesmo id |
| `ocorrido_em` | data/hora ISO 8601 com fuso | sim | Usar o horário real (o relógio do painel hoje está 1 h atrasado) |
| `conversa` | número | sim* | Nº da conversa (*exceto `conexao`) |
| `telefone` | texto | sim* | Só dígitos, com DDI |
| `contato` | texto | não | Nome exibido |
| `fila` / `atendente` | texto | não | Menu escolhido e quem está com a conversa |
| `tipo_ultima_mensagem` | texto | não | `texto`, `audio`, `imagem`, `arquivo`, `figurinha`, `reacao` |
| `minutos_sem_aceite` | número | só em `transferencia_sem_aceite` | 10 ou 20 |
| `minutos_sem_resposta` | número | só em `inatividade_cliente` | 15 ou 30 |
| `status` | texto | só em `conexao` | `fora` ou `voltou` |

**Privacidade:** não enviar o texto das mensagens, CPF/CNPJ, valores, comprovantes ou senhas no aviso. A Claudia lê o conteúdo dentro do próprio WhatsOn. O aviso só diz *onde* olhar.

## 5. Agrupamento (reduz custo)

- **Uma conversa, um aviso por vez:** se chegarem várias mensagens da mesma conversa, mandar no máximo **1 aviso a cada 60 s** por conversa (o primeiro na hora, os demais agrupados).
- **Rajadas:** se mais de 5 eventos ocorrerem em 30 s, pode mandar um único aviso com `"evento": "lote"` e a lista de conversas em `"conversas": [..]`.
- Não reenviar `transferencia_sem_aceite` / `inatividade_cliente` para o mesmo marco (10, 20, 15, 30) da mesma conversa.

## 6. Resposta e reenvio

- Resposta `2xx` = recebido. Não precisa esperar o atendimento terminar.
- Erro ou timeout: reenviar com o **mesmo `id_evento`** após 30 s, 2 min e 10 min, e então desistir e registrar no log do servidor.
- Registrar no WhatsOn (log interno) cada envio: data, evento, conversa, código de resposta.

## 7. O que muda na operação da Claudia

| Hoje | Com os avisos |
|---|---|
| Abre o painel a cada 10 min, 6h–22h (≈ 480 verificações/semana), mesmo sem cliente | Atua só quando chega um aviso |
| Cliente espera até ~10 min pela primeira resposta | Primeira resposta em ~1–2 min |
| Escalonamentos de 10/20 min dependem da passada seguinte | Chegam no minuto certo |
| — | Checagem de segurança a cada 30 min (≈ 160/semana), só para garantir que nenhum aviso se perdeu |

Estimativa: redução de **~60–70%** nas execuções da cobertura em dias tranquilos (o número exato depende do volume de atendimentos).

## 8. Fase 2 (opcional, maior economia)

Hoje a Claudia usa o navegador para ler e responder, que é a parte mais cara. Uma API simples do WhatsOn eliminaria isso:

| Endpoint | Uso |
|---|---|
| `GET /api/conversas/{id}` | Dados da conversa, atendente, fila, Observações |
| `GET /api/conversas/{id}/mensagens?desde=` | Mensagens novas (com links para anexos) |
| `POST /api/conversas/{id}/mensagens` | Enviar mensagem como Claudia |
| `POST /api/conversas/{id}/aceitar` · `/transferir` · `/finalizar` | Ações de atendimento (`finalizar` com opção de não enviar a mensagem de encerramento) |
| `PUT /api/conversas/{id}/observacoes` | Gravar/acrescentar Observações |
| `GET /api/atendentes/online` | Quem está online/externo para distribuir |

Autenticação por token próprio da Claudia, com permissões só de atendimento.

## 9. Teste de aceite

1. Configurar URL e chave em homologação.
2. Mandar uma mensagem de teste do número 79 8138-4774 (Whatyson) para cair em **Aguardando**.
3. Conferir que a Claudia respondeu em até ~2 min e que o log mostra a origem "webhook".
4. Repetir para `bot_parado`, `transferencia_sem_aceite` (transferir e não aceitar por 10 min) e `conexao`.
5. Com tudo ok, o Whatyson avisa a Claudia para passar a checagem por horário de 10 para 30 min.
