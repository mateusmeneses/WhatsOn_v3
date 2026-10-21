import { describe, expect, it } from "vitest";
import { suggestProduct } from "./RegisterAtendimentoDialog";

const produtos = [
  { cod_produto: 1, descricao: "NOVO MULTICOMERCIO (NUVEM)" },
  { cod_produto: 2, descricao: "MULTICOMERCIO" },
  { cod_produto: 3, descricao: "Acadêmico" },
];

describe("suggestProduct", () => {
  it("matches the system chosen in the bot menu, ignoring accents and case", () => {
    expect(suggestProduct("Suporte técnico › Academico", produtos)).toBe(3);
    expect(suggestProduct("Suporte técnico › Multicomércio", produtos)).toBe(2);
  });

  it("prefers the exact description and ignores the parenthesis when falling back", () => {
    expect(suggestProduct("Suporte técnico › Novo Multicomércio (Nuvem)", produtos)).toBe(1);
  });

  it("suggests nothing without a path or a matching product", () => {
    expect(suggestProduct(null, produtos)).toBeUndefined();
    expect(suggestProduct("Suporte técnico › João", produtos)).toBeUndefined();
  });
});
