import { DataTypes, Op, QueryInterface } from "sequelize";

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false };
const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};
const fk = (model: string, onDelete: "CASCADE" | "SET NULL" | "RESTRICT", allowNull = false) => ({
  type: DataTypes.INTEGER,
  allowNull,
  references: { model, key: "id" },
  onDelete,
  onUpdate: "CASCADE",
});
const str = (allowNull = false, defaultValue?: string) => ({
  type: DataTypes.STRING,
  allowNull,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
});
const text = (defaultValue: string) => ({ type: DataTypes.TEXT, allowNull: false, defaultValue });
const bool = (defaultValue: boolean) => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue });
const int = (defaultValue: number) => ({ type: DataTypes.INTEGER, allowNull: false, defaultValue });
const nullableInt = { type: DataTypes.INTEGER, allowNull: true };
const nullableDate = { type: DataTypes.DATE, allowNull: true };

export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable("companies", {
    id,
    name: str(),
    status: str(false, "active"),
    timezone: str(false, "America/Sao_Paulo"),
    ...timestamps,
  });

  await qi.createTable("users", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: str(),
    profile: str(false, "agent"),
    online: bool(false),
    tokenVersion: int(0),
    ...timestamps,
  });

  await qi.createTable("queues", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    color: str(false, "#6d5dfc"),
    schedule: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ...timestamps,
  });

  await qi.createTable("user_queues", {
    userId: { ...fk("users", "CASCADE"), primaryKey: true },
    queueId: { ...fk("queues", "CASCADE"), primaryKey: true },
  });

  await qi.createTable("connections", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    instanceName: { type: DataTypes.STRING, allowNull: false, unique: true },
    status: str(false, "disconnected"),
    number: str(true),
    webhookToken: { type: DataTypes.STRING, allowNull: false, unique: true },
    isDefault: bool(false),
    defaultQueueId: fk("queues", "SET NULL", true),
    outOfHoursMessage: text(
      "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.",
    ),
    closingMessage: text(""),
    transferMessage: text("Aguarde, em instantes um atendente irá falar com você."),
    botTimeoutMinutes: int(30),
    ...timestamps,
  });

  await qi.createTable("contacts", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    number: str(),
    profilePicUrl: str(true),
    isGroup: bool(false),
    ...timestamps,
  });
  await qi.addIndex("contacts", ["companyId", "number"], { unique: true, name: "contacts_company_number_unique" });

  await qi.createTable("tickets", {
    id,
    companyId: fk("companies", "CASCADE"),
    contactId: fk("contacts", "RESTRICT"),
    connectionId: fk("connections", "RESTRICT"),
    queueId: fk("queues", "SET NULL", true),
    userId: fk("users", "SET NULL", true),
    status: str(false, "pending"),
    chatbotNodeId: nullableInt,
    chatbotAttempts: int(0),
    lastMessage: text(""),
    lastMessageAt: nullableDate,
    unreadCount: int(0),
    closedAt: nullableDate,
    ...timestamps,
  });
  await qi.addIndex("tickets", ["contactId", "connectionId"], {
    unique: true,
    name: "tickets_one_open_per_contact",
    where: { status: { [Op.ne]: "closed" } },
  });
  await qi.addIndex("tickets", ["companyId", "status", "lastMessageAt"], { name: "tickets_company_status_last" });

  await qi.createTable("messages", {
    id,
    companyId: fk("companies", "CASCADE"),
    ticketId: fk("tickets", "CASCADE"),
    connectionId: fk("connections", "CASCADE"),
    providerMessageId: str(true),
    fromMe: bool(false),
    body: text(""),
    type: str(false, "text"),
    mediaUrl: str(true),
    mediaMime: str(true),
    mediaName: str(true),
    ack: str(false, "sent"),
    quotedMessageId: fk("messages", "SET NULL", true),
    sentByUserId: fk("users", "SET NULL", true),
    isBot: bool(false),
    ...timestamps,
  });
  await qi.addIndex("messages", ["connectionId", "providerMessageId"], {
    unique: true,
    name: "messages_provider_id_unique",
  });
  await qi.addIndex("messages", ["ticketId", "id"], { name: "messages_ticket_id" });

  await qi.createTable("chatbot_nodes", {
    id,
    companyId: fk("companies", "CASCADE"),
    connectionId: fk("connections", "CASCADE"),
    parentId: fk("chatbot_nodes", "CASCADE", true),
    order: int(0),
    key: str(false, ""),
    title: str(false, ""),
    action: str(false, "submenu"),
    message: text(""),
    mediaUrl: str(true),
    mediaMime: str(true),
    mediaName: str(true),
    queueId: fk("queues", "SET NULL", true),
    userId: fk("users", "SET NULL", true),
    ...timestamps,
  });
  await qi.addIndex("chatbot_nodes", ["connectionId"], {
    unique: true,
    name: "chatbot_one_root_per_connection",
    where: { parentId: null },
  });
  await qi.addIndex("chatbot_nodes", ["parentId", "key"], {
    unique: true,
    name: "chatbot_unique_key_per_parent",
    where: { parentId: { [Op.ne]: null } },
  });

  await qi.createTable("ticket_logs", {
    id,
    companyId: fk("companies", "CASCADE"),
    ticketId: fk("tickets", "CASCADE"),
    event: str(),
    userId: fk("users", "SET NULL", true),
    fromQueueId: fk("queues", "SET NULL", true),
    toQueueId: fk("queues", "SET NULL", true),
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down(qi: QueryInterface): Promise<void> {
  for (const table of [
    "ticket_logs",
    "chatbot_nodes",
    "messages",
    "tickets",
    "contacts",
    "connections",
    "user_queues",
    "queues",
    "users",
    "companies",
  ]) {
    await qi.dropTable(table);
  }
}
