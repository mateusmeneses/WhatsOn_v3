import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { CodeBlock, InlineCode } from "./CodeBlock";
import { ERRORS } from "./endpoints";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <section aria-labelledby={id} className="space-y-3 text-sm leading-relaxed text-ink">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Gere o token",
    body: (
      <>
        Em{" "}
        <Link to="/conexoes" className="font-medium text-primary hover:underline">
          Conexões
        </Link>
        , clique na chave da conexão e em <strong>Gerar token</strong>. Cada token pertence a um número.
      </>
    ),
  },
  {
    title: "Conecte o número",
    body: (
      <>
        Consulte <InlineCode>GET /connection/status</InlineCode>. Se não estiver <InlineCode>connected</InlineCode>, mostre a
        imagem de <InlineCode>GET /connection/qrcode</InlineCode> e renove a cada ~20 s até conectar.
      </>
    ),
  },
  {
    title: "Valide o destinatário (opcional)",
    body: (
      <>
        <InlineCode>POST /contacts/check</InlineCode> diz se o número tem WhatsApp, sem enviar nada. Útil no cadastro do
        cliente.
      </>
    ),
  },
  {
    title: "Envie",
    body: (
      <>
        <InlineCode>POST /messages/send</InlineCode> para texto ou arquivos, <InlineCode>POST /messages/send-media-url</InlineCode>{" "}
        para arquivos que já estão numa URL pública.
      </>
    ),
  },
  {
    title: "Trate a resposta",
    body: (
      <>
        Guarde o <InlineCode>messages[].id</InlineCode> e o <InlineCode>ticketId</InlineCode> devolvidos. Em erro, decida pelo{" "}
        <InlineCode>error.code</InlineCode> se corrige, repete ou desiste (tabela abaixo).
      </>
    ),
  },
];

const RETRYABLE = new Set(["RATE_LIMITED", "PROVIDER_ERROR", "INTERNAL_ERROR", "CONNECTION_NOT_CONNECTED"]);

