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

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  tokenVersion!: number;
}
