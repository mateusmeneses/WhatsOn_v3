import { Contact, User } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { AuthContext } from "../auth/auth.types";
import { getContactOr404 } from "../contacts/contacts.service";
import { emitTicket } from "../tickets/ticket.events";
import { getVisibleTicket, loadTicket } from "../tickets/tickets.service";
import { managerRequest } from "./manager.client";

export interface ManagerClient {
  cod_cliente: number;
  nome: string;
  fantasia: string | null;
  cnpj: string | null;
  contato: { cod_contato: number; nome: string; telefone: string | null } | null;
}

export interface ManagerCatalog {
  usuarios: { cod_usuario: number; nome: string; email: string | null; celular: string | null }[];
  produtos: { cod_produto: number; descricao: string }[];
  tipos_atendimento: { cod_tipo_atendimento: number; descricao: string }[];
  colunas: { cod_coluna: number; nome: string }[];
  prioridades_os: { id: number; nome: string }[];
  prioridades_atendimento: { id: number; nome: string }[];
}

const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { at: number; value: ManagerCatalog } | null = null;

export function resetManagerCache(): void {
  catalogCache = null;
}

export async function getCatalog(): Promise<ManagerCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const value = await managerRequest<ManagerCatalog>("GET", "/catalogos/");
  catalogCache = { at: Date.now(), value };
  return value;
}

export async function searchClients(
  auth: AuthContext,
  input: { ticketId?: number; contactId?: number; q?: string },
): Promise<{ clientes: ManagerClient[] }> {
  if (input.contactId !== undefined) {
    const contact = await getContactOr404(auth.companyId, input.contactId);
    return managerRequest("GET", "/clientes/", { query: { telefone: contact.number } });
  }
  if (input.ticketId !== undefined) {
    const ticket = await getVisibleTicket(auth, input.ticketId);
    const contact = await Contact.findByPk(ticket.contactId);
    return managerRequest("GET", "/clientes/", { query: { telefone: contact?.number } });
  }
  return managerRequest("GET", "/clientes/", { query: { q: input.q } });
}

export function clientContacts(codCliente: number) {
  return managerRequest("GET", `/clientes/${codCliente}/contatos/`);
}

/** Usuário do Manager que corresponde ao do WhatsOn, pelo e-mail. */
async function managerUserId(userId: number, override?: number): Promise<number> {
  const catalog = await getCatalog();
  if (override !== undefined) {
    if (!catalog.usuarios.some((u) => u.cod_usuario === override)) {
      throw new AppError("MANAGER_USER_NOT_FOUND", 400, "Usuário do Manager não encontrado");
    }
    return override;
  }
  const user = await User.findByPk(userId);
  const email = user?.email.trim().toLowerCase();
  const match = email ? catalog.usuarios.find((u) => u.email?.trim().toLowerCase() === email) : undefined;
  if (!match) {
    throw new AppError("MANAGER_USER_NOT_FOUND", 400, "Seu e-mail não tem usuário correspondente no Manager");
  }
  return match.cod_usuario;
}

export interface OpenOsInput {
  titulo: string;
  descricao: string;
  prioridade: number;
  codCliente: number;
  codSolicitante?: number;
  codContrato?: number;
  codResponsavel?: number;
  dtVencimento?: string;
}

export async function openOs(auth: AuthContext, ticketId: number, input: OpenOsInput) {
  const ticket = await getVisibleTicket(auth, ticketId);
  if (ticket.managerOsId) throw new AppError("MANAGER_OS_EXISTS", 409, `Este atendimento já tem a OS #${ticket.managerOsId}`);
  const criador = await managerUserId(auth.userId);
  const result = await managerRequest<{ cod_os: number; url: string }>("POST", "/os/", {
    body: {
      titulo: input.titulo,
      descricao: input.descricao,
      prioridade: input.prioridade,
      cod_cliente: input.codCliente,
      cod_solicitante: input.codSolicitante ?? null,
      cod_contrato: input.codContrato ?? null,
      cod_responsavel: input.codResponsavel ?? null,
      cod_criador: criador,
      dt_vencimento: input.dtVencimento ?? null,
      ticket_id: ticket.id,
    },
  });
  await ticket.update({ managerOsId: result.cod_os, managerOsUrl: result.url });
  await emitTicket(ticket.id);
  return loadTicket(ticket.id);
}

export interface RegisterAtendimentoInput {
  codCliente: number;
  codSolicitante?: number;
  codProduto?: number;
  codTipoAtendimento?: number;
  codTecnico?: number;
  prioridade?: number;
  descricao: string;
}

export async function registerAtendimento(auth: AuthContext, ticketId: number, input: RegisterAtendimentoInput): Promise<Awaited<ReturnType<typeof loadTicket>>> {
  const ticket = await getVisibleTicket(auth, ticketId);
  if (ticket.managerAtendimentoId) {
    throw new AppError("MANAGER_ATENDIMENTO_EXISTS", 409, `Este atendimento já foi registrado no Manager (#${ticket.managerAtendimentoId})`);
  }
  const tecnico = await managerUserId(ticket.userId ?? auth.userId, input.codTecnico);
  const result = await managerRequest<{ cod_atendimento: number }>("POST", "/atendimentos/", {
    body: {
      cod_cliente: input.codCliente,
      cod_solicitante: input.codSolicitante ?? null,
      cod_tecnico: tecnico,
      cod_produto: input.codProduto ?? null,
      cod_tipo_atendimento: input.codTipoAtendimento ?? null,
      prioridade: input.prioridade ?? null,
      dt_abertura: ticket.createdAt.toISOString(),
      dt_fim: (ticket.closedAt ?? new Date()).toISOString(),
      descricao: input.descricao,
      ticket_id: ticket.id,
    },
  });
  await ticket.update({ managerAtendimentoId: result.cod_atendimento });
  await emitTicket(ticket.id);
  return loadTicket(ticket.id);
}
