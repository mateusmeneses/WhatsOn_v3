export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = "test";
  const { sequelize } = await import("../../src/database/sequelize");
  const { migrator } = await import("../../src/database/migrator");
  await sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrator.up();
  await sequelize.close();
}
