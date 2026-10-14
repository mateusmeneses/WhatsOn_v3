import { Router } from "express";
import { authRoutes } from "./modules/auth/auth.routes";
import { queueRoutes } from "./modules/queues/queues.routes";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/queues", queueRoutes);
