import { validateProductionEnv } from "../../src/config/env";

const strong = "a".repeat(32);
const base = {
  NODE_ENV: "production" as const,
  JWT_SECRET: strong,
  JWT_REFRESH_SECRET: strong + "b",
  EVOLUTION_API_KEY: strong + "c",
  SEED_ADMIN_PASSWORD: "outra-senha-forte",
};

describe("validateProductionEnv", () => {
  it("accepts strong production values", () => {
    expect(() => validateProductionEnv(base)).not.toThrow();
  });

  it("ignores non-production environments", () => {
    expect(() =>
      validateProductionEnv({ ...base, NODE_ENV: "development", JWT_SECRET: "curto", SEED_ADMIN_PASSWORD: "admin123" }),
    ).not.toThrow();
  });

  it("refuses placeholder secrets", () => {
    expect(() => validateProductionEnv({ ...base, EVOLUTION_API_KEY: "troque-esta-chave" })).toThrow(
      /EVOLUTION_API_KEY está com o valor de exemplo/,
    );
    expect(() => validateProductionEnv({ ...base, JWT_SECRET: "troque-por-uma-string-longa-aleatoria" })).toThrow(
      /JWT_SECRET/,
    );
  });

  it("refuses short secrets", () => {
    expect(() => validateProductionEnv({ ...base, JWT_REFRESH_SECRET: "x".repeat(31) })).toThrow(
      /JWT_REFRESH_SECRET deve ter pelo menos 32 caracteres/,
    );
  });

  it("refuses the default admin password", () => {
    expect(() => validateProductionEnv({ ...base, SEED_ADMIN_PASSWORD: "admin123" })).toThrow(/SEED_ADMIN_PASSWORD/);
  });
});
