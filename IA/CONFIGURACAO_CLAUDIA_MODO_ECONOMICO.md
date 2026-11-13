# Configuração da Claudia (Grok Bot): modo econômico, só por webhook

**Para:** quem administra a Claudia (rotinas, instruções e gatilhos)
**Data:** 13/11/2026
**Objetivo:** gastar menos tokens. A Claudia deixa de abrir o painel por horário e passa a acordar **somente** quando o
WhatsOn avisar por webhook, e o WhatsOn só avisa em dois casos:

1. a conversa foi **transferida para a Claudia** (ou já está com ela e o cliente escreveu ou parou de responder);
2. a conversa é de um cliente **NewMulticomércio**, ou seja, o **Produto** do cadastro do contato contém "Multicomércio".

Todo o resto (outras conversas, quedas de conexão, número vigiado, robôs, mensagens automáticas) **não acorda** a Claudia.

---

## 1. O que desligar na Claudia

| Item | Hoje | Novo |
|---|---|---|
| Rotina por horário (a cada 30 min em dias úteis, 6:30–20:00) | Ligada | **Desligar** |
| Rotina de fim de semana (a cada 1 h) | Ligada | **Desligar** |
| "Checagem de segurança" / varredura das abas Bot, Aguardando e Atendendo | Ligada | **Desligar** |
| Gatilho "WhatsOn por aviso (webhook)" | Ligado | **Manter**: passa a ser o único gatilho |
| Conferir conexão / faixa "Reconectando" | A cada execução | **Não fazer**: o WhatsOn não manda mais aviso de conexão |

A Claudia **não** precisa conferir avisos perdidos: o WhatsOn reenvia cada aviso que não recebeu resposta 2xx
(após 30 s, 2 min e 10 min, com o mesmo `id_evento`).

## 2. Configuração no servidor do WhatsOn

No `.env` do servidor (feito pela equipe do WhatsOn; depois `docker compose up -d backend`):

```env
CLAUDIA_WEBHOOK_MODO=economico
CLAUDIA_PRODUTOS=multicomercio
CLAUDIA_WEBHOOK_FORMATO=v2
CLAUDIA_WEBHOOK_INCLUIR_TEXTO=true
CLAUDIA_WEBHOOK_SECRET=<segredo combinado por canal seguro>
```

- `CLAUDIA_WEBHOOK_FORMATO=v2` e `CLAUDIA_WEBHOOK_INCLUIR_TEXTO=true` fazem o aviso já trazer as últimas mensagens do
  cliente. Assim a Claudia decide **sem abrir o navegador** na maioria dos casos (a maior economia).
  Se a Claudia ainda não estiver pronta para o v2, deixar `v1` por enquanto: o filtro econômico funciona nos dois.
- `CLAUDIA_WEBHOOK_SECRET` é opcional; com ele, os avisos vêm assinados (`X-WhatsOn-Assinatura`).
- Detalhes técnicos: `docs/claudia-webhook.md`.

Melhorias de 13/11 (`IA/MELHORIAS_WEBHOOK_CLAUDIA_WHATSON.md`), ligadas por variável no mesmo `.env`:

```env
CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO=150
CLAUDIA_AUTO_REACAO=true
CLAUDIA_AUTO_INATIVIDADE=true
CLAUDIA_AUTO_FORA_HORARIO=true
ALERTA_CONEXAO_DESTINOS=whatsapp:<Whatyson>,whatsapp:<Mateus>
CLAUDIA_ALERTA_TECNICOS=<id do Nadilson>,<id do Yure>
```

Com elas, a Claudia **para de receber** reações pós-finalização, inatividade (lembrete e finalização são
automáticos), conversas fora do horário e transferências sem aceite (o alerta vai direto ao Whatyson e ao Mateus).
Para **agir sem o navegador**, ela usa a API de ações (`docs/claudia-webhook.md`, seção 6): aceitar, responder,
Observações, transferir (recusa quem está offline), finalizar e presença dos atendentes. O aviso v2 também traz
`atendentes_online`, `ultima_mensagem_origem` e `observacoes_resumo`.

