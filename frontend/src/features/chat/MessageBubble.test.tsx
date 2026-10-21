import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeMessage } from "@/test/factories";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble media", () => {
  it("enlarges an image in a viewer when clicked and closes it", async () => {
    const message = makeMessage({ type: "image", mediaUrl: "/media/1/a.png", mediaName: "foto.png", body: "" });
    render(<MessageBubble message={message} onRetry={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ampliar foto.png" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "foto.png" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("plays a video in the viewer when clicked", async () => {
    const message = makeMessage({ type: "video", mediaUrl: "/media/1/v.mp4", mediaName: "v.mp4", body: "" });
    const { container } = render(<MessageBubble message={message} onRetry={vi.fn()} />);
    expect(container.querySelector("video[controls]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reproduzir v.mp4" }));
    const player = document.body.querySelector("video[controls]") as HTMLVideoElement;
    expect(player).not.toBeNull();
    expect(player.autoplay).toBe(true);
  });
});