export function ManualTab({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="space-y-4">
      <Section id="visao-geral" title="Visão geral">
        <p>
          A API externa permite que qualquer sistema (ERP, e-commerce, CRM, automações) conecte um número de WhatsApp e envie
          mensagens por ele. É uma API REST: HTTPS, JSON em UTF-8 e autenticação por token no cabeçalho. Toda mensagem enviada
          entra no atendimento do contato e aparece no histórico do WhatsOn, como se um atendente tivesse enviado.
        </p>
        <p className="font-medium">URL base</p>
        <CodeBlock code={baseUrl} label="Copiar URL base" />
      </Section>

      <Section id="passo-a-passo" title="Passo a passo da integração">
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="autenticacao" title="Autenticação">
        <p>Envie o token em todas as requisições:</p>
        <CodeBlock code="Authorization: Bearer SEU_TOKEN" label="Copiar cabeçalho" />
        <ul className="list-disc space-y-1 pl-5 text-ink-muted">
          <li>
            Sem o cabeçalho a resposta é <InlineCode>401 UNAUTHENTICATED</InlineCode>; com token errado ou regenerado,{" "}
            <InlineCode>403 INVALID_API_TOKEN</InlineCode>.
          </li>
          <li>O login do painel (JWT) e o token de webhook da conexão não valem nesta API.</li>
          <li>Regenerar o token no painel invalida o anterior imediatamente: atualize o sistema integrado na mesma hora.</li>
        </ul>
      </Section>

      <Section id="numeros" title="Números de telefone">
        <p>
          O campo <InlineCode>number</InlineCode> aceita qualquer formatação: <InlineCode>(11) 98888-7777</InlineCode>,{" "}
          <InlineCode>+55 11 98888-7777</InlineCode> ou <InlineCode>5511988887777</InlineCode>. Ficam só os dígitos; com 10 ou 11
          dígitos (DDD + número) o DDI 55 é adicionado. Números de outros países devem vir com o DDI.
        </p>
        <p className="text-ink-muted">
          Antes de enviar, o número é conferido no WhatsApp e o contato é gravado como o WhatsApp o devolve (há números sem o
          nono dígito). Por isso o <InlineCode>number</InlineCode> da resposta pode ser diferente do enviado.
        </p>
      </Section>

      <Section id="envio" title="Envio assíncrono e histórico">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A resposta <InlineCode>201</InlineCode> significa que a mensagem foi <strong>aceita e registrada</strong> no
            atendimento; a entrega ao WhatsApp acontece logo em seguida, em fila.
          </li>
          <li>
            <InlineCode>ack</InlineCode> começa em <InlineCode>pending</InlineCode> e evolui para <InlineCode>sent</InlineCode>,{" "}
            <InlineCode>delivered</InlineCode> e <InlineCode>read</InlineCode> (acompanhe pelo painel).
          </li>
          <li>Se o contato já tem atendimento aberto, a mensagem entra nele; senão um novo é aberto.</li>
          <li>
            Respostas do cliente chegam no WhatsOn como qualquer conversa, e a equipe atende normalmente pelo painel.
          </li>
        </ul>
      </Section>

      <Section id="erros" title="Erros e quando repetir">
        <p>Todo erro segue o mesmo formato:</p>
        <CodeBlock code={'{ "error": { "code": "INVALID_PHONE", "message": "Telefone inválido" } }'} label="Copiar exemplo de erro" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">HTTP</th>
                <th className="py-2 pr-3 font-medium">error.code</th>
                <th className="py-2 pr-3 font-medium">Significado</th>
                <th className="py-2 pr-3 font-medium">O que fazer</th>
                <th className="py-2 font-medium">Repetir?</th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map((e) => (
                <tr key={e.code} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3 font-mono">{e.status}</td>
                  <td className="py-2 pr-3 font-mono">{e.code}</td>
                  <td className="py-2 pr-3">{e.meaning}</td>
                  <td className="py-2 pr-3">{e.action}</td>
                  <td className="py-2">{RETRYABLE.has(e.code) ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-ink-muted">
          Repita só os erros marcados, com espera crescente (ex.: 2 s, 4 s, 8 s, 16 s, 32 s) e no máximo 5 tentativas. A API não
          tem chave de idempotência: em timeout de rede sem resposta, confira o histórico antes de reenviar para não duplicar.
        </p>
      </Section>

      <Section id="limites" title="Limites">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>60 requisições por minuto por token</strong> (padrão). Os cabeçalhos <InlineCode>X-RateLimit-Limit</InlineCode>{" "}
            e <InlineCode>X-RateLimit-Remaining</InlineCode> mostram o saldo; o <InlineCode>429</InlineCode> traz{" "}
            <InlineCode>Retry-After</InlineCode> em segundos.
          </li>
          <li>Texto: até 4096 caracteres. Legenda por URL: até 1024.</li>
          <li>Arquivos: até 10 por envio, 16 MB cada.</li>
          <li>
            Envios em massa: distribua no tempo (ex.: uma mensagem a cada 1–3 s). Disparos rápidos para muitos contatos podem
            levar o WhatsApp a bloquear o número.
          </li>
        </ul>
      </Section>

      <Section id="seguranca" title="Segurança">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            O token dá acesso total ao número. Guarde-o <strong>só no servidor</strong> do sistema integrado (variável de ambiente
            ou cofre de segredos), nunca em app, site ou planilha do cliente final.
          </li>
          <li>Use sempre HTTPS. Não registre o token em logs.</li>
          <li>Se o token vazar, regenere-o em Conexões: o antigo para de funcionar na hora.</li>
          <li>Use um token por sistema integrado quando possível (uma conexão por sistema).</li>
        </ul>
      </Section>

      <Section id="homologacao" title="Checklist de homologação">
        <ul className="space-y-1">
          {[
            "Status retorna connected com o token de homologação.",
            "Envio de texto aparece no celular e no histórico do WhatsOn.",
            "Envio de PDF e de imagem (multipart ou URL) chega com legenda.",
            "Número inexistente devolve NUMBER_NOT_ON_WHATSAPP e o sistema não repete.",
            "Token inválido devolve 403 e o sistema alerta o administrador.",
            "429 e 502 são repetidos com espera; os demais erros não.",
            "Número desconectado (409) gera alerta para ler o QR code.",
            "O token não aparece em logs nem no navegador do usuário final.",
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <input type="checkbox" className="mt-1" aria-label={item} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
