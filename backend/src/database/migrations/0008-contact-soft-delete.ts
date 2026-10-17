import { QueryInterface } from "sequelize";

/** Contato apagado some da consulta, mas fica no banco: o número continua único por empresa e o histórico de tickets o referencia. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE NULL`);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`ALTER TABLE "contacts" DROP COLUMN IF EXISTS "deletedAt"`);
}
