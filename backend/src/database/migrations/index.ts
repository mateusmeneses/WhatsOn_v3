import { QueryInterface } from "sequelize";
import * as m0001 from "./0001-initial";
import * as m0002 from "./0002-message-edit-delete";
import * as m0003 from "./0003-reopen-user-phone-scheduled";
import * as m0004 from "./0004-connection-api-token";
import * as m0005 from "./0005-super-admin";
import * as m0006 from "./0006-user-ticket-access";
import * as m0007 from "./0007-ticket-log-to-user";
import * as m0008 from "./0008-contact-soft-delete";
import * as m0009 from "./0009-ticket-claim";
import * as m0010 from "./0010-partners";
import * as m0011 from "./0011-dashboard-metrics";
import * as m0012 from "./0012-company-response-sla";
import * as m0013 from "./0013-messages-covering-index";
import * as m0014 from "./0014-company-inactivity-close";
import * as m0015 from "./0015-ticket-bot-path";
import * as m0016 from "./0016-ticket-notes";
import * as m0017 from "./0017-ticket-manager-refs";

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
  { name: "0005-super-admin", up: m0005.up, down: m0005.down },
  { name: "0006-user-ticket-access", up: m0006.up, down: m0006.down },
  { name: "0007-ticket-log-to-user", up: m0007.up, down: m0007.down },
  { name: "0008-contact-soft-delete", up: m0008.up, down: m0008.down },
  { name: "0009-ticket-claim", up: m0009.up, down: m0009.down },
  { name: "0010-partners", up: m0010.up, down: m0010.down },
  { name: "0011-dashboard-metrics", up: m0011.up, down: m0011.down },
  { name: "0012-company-response-sla", up: m0012.up, down: m0012.down },
  { name: "0013-messages-covering-index", up: m0013.up, down: m0013.down },
  { name: "0014-company-inactivity-close", up: m0014.up, down: m0014.down },
  { name: "0015-ticket-bot-path", up: m0015.up, down: m0015.down },
  { name: "0016-ticket-notes", up: m0016.up, down: m0016.down },
  { name: "0017-ticket-manager-refs", up: m0017.up, down: m0017.down },
];
