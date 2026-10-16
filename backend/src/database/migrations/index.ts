import { QueryInterface } from "sequelize";
import * as m0001 from "./0001-initial";
import * as m0002 from "./0002-message-edit-delete";
import * as m0003 from "./0003-reopen-user-phone-scheduled";
import * as m0004 from "./0004-connection-api-token";

export interface MigrationModule {
  name: string;
  up(qi: QueryInterface): Promise<void>;
  down(qi: QueryInterface): Promise<void>;
}

export const migrations: MigrationModule[] = [
  { name: "0001-initial", up: m0001.up, down: m0001.down },
  { name: "0002-message-edit-delete", up: m0002.up, down: m0002.down },
  { name: "0003-reopen-user-phone-scheduled", up: m0003.up, down: m0003.down },
  { name: "0004-connection-api-token", up: m0004.up, down: m0004.down },
];
