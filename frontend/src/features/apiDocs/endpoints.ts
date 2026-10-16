/** Especificação da API externa (/api/v1): fonte única do manual, do console de testes e dos exemplos de código. */

export type HttpMethod = "GET" | "POST";

export interface EndpointField {
  name: string;
  type: "string" | "file";
  required: boolean;
  description: string;
  example?: string;
  multiline?: boolean;
}

export interface EndpointSpec {
  id: string;
  method: HttpMethod;
  path: string;
  title: string;
  summary: string;
  /** "json" envia application/json; "multipart" aceita também arquivos (vira JSON quando não há arquivo). */
  body: "none" | "json" | "multipart";
  fields: EndpointField[];
  response: unknown;
  errors: string[];
  notes?: string[];
  /** Ação que altera o estado do número (pede confirmação no console). */
  destructive?: boolean;
}

const number: EndpointField = {
  name: "number",
  type: "string",
  required: true,
  description: "Telefone do destinatário. Aceita qualquer formatação; com DDD e sem DDI, o 55 é adicionado.",
  example: "5511988887777",
};

const sendResponse = {
  ticketId: 42,
  contactId: 17,
  number: "5511988887777",
  messages: [{ id: 901, type: "text", ack: "pending" }],
};

export const ENDPOINTS: EndpointSpec[] = [
  {
    id: "status",
    method: "GET",
    path: "/connection/status",
    title: "Status da conexão",
    summary: "Informa se o número do token está conectado ao WhatsApp.",
    body: "none",
    fields: [],
    response: { status: "connected", number: "5511999990000" },
    errors: ["UNAUTHENTICATED", "INVALID_API_TOKEN"],
    notes: ["status: connected (ativo), qrcode (aguardando leitura) ou disconnected."],
  },
  {
    id: "qrcode",
    method: "GET",
    path: "/connection/qrcode",
    title: "QR code",
    summary: "Gera o QR code (imagem base64) para conectar o número pelo celular.",
    body: "none",
    fields: [],
    response: { qrcode: "data:image/png;base64,iVBORw0KGgo...", status: "qrcode" },
    errors: ["PROVIDER_ERROR"],
    notes: [
      "O QR expira em poucos segundos: peça de novo a cada ~20 s até o status virar connected.",
      "Com o número já conectado volta { qrcode: null, status: \"connected\" }.",
      "Exiba o valor de qrcode direto como src de uma imagem.",
    ],
  },
  {
    id: "logout",
    method: "POST",
    path: "/connection/logout",
    title: "Desconectar",
    summary: "Desconecta o número do WhatsApp. Para voltar, leia um novo QR code.",
    body: "none",
    fields: [],
    response: { status: "disconnected" },
    errors: ["PROVIDER_ERROR"],
    destructive: true,
  },
  {
    id: "send",
    method: "POST",
    path: "/messages/send",
    title: "Enviar mensagem",
    summary: "Envia texto (JSON) ou arquivos (multipart, campo medias). A mensagem entra no atendimento do contato.",
    body: "multipart",
    fields: [
      number,
      {
        name: "body",
        type: "string",
        required: false,
        description: "Texto da mensagem (até 4096 caracteres). Com arquivos, vira a legenda do primeiro.",
        example: "Olá! Seu pedido 1234 saiu para entrega.",
        multiline: true,
      },
      {
        name: "medias",
        type: "file",
        required: false,
        description: "Até 10 arquivos de 16 MB (imagem, áudio, vídeo, PDF ou outro documento). Só em multipart/form-data.",
      },
    ],
    response: sendResponse,
    errors: ["VALIDATION_ERROR", "INVALID_PHONE", "NUMBER_NOT_ON_WHATSAPP", "CONNECTION_NOT_CONNECTED", "UPLOAD_ERROR"],
    notes: [
      "Informe body, medias ou os dois.",
      "O envio ao WhatsApp é assíncrono: ack começa em pending e evolui para sent, delivered e read.",
    ],
  },
  {
    id: "send-media-url",
    method: "POST",
    path: "/messages/send-media-url",
    title: "Enviar mídia por URL",
    summary: "Baixa o arquivo de uma URL pública e envia ao contato.",
    body: "json",
    fields: [
      number,
      { name: "url", type: "string", required: true, description: "URL http(s) pública do arquivo (até 16 MB).", example: "https://exemplo.com/boleto.pdf" },
      { name: "caption", type: "string", required: false, description: "Legenda (até 1024 caracteres).", example: "Segue o boleto" },
      { name: "fileName", type: "string", required: false, description: "Nome do arquivo exibido no WhatsApp. Padrão: o nome na URL.", example: "boleto-1234.pdf" },
    ],
    response: { ...sendResponse, messages: [{ id: 902, type: "document", ack: "pending" }] },
    errors: ["INVALID_MEDIA_URL", "MEDIA_DOWNLOAD_FAILED", "MEDIA_TOO_LARGE", "NUMBER_NOT_ON_WHATSAPP", "CONNECTION_NOT_CONNECTED"],
    notes: ["Endereços internos (localhost, 10.x, 192.168.x...) são recusados.", "Segue até 3 redirecionamentos."],
  },
  {
    id: "check",
    method: "POST",
    path: "/contacts/check",
    title: "Verificar número",
    summary: "Confere se o número tem WhatsApp, sem enviar nada.",
    body: "json",
    fields: [number],
    response: { exists: true, jid: "5511988887777@s.whatsapp.net" },
    errors: ["INVALID_PHONE", "CONNECTION_NOT_CONNECTED"],
  },
];

