import { BelongsTo, Column, DataType, Model, Table } from "sequelize-typescript";
import { Ticket } from "./Ticket";

export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location";
export type Ack = "pending" | "sent" | "delivered" | "read" | "failed";

@Table({ tableName: "messages" })
export class Message extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  ticketId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.STRING, allowNull: true })
  providerMessageId!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  fromMe!: boolean;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  body!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "text" })
  type!: MessageType;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaUrl!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaMime!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaName!: string | null;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "sent" })
  ack!: Ack;

  @Column({ type: DataType.INTEGER, allowNull: true })
  quotedMessageId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  sentByUserId!: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isBot!: boolean;

  @BelongsTo(() => Ticket, "ticketId")
  ticket?: Ticket;
}
