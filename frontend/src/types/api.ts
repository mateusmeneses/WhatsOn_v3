export type Profile = "admin" | "supervisor" | "agent";
export type TicketStatus = "bot" | "pending" | "open" | "closed";
export type Ack = "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location";
export type ConnectionStatus = "disconnected" | "qrcode" | "connected";
export type BotAction = "submenu" | "reply" | "transfer_queue" | "transfer_agent" | "close";
export type WeekDay = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type WeekSchedule = Partial<Record<WeekDay, string[]>>;

export interface PublicUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  profile: Profile;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface UserView extends PublicUser {
  queueIds: number[];
}

export interface UserOption {
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