export interface ErrorSpec {
  code: string;
  status: number;
  meaning: string;
  action: string;
}

export const ERRORS: ErrorSpec[] = [
  { code: "UNAUTHENTICATED", status: 401, meaning: "Cabeçalho Authorization ausente.", action: "Envie Authorization: Bearer <token>." },
  { code: "INVALID_API_TOKEN", status: 403, meaning: "Token inexistente ou regenerado.", action: "Copie o token atual em Conexões." },
  { code: "COMPANY_BLOCKED", status: 403, meaning: "Empresa bloqueada no WhatsOn.", action: "Fale com o suporte; não repita." },
  { code: "VALIDATION_ERROR", status: 400, meaning: "Campo obrigatório ausente ou inválido.", action: "Corrija o payload; não repita igual." },
  { code: "INVALID_PHONE", status: 400, meaning: "Telefone com quantidade de dígitos inválida.", action: "Revise o cadastro do número." },
  { code: "INVALID_MEDIA_URL", status: 400, meaning: "URL inválida, não pública ou não http(s).", action: "Use uma URL pública." },
  { code: "MEDIA_DOWNLOAD_FAILED", status: 400, meaning: "Não foi possível baixar a URL.", action: "Confira se a URL abre sem login." },
  { code: "MEDIA_TOO_LARGE", status: 400, meaning: "Arquivo acima de 16 MB.", action: "Reduza o arquivo." },
  { code: "UPLOAD_ERROR", status: 400, meaning: "Arquivo grande demais ou campo errado.", action: "Use o campo medias, até 16 MB." },
  { code: "NUMBER_NOT_ON_WHATSAPP", status: 404, meaning: "O número não tem WhatsApp.", action: "Marque o contato; não repita." },
  { code: "CONNECTION_NOT_CONNECTED", status: 409, meaning: "Número desconectado do WhatsApp.", action: "Reconecte pelo QR code e repita." },
  { code: "RATE_LIMITED", status: 429, meaning: "Limite de requisições por minuto excedido.", action: "Aguarde Retry-After segundos e repita." },
  { code: "PROVIDER_ERROR", status: 502, meaning: "Falha temporária no serviço do WhatsApp.", action: "Repita com espera crescente." },
  { code: "INTERNAL_ERROR", status: 500, meaning: "Erro inesperado.", action: "Repita mais tarde; persistindo, avise o suporte." },
];

export function endpointById(id: string): EndpointSpec {
  return ENDPOINTS.find((e) => e.id === id) ?? ENDPOINTS[0];
}

/** Payload de exemplo do endpoint (só campos de texto com exemplo). */
export function examplePayload(endpoint: EndpointSpec): Record<string, string> {
  return Object.fromEntries(
    endpoint.fields.filter((f) => f.type === "string" && f.example !== undefined).map((f) => [f.name, f.example!]),
  );
}
