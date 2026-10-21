import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { uploadMedia } from "./messagesApi";

vi.mock("./messagesApi", () => ({ uploadMedia: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const stored = { mediaUrl: "/media/1/a.png", mediaMime: "image/png", mediaName: "a.png", type: "image" as const };

function paste(file: File) {
  fireEvent.paste(screen.getByLabelText("Mensagem"), { clipboardData: { files: [file], getData: () => "" } });
}

describe("Composer paste", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  beforeEach(() => vi.mocked(uploadMedia).mockReset());

  it("previews a pasted image and sends it with the typed caption", async () => {
    vi.mocked(uploadMedia).mockResolvedValue(stored as never);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const file = new File(["x"], "print.png", { type: "image/png" });
    await userEvent.type(screen.getByLabelText("Mensagem"), "olha isso");
    paste(file);
    expect(screen.getByTestId("paste-preview")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("olha isso", stored));
    expect(uploadMedia).toHaveBeenCalledWith(file);
    expect(screen.queryByTestId("paste-preview")).not.toBeInTheDocument();
  });

  it("previews a pasted video", () => {
    render(<Composer onSend={vi.fn()} />);
    paste(new File(["x"], "clip.mp4", { type: "video/mp4" }));
    expect(screen.getByTestId("paste-preview").tagName).toBe("VIDEO");
  });

  it("lets the user discard the pasted file", async () => {
    render(<Composer onSend={vi.fn()} />);
    paste(new File(["x"], "print.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "Remover anexo" }));
    expect(screen.queryByTestId("paste-preview")).not.toBeInTheDocument();
  });

  it("ignores pasted files that are not image or video", () => {
    render(<Composer onSend={vi.fn()} />);
    paste(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(screen.queryByTestId("paste-preview")).not.toBeInTheDocument();
  });
});
