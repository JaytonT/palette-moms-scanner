import { useEffect, useState } from "react";
import { Loader2, Pencil, Star, Camera, Upload, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollectionPicker } from "@/components/CollectionPicker";
import {
  getProductDetail,
  updateProductFields,
  setProductPrice,
  uploadImage,
  listCollections,
  type Collection,
  type ProductDetail,
} from "@/lib/ghl";

// Item shape returned by /api/inventory (GHL product + quantity + collectionIds).
interface InvItem {
  _id: string;
  name?: string;
  statementDescriptor?: string;
  availableInStore?: boolean;
  isFeatured?: boolean;
  collectionIds?: string[];
  medias?: { url: string }[];
  quantity?: number;
}

// Editable working copy for the panel and the staged map.
interface Draft {
  _id: string;
  name: string;
  description: string;
  statementDescriptor: string;
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
  availableInStore: boolean;
  collectionId: string;
  images: { id?: string; url: string }[];
  amount: string;
  sloc: string;
  quantity: number;
  weight: string;
  dimensions: string;
}

function detailToDraft(d: ProductDetail): Draft {
  return {
    _id: d._id,
    name: d.name,
    description: d.description,
    statementDescriptor: d.statementDescriptor,
    seoTitle: d.seoTitle,
    seoDescription: d.seoDescription,
    isFeatured: d.isFeatured,
    availableInStore: d.availableInStore,
    collectionId: d.collectionIds[0] ?? "",
    images: d.images,
    amount: d.amount,
    sloc: d.sloc,
    quantity: d.quantity,
    weight: d.weight,
    dimensions: d.dimensions,
  };
}

// ─── Edit panel (modal) ─────────────────────────────────────────────────────────

interface EditPanelProps {
  draft: Draft;
  collections: Collection[];
  onCollectionCreated: (c: Collection) => void;
  onStage: (d: Draft) => void;
  onCancel: () => void;
}

