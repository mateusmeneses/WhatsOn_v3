import { BelongsTo, Column, DataType, Model, Table } from "sequelize-typescript";
import { Ticket } from "./Ticket";

export type ScheduledStatus = "pending" | "sending" | "sent" | "canceled" | "failed";

@Table({ tableName: "scheduled_messages" })
export class ScheduledMessage extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  ticketId!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  body!: string;

  @Column({ type: DataType.DATE, allowNull: false })
  sendAt!: Date;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "pending" })
  status!: ScheduledStatus;

  @Column({ type: DataType.INTEGER, allowNull: true })
  messageId!: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  error!: string | null;

  @BelongsTo(() => Ticket, "ticketId")
  ticket?: Ticket;
}
