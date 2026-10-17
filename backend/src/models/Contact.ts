import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "contacts" })
export class Contact extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  number!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  profilePicUrl!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isGroup!: boolean;

  /** Apagado na consulta (soft delete). Não é o `paranoid` do Sequelize: o número segue único e reativável. */
  @Column({ type: DataType.DATE, allowNull: true })
  deletedAt!: Date | null;
}
