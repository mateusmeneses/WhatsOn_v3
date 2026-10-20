import { act } from "@testing-library/react";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders } from "@/test/utils";
import { useLiveInvalidate } from "./useLiveInvalidate";

function Probe() {
  useLiveInvalidate(["probe"], ["presence:changed"], 1000);
  return null;
}

describe("useLiveInvalidate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("revalidates shortly after the socket is ready and groups bursts of events into one call", () => {
    const socket = new FakeSocket();
    const { queryClient } = renderWithProviders(<Probe />, { socket });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    act(() => void vi.advanceTimersByTime(500)); // conexão pronta (epoch > 0)
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => {
      for (const handler of socket.handlers.get("presence:changed") ?? []) {
        handler();
        handler();
        handler();
      }
    });
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith({ queryKey: ["probe"] });
  });
});
