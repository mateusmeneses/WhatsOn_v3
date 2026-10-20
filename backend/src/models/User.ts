import { Column, DataType, Model, Table } from "sequelize-typescript";

/** "superadmin" só existe no banco: dentro de uma empresa o token do super-admin usa "admin". */
export type Profile = "admin" | "supervisor" | "agent" | "superadmin";

@Table({ tableName: "users" })
export class User extends Model {
  declare id: number;

  /** null só para o super-admin, que não pertence a nenhuma empresa. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  companyId!: number | null;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  passwordHash!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "agent" })
  profile!: Profile;

  @Column({ type: DataType.STRING, allowNull: true })
  phone!: string | null;

  /** Senha temporária: o usuário precisa trocá-la antes de usar o sistema. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  mustChangePassword!: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  online!: boolean;

  /** Atendente vê (e pode aceitar) os chamados ainda no bot. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  canViewBot!: boolean;

  /** Atendente vê (e pode aceitar) os chamados aguardando em qualquer fila. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  canViewOtherQueues!: boolean;

  /** Atendente vê os chamados em atendimento com outros atendentes. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  canViewOthersOpen!: boolean;

  /** Pode requerer qualquer atendimento não finalizado (admin sempre pode). Também passa a ver todos. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  canClaimTickets!: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  tokenVersion!: number;

  /** Último login com senha (alimenta o dashboard). */
  @Column({ type: DataType.DATE, allowNull: true })
  lastLoginAt!: Date | null;

  /** Última vez que o painel dele esteve conectado (atualizado ao conectar e desconectar). */
  @Column({ type: DataType.DATE, allowNull: true })
  lastSeenAt!: Date | null;
}
