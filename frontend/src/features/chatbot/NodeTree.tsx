import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ACTION_LABELS, canHaveChildren, moveByOffset, moveId, type TreeNode } from "./tree";

export interface NodeTreeHandlers {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAddChild: (parentId: number) => void;
  onDelete: (id: number, title: string) => void;
  onReorder: (parentId: number, ids: number[]) => void;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-ink-muted hover:bg-background hover:text-ink"
    >
      {children}
    </button>
  );
}

function OptionRow({ item, siblingIds, parentId, handlers }: {
  item: TreeNode;
  siblingIds: number[];
  parentId: number;
  handlers: NodeTreeHandlers;
}) {
  const { node } = item;
  const sortable = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  return (
    <li ref={sortable.setNodeRef} style={style}>
      <div
        data-testid="bot-option"
        onClick={() => handlers.onSelect(node.id)}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background",
          handlers.selectedId === node.id && "bg-primary-soft hover:bg-primary-soft",
        )}
      >
        <span {...sortable.attributes} {...sortable.listeners} aria-label={`Arrastar ${node.title}`} className="cursor-grab text-ink-muted">
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-xs font-bold text-white">
          {node.key}
        </span>
        <span data-testid="bot-option-title" className="font-medium">{node.title}</span>
        <span className="text-xs text-ink-muted">{ACTION_LABELS[node.action]}</span>
        <span className="ml-auto flex items-center">
          <IconButton label={`Mover ${node.title} para cima`} onClick={() => handlers.onReorder(parentId, moveByOffset(siblingIds, node.id, -1))}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Mover ${node.title} para baixo`} onClick={() => handlers.onReorder(parentId, moveByOffset(siblingIds, node.id, 1))}>
            <ArrowDown className="h-4 w-4" aria-hidden />
          </IconButton>
          {canHaveChildren(node) && (
            <IconButton label={`Adicionar opção em ${node.title}`} onClick={() => handlers.onAddChild(node.id)}>
              <Plus className="h-4 w-4" aria-hidden />
            </IconButton>
          )}
          <IconButton label={`Excluir ${node.title}`} onClick={() => handlers.onDelete(node.id, node.title)}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </span>
      </div>
      {item.children.length > 0 && <Children parent={item} handlers={handlers} />}
    </li>
  );
}

function Children({ parent, handlers }: { parent: TreeNode; handlers: NodeTreeHandlers }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = parent.children.map((c) => c.node.id);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) handlers.onReorder(parent.node.id, moveId(ids, Number(active.id), Number(over.id)));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="ml-5 space-y-1 border-l border-border pl-3">
          {parent.children.map((child) => (
            <OptionRow key={child.node.id} item={child} siblingIds={ids} parentId={parent.node.id} handlers={handlers} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export function NodeTree({ tree, handlers }: { tree: TreeNode; handlers: NodeTreeHandlers }) {
  const root = tree.node;
  return (
    <div className="space-y-2">
      <div
        onClick={() => handlers.onSelect(root.id)}
        className={cn(
          "cursor-pointer rounded-lg border border-border bg-surface p-3",
          handlers.selectedId === root.id && "border-primary",
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Mensagem de boas-vindas</p>
          <IconButton label={`Adicionar opção em ${root.title}`} onClick={() => handlers.onAddChild(root.id)}>
            <Plus className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{root.message || "(sem mensagem)"}</p>
      </div>
      {tree.children.length > 0 ? (
        <Children parent={tree} handlers={handlers} />
      ) : (
        <p className="px-2 text-sm text-ink-muted">Nenhuma opção ainda. Sem opções, o cliente vai direto para a fila padrão.</p>
      )}
    </div>
  );
}
