import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { toast } from "sonner";
import type { GHLProduct } from "@/types/product";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setProductFeatured } from "@/lib/ghl";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_KEY = import.meta.env.VITE_GHL_API_KEY as string;
const GHL_LOCATION_ID = import.meta.env.VITE_GHL_LOCATION_ID as string;

function ghlHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function fetchAllProducts(): Promise<GHLProduct[]> {
  // Use /products/ endpoint (not /products/inventory) as it returns availableInStore
  const res = await fetch(
    `${GHL_BASE}/products/?locationId=${GHL_LOCATION_ID}&limit=100`,
    { headers: ghlHeaders() }
  );
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return (data.products ?? []) as GHLProduct[];
}

async function activateProduct(productId: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({ availableInStore: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Activate failed: ${res.status} ${text}`);
  }
}

// ─── Product card ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: GHLProduct;
  needsReview: boolean;
  onActivate?: (id: string) => void;
  onToggleFeatured?: (id: string, current: boolean) => void;
}

function ProductCard({
  product,
  needsReview,
  onActivate,
  onToggleFeatured,
}: ProductCardProps) {
  const qty =
    product.variants?.reduce(
      (sum, v) => sum + (v.availableQuantity ?? 0),
      0
    ) ?? 0;

  const firstImage = product.medias?.[0]?.url;

  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4 px-4">
        {firstImage ? (
          <img
            src={firstImage}
            alt={product.name}
            className="h-14 w-14 rounded-md object-cover border flex-shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
            <span className="text-xs text-muted-foreground">No img</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{product.name}</p>
          {product.statementDescriptor && (
            <p className="text-xs text-muted-foreground">
              Barcode: {product.statementDescriptor}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`text-sm font-semibold ${
                qty === 0 ? "text-destructive" : "text-primary"
              }`}
            >
              {qty} in stock
            </span>
            {needsReview && (
              <Badge variant="danger" className="text-xs">
                Needs Review
              </Badge>
            )}
            {product.isFeatured && (
              <Badge variant="success" className="text-xs">
                Featured
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0">
          {needsReview && onActivate && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => onActivate(product._id)}
            >
              <Eye className="h-3 w-3" />
              Approve
            </Button>
          )}
          {onToggleFeatured && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => onToggleFeatured(product._id, !!product.isFeatured)}
            >
              {product.isFeatured ? "Unfeature" : "Feature"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Inventory page ───────────────────────────────────────────────────────────

export function Inventory() {
  const [products, setProducts] = useState<GHLProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const all = await fetchAllProducts();
      setProducts(all);
    } catch {
      setError("Could not load products from GHL.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleActivate = async (productId: string) => {
    try {
      await activateProduct(productId);
      // Optimistic update
      setProducts((prev) =>
        prev.map((p) =>
          p._id === productId ? { ...p, availableInStore: true } : p
        )
      );
      toast.success("Product approved and now live on storefront.");
    } catch (err) {
      toast.error("Failed to approve product", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleToggleFeatured = async (productId: string, current: boolean) => {
    try {
      await setProductFeatured(productId, !current);
      setProducts((prev) =>
        prev.map((p) =>
          p._id === productId ? { ...p, isFeatured: !current } : p
        )
      );
      toast.success(!current ? "Marked as featured." : "Removed from featured.");
    } catch (err) {
      toast.error("Failed to update featured status", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-destructive p-8">{error}</p>
    );
  }

  // Group into Needs Review (availableInStore === false) and Live
  const needsReview = products.filter((p) => p.availableInStore === false);
  const live = products.filter((p) => p.availableInStore !== false);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          GHL Inventory
          <span className="ml-2 text-base font-normal text-muted-foreground">
            ({products.length} products)
          </span>
        </h1>
      </div>

      {/* Needs Review section */}
      {needsReview.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-amber-700">
              Needs Review ({needsReview.length})
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            These products have low confidence and are hidden from storefront.
            Review and approve to make them live.
          </p>
          <div className="space-y-2">
            {needsReview.map((p) => (
              <ProductCard
                key={p._id}
                product={p}
                needsReview
                onActivate={handleActivate}
                onToggleFeatured={handleToggleFeatured}
              />
            ))}
          </div>
        </section>
      )}

      {/* Live section */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <h2 className="text-lg font-semibold">
            Live Products ({live.length})
          </h2>
        </div>
        {live.length === 0 ? (
          <p className="text-muted-foreground text-sm">No live products yet.</p>
        ) : (
          <div className="space-y-2">
            {live.map((p) => (
              <ProductCard
                key={p._id}
                product={p}
                needsReview={false}
                onToggleFeatured={handleToggleFeatured}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
