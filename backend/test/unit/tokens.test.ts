import jwt from "jsonwebtoken";
import { env } from "../../src/config/env";
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from "../../src/modules/auth/tokens";

describe("tokens typ claim", () => {
  it("accepts own valid tokens", () => {
    expect(verifyAccessToken(signAccessToken({ id: 7, companyId: 3, profile: "admin" }))).toEqual({
      userId: 7,
      companyId: 3,
      profile: "admin",
    });
    expect(verifyRefreshToken(signRefreshToken({ id: 7, tokenVersion: 2 }))).toEqual({ userId: 7, tokenVersion: 2 });
  });

  it("rejects typ=access signed with the refresh secret as a refresh token", () => {
    const token = jwt.sign({ typ: "access", tv: 0 }, env.JWT_REFRESH_SECRET, { subject: "7" });
    expect(() => verifyRefreshToken(token)).toThrow("invalid refresh token");
  });

  it("rejects typ=refresh signed with the access secret as an access token", () => {
    const token = jwt.sign({ typ: "refresh", companyId: 3, profile: "admin" }, env.JWT_SECRET, { subject: "7" });
    expect(() => verifyAccessToken(token)).toThrow("invalid access token");
  });
});
