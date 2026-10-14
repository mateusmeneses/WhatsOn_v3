import { Column, DataType, Model, Table } from "sequelize-typescript";

export type Profile = "admin" | "supervisor" | "agent";

@Table({ tableName: "users" })
export class User extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  passwordHash!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "agent" })
  profile!: Profile;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  online!: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  tokenVersion!: number;
}
