import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({ tableName: "user_queues", timestamps: false })
export class UserQueue extends Model {
  @PrimaryKey
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @PrimaryKey
  @Column({ type: DataType.INTEGER, allowNull: false })
  queueId!: number;
}
