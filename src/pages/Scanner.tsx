import { useState } from "react";
import { toast } from "sonner";
import { lookupBarcode } from "@/lib/barcode-lookup";
import { ProductForm } from "@/components/ProductForm";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import type { ProductData } from "@/types/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Camera, PenLine } from "lucide-react";

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
  const [product, setProduct] = useState<ProductData | null>(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [isScanning, setIsScanning] = useState(false);

  const handleLookup = async (barcode: string) => {
    setLoading(true);
    try {
      const data = await lookupBarcode(barcode.trim());
      setProduct(data);
    } catch {
      toast.error("Lookup failed", {
        description: "Could not fetch product info. Try manual entry.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualEntry = () => {
    setProduct(ManualEntry());
  };

  const reset = () => {
    setProduct(null);
    setManualBarcode("");
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
              <span className="text-muted-foreground">Looking up product...</span>
            </CardContent>
          </Card>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full h-16 text-lg gap-3"
              onClick={() => setIsScanning(true)}
            >
              <Camera className="h-6 w-6" />
              Start Camera Scan
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
