import { Column, DataType, Model, Table } from "sequelize-typescript";

export type BotAction = "submenu" | "reply" | "transfer_queue" | "transfer_agent" | "close";

@Table({ tableName: "chatbot_nodes" })
export class ChatbotNode extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  parentId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  order!: number;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "" })
  key!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "" })
  title!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "submenu" })
  action!: BotAction;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  message!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaUrl!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaMime!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaName!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  queueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;
}
