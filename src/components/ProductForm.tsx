import { useState } from "react";
import { Star, Edit2, EyeOff, AlertCircle, CheckCircle2, ScanBarcode, Camera, Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProductData } from "@/types/product";
import {
  findProductByBarcode,
  createProduct,
  updateProductQuantity,
  uploadImage,
} from "@/lib/ghl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type SubmissionResult =
  | {
      mode: "created";
      productId: string;
      availableInStore: boolean;
      snapshot: ProductData;
    }
  | {
      mode: "updated";
      existingQuantity: number;
      addedQuantity: number;
      newTotal: number;
      snapshot: ProductData;
    };

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({
  confidence,
}: {
  confidence: ProductData["confidence"];
}) {
  if (confidence === "high") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        High confidence
      </Badge>
    );
  }
  if (confidence === "medium") {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Medium confidence
      </Badge>
    );
  }
  return (
    <Badge variant="danger" className="gap-1">
      <EyeOff className="h-3 w-3" />
      Low — will save as Needs Review
    </Badge>
  );
}

// ─── Estimated field indicator ────────────────────────────────────────────────

function EstimateTag() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600">
      <AlertCircle className="h-3 w-3" />
      estimate
    </span>
  );
}

// ─── Duplicate dialog ─────────────────────────────────────────────────────────

