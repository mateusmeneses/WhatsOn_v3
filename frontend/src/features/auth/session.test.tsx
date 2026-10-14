import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { AppRoutes } from "@/app/routes";
import { useLocalMessages } from "@/features/chat/localMessages";
import { api, refreshAccessToken } from "@/lib/api";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import { makeMessage } from "@/test/factories";
import { createTestQueryClient, renderWithProviders, setTestUser } from "@/test/utils";
import type { PublicUser } from "@/types/api";
import { useSessionReset } from "./useSessionReset";

const user: PublicUser = { id: 1, companyId: 1, name: "Ana", email: "ana@test.local", profile: "admin" };
let apiMock: MockAdapter;
let rawMock: MockAdapter;

beforeEach(() => {
  apiMock = new MockAdapter(api);
  rawMock = new MockAdapter(axios);
  useAuth.getState().clear();
  useLocalMessages.setState({ byTicket: {} });
});

afterEach(() => {
  apiMock.restore();
  rawMock.restore();
});

function ResetProbe() {
  useSessionReset();
  return null;
}

describe("session lifecycle", () => {
  it("drops cached queries and local messages when a failed refresh ends the session", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["tickets", "list", "pending", ""], { pages: [], pageParams: [] });
    useLocalMessages.getState().add(1, { ...makeMessage({ id: -1 }), tempId: "t1", localFailed: true });
    render(
      <QueryClientProvider client={queryClient}>
        <ResetProbe />
      </QueryClientProvider>,
    );
    apiMock.onGet("/tickets").reply(401, {});
    rawMock.onPost("/api/auth/refresh").reply(401, {});

    await act(async () => {
      await expect(api.get("/tickets")).rejects.toBeDefined();
    });

    expect(useAuth.getState().user).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useLocalMessages.getState().byTicket).toEqual({});
  });

  it("does not restore the session when a refresh resolves after logout", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    rawMock.onPost("/api/auth/refresh").reply(async () => {
      await gate;
      return [200, { accessToken: "new", refreshToken: "r2", user }];
    });

    const pending = refreshAccessToken();
    useAuth.getState().clear();
    release();

    expect(await pending).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().accessToken).toBeNull();
    expect(refreshTokenStorage.get()).toBeNull();
  });

  it("logs out through the sidebar and goes to the login page", async () => {
    setTestUser({ profile: "agent" });
    refreshTokenStorage.set("r1");
    apiMock.onPost("/auth/logout").reply(204);
    apiMock.onGet("/users/options").reply(200, []);
    apiMock.onGet().reply(200, { items: [], hasMore: false });
    renderWithProviders(<AppRoutes />, { route: "/contatos" });

    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument());
    expect(useAuth.getState().user).toBeNull();
    expect(refreshTokenStorage.get()).toBeNull();
  });
});
