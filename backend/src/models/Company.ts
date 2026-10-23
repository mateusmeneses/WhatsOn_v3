import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "companies" })
export class Company extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "active" })
  status!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "America/Sao_Paulo" })
  timezone!: string;

  /** Meta de primeira resposta ao cliente, em minutos (indicador "no prazo" do dashboard). */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 5 })
  responseSlaMinutes!: number;

  /** Finaliza o atendimento quando o cliente fica esse tempo sem responder (minutos; 0 = desligado). */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  inactivityCloseMinutes!: number;

  /** Mensagem enviada ao finalizar por inatividade; vazia = usa a mensagem de encerramento da conexão. */
  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  inactivityCloseMessage!: string;

  /** Técnico sem responder o cliente: avisa a cada intervalo (minutos de expediente da fila; 0 = desligado). */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 15 })
  idleAlertMinutes!: number;

  /** CNPJ normalizado (14 caracteres, sem pontuação). Nulo em empresas antigas do painel. */
  @Column({ type: DataType.STRING(14), allowNull: true, unique: true })
  cnpj!: string | null;

  /** Parceiro que criou a empresa pela API de parceiros; nulo = criada no painel. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  partnerId!: number | null;

  @Column({ type: DataType.STRING, allowNull: true })
  contactEmail!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  contactPhone!: string | null;
}
