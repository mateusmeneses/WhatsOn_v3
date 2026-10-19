import { formatCnpj, normalizeCnpj } from "../../src/shared/cnpj";

describe("cnpj", () => {
  it("strips punctuation from a numeric CNPJ", () => {
    expect(normalizeCnpj("12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizeCnpj(" 12345678000195 ")).toBe("12345678000195");
  });

  it("accepts the alphanumeric CNPJ and upper-cases it", () => {
    expect(normalizeCnpj("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(normalizeCnpj("12abc34501de35")).toBe("12ABC34501DE35");
  });

  it.each(["12345678000196", "11111111111111", "00000000000000", "123", "12ABC34501DEAB", ""])(
    "rejects %p",
    (raw) => {
      expect(() => normalizeCnpj(raw)).toThrow(expect.objectContaining({ code: "INVALID_CNPJ", status: 400 }));
    },
  );

  it("formats for display", () => {
    expect(formatCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
});
