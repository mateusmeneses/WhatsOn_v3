import type { ChatbotNode } from "@/types/api";
import { buildTree, canHaveChildren, moveByOffset, moveId, nextFreeKey } from "./tree";

const node = (partial: Partial<ChatbotNode> & Pick<ChatbotNode, "id">): ChatbotNode => ({
  companyId: 1,
  connectionId: 1,
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
  ...partial,
});

describe("chatbot tree helpers", () => {
  it("builds the tree ordering children by order", () => {
    const tree = buildTree([
      node({ id: 3, parentId: 1, order: 2, key: "2", title: "B", action: "close" }),
      node({ id: 1 }),
      node({ id: 2, parentId: 1, order: 1, key: "1", title: "A", action: "submenu" }),
      node({ id: 4, parentId: 2, order: 1, key: "1", title: "A1", action: "reply" }),
    ]);
    expect(tree!.node.id).toBe(1);
    expect(tree!.children.map((c) => c.node.id)).toEqual([2, 3]);
    expect(tree!.children[0]!.children.map((c) => c.node.id)).toEqual([4]);
    expect(buildTree([])).toBeNull();
  });

  it("moves ids", () => {
    expect(moveId([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
    expect(moveByOffset([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveByOffset([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });

  it("suggests the next free key and knows who can have children", () => {
    expect(nextFreeKey([node({ id: 2, key: "1" }), node({ id: 3, key: "3" })])).toBe("2");
    expect(canHaveChildren(node({ id: 1 }))).toBe(true);
    expect(canHaveChildren(node({ id: 2, parentId: 1, action: "reply" }))).toBe(false);
  });
});
