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

  /** Empresa do cliente (nome do cliente no Manager, quando vinculado). */
  @Column({ type: DataType.STRING, allowNull: true })
  clientCompany!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  managerClientId!: number | null;

  /** Produto (sistema) que o contato usa; o bot pergunta por ele no menu de suporte. */
  @Column({ type: DataType.STRING, allowNull: true })
  product!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  managerProductId!: number | null;

  /** Apagado na consulta (soft delete). Não é o `paranoid` do Sequelize: o número segue único e reativável. */
  @Column({ type: DataType.DATE, allowNull: true })
  deletedAt!: Date | null;
}
