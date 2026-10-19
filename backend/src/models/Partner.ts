import { Column, DataType, Model, Table } from "sequelize-typescript";

export type PartnerStatus = "active" | "revoked";

/** Sistema parceiro (ex.: ERP) que cria empresas e conexões pela API de parceiros. */
@Table({ tableName: "partners" })
export class Partner extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  /** SHA-256 da chave; a chave em si só é mostrada na criação/regeneração. */
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  keyHash!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  keyPrefix!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "active" })
  status!: PartnerStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  lastUsedAt!: Date | null;
}