interface DuplicateDialogProps {
  existingQuantity: number;
  addQuantity: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function DuplicateDialog({
  existingQuantity,
  addQuantity,
  onConfirm,
  onCancel,
}: DuplicateDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg border shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="font-semibold text-lg mb-2">Product already exists</h3>
        <p className="text-muted-foreground text-sm mb-4">
          This product is already in GHL with {existingQuantity} units. Add{" "}
          {addQuantity} more? New total: {existingQuantity + addQuantity}
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Add {addQuantity} units
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ProductForm ─────────────────────────────────────────────────────────

interface ProductFormProps {
  product: ProductData;
  onReset: () => void;
}

export function ProductForm({ product: initialProduct, onReset }: ProductFormProps) {
  const [product, setProduct] = useState<ProductData>(initialProduct);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDuplicateCheck, setIsDuplicateCheck] = useState(false);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [uploading, setUploading] = useState(false);

  // Duplicate dialog state
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [existingProductId, setExistingProductId] = useState<string | null>(null);
  const [existingVariantId, setExistingVariantId] = useState<string | null>(null);
  const [existingQuantity, setExistingQuantity] = useState(0);

  const isEstimated = (field: string) =>
    product.estimatedFields?.includes(field) ?? false;

  const update = (field: keyof ProductData, value: unknown) =>
    setProduct((prev) => ({ ...prev, [field]: value }));

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls = await Promise.all(Array.from(files).map((f) => uploadImage(f)));
      setProduct((prev) => ({ ...prev, images: [...prev.images, ...urls] }));
      toast.success(`Added ${urls.length} photo${urls.length > 1 ? "s" : ""}`);
    } catch (err) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx: number) =>
    setProduct((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));

  const setAsHero = (idx: number) =>
    setProduct((prev) => {
      const imgs = [...prev.images];
      const [hero] = imgs.splice(idx, 1);
      return { ...prev, images: [hero, ...imgs] };
    });

  const handleSubmit = async (skipDuplicateCheck = false) => {
    if (!product.quantity || product.quantity <= 0) {
      toast.error("Quantity required", {
        description: "Enter a quantity before adding.",
      });
      return;
    }

    // Duplicate check
    if (!skipDuplicateCheck) {
      setIsDuplicateCheck(true);
      try {
        const existing = await findProductByBarcode(product.barcode);
        if (existing && existing.product) {
          const variant = existing.product.variants?.[0];
          setExistingProductId(existing.product._id);
          setExistingVariantId(variant?.id ?? null);
          setExistingQuantity(existing.currentQuantity ?? 0);
          setIsDuplicateCheck(false);
          setShowDuplicate(true);
          return;
        }
      } catch (err) {
        console.warn("Duplicate check failed, proceeding with create:", err);
      }
      setIsDuplicateCheck(false);
    }

    // Create new product
    setIsSubmitting(true);
    try {
      const availableInStore = product.confidence !== "low";
      const productId = await createProduct(product, availableInStore);
      setSubmission({
        mode: "created",
        productId,
        availableInStore,
        snapshot: product,
      });
    } catch (err) {
      toast.error("Error", {
        description:
          err instanceof Error ? err.message : "Failed to add product.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDuplicate = async () => {
    if (!existingProductId || !existingVariantId) return;
    setShowDuplicate(false);
    setIsSubmitting(true);
    try {
      const addedQuantity = product.quantity ?? 0;
      const newTotal = existingQuantity + addedQuantity;
      await updateProductQuantity(existingProductId, existingVariantId, newTotal);
      setSubmission({
        mode: "updated",
        existingQuantity,
        addedQuantity,
        newTotal,
        snapshot: product,
      });
    } catch (err) {
      toast.error("Error", {
        description:
          err instanceof Error ? err.message : "Failed to update.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = isSubmitting || isDuplicateCheck;

  if (submission) {
    const s = submission;
    const snap = s.snapshot;
    const isLive = s.mode === "created" ? s.availableInStore : true;
    return (
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Card className="border-green-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <CardTitle>
                {s.mode === "created" ? "Pushed to GHL" : "Quantity updated in GHL"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              {snap.images[0] && (
                <img
                  src={snap.images[0]}
                  alt={snap.title}
                  className="h-20 w-20 rounded object-cover border"
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg truncate">
                  {snap.title || "(no title)"}
                </h3>
                {snap.brand && (
                  <p className="text-sm text-muted-foreground">{snap.brand}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Barcode: {snap.barcode}
                </p>
              </div>
              {snap.isFeatured && (
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 shrink-0" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded p-3">
              {s.mode === "created" ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Quantity:</span>{" "}
                    <span className="font-medium">{snap.quantity}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Price:</span>{" "}
                    <span className="font-medium">{snap.averagePrice || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">SKU:</span>{" "}
                    <span className="font-medium">{snap.skuCode || "auto"}</span>
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground break-all">
                    GHL product ID: {s.productId}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-muted-foreground">Previous stock:</span>{" "}
                    <span className="font-medium">{s.existingQuantity}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Added:</span>{" "}
                    <span className="font-medium">+{s.addedQuantity}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">New total:</span>{" "}
                    <span className="font-semibold text-primary">{s.newTotal}</span>
                  </div>
                </>
              )}
            </div>

            {isLive ? (
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Live on storefront</span>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800 flex items-start gap-2">
                <EyeOff className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Saved as <strong>Needs Review</strong>. Approve it in the
                  Inventory page before it shows on the storefront.
                </span>
              </div>
            )}

            <Button onClick={onReset} size="lg" className="w-full h-14 text-lg">
              <ScanBarcode className="mr-2 h-5 w-5" />
              Scan Next Item
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {showDuplicate && (
        <DuplicateDialog
          existingQuantity={existingQuantity}
          addQuantity={product.quantity ?? 0}
          onConfirm={handleConfirmDuplicate}
          onCancel={() => setShowDuplicate(false)}
        />
      )}

      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>Product Details</CardTitle>
                <ConfidenceBadge confidence={product.confidence} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => update("isFeatured", !product.isFeatured)}
                  title={product.isFeatured ? "Remove from Featured" : "Mark as Featured"}
                  className="p-1 rounded hover:bg-muted transition-colors"
                >
                  <Star
                    className={`h-5 w-5 transition-colors ${
                      product.isFeatured
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title={isEditing ? "Lock fields" : "Edit fields"}
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Images */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    id="take-photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    aria-label="Take a photo of the item"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={uploading}
                    onClick={() => document.getElementById("take-photo")?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Take Photo
                  </Button>
                </div>
                <div className="flex-1">
                  <input
                    id="upload-photo"
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label="Upload photos from your gallery"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={uploading}
                    onClick={() => document.getElementById("upload-photo")?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload
                  </Button>
                </div>
              </div>

              {uploading && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </div>
              )}

              {product.images.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {product.images.map((src, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={src}
                        alt={`Product ${i + 1}`}
                        className="w-full aspect-square object-cover rounded-lg border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 bg-black/60 hover:bg-black text-white rounded-full p-1 transition"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => setAsHero(i)}
                          className="absolute top-1 left-1 bg-black/60 hover:bg-black text-white rounded-full p-1 transition"
                          title="Set as hero"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                      )}
                      {i === 0 && (
                        <div className="absolute bottom-1 left-1 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">
                          Hero
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {/* Barcode (read-only) */}
              <div>
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={product.barcode}
                  disabled
                  className="mt-1 bg-muted"
                />
              </div>

              {/* Title */}
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={product.title}
                  onChange={(e) => update("title", e.target.value)}
                  disabled={!isEditing}
                  className="mt-1"
                />
              </div>

              {/* Description */}
              <div>
                <Label htmlFor="description" className="flex items-center">
                  Description {isEstimated("description") && <EstimateTag />}
                </Label>
                <Textarea
                  id="description"
                  value={product.description}
                  onChange={(e) => update("description", e.target.value)}
                  disabled={!isEditing}
                  className="mt-1 min-h-[80px]"
                />
              </div>

              {/* Brand + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="brand">Brand</Label>
                  <Input
                    id="brand"
                    value={product.brand}
                    onChange={(e) => update("brand", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="category" className="flex items-center">
                    Category {isEstimated("category") && <EstimateTag />}
                  </Label>
                  <Input
                    id="category"
                    value={product.category}
                    onChange={(e) => update("category", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Weight + Dimensions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="weight" className="flex items-center">
                    Weight {isEstimated("weight") && <EstimateTag />}
                  </Label>
                  <Input
                    id="weight"
                    value={product.weight}
                    onChange={(e) => update("weight", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="dimensions" className="flex items-center">
                    Dimensions {isEstimated("dimensions") && <EstimateTag />}
                  </Label>
                  <Input
                    id="dimensions"
                    value={product.dimensions}
                    onChange={(e) => update("dimensions", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Price + SKU */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="price" className="flex items-center">
                    Price {isEstimated("averagePrice") && <EstimateTag />}
                  </Label>
                  <Input
                    id="price"
                    value={product.averagePrice}
                    onChange={(e) => update("averagePrice", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    value={product.skuCode}
                    onChange={(e) => update("skuCode", e.target.value)}
                    disabled={!isEditing}
                    placeholder="Enter SKU"
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Quantity */}
              <div>
                <Label htmlFor="quantity" className="text-primary font-semibold">
                  Quantity *
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={product.quantity || ""}
                  onChange={(e) =>
                    update("quantity", parseInt(e.target.value) || 0)
                  }
                  placeholder="Enter quantity"
                  className="mt-1 border-primary/50"
                />
              </div>

              {/* SEO fields */}
              <div className="pt-3 border-t space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  SEO Fields
                </h4>
                <div>
                  <Label htmlFor="seoTitle" className="flex items-center">
                    SEO Title {isEstimated("seoTitle") && <EstimateTag />}
                  </Label>
                  <Input
                    id="seoTitle"
                    value={product.seoTitle}
                    onChange={(e) => update("seoTitle", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="seoDescription" className="flex items-center">
                    SEO Description{" "}
                    {isEstimated("seoDescription") && <EstimateTag />}
                  </Label>
                  <Textarea
                    id="seoDescription"
                    value={product.seoDescription}
                    onChange={(e) => update("seoDescription", e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={() => handleSubmit()}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading
                    ? "Processing..."
                    : product.confidence === "low"
                    ? "Save as Needs Review"
                    : "Add to GHL Inventory"}
                </Button>
                <Button
                  variant="outline"
                  onClick={onReset}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
