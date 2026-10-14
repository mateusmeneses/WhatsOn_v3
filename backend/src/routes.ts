import { Router } from "express";
import { authRoutes } from "./modules/auth/auth.routes";
import { companyRoutes } from "./modules/companies/companies.routes";
import { connectionRoutes } from "./modules/connections/connections.routes";
import { contactRoutes } from "./modules/contacts/contacts.routes";
import { mediaRoutes } from "./modules/media/media.routes";
import { messageRoutes } from "./modules/messages/messages.routes";
import { queueRoutes } from "./modules/queues/queues.routes";
import { ticketRoutes } from "./modules/tickets/tickets.routes";
import { userRoutes } from "./modules/users/users.routes";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/queues", queueRoutes);
apiRoutes.use("/company", companyRoutes);
apiRoutes.use("/users", userRoutes);
apiRoutes.use("/contacts", contactRoutes);
apiRoutes.use("/media", mediaRoutes);
apiRoutes.use("/connections", connectionRoutes);
apiRoutes.use("/tickets", ticketRoutes);
apiRoutes.use(messageRoutes);
