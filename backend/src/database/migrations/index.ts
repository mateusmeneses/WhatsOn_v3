import { QueryInterface } from "sequelize";
import * as m0001 from "./0001-initial";
import * as m0002 from "./0002-message-edit-delete";

export interface MigrationModule {
  name: string;
  up(qi: QueryInterface): Promise<void>;
  down(qi: QueryInterface): Promise<void>;
}

export const migrations: MigrationModule[] = [
  { name: "0001-initial", up: m0001.up, down: m0001.down },
  { name: "0002-message-edit-delete", up: m0002.up, down: m0002.down },
];
