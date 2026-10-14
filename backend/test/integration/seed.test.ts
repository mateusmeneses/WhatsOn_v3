import bcrypt from "bcryptjs";
import { env } from "../../src/config/env";
import { seed } from "../../src/database/seed";
import { Company, User } from "../../src/models";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

describe("seed", () => {
  beforeEach(resetDb);

  it("creates a demo company and an admin on an empty database", async () => {
    await expect(seed()).resolves.toEqual({ created: true });
    const admin = await User.findOne({ where: { email: env.SEED_ADMIN_EMAIL } });
    expect(admin).toMatchObject({ profile: "admin" });
    expect(await bcrypt.compare(env.SEED_ADMIN_PASSWORD, admin!.passwordHash)).toBe(true);
    expect(await Company.count()).toBe(1);
  });

  it("is idempotent", async () => {
    await seed();
    await expect(seed()).resolves.toEqual({ created: false });
    expect(await User.count()).toBe(1);
  });

  it("does nothing when users already exist", async () => {
    const company = await createCompany();
    await createUser(company.id);
    await expect(seed()).resolves.toEqual({ created: false });
    expect(await Company.count()).toBe(1);
  });
});
