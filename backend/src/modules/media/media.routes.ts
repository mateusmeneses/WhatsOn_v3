import { Router } from "express";
import multer from "multer";
import { AppError } from "../../shared/errors/AppError";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { saveBuffer } from "./media.storage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

export const mediaRoutes = Router();

mediaRoutes.post("/", isAuth, upload.single("file"), async (req, res) => {
  if (!req.file) throw new AppError("FILE_REQUIRED", 400, "Arquivo obrigatório");
  const stored = await saveBuffer(currentAuth(req).companyId, req.file.buffer, req.file.mimetype, req.file.originalname);
  res.status(201).json(stored);
});
