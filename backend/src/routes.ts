import { Router } from "express";
import { authRoutes } from "./modules/auth/auth.routes";
import { companyRoutes } from "./modules/companies/companies.routes";
import { queueRoutes } from "./modules/queues/queues.routes";
import { userRoutes } from "./modules/users/users.routes";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/queues", queueRoutes);
apiRoutes.use("/company", companyRoutes);
apiRoutes.use("/users", userRoutes);
