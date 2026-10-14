import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "companies" })
export class Company extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "active" })
  status!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "America/Sao_Paulo" })
  timezone!: string;
}
