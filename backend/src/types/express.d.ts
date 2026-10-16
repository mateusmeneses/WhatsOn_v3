import type { Connection } from "../models";
import { AuthContext } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Conexão autenticada pelo token da API externa (/api/v1). */
      apiConnection?: Connection;
    }
  }
}

export {};
