import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../../database/sequelize";
import { Contact, Ticket, TicketStatus } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";
import { emitTicket } from "../tickets/ticket.events";

export async function listContacts(companyId: number, { search, page }: { search?: string; page: number }) {
  const term = search?.trim();
  const where = {
    companyId,
    isGroup: false,
    deletedAt: null,
    ...(term
      ? {
          [Op.or]: [
            { name: { [Op.iLike]: `%${term}%` } },
            { number: { [Op.like]: `%${term}%` } },
            { clientCompany: { [Op.iLike]: `%${term}%` } },
          ],
        }
      : {}),
  };
  const rows = await Contact.findAll({
    where,
    order: [["name", "ASC"]],
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  return paginate(rows);
}

export async function getContactOr404(companyId: number, id: number): Promise<Contact> {
  const contact = await Contact.findOne({ where: { id, companyId, deletedAt: null } });
  if (!contact) throw notFound("Contato");
  return contact;
}

export async function deleteContact(companyId: number, id: number): Promise<void> {
  const contact = await getContactOr404(companyId, id);
  await contact.update({ deletedAt: new Date() });
}

export interface ContactUpdate {
  name?: string;
  clientCompany?: string | null;
  managerClientId?: number | null;
  product?: string | null;
  managerProductId?: number | null;
}

export async function updateContact(companyId: number, id: number, input: ContactUpdate) {
  const contact = await getContactOr404(companyId, id);
  // Só os campos enviados: os ausentes ficam como estão.
  await contact.update(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
  // tickets embutem o contato: atualiza lista e cabeçalho de quem está com eles na tela
  const active = await Ticket.findAll({
    where: { companyId, contactId: id, status: { [Op.ne]: "closed" } },
    attributes: ["id"],
  });
  await Promise.all(active.map((t) => emitTicket(t.id)));
  return contact;
}

export interface ContactStats {
  id: number;
  tickets: number;
  lastContactAt: Date | null;
  /** Situação do atendimento em andamento, se houver. */
  activeStatus: TicketStatus | null;
}

/** Histórico resumido dos contatos de uma página da lista (máx. 100 ids por chamada). */
export async function contactStats(companyId: number, ids: number[]): Promise<ContactStats[]> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (unique.length === 0) return [];
  return sequelize.query<ContactStats>(
    `SELECT c.id,
       (SELECT count(*) FROM tickets t WHERE t."contactId" = c.id)::int AS tickets,
       (SELECT max(m."createdAt") FROM messages m JOIN tickets t ON t.id = m."ticketId" WHERE t."contactId" = c.id) AS "lastContactAt",
       (SELECT t.status FROM tickets t WHERE t."contactId" = c.id AND t.status <> 'closed' ORDER BY t.id DESC LIMIT 1) AS "activeStatus"
     FROM contacts c WHERE c."companyId" = :companyId AND c.id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { companyId, ids: unique } },
  );
}