function EditPanel({ draft: initial, collections, onCollectionCreated, onStage, onCancel }: EditPanelProps) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(files).map((f) => uploadImage(f)));
      setDraft((p) => ({ ...p, images: [...p.images, ...uploaded] }));
      toast.success(`Added ${uploaded.length} photo${uploaded.length > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error("Upload failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (idx: number) =>
    setDraft((p) => ({ ...p, images: p.images.filter((_, i) => i !== idx) }));

  const setHero = (idx: number) =>
    setDraft((p) => {
      const imgs = [...p.images];
      const [hero] = imgs.splice(idx, 1);
      return { ...p, images: [hero, ...imgs] };
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <Card className="my-8 w-full max-w-2xl">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Edit product</h3>
            <button type="button" aria-label="Close" onClick={onCancel} className="rounded p-1 hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <Label>Photos</Label>
            <div className="flex gap-2">
              <input
                id="inv-take-photo"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Take a photo"
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => document.getElementById("inv-take-photo")?.click()}
              >
                <Camera className="mr-1 h-4 w-4" /> Take
              </Button>
              <input
                id="inv-upload-photo"
                type="file"
                accept="image/*"
                multiple
                aria-label="Upload photos"
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => document.getElementById("inv-upload-photo")?.click()}
              >
                <Upload className="mr-1 h-4 w-4" /> Upload
              </Button>
              {uploading && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
            </div>
            {draft.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {draft.images.map((img, i) => (
                  <div key={img.url + i} className="relative">
                    <img src={img.url} alt="" className="aspect-square w-full rounded border object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {i === 0 ? (
                      <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                        Hero
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setHero(i)}
                        className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                        title="Set as hero"
                      >
                        <Star className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="inv-barcode">Barcode</Label>
            <Input id="inv-barcode" value={draft.statementDescriptor} disabled className="mt-1 bg-muted" />
          </div>

          <div>
            <Label htmlFor="inv-name">Title</Label>
            <Input id="inv-name" value={draft.name} onChange={(e) => set("name", e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label htmlFor="inv-desc">Description</Label>
            <Textarea
              id="inv-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              className="mt-1 min-h-[70px]"
            />
          </div>

          <div>
            <Label>Category (GHL collection)</Label>
            <div className="mt-1">
              <CollectionPicker
                collections={collections}
                value={draft.collectionId}
                onChange={(id) => set("collectionId", id)}
                onCreated={onCollectionCreated}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="inv-price">Price</Label>
              <Input id="inv-price" value={draft.amount} onChange={(e) => set("amount", e.target.value)} className="mt-1" placeholder="$0.00" />
            </div>
            <div>
              <Label htmlFor="inv-sloc">SLOC</Label>
              <Input id="inv-sloc" value={draft.sloc} onChange={(e) => set("sloc", e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="inv-qty" className="text-primary font-semibold">Quantity</Label>
              <Input
                id="inv-qty"
                type="number"
                min="0"
                value={draft.quantity}
                onChange={(e) => set("quantity", parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="inv-weight">Weight</Label>
              <Input id="inv-weight" value={draft.weight} onChange={(e) => set("weight", e.target.value)} className="mt-1" placeholder="3.5 lb" />
            </div>
            <div>
              <Label htmlFor="inv-dims">Dimensions</Label>
              <Input id="inv-dims" value={draft.dimensions} onChange={(e) => set("dimensions", e.target.value)} className="mt-1" placeholder="10 x 8 x 2 in" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div>
              <Label htmlFor="inv-seo-title">SEO Title</Label>
              <Input id="inv-seo-title" value={draft.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="inv-seo-desc">SEO Description</Label>
              <Input id="inv-seo-desc" value={draft.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="flex items-center gap-6 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} />
              Featured
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.availableInStore} onChange={(e) => set("availableInStore", e.target.checked)} />
              Live on storefront
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="outline" onClick={onCancel} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={() => onStage(draft)} disabled={uploading}>
              Stage changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Inventory page ───────────────────────────────────────────────────────────

export function Inventory() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [staged, setStaged] = useState<Record<string, Draft>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [openingPanel, setOpeningPanel] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [invRes, cols] = await Promise.all([
        fetch("/api/inventory").then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        }),
        listCollections().catch(() => [] as Collection[]),
      ]);
      setItems((invRes.products ?? []) as InvItem[]);
      setCollections(cols);
      setError("");
    } catch {
      setError("Could not load products from GHL.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const collectionName = (id?: string) => collections.find((c) => c.id === id)?.name;

  // Merge staged values over the loaded item for display.
  const view = (item: InvItem) => {
    const s = staged[item._id];
    return {
      name: s?.name ?? item.name ?? "(no title)",
      quantity: s ? s.quantity : item.quantity ?? 0,
      heroUrl: s ? s.images[0]?.url : item.medias?.[0]?.url,
      isFeatured: s ? s.isFeatured : !!item.isFeatured,
      live: s ? s.availableInStore : item.availableInStore !== false,
      collectionId: s ? s.collectionId : item.collectionIds?.[0],
      barcode: s?.statementDescriptor ?? item.statementDescriptor,
      unsynced: !!s,
    };
  };

  const openEditor = async (id: string) => {
    if (staged[id]) {
      setEditingDraft(staged[id]);
      setEditingId(id);
      return;
    }
    setOpeningPanel(true);
    setEditingId(id);
    try {
      const detail = await getProductDetail(id);
      setEditingDraft(detailToDraft(detail));
    } catch (e) {
      toast.error("Could not load product", { description: e instanceof Error ? e.message : String(e) });
      setEditingId(null);
    } finally {
      setOpeningPanel(false);
    }
  };

  const stage = (d: Draft) => {
    setStaged((prev) => ({ ...prev, [d._id]: d }));
    setEditingId(null);
    setEditingDraft(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingDraft(null);
  };

  const unsyncedIds = Object.keys(staged);

  const sync = async () => {
    const ids = Object.keys(staged);
    if (ids.length === 0) return;
    setSyncing(true);
    const failed: { name: string; error: string }[] = [];
    let synced = 0;

    for (const id of ids) {
      const d = staged[id];
      try {
        await updateProductFields(id, {
          name: d.name,
          description: d.description,
          seoTitle: d.seoTitle,
          seoDescription: d.seoDescription,
          isFeatured: d.isFeatured,
          availableInStore: d.availableInStore,
          collectionIds: d.collectionId ? [d.collectionId] : [],
          medias: d.images
            .filter((i): i is { id: string; url: string } => !!i.id)
            .map((i, idx) => ({ id: i.id, url: i.url, type: "image", isFeatured: idx === 0 })),
        });
        await setProductPrice(id, {
          amount: parseFloat(d.amount.replace(/[^0-9.]/g, "")) || 0,
          sloc: d.sloc,
          quantity: d.quantity,
          weight: d.weight,
          dimensions: d.dimensions,
          name: d.name,
        });
        synced += 1;
        setStaged((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (e) {
        failed.push({ name: d.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    setSyncing(false);
    if (failed.length === 0) {
      toast.success(`Synced ${synced} product${synced === 1 ? "" : "s"} to GHL.`);
    } else {
      toast.error(`Synced ${synced}, ${failed.length} failed`, {
        description: failed.map((f) => `${f.name}: ${f.error}`).join("; "),
      });
    }
    await load();
  };

  if (loading) {
    return (
      <div className="flex justify-center p-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (error) {
    return <p className="p-8 text-center text-destructive">{error}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          GHL Inventory
          <span className="ml-2 text-base font-normal text-muted-foreground">({items.length})</span>
        </h1>
        <div className="flex items-center gap-3">
          {unsyncedIds.length > 0 && (
            <span className="text-sm font-medium text-amber-600">
              {unsyncedIds.length} unsynced
            </span>
          )}
          <Button onClick={sync} disabled={syncing || unsyncedIds.length === 0}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync to GHL
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const v = view(item);
          return (
            <Card key={item._id} className={v.unsynced ? "border-amber-300" : ""}>
              <CardContent className="flex items-center gap-4 px-4 py-4">
                {v.heroUrl ? (
                  <img src={v.heroUrl} alt={v.name} className="h-14 w-14 flex-shrink-0 rounded-md border object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                    <span className="text-xs text-muted-foreground">No img</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{v.name}</p>
                  {v.barcode && <p className="text-xs text-muted-foreground">Barcode: {v.barcode}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${v.quantity === 0 ? "text-destructive" : "text-primary"}`}>
                      {v.quantity} in stock
                    </span>
                    {collectionName(v.collectionId) && (
                      <Badge variant="secondary" className="text-xs">{collectionName(v.collectionId)}</Badge>
                    )}
                    {!v.live && <Badge variant="danger" className="text-xs">Needs Review</Badge>}
                    {v.isFeatured && <Badge variant="success" className="text-xs">Featured</Badge>}
                    {v.unsynced && <Badge variant="warning" className="text-xs">Unsynced</Badge>}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 gap-1"
                  onClick={() => openEditor(item._id)}
                  disabled={openingPanel && editingId === item._id}
                >
                  {openingPanel && editingId === item._id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Pencil className="h-4 w-4" />
                  )}
                  Edit
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editingId && editingDraft && (
        <EditPanel
          draft={editingDraft}
          collections={collections}
          onCollectionCreated={(c) => setCollections((prev) => [...prev, c])}
          onStage={stage}
          onCancel={cancelEdit}
        />
      )}
    </div>
  );
}
