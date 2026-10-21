import { BotContext, BotNode, botPath, renderMenu, step } from "../../src/modules/chatbot/engine";

const node = (n: Partial<BotNode> & Pick<BotNode, "id">): BotNode => ({
  parentId: null,
  order: 0,
  key: "",
  title: "",
  action: "submenu",
  message: "",
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  queueId: null,
  userId: null,
  ...n,
});

const nodes: BotNode[] = [
  node({ id: 1, message: "Olá! Bem-vindo à Empresa X." }),
  node({ id: 2, parentId: 1, order: 1, key: "1", title: "Financeiro", action: "submenu", message: "Financeiro:" }),
  node({ id: 3, parentId: 1, order: 2, key: "2", title: "Suporte", action: "transfer_queue", queueId: 20 }),
  node({ id: 4, parentId: 1, order: 3, key: "3", title: "Encerrar", action: "close", message: "Até logo!" }),
  node({ id: 5, parentId: 1, order: 4, key: "4", title: "Falar com Ana", action: "transfer_agent", userId: 99 }),
  node({ id: 6, parentId: 2, order: 1, key: "1", title: "2ª via", action: "reply", message: "Acesse: https://exemplo.com/boleto" }),
  node({ id: 7, parentId: 2, order: 2, key: "2", title: "Falar com o financeiro", action: "transfer_queue", queueId: 10, message: "Transferindo para o financeiro." }),
  node({ id: 8, parentId: 2, order: 3, key: "3", title: "Fila removida", action: "transfer_queue", queueId: null }),
];

const ctx = (overrides: Partial<BotContext> = {}): BotContext => ({
  nodes,
  defaultQueueId: 30,
  isQueueOpen: (id) => id !== 20,
  messages: { transfer: "Aguarde um atendente.", outOfHours: "Estamos fora do horário.", invalid: "Opção inválida." },
  ...overrides,
});

const ROOT_MENU = "Olá! Bem-vindo à Empresa X.\n\n1 - Financeiro\n2 - Suporte\n3 - Encerrar\n4 - Falar com Ana";
const FIN_MENU = "Financeiro:\n\n1 - 2ª via\n2 - Falar com o financeiro\n3 - Fila removida\n0 - Voltar";
const text = (t: string) => ({ type: "send_text", text: t });

describe("renderMenu", () => {
  it("lists children in order and adds Voltar only below the root", () => {
    expect(renderMenu(nodes[0], nodes.filter((n) => n.parentId === 1))).toBe(ROOT_MENU);
    expect(renderMenu(nodes[1], nodes.filter((n) => n.parentId === 2))).toBe(FIN_MENU);
  });

  it("omits the header when the node has no message", () => {
    expect(renderMenu(node({ id: 50, parentId: 1 }), [node({ id: 51, parentId: 50, key: "1", title: "A" })])).toBe(
      "1 - A\n0 - Voltar",
    );
  });
});

