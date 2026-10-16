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

/** Cria o super-admin configurado (SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD) se ainda não existir; nunca altera um existente. */
export async function ensureSuperAdmin(
  email = env.SUPERADMIN_EMAIL,
  password = env.SUPERADMIN_PASSWORD,
): Promise<{ created: boolean }> {
  if (!email || !password) return { created: false };
  const normalized = email.trim().toLowerCase();
  if (await User.count({ where: { email: normalized } })) return { created: false };
  await User.create({
    companyId: null,
    name: "Super-admin",
    email: normalized,
    profile: "superadmin",
    passwordHash: await bcrypt.hash(password, 10),
  });
  return { created: true };
}

if (require.main === module) {
  // Em sequência: o seed só cria o admin demo quando não há nenhum usuário.
  seed()
    .then(async (r) => [r, await ensureSuperAdmin()] as const)
    .then(([r, sa]) => {
      console.log(r.created ? "seed: admin criado" : "seed: já existem usuários, nada a fazer");
      if (sa.created) console.log("seed: super-admin criado");
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}
