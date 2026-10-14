import { Op } from "sequelize";
import { Contact } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";

export async function listContacts(companyId: number, { search, page }: { search?: string; page: number }) {
  const term = search?.trim();
  const where = {
    companyId,
    isGroup: false,
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
  const contact = await Contact.findOne({ where: { id, companyId } });
  if (!contact) throw notFound("Contato");
  return contact;
}

export async function updateContact(companyId: number, id: number, input: { name: string }) {
  const contact = await getContactOr404(companyId, id);
  return contact.update({ name: input.name });
}