describe("step", () => {
  it("greets with the root menu on first contact, ignoring the input", () => {
    expect(step({ nodeId: null, attempts: 0 }, "oi", ctx())).toEqual({
      effects: [text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 0 },
      finished: false,
    });
  });

  it("restarts at the root when the current node no longer exists", () => {
    expect(step({ nodeId: 999, attempts: 1 }, "1", ctx()).effects).toEqual([text(ROOT_MENU)]);
  });

  it("opens a submenu (trimming whitespace)", () => {
    expect(step({ nodeId: 1, attempts: 0 }, " 1 ", ctx())).toEqual({
      effects: [text(FIN_MENU)],
      state: { nodeId: 2, attempts: 0 },
      finished: false,
    });
  });

  it("replies and shows the current menu again", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "1", ctx())).toEqual({
      effects: [text("Acesse: https://exemplo.com/boleto"), text(FIN_MENU)],
      state: { nodeId: 2, attempts: 0 },
      finished: false,
    });
  });

  it("replies with media when the node has a file", () => {
    const withMedia = nodes.map((n) =>
      n.id === 6 ? { ...n, mediaUrl: "/media/1/a.pdf", mediaMime: "application/pdf", mediaName: "boleto.pdf" } : n,
    );
    const result = step({ nodeId: 2, attempts: 0 }, "1", ctx({ nodes: withMedia }));
    expect(result.effects[0]).toEqual({
      type: "send_media",
      media: { url: "/media/1/a.pdf", mime: "application/pdf", name: "boleto.pdf" },
      caption: "Acesse: https://exemplo.com/boleto",
    });
    expect(result.effects[1]).toEqual(text(FIN_MENU));
  });

  it("transfers to an open queue with the node message", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "2", ctx())).toEqual({
      effects: [text("Transferindo para o financeiro."), { type: "transfer", queueId: 10, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("sends the out-of-hours message when the target queue is closed", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "2", ctx()).effects).toEqual([
      text("Estamos fora do horário."),
      { type: "transfer", queueId: 20, userId: null },
    ]);
  });

  it("falls back to the transfer message when no out-of-hours message is set", () => {
    const result = step({ nodeId: 1, attempts: 0 }, "2", ctx({ messages: { transfer: "Aguarde.", outOfHours: "", invalid: "x" } }));
    expect(result.effects[0]).toEqual(text("Aguarde."));
  });

  it("transfers to a specific agent", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "4", ctx()).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: null, userId: 99 },
    ]);
  });

  it("sends a deleted queue target to the default queue", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "3", ctx()).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: 30, userId: null },
    ]);
  });

  it("closes with the node message", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "3", ctx())).toEqual({
      effects: [text("Até logo!"), { type: "close" }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("goes back to the parent with 0", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "0", ctx())).toEqual({
      effects: [text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 0 },
      finished: false,
    });
  });

  it("treats 0 at the root as invalid", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "0", ctx()).state).toEqual({ nodeId: 1, attempts: 1 });
  });

  it("counts invalid input and repeats the menu", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "9", ctx())).toEqual({
      effects: [text("Opção inválida."), text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 1 },
      finished: false,
    });
  });

  it("counts non-text input (null) as invalid", () => {
    expect(step({ nodeId: 1, attempts: 0 }, null, ctx()).state).toEqual({ nodeId: 1, attempts: 1 });
  });

  it("transfers to the default queue on the third invalid input", () => {
    expect(step({ nodeId: 1, attempts: 2 }, "x", ctx())).toEqual({
      effects: [text("Aguarde um atendente."), { type: "transfer", queueId: 30, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("resets the attempt counter after a valid option", () => {
    expect(step({ nodeId: 1, attempts: 2 }, "1", ctx()).state).toEqual({ nodeId: 2, attempts: 0 });
  });

  it("transfers right away when the root has no options", () => {
    const result = step({ nodeId: null, attempts: 0 }, "oi", ctx({ nodes: [node({ id: 1, message: "Oi" })] }));
    expect(result).toEqual({
      effects: [text("Oi"), text("Aguarde um atendente."), { type: "transfer", queueId: 30, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("transfers when there is no tree at all", () => {
    expect(step({ nodeId: null, attempts: 0 }, "oi", ctx({ nodes: [] })).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: 30, userId: null },
    ]);
  });
});

describe("botPath", () => {
  it("is null before the first menu and at the root", () => {
    expect(botPath(nodes, { nodeId: null, attempts: 0 }, "oi")).toBeNull();
    expect(botPath(nodes, { nodeId: 1, attempts: 0 }, "x")).toBeNull();
  });

  it("joins the titles of the chosen options", () => {
    expect(botPath(nodes, { nodeId: 1, attempts: 0 }, "1")).toBe("Financeiro");
    expect(botPath(nodes, { nodeId: 2, attempts: 0 }, "2")).toBe("Financeiro › Falar com o financeiro");
  });

  it("keeps the current menu on replies and goes up on Voltar", () => {
    expect(botPath(nodes, { nodeId: 2, attempts: 0 }, "1")).toBe("Financeiro");
    expect(botPath(nodes, { nodeId: 2, attempts: 0 }, "0")).toBeNull();
  });
});
