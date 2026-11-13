import { Column, DataType, Model, Table } from "sequelize-typescript";

/** Aviso à Claudia como foi (ou vai ser) enviado: um por id_evento; os reenvios mandam exatamente este corpo. */
@Table({ tableName: "claudia_events", updatedAt: false })
export class ClaudiaEventLog extends Model {
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  eventId!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  event!: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  ticketId!: number | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  payload!: Record<string, unknown>;
}
