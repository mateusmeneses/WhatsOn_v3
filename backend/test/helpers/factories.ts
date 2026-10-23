import "../../src/database/sequelize";
import bcrypt from "bcryptjs";
import {
  ChatbotNode,
  Company,
  Connection,
  Contact,
  Message,
  Partner,
  Profile,
  Queue,
  Ticket,
  TicketStatus,
  User,
  UserQueue,
  WeekSchedule,
} from "../../src/models";
import { generatePartnerKey } from "../../src/modules/partners/partnerKey";

let seq = 0;
const next = () => ++seq;

export function createCompany(
  attrs: Partial<{ name: string; timezone: string; status: string; cnpj: string | null; partnerId: number | null }> = {},
) {
  return Company.create({ name: `Empresa ${next()}`, ...attrs });
}

/** Parceiro com a chave em claro (o banco guarda só o hash). */
export async function createPartner(attrs: Partial<{ name: string; status: "active" | "revoked" }> = {}) {
  const { key, keyHash, keyPrefix } = generatePartnerKey();
  const partner = await Partner.create({ name: `Parceiro ${next()}`, keyHash, keyPrefix, ...attrs });
  return { partner, key };
}

export async function createUser(
  companyId: number,
  attrs: Partial<{
    name: string;
    email: string;
    password: string;
    profile: Profile;
    queueIds: number[];
    canViewBot: boolean;
    canViewOtherQueues: boolean;
    canViewOthersOpen: boolean;
    canClaimTickets: boolean;
    phone: string | null;
  }> = {},
) {
  const n = next();
  const { password = "secret123", queueIds = [], ...rest } = attrs;
  const user = await User.create({
    companyId,
    name: `Usuário ${n}`,
    email: `user${n}@test.local`,
    profile: "agent",
    passwordHash: await bcrypt.hash(password, 4),
    ...rest,
  });
  if (queueIds.length) await UserQueue.bulkCreate(queueIds.map((queueId) => ({ userId: user.id, queueId })));
  return user;
}

export async function createSuperAdmin(attrs: Partial<{ name: string; email: string; password: string }> = {}) {
  const n = next();
  const { password = "secret123", ...rest } = attrs;
  return User.create({
    companyId: null,
    name: `Super ${n}`,
    email: `super${n}@test.local`,
    profile: "superadmin",
    passwordHash: await bcrypt.hash(password, 4),
    ...rest,
  });
}

export function createQueue(companyId: number, attrs: Partial<{ name: string; color: string; schedule: WeekSchedule }> = {}) {
  return Queue.create({ companyId, name: `Fila ${next()}`, ...attrs });
}

export function createConnection(companyId: number, attrs: Record<string, unknown> = {}) {
  const n = next();
  return Connection.create({
    companyId,
    name: `Conexão ${n}`,
    instanceName: `inst_${n}`,
    webhookToken: `token_${n}`,
    status: "connected",
    number: "5511999990000",
    ...attrs,
  });
}

export function createContact(companyId: number, attrs: Record<string, unknown> = {}) {
  const n = next();
  return Contact.create({ companyId, name: `Contato ${n}`, number: `5511${90000000 + n}`, ...attrs });
}

export function createTicket(
  attrs: { companyId: number; contactId: number; connectionId: number; status?: TicketStatus } & Record<string, unknown>,
) {
  return Ticket.create({ status: "pending", ...attrs });
}

export function createMessage(ticket: Ticket, attrs: Record<string, unknown> = {}) {
  return Message.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    fromMe: false,
    body: "oi",
    type: "text",
    ack: "delivered",
    ...attrs,
  });
}

export function createNode(connection: Connection, attrs: Record<string, unknown> = {}) {
  return ChatbotNode.create({
    companyId: connection.companyId,
    connectionId: connection.id,
    parentId: null,
    order: 0,
    key: "",
    title: "",
    action: "submenu",
    message: "",
    ...attrs,
  });
}

/** Empresa + fila + conexão (com a fila como padrão) + contato. */
export async function scenario() {
  const company = await createCompany();
  const queue = await createQueue(company.id);
  const connection = await createConnection(company.id, { defaultQueueId: queue.id });
  const contact = await createContact(company.id);
  return { company, queue, connection, contact };
}
