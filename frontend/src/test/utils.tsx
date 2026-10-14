import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { useAuth } from "@/stores/auth";
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
  { route = "/", queryClient = createTestQueryClient() }: { route?: string; queryClient?: QueryClient } = {},
) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
