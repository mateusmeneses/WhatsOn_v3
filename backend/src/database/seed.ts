import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { Company, User } from "../models";
import { sequelize } from "./sequelize";

/** Instalação nova: cria a empresa demo e o admin inicial. Não faz nada se já existir algum usuário. */
export async function seed(): Promise<{ created: boolean }> {
  if ((await User.count()) > 0) return { created: false };
  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10);
  await sequelize.transaction(async (transaction) => {
    const company = await Company.create({ name: "Empresa Demo" }, { transaction });
    await User.create(
      {
        companyId: company.id,
        name: "Administrador",
        email: env.SEED_ADMIN_EMAIL.toLowerCase(),
        profile: "admin",
        passwordHash,
      },
      { transaction },
    );
  });
  return { created: true };
}

if (require.main === module) {
  seed()
    .then((r) => console.log(r.created ? "seed: admin criado" : "seed: já existem usuários, nada a fazer"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}
