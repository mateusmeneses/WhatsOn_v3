import { QueryInterface } from "sequelize";

/** Super-admin não pertence a nenhuma empresa: users.companyId passa a aceitar NULL. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`ALTER TABLE "users" ALTER COLUMN "companyId" DROP NOT NULL`);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`DELETE FROM "users" WHERE "companyId" IS NULL`);
  await qi.sequelize.query(`ALTER TABLE "users" ALTER COLUMN "companyId" SET NOT NULL`);
}
