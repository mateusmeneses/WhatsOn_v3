import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { ConfirmProvider } from "@/components/ui/confirm";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { FakeSocket } from "./fakeSocket";
import type { PublicUser } from "@/types/api";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function setTestUser(partial: Partial<PublicUser> = {}): PublicUser {
  const user: PublicUser = {
    id: 1,
    companyId: 1,
    name: "Ana Atendente",
    email: "ana@test.local",
    profile: "agent",
    ...partial,
  };
  useAuth.setState({ accessToken: "test-token", user });
  return user;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    queryClient = createTestQueryClient(),
    socket,
  }: { route?: string; queryClient?: QueryClient; socket?: FakeSocket } = {},
) {
  const content = socket ? (
    <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1, connected: true }}>{ui}</RealtimeContext.Provider>
  ) : (
    ui
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ConfirmProvider>{content}</ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
