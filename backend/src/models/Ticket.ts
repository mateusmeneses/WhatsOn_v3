import { BelongsTo, Column, DataType, Model, Table } from "sequelize-typescript";
import { Connection } from "./Connection";
import { Contact } from "./Contact";
import { Queue } from "./Queue";
import { User } from "./User";

export type TicketStatus = "bot" | "pending" | "open" | "closed";

@Table({ tableName: "tickets" })
export class Ticket extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  queueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "pending" })
  status!: TicketStatus;

  @Column({ type: DataType.INTEGER, allowNull: true })
  chatbotNodeId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  chatbotAttempts!: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  lastMessage!: string;

  @Column({ type: DataType.DATE, allowNull: true })
  lastMessageAt!: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  unreadCount!: number;

  @Column({ type: DataType.DATE, allowNull: true })
  closedAt!: Date | null;

  @BelongsTo(() => Contact, "contactId")
  contact?: Contact;

  @BelongsTo(() => Connection, "connectionId")
  connection?: Connection;

  @BelongsTo(() => Queue, "queueId")
  queue?: Queue | null;

  @BelongsTo(() => User, "userId")
  user?: User | null;
}