## 3. Cadastro (para o filtro funcionar)

- Contatos NewMulticomércio são reconhecidos pelo **Produto** do cadastro (Contatos → Editar → Produto, ou vinculado
  ao Manager) **ou** pela opção Multicomércio escolhida no menu do bot.
- Contatos que mandam disparos automáticos (ex.: robô de cardápio): marcar **"Robô / mensagens automáticas"** no
  mesmo formulário. Eles nunca acordam a Claudia.

## 4. Quando a Claudia acorda e o que fazer

| Evento | Situação | Ação da Claudia |
|---|---|---|
| `transferida_para_claudia` | Um técnico ou supervisor passou a conversa para ela | Aceitar, ler o histórico e responder |
| `mensagem_cliente` | Cliente escreveu em conversa com ela (ou NewMulticomércio aguardando sem atendente) | Ler `mensagens_recentes` e responder |
| `conversa_aguardando` | Conversa nova de cliente NewMulticomércio em Aguardando | Aceitar e fazer o primeiro atendimento |
| `bot_parado` | Cliente NewMulticomércio travado no menu do bot | Aceitar e atender |
| `mensagem_pos_finalizacao` | Cliente NewMulticomércio escreveu até 24 h depois de finalizar | Se `apenas_reacao` = `true` ("obrigado", 👍): finalizar **sem** mensagem. Senão, atender |
| `inatividade_cliente` | Cliente parado 15 ou 30 min na conversa com ela | 15 min: lembrete curto. 30 min: finalizar conforme a regra atual |
| `transferencia_sem_aceite` | Conversa NewMulticomércio com técnico que não aceitou em 10/20 min (horário da fila) | Avisar conforme a regra de escalonamento atual |
| `lote` | Muitos avisos em 30 s | Atender só as conversas listadas em `conversas`, uma por vez |

Outros eventos (`conexao_prolongada`, `mensagem_numero_especial`) não chegam no modo econômico. Se chegarem, ignorar.

## 5. Instruções para colar na Claudia

> Você só é acionada por aviso (webhook) do WhatsOn. Não existe mais rotina por horário nem checagem periódica:
> não abra o painel para procurar trabalho, não percorra as abas Bot, Aguardando ou Atendendo e não confira a
> conexão.
>
> A cada aviso:
> 1. Leia o JSON do aviso primeiro. Ele diz qual é a conversa (`conversa.id`), o evento e as últimas mensagens
>    (`mensagens_recentes`).
> 2. Trate **somente** a conversa do aviso (no `lote`, só as conversas listadas, uma de cada vez). Nunca leve dados
>    de uma conversa para outra.
> 3. Se `contato.automatico` for `true`, não faça nada.
> 4. Se o evento for `mensagem_pos_finalizacao` e `apenas_reacao` for `true`, finalize sem mensagem de encerramento.
> 5. Se `mensagens_recentes` já basta para responder, responda sem reler o histórico inteiro. Abra o navegador só
>    quando precisar de algo que o aviso não traz (anexo, histórico antigo, Observações).
> 6. Se o mesmo `id_evento` chegar de novo (`tentativa` maior que 1) e você já tratou, não faça nada.
> 7. Terminou a ação, encerre a execução. Não fique esperando nem verificando outras conversas.

## 6. Teste de aceite

1. Com o modo econômico ligado, mandar mensagem de um contato **sem** Produto Multicomércio: a Claudia **não** acorda.
2. Mandar de um contato com Produto "Novo Multicomércio (Nuvem)": chega `conversa_aguardando` em segundos.
3. Transferir uma conversa qualquer para a Claudia: chega `transferida_para_claudia` na hora.
4. Derrubar a conexão por mais de 10 min: **nenhum** aviso.
5. Depois de 1 semana, comparar o número de execuções da Claudia com a semana anterior.
