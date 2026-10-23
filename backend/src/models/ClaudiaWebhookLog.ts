import { Column, DataType, Model, Table } from "sequelize-typescript";

/** Uma tentativa de envio de aviso à Claudia (statusCode null = sem resposta: erro de rede ou timeout). */
@Table({ tableName: "claudia_webhook_logs", updatedAt: false })
export class ClaudiaWebhookLog extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  eventId!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  event!: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  ticketId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false })
  attempt!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  statusCode!: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  error!: string | null;
}
