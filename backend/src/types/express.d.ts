import type { Connection, Partner } from "../models";
import { AuthContext, SessionContext } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      /** Sessão dentro de uma empresa (definida por isAuth). */
      auth?: AuthContext;
      /** Qualquer sessão válida, inclusive a do super-admin fora de uma empresa. */
      authSession?: SessionContext;
      /** Conexão autenticada pelo token da API externa (/api/v1). */
      apiConnection?: Connection;
      /** Sistema parceiro autenticado pela chave da API de parceiros (/api/partner/v1). */
      partner?: Partner;
    }
  }
}

export {};
