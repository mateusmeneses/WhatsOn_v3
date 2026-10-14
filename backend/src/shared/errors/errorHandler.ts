import { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { logger } from "../logger";
import { AppError } from "./AppError";

const MULTER_MESSAGES: Partial<Record<MulterError["code"], string>> = {
  LIMIT_FILE_SIZE: "Arquivo maior que 16 MB",
  LIMIT_FILE_COUNT: "Arquivos demais no envio",
  LIMIT_UNEXPECTED_FILE: "Campo de arquivo inesperado",
  LIMIT_FIELD_KEY: "Nome de campo muito longo",
  LIMIT_FIELD_VALUE: "Valor de campo muito longo",
  LIMIT_FIELD_COUNT: "Campos demais no envio",
  LIMIT_PART_COUNT: "Partes demais no envio",
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
    return;
  }
  if (err instanceof MulterError) {
    const message = MULTER_MESSAGES[err.code] ?? "Falha no envio do arquivo";
    res.status(400).json({ error: { code: "UPLOAD_ERROR", message } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "JSON inválido" } });
    return;
  }
  const status = typeof err?.status === "number" ? err.status : err?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && err?.expose) {
    if (status === 413) {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Conteúdo da requisição muito grande" } });
    } else {
      res.status(status).json({ error: { code: "BAD_REQUEST", message: "Requisição inválida" } });
    }
    return;
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
};
