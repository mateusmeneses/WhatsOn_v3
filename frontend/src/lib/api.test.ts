import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import type { PublicUser } from "@/types/api";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import { api } from "./api";
import { errorCode, errorMessage } from "./apiError";

const user: PublicUser = { id: 1, companyId: 1, name: "Ana", email: "ana@test.local", profile: "admin" };
let apiMock: MockAdapter;
let rawMock: MockAdapter;

beforeEach(() => {
  apiMock = new MockAdapter(api);
  rawMock = new MockAdapter(axios);
  useAuth.getState().clear();
});

afterEach(() => {
  apiMock.restore();
  rawMock.restore();
});

describe("api client", () => {
  it("sends the access token as a bearer header", async () => {
    useAuth.setState({ accessToken: "abc", user });
    apiMock.onGet("/queues").reply((config) => [200, { auth: config.headers?.Authorization }]);
    const { data } = await api.get("/queues");
    expect(data.auth).toBe("Bearer abc");
  });

  it("refreshes once for concurrent 401s and retries the requests", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    apiMock
      .onGet("/tickets")
      .reply((config) => (config.headers?.Authorization === "Bearer new" ? [200, { ok: true }] : [401, {}]));
    rawMock.onPost("/api/auth/refresh").reply(200, { accessToken: "new", refreshToken: "r2", user });

    const [a, b] = await Promise.all([api.get("/tickets"), api.get("/tickets")]);

    expect(a.data).toEqual({ ok: true });
    expect(b.data).toEqual({ ok: true });
    expect(rawMock.history.post).toHaveLength(1);
    expect(refreshTokenStorage.get()).toBe("r2");
    expect(useAuth.getState().accessToken).toBe("new");
  });

  it("clears the session when the refresh fails", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    apiMock.onGet("/tickets").reply(401, {});
    rawMock.onPost("/api/auth/refresh").reply(401, { error: { code: "INVALID_REFRESH", message: "Sessão expirada" } });

    await expect(api.get("/tickets")).rejects.toBeDefined();
    expect(useAuth.getState().user).toBeNull();
    expect(refreshTokenStorage.get()).toBeNull();
  });

  it("does not try to refresh failed auth calls", async () => {
    apiMock.onPost("/auth/login").reply(401, { error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos" } });
    await expect(api.post("/auth/login", {})).rejects.toBeDefined();
    expect(rawMock.history.post).toHaveLength(0);
  });
});

describe("errorMessage", () => {
  it("uses the API message and code", async () => {
    apiMock.onGet("/x").reply(409, { error: { code: "TICKET_ALREADY_ACCEPTED", message: "Já foi aceito" } });
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Já foi aceito");
    expect(errorCode(err)).toBe("TICKET_ALREADY_ACCEPTED");
  });

  it("explains network failures and falls back otherwise", async () => {
    apiMock.onGet("/y").networkError();
    const err = await api.get("/y").catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Sem conexão com o servidor. Verifique sua internet.");
    expect(errorMessage(new Error("boom"))).toBe("Algo deu errado. Tente novamente.");
  });
});
