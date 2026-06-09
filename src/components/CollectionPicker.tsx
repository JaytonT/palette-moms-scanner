import { useState } from "react";
import { toast } from "sonner";
import { createCollection, type Collection } from "@/lib/ghl";

// Category picker backed by GHL product collections. Lists existing collections so
// naming stays consistent; "New collection" creates one in GHL and selects it.
interface Props {
  collections: Collection[];
  value: string; // selected collection id, "" = none
  onChange: (id: string) => void;
  onCreated: (c: Collection) => void; // parent appends to its list
  disabled?: boolean;
}

export function CollectionPicker({ collections, value, onChange, onCreated, disabled }: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const c = await createCollection(name);
      onCreated(c);
      onChange(c.id);
      setAdding(false);
      setNewName("");
      toast.success(`Collection "${c.name}" created`);
    } catch (e) {
      toast.error("Could not create collection", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div className="flex gap-2">
        <input
          className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="New collection name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="rounded-md border px-3 text-sm"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          disabled={busy}
          className="px-2 text-sm text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === "__new__") {
          setAdding(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">No category</option>
      {collections.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="__new__">+ New collection...</option>
    </select>
  );
}
