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
}
