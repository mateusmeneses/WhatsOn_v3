import { env } from "../config/env";

/**
 * Esperas entre as tentativas inline (1ª→2ª, 2ª→3ª). Mutável para os testes; em NODE_ENV=test já é curta.
 * Repetir dentro do mesmo job evita que jobs seguintes do mesmo shard passem na frente (ordem por contato/ticket).
 */
export const inlineRetry = {
  delaysMs: env.NODE_ENV === "test" ? [1, 1] : [500, 1500],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executa `fn` até `delaysMs.length + 1` vezes; relança o último erro. */
export async function retryInline<T>(fn: () => Promise<T>, delaysMs: number[] = inlineRetry.delaysMs): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delaysMs.length) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}
