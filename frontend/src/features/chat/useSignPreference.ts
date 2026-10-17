import { useCallback, useState } from "react";

const KEY = "whatson:sign-messages";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Preferência do administrador de assinar as mensagens (lembrada neste navegador; padrão: assinar). */
export function useSignPreference(): [boolean, () => void] {
  const [sign, setSign] = useState(read);
  const toggle = useCallback(() => {
    setSign((current) => {
      const next = !current;
      try {
        localStorage.setItem(KEY, next ? "on" : "off");
      } catch {
        // Sem armazenamento a escolha vale só nesta tela.
      }
      return next;
    });
  }, []);
  return [sign, toggle];
}
