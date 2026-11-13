import { config } from "dotenv";
import { z } from "zod";

config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Linha vazia no .env (ex.: copiada do .env.example) vale como não definida. */
const emptyAsUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Versão do build (yyyy.MM.dd.N), vinda do version.txt pelos scripts de deploy. */
  APP_VERSION: z.preprocess(emptyAsUndefined, z.string().default("0.0.0.0")),
  /** Data/hora do build (dd/MM/yyyy HH:mm), gravada pelos scripts de deploy. */
  APP_BUILD_TIME: z.preprocess(emptyAsUndefined, z.string().default("")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().default(5433),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_LOGGING: bool,
  REDIS_URL: z.string().default("redis://localhost:6380/0"),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  BACKEND_PUBLIC_URL: z.string().url(),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  MEDIA_DIR: z.string().default("./public/media"),
  INBOUND_SHARDS: z.coerce.number().int().min(1).default(8),
  OUTBOUND_SHARDS: z.coerce.number().int().min(1).default(8),
  /** Requisições por minuto por token na API externa (/api/v1). */
  EXTERNAL_API_RATE_LIMIT: z.coerce.number().int().min(1).default(60),
  PARTNER_API_RATE_LIMIT: z.coerce.number().int().min(1).default(60),
  BULL_BOARD_USER: z.string().optional(),
  BULL_BOARD_PASS: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@whatson.local"),
  SEED_ADMIN_PASSWORD: z.string().min(6).default("admin123"),
  /** Integração com o Manager (só a empresa MANAGER_COMPANY_ID; vazio = desligada). */
  MANAGER_API_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
  MANAGER_API_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(16).optional()),
  MANAGER_COMPANY_ID: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  /**
   * Avisos (webhook) para a Claudia, atendente IA da empresa CLAUDIA_COMPANY_ID (vazio = desligado).
   * A chave vai como está no cabeçalho CLAUDIA_WEBHOOK_KEY_HEADER (ex.: "Bearer abc" em Authorization).
   */
  CLAUDIA_WEBHOOK_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
  CLAUDIA_WEBHOOK_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  CLAUDIA_WEBHOOK_KEY_HEADER: z.preprocess(emptyAsUndefined, z.string().min(1).default("Authorization")),
  /** Cabeçalhos extras em JSON, ex.: {"anthropic-version":"2023-06-01"}. */
  CLAUDIA_WEBHOOK_EXTRA_HEADERS: z.preprocess(emptyAsUndefined, z.string().optional()),
  /** "json" manda o aviso como corpo; "text" embrulha em {"text": "<aviso em JSON>"}. */
  CLAUDIA_WEBHOOK_BODY: z.preprocess(emptyAsUndefined, z.enum(["json", "text"]).default("json")),
  CLAUDIA_COMPANY_ID: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  /** Usuário da Claudia no WhatsOn: conversas com ele geram mensagem_cliente e inatividade_cliente. */
  CLAUDIA_USER_ID: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  /** Números (com DDI, separados por vírgula) cujas mensagens geram mensagem_mateus. */
  CLAUDIA_WATCH_NUMBERS: z.preprocess(emptyAsUndefined, z.string().default("")),
  /**
   * Formato do aviso: v1 (campos soltos, especificação de 23/10) ou v2 (payload completo, requisitos de 28/10:
   * conexao_prolongada, mensagem_numero_especial, lote, mensagens_recentes, tentativa).
   */
  CLAUDIA_WEBHOOK_FORMATO: z.preprocess(emptyAsUndefined, z.enum(["v1", "v2"]).default("v1")),
  /** Segredo do HMAC: com ele, todo aviso leva X-WhatsOn-Timestamp e X-WhatsOn-Assinatura (sha256 do corpo). */
  CLAUDIA_WEBHOOK_SECRET: z.preprocess(emptyAsUndefined, z.string().min(16).optional()),
  /** v2: inclui o texto das mensagens em mensagens_recentes (desligado: só tipo, origem, hora e anexos). */
  CLAUDIA_WEBHOOK_INCLUIR_TEXTO: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).default("false")),
  /** v2: queda da conexão só vira conexao_prolongada depois deste tempo fora. */
  CLAUDIA_CONEXAO_MINUTOS: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().default(10)),
  /**
   * "economico": só avisa de conversas com a Claudia ou de contatos cujo Produto contém um dos termos de
   * CLAUDIA_PRODUTOS; sem avisos de conexão nem de número vigiado. "completo": todos os eventos.
   */
  CLAUDIA_WEBHOOK_MODO: z.preprocess(emptyAsUndefined, z.enum(["completo", "economico"]).default("completo")),
  /** Termos (separados por vírgula, sem diferenciar acento/maiúscula) do Produto do contato que a Claudia atende. */
  CLAUDIA_PRODUTOS: z.preprocess(emptyAsUndefined, z.string().default("multicomercio")),
  /** Janela de agrupamento (s) para conversas sem atendente; com atendente segue 60 s. */
  CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(60).max(600).default(120)),
  /** "obrigado"/👍 até 24 h depois de finalizar: fecha a conversa nova sem mensagem e não avisa a Claudia. */
  CLAUDIA_AUTO_REACAO: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).default("false")),
  /** Conversa com a Claudia sem resposta do cliente: lembrete aos 15 min e finaliza aos 30, sem avisar a Claudia. */
  CLAUDIA_AUTO_INATIVIDADE: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).default("false")),
  CLAUDIA_TEXTO_LEMBRETE: z.preprocess(
    emptyAsUndefined,
    z.string().default("Olá! Ainda está por aí? Se precisar de mais alguma coisa, é só responder por aqui."),
  ),
  /** Vazio = mensagem de inatividade da empresa (ou de encerramento da conexão). */
  CLAUDIA_TEXTO_INATIVIDADE: z.preprocess(emptyAsUndefined, z.string().optional()),
  /** Conversa nova aguardando com a fila fora do expediente: manda o texto abaixo e não avisa a Claudia. */
  CLAUDIA_AUTO_FORA_HORARIO: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).default("false")),
  /** Vazio = mensagem de fora do horário da conexão. */
  CLAUDIA_TEXTO_FORA_HORARIO: z.preprocess(emptyAsUndefined, z.string().optional()),
  /** Queda de conexão (mais de CLAUDIA_CONEXAO_MINUTOS) avisada direto: "whatsapp:5579...,whatsapp:5579...". */
  ALERTA_CONEXAO_DESTINOS: z.preprocess(emptyAsUndefined, z.string().default("")),
  /**
   * Transferência sem aceite (10/20 min) avisada direto a estes destinos, em vez de acordar a Claudia.
   * Só para conversas dos usuários de CLAUDIA_ALERTA_TECNICOS (IDs), online e devendo resposta ao cliente.
   */
  ALERTA_SEM_ACEITE_DESTINOS: z.preprocess(emptyAsUndefined, z.string().default("")),
  CLAUDIA_ALERTA_TECNICOS: z.preprocess(emptyAsUndefined, z.string().default("")),
  /** v2: valor do campo "ambiente" (ex.: homologacao, producao). */
  CLAUDIA_AMBIENTE: z.preprocess(emptyAsUndefined, z.string().default("producao")),
  /** Super-admin da plataforma, criado na subida se ainda não existir. */
  SUPERADMIN_EMAIL: z.preprocess(emptyAsUndefined, z.string().email().optional()),
  SUPERADMIN_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
});

