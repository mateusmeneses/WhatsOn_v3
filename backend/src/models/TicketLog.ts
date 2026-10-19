import { Column, DataType, Model, Table } from "sequelize-typescript";

export type TicketEvent = "created" | "accepted" | "transferred" | "closed" | "bot_timeout" | "reopened" | "claimed";

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

  /** Transferência direta para um técnico (null = para a fila). */
  @Column({ type: DataType.INTEGER, allowNull: true })
  toUserId!: number | null;

  /** Requerido: técnico de quem o atendimento foi tirado. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  fromUserId!: number | null;

  /** Recado interno deixado ao requerer (nunca vai para o cliente). */
  @Column({ type: DataType.TEXT, allowNull: true })
  note!: string | null;
}
