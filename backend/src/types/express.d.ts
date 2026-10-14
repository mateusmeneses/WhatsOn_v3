import { AuthContext } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
