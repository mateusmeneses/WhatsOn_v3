/** "superadmin" só aparece fora de uma empresa; dentro dela o super-admin atua como "admin". */
export type Profile = "admin" | "supervisor" | "agent" | "superadmin";
/** Perfis de usuários de uma empresa. */
export type CompanyProfile = Exclude<Profile, "superadmin">;
export type TicketStatus = "bot" | "pending" | "open" | "closed";
export type Ack = "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location";
export type ConnectionStatus = "disconnected" | "qrcode" | "connected";
export type BotAction = "submenu" | "reply" | "transfer_queue" | "transfer_agent" | "close";
export type WeekDay = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type WeekSchedule = Partial<Record<WeekDay, string[]>>;

export interface PublicUser {
  id: number;
  /** Para o super-admin, a empresa em que está atuando (null no painel da plataforma). */
  companyId: number | null;
  name: string;
  email: string;
  profile: Profile;
  phone?: string | null;
  /** Senha temporária: precisa trocar antes de usar o sistema. */
  mustChangePassword?: boolean;
  /** Super-admin da plataforma (pode entrar em qualquer empresa). */
  superAdmin?: boolean;
}

/** Resultado do envio do acesso por WhatsApp; a senha só vem quando não foi possível enviar. */
export interface AccessDelivery {
  sent: boolean;
  temporaryPassword?: string;
}

export type ScheduledStatus = "pending" | "sending" | "sent" | "canceled" | "failed";

export interface ScheduledMessage {
  id: number;
  ticketId: number;
  userId: number | null;
  body: string;
  sendAt: string;
  status: ScheduledStatus;
  error: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/** Permissões extras de atendimento: visibilidade (só atendentes) e requerer (atendentes e supervisores). */
export interface TicketAccess {
  canViewBot: boolean;
  canViewOtherQueues: boolean;
  canViewOthersOpen: boolean;
  /** Pode requerer atendimentos (atendente e supervisor; admin sempre pode). Também faz ver todos. */
  canClaimTickets: boolean;
}

export interface UserView extends PublicUser, Partial<TicketAccess> {
  profile: CompanyProfile;
  queueIds: number[];
  /** Presença (só na listagem). */
  online?: boolean;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
}

export interface UserOption extends Partial<TicketAccess> {
  id: number;
  name: string;
  queueIds: number[];
}

export interface Queue {
  id: number;
  companyId: number;
  name: string;
  color: string;
  schedule: WeekSchedule;
}

export interface Contact {
  id: number;
  companyId: number;
  name: string;
  number: string;
  profilePicUrl: string | null;
  isGroup: boolean;
}

export interface Ticket {
  id: number;
  companyId: number;
  contactId: number;
  connectionId: number;
  queueId: number | null;
  userId: number | null;
  status: TicketStatus;
  chatbotNodeId: number | null;
  chatbotAttempts: number;
  botPath: string | null;
  notes: string;
  managerOsId: number | null;
  managerOsUrl: string | null;
  managerAtendimentoId: number | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: Contact;
  queue?: Queue | null;
  user?: { id: number; name: string } | null;
}

export type TicketEvent = "created" | "accepted" | "transferred" | "closed" | "bot_timeout" | "inactivity" | "reopened" | "claimed";

/** Um passo da linha do tempo do atendimento (GET /tickets/:id/history). */
export interface TicketHistoryEntry {
  id: number;
  event: TicketEvent;
  createdAt: string;
  user: { id: number; name: string } | null;
  fromQueue: { id: number; name: string; color: string } | null;
  toQueue: { id: number; name: string; color: string } | null;
  toUser: { id: number; name: string } | null;
  /** Requerido: técnico de quem o atendimento foi tirado. */
  fromUser: { id: number; name: string } | null;
  /** Recado interno deixado ao requerer. */
  note: string | null;
}

export interface Message {
  id: number;
  companyId: number;
  ticketId: number;
  connectionId: number;
  providerMessageId: string | null;
  fromMe: boolean;
  body: string;
  type: MessageType;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  ack: Ack;
  quotedMessageId: number | null;
  sentByUserId: number | null;
  isBot: boolean;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface Connection {
  id: number;
  companyId: number;
  name: string;
  instanceName: string;
  status: ConnectionStatus;
  number: string | null;
  isDefault: boolean;
  defaultQueueId: number | null;
  outOfHoursMessage: string;
  closingMessage: string;
  transferMessage: string;
  botTimeoutMinutes: number;
  hasApiToken?: boolean;
}

export interface ChatbotNode {
  id: number;
  companyId: number;
  connectionId: number;
  parentId: number | null;
  order: number;
  key: string;
  title: string;
  action: BotAction;
  message: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  queueId: number | null;
  userId: number | null;
}

export interface StoredMedia {
  url: string;
  mime: string;
  name: string | null;
}

export interface Company {
  id: number;
  name: string;
  status: string;
  timezone: string;
  /** Meta de primeira resposta, em minutos. */
  responseSlaMinutes?: number;
  /** Finaliza quando o cliente fica esse tempo sem responder (minutos; 0 = desligado). */
  inactivityCloseMinutes?: number;
  /** Enviada ao finalizar por inatividade; vazia = usa a mensagem de encerramento da conexão. */
  inactivityCloseMessage?: string;
  /** Avisa o técnico que não responde o cliente a cada esse tempo de expediente (minutos; 0 = desligado). */
  idleAlertMinutes?: number;
}

/** Empresa vista pelo super-admin. */
export interface AdminCompany extends Company {
  createdAt: string;
  userCount: number;
  /** CNPJ sem pontuação (14 caracteres). */
  cnpj: string | null;
  /** Sistema parceiro que criou a empresa pela API de parceiros. */
  partner: { id: number; name: string } | null;
}

export interface AdminPartner {
  id: number;
  name: string;
  /** Início da chave, para reconhecê-la; a chave completa só aparece ao criar/regenerar. */
  keyPrefix: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
  createdAt: string;
  companyCount: number;
}

export interface BotState {
  nodeId: number | null;
  attempts: number;
}

export type BotEffect =
  | { type: "send_text"; text: string }
  | { type: "send_media"; media: StoredMedia; caption: string }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "close" };

export interface StepResult {
  effects: BotEffect[];
  state: BotState;
  finished: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
