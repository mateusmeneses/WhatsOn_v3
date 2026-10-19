import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "companies" })
export class Company extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "active" })
  status!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "America/Sao_Paulo" })
  timezone!: string;

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
