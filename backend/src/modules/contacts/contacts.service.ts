import { Op } from "sequelize";
import { Contact, Ticket } from "../../models";
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
      ? { [Op.or]: [{ name: { [Op.iLike]: `%${term}%` } }, { number: { [Op.like]: `%${term}%` } }] }
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

export async function updateContact(companyId: number, id: number, input: { name: string }) {
  const contact = await getContactOr404(companyId, id);
  await contact.update({ name: input.name });
  // tickets embutem o contato: atualiza lista e cabeçalho de quem está com eles na tela
  const active = await Ticket.findAll({
    where: { companyId, contactId: id, status: { [Op.ne]: "closed" } },
    attributes: ["id"],
  });
  await Promise.all(active.map((t) => emitTicket(t.id)));
  return contact;
}
