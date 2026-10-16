import { Column, DataType, Model, Table } from "sequelize-typescript";

export type ConnectionStatus = "disconnected" | "qrcode" | "connected";

export const DEFAULT_TRANSFER_MESSAGE = "Aguarde, em instantes um atendente irá falar com você.";
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.";

@Table({ tableName: "connections" })
export class Connection extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  instanceName!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "disconnected" })
  status!: ConnectionStatus;

  @Column({ type: DataType.STRING, allowNull: true })
  number!: string | null;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  webhookToken!: string;

  /** Token da API externa (/api/v1). Nulo até o admin gerar. */
  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  apiToken!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isDefault!: boolean;

  @Column({ type: DataType.INTEGER, allowNull: true })
  defaultQueueId!: number | null;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: DEFAULT_OUT_OF_HOURS_MESSAGE })
  outOfHoursMessage!: string;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  closingMessage!: string;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: DEFAULT_TRANSFER_MESSAGE })
  transferMessage!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 30 })
  botTimeoutMinutes!: number;
}
