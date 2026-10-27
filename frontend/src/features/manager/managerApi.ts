import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { updateContact, type ContactUpdate } from "@/features/contacts/contactsApi";
import type { Contact, Ticket } from "@/types/api";

export interface ManagerContact {
  cod_contato: number;
  nome: string;
  telefone: string | null;
  funcao?: string | null;
}

export interface ManagerClient {
  cod_cliente: number;
  nome: string;
  fantasia: string | null;
  cnpj: string | null;
  contato: ManagerContact | null;
}

export interface ManagerCatalog {
  usuarios: { cod_usuario: number; nome: string; email: string | null }[];
  produtos: { cod_produto: number; descricao: string }[];
  tipos_atendimento: { cod_tipo_atendimento: number; descricao: string }[];
  colunas: { cod_coluna: number; nome: string }[];
  prioridades_os: { id: number; nome: string }[];
  prioridades_atendimento: { id: number; nome: string }[];
}

export interface OpenOsBody {
  titulo: string;
  descricao: string;
  prioridade: number;
  codCliente: number;
  codSolicitante?: number;
}

export interface RegisterAtendimentoBody {
  codCliente: number;
  codSolicitante?: number;
  codProduto?: number;
  codTipoAtendimento?: number;
  prioridade?: number;
  descricao: string;
}

export const managerKeys = {
  status: ["manager", "status"] as const,
  catalog: ["manager", "catalog"] as const,
  clients: (ticketId: number | null, q: string) => ["manager", "clients", ticketId, q] as const,
  contacts: (codCliente: number) => ["manager", "contacts", codCliente] as const,
};

export async function fetchManagerClients(params: { ticketId?: number; contactId?: number; q?: string }): Promise<ManagerClient[]> {
  const { data } = await api.get<{ clientes: ManagerClient[] }>("/manager/clients", { params });
  return data.clientes;
}

export async function fetchManagerContacts(codCliente: number): Promise<ManagerContact[]> {
  const { data } = await api.get<{ contatos: ManagerContact[] }>(`/manager/clients/${codCliente}/contacts`);
  return data.contatos;
}

export async function fetchManagerCatalog(): Promise<ManagerCatalog> {
  const { data } = await api.get<ManagerCatalog>("/manager/catalog");
  return data;
}

export async function openManagerOs(ticketId: number, body: OpenOsBody): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${ticketId}/manager/os`, body);
  return data;
}

export async function registerManagerAtendimento(ticketId: number, body: RegisterAtendimentoBody): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${ticketId}/manager/atendimento`, body);
  return data;
}

/** A integração com o Manager só existe para a empresa configurada no servidor. */
export function useManagerEnabled(): boolean {
  const { data } = useQuery({
    queryKey: managerKeys.status,
    queryFn: async () => (await api.get<{ enabled: boolean }>("/manager/status")).data.enabled,
    staleTime: Infinity,
  });
  return data === true;
}

/** Guarda no contato a empresa e o produto usados no Manager, para os próximos atendimentos. Falha não atrapalha o fluxo. */
export async function rememberOnContact(
  contact: Contact | undefined,
  choice: { client?: { id: number; name?: string }; product?: { id: number; name: string } },
): Promise<void> {
  if (!contact) return;
  const patch: ContactUpdate = {};
  if (choice.client && choice.client.id !== contact.managerClientId) {
    patch.managerClientId = choice.client.id;
    if (choice.client.name) patch.clientCompany = choice.client.name;
  }
  if (choice.product && choice.product.id !== contact.managerProductId) {
    patch.managerProductId = choice.product.id;
    patch.product = choice.product.name;
  }
  if (Object.keys(patch).length === 0) return;
  await updateContact(contact.id, patch).catch(() => undefined);
}

export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Descrição inicial a partir do que o atendimento já sabe: menu escolhido pelo cliente e observações internas. */
export function ticketSummaryText(ticket: Ticket): string {
  const lines = [
    `Contato no WhatsApp: ${ticket.contact?.name ?? "—"} (${ticket.contact?.number ?? "—"})`,
    ticket.botPath ? `Menu escolhido: ${ticket.botPath}` : "",
    ticket.notes ? `Observações: ${ticket.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
