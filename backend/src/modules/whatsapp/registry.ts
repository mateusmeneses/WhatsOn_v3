import { EvolutionProvider } from "./evolution/EvolutionProvider";
import { WhatsAppProvider } from "./provider";

let current: WhatsAppProvider | null = null;

export function getProvider(): WhatsAppProvider {
  if (!current) current = new EvolutionProvider();
  return current;
}

/** Usado em testes para injetar um provider falso; `null` volta ao padrão. */
export function setProvider(provider: WhatsAppProvider | null): void {
  current = provider;
}
