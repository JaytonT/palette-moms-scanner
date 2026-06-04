import { useRef, useState } from "react";
import { toast } from "sonner";
import { lookupBarcode } from "@/lib/barcode-lookup";
import { identifyProductFromImage } from "@/lib/identify-product";
import { ProductForm } from "@/components/ProductForm";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import type { ProductData } from "@/types/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Camera, PenLine, Sparkles } from "lucide-react";

function ManualEntry(): ProductData {
  return {
    barcode: "MANUAL",
    title: "",
    description: "",
    brand: "",
    category: "",
    weight: "",
    dimensions: "",
    images: [],
    averagePrice: "",
    seoTitle: "",
    seoDescription: "",
    quantity: 0,
    skuCode: "",
    isFeatured: false,
    estimatedFields: [],
    dataSource: "manual",
    confidence: "medium",
  };
}

export function Scanner() {
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Looking up product...");
  const [product, setProduct] = useState<ProductData | null>(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  // Set when a scan/lookup found no product in any database. Drives the
  // photo-AI fallback screen and carries the barcode onto the identified item.
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleLookup = async (barcode: string) => {
    setLoadingLabel("Looking up product...");
    setLoading(true);
    try {
      const data = await lookupBarcode(barcode.trim());
      // No title means no database had this product. Don't dump the user into
      // an empty form — route to the photo-AI fallback, keeping the barcode.
      if (!data.title?.trim()) {
        setNotFoundBarcode(barcode.trim());
      } else {
        setProduct(data);
      }
    } catch {
      toast.error("Lookup failed", {
        description: "Could not fetch product info. Try a photo or manual entry.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleIdentifyPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLoadingLabel("Reading the package...");
    setLoading(true);
    try {
      // Pass the scanned barcode (if this came from the not-found fallback) so
      // the identified product keeps its barcode.
      const data = await identifyProductFromImage(file, notFoundBarcode ?? undefined);
      setNotFoundBarcode(null);
      setProduct(data);
    } catch (err) {
      toast.error("Could not identify product", {
        description: err instanceof Error ? err.message : "Try again or use manual entry.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualEntry = () => {
    // Carry the scanned barcode into a manual entry if we came from not-found.
    const base = ManualEntry();
    setProduct(notFoundBarcode ? { ...base, barcode: notFoundBarcode } : base);
    setNotFoundBarcode(null);
  };

  const reset = () => {
    setProduct(null);
    setManualBarcode("");
    setNotFoundBarcode(null);
  };

  if (product) {
    return <ProductForm product={product} onReset={reset} />;
  }

  return (
    <>
      <BarcodeScanner
        isScanning={isScanning}
        onScanSuccess={(barcode) => {
          setIsScanning(false);
          handleLookup(barcode);
        }}
        onClose={() => setIsScanning(false)}
      />

      {/* One hidden photo input, shared by the main "Identify by Photo" button
          and the not-found fallback. Always mounted so either path can open it. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        aria-label="Take or upload a product photo"
        className="hidden"
        onChange={handleIdentifyPhoto}
      />

      <div className="p-6 max-w-lg mx-auto space-y-6">
        <div className="text-center space-y-2">
          <Camera className="h-12 w-12 mx-auto text-primary" />
          <h1 className="text-2xl font-bold">Barcode Scanner</h1>
          <p className="text-muted-foreground text-sm">
            Scan a product barcode to look up its details
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-muted-foreground">{loadingLabel}</span>
            </CardContent>
          </Card>
        ) : notFoundBarcode ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Not found in any database</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Barcode <span className="font-medium">{notFoundBarcode}</span> isn't in
                the product databases. Snap a photo of the package and AI will fill in
                the details.
              </p>
              <Button
                size="lg"
                className="w-full h-14 text-base gap-3"
                onClick={() => photoInputRef.current?.click()}
              >
                <Sparkles className="h-5 w-5" />
                Take Photo to Auto-Fill
              </Button>
              <Button variant="outline" className="w-full" onClick={handleManualEntry}>
                Enter details manually
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setNotFoundBarcode(null)}
              >
                Back
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full h-16 text-lg gap-3"
              onClick={() => photoInputRef.current?.click()}
            >
              <Sparkles className="h-6 w-6" />
              Identify by Photo
            </Button>
            <p className="text-center text-xs text-muted-foreground -mt-2">
              Snap the front of the package. Best for items not in barcode databases.
            </p>

            <Button
              size="lg"
              variant="outline"
              className="w-full h-14 text-base gap-3"
              onClick={() => setIsScanning(true)}
            >
              <Camera className="h-5 w-5" />
              Scan Barcode
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or enter barcode manually
                </span>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manual Barcode Entry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="barcode-input">Barcode / UPC</Label>
                  <Input
                    id="barcode-input"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && manualBarcode.trim()) {
                        handleLookup(manualBarcode.trim());
                      }
                    }}
                    placeholder="e.g. 012345678901"
                    className="mt-1"
                  />
                </div>
                <Button
                  onClick={() => handleLookup(manualBarcode.trim())}
                  disabled={!manualBarcode.trim()}
                  className="w-full"
                >
                  Look Up
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={handleManualEntry}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <PenLine className="h-4 w-4" />
            Manual entry
          </button>
        </div>
      </div>
    </>
  );
}
