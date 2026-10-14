import { migrator } from "./migrator";
import { sequelize } from "./sequelize";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  if (command === "up") await migrator.up();
  else if (command === "down") await migrator.down();
  else throw new Error(`comando desconhecido: ${command}`);
  console.log(`migrations ${command}: ok`);
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