/** Valores de exemplo (.env.example da raiz e do backend) que nunca podem ir para produção. */
export const PLACEHOLDER_SECRETS = new Set([
  "troque-esta-chave",
  "troque-por-uma-string-longa-aleatoria",
  "troque-por-outra-string-longa-aleatoria",
  "dev-access-secret-change-me-123",
  "dev-refresh-secret-change-me-123",
]);

type ProductionEnvInput = Pick<
  z.infer<typeof schema>,
  "NODE_ENV" | "JWT_SECRET" | "JWT_REFRESH_SECRET" | "EVOLUTION_API_KEY" | "SEED_ADMIN_PASSWORD"
>;

/** Em produção recusa segredos de exemplo/curtos e a senha padrão do admin. */
export function validateProductionEnv(input: ProductionEnvInput): void {
  if (input.NODE_ENV !== "production") return;
  const problems: string[] = [];
  for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET", "EVOLUTION_API_KEY"] as const) {
    const value = input[key];
    if (PLACEHOLDER_SECRETS.has(value)) problems.push(`${key} está com o valor de exemplo`);
    else if (value.length < 32) problems.push(`${key} deve ter pelo menos 32 caracteres`);
  }
  if (input.SEED_ADMIN_PASSWORD === "admin123") problems.push("SEED_ADMIN_PASSWORD não pode ser \"admin123\"");
  if (problems.length) {
    throw new Error(`Configuração insegura para produção: ${problems.join("; ")}. Ajuste o arquivo .env.`);
  }
}

export const env = schema.parse(process.env);
validateProductionEnv(env);
export type Env = typeof env;
