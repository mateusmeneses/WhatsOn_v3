import { Column, DataType, Model, Table } from "sequelize-typescript";

export type TicketEvent = "created" | "accepted" | "transferred" | "closed" | "bot_timeout" | "reopened";

@Table({ tableName: "ticket_logs", updatedAt: false })
export class TicketLog extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  ticketId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  event!: TicketEvent;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  fromQueueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  toQueueId!: number | null;
}
