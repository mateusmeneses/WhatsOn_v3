import { makeMessage, makeTicket } from "@/test/factories";
import { createTempMessage, flattenMessages, removeMessage, upsertMessage, type MessagePages } from "./messageCache";

const data = (...pages: ReturnType<typeof makeMessage>[][]): MessagePages => ({
  pages: pages.map((items) => ({ items, hasMore: false })),
  pageParams: pages.map(() => undefined),
});

describe("messageCache", () => {
  it("flattens pages from oldest to newest", () => {
    const cache = data([makeMessage({ id: 3 }), makeMessage({ id: 4 })], [makeMessage({ id: 1 }), makeMessage({ id: 2 })]);
    expect(flattenMessages(cache).map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it("appends new messages to the newest page and replaces existing ones by id", () => {
    let cache = data([makeMessage({ id: 1 })]);
    cache = upsertMessage(cache, makeMessage({ id: 2, body: "novo" }));
    cache = upsertMessage(cache, makeMessage({ id: 1, ack: "read" }));
    expect(flattenMessages(cache).map((m) => [m.id, m.ack])).toEqual([
      [1, "read"],
      [2, "delivered"],
    ]);
  });

  it("keeps a single bubble when the socket delivers the real message before the POST resolves", () => {
    const temp = createTempMessage(makeTicket(), "Olá", null, 1);
    let cache = upsertMessage(data([]), temp);
    const real = makeMessage({ id: 200, fromMe: true, body: "Olá", ack: "pending" });
    cache = upsertMessage(cache, real); // chegou pelo socket
    cache = upsertMessage(removeMessage(cache, (m) => m.tempId === temp.tempId), real); // POST resolveu
    expect(flattenMessages(cache).filter((m) => m.body === "Olá")).toHaveLength(1);
  });

  it("creates temporary messages with negative ids and the media type", () => {
    const temp = createTempMessage(makeTicket(), "", { url: "/media/1/a.png", mime: "image/png", name: "a.png" }, 1);
    expect(temp.id).toBeLessThan(0);
    expect(temp).toMatchObject({ fromMe: true, ack: "pending", type: "image", mediaUrl: "/media/1/a.png" });
  });
});
