import { QueryInterface } from "sequelize";
import * as m0001 from "./0001-initial";

export interface MigrationModule {
  name: string;
  up(qi: QueryInterface): Promise<void>;
  down(qi: QueryInterface): Promise<void>;
}

export const migrations: MigrationModule[] = [{ name: "0001-initial", up: m0001.up, down: m0001.down }];
