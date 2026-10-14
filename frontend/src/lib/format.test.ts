import { formatPhone, initials } from "./format";

describe("format helpers", () => {
  it("formats Brazilian mobile and landline numbers", () => {
    expect(formatPhone("5511988887777")).toBe("+55 (11) 98888-7777");
    expect(formatPhone("551133334444")).toBe("+55 (11) 3333-4444");
    expect(formatPhone("123456789012345")).toBe("123456789012345");
  });

  it("builds initials", () => {
    expect(initials("Maria Souza Lima")).toBe("MS");
    expect(initials("  ")).toBe("?");
  });
});
