import { AppError } from "./errors/AppError";

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, ...WEIGHTS_1];

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * Normaliza e valida o CNPJ: tira a pontuação, passa para maiúsculo e confere os dígitos verificadores.
 * Aceita o numérico e o alfanumérico (Receita, a partir de jul/2026): valor de cada caractere = ASCII − 48.
 */
export function normalizeCnpj(raw: string): string {
  const cnpj = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const valid =
    /^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) &&
    !/^(.)\1{13}$/.test(cnpj) &&
    checkDigit(cnpj, WEIGHTS_1) === Number(cnpj[12]) &&
    checkDigit(cnpj, WEIGHTS_2) === Number(cnpj[13]);
  if (!valid) throw new AppError("INVALID_CNPJ", 400, "CNPJ inválido");
  return cnpj;
}

export function formatCnpj(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
