import { Column, DataType, Model, Table } from "sequelize-typescript";

export type WeekDay = "0" | "1" | "2" | "3" | "4" | "5" | "6";
/** Chave = dia da semana (0 = domingo). Valor = intervalos "HH:mm-HH:mm". Objeto vazio = sempre aberto. */
export type WeekSchedule = Partial<Record<WeekDay, string[]>>;

@Table({ tableName: "queues" })
export class Queue extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "#6d5dfc" })
  color!: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  schedule!: WeekSchedule;
}
