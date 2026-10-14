export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function notFound(what = "Registro"): AppError {
  return new AppError("NOT_FOUND", 404, `${what} não encontrado`);
}
