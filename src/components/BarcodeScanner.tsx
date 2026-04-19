import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "./ui/button";
import { Camera, X, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface BarcodeScannerProps {
  onScanSuccess: (barcode: string) => void;
  isScanning: boolean;
  onClose: () => void;
  onPhotoFallback?: (imageFile: File) => void;
}

export const BarcodeScanner = ({ onScanSuccess, isScanning, onClose, onPhotoFallback }: BarcodeScannerProps) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onPhotoFallback) {
      stopScanning();
      onPhotoFallback(file);
      onClose();
    }
  };

  useEffect(() => {
    if (!isScanning) return;
    // Defer start until after the DOM is painted so #barcode-reader has real dimensions
    const rafId = requestAnimationFrame(() => {
      startScanning();
    });
    return () => {
      cancelAnimationFrame(rafId);
      stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning]);

  const startScanning = async () => {
    try {
      if (!window.isSecureContext) {
        toast.error("Camera requires HTTPS", {
          description: "Open the app over HTTPS (or localhost) to use the camera.",
        });
        onClose();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Camera not supported", {
          description: "This browser doesn't support camera access.",
        });
        onClose();
        return;
      }

      const scanner = new Html5Qrcode("barcode-reader", { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: { ideal: "environment" } },
        {
          fps: 10,
          qrbox: (w, h) => {
            const edge = Math.floor(Math.min(w, h) * 0.75);
            return { width: edge, height: edge };
          },
          aspectRatio: 1.0,
          disableFlip: false,
        },
        (decodedText) => {
          onScanSuccess(decodedText);
          stopScanning();
        },
        (_error) => {
          // per-frame decode errors are expected, ignore
        }
      );

      setIsCameraReady(true);
    } catch (err) {
      console.error("Error starting scanner:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Camera Error", {
        description: msg || "Could not access camera. Please check permissions.",
      });
      onClose();
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
        setIsCameraReady(false);
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
    }
  };

  if (!isScanning) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm animate-in fade-in">
      <div className="container flex h-full flex-col items-center justify-center p-4">
        <div className="relative w-full max-w-md space-y-4">
          <Button
            variant="ghost"
            size="icon"
            className="absolute -top-12 right-0 z-10"
            onClick={() => {
              stopScanning();
              onClose();
            }}
          >
            <X className="h-6 w-6" />
          </Button>

          <div className="relative overflow-hidden rounded-2xl shadow-elevated bg-black aspect-square">
            <div
              id="barcode-reader"
              className="absolute inset-0 w-full h-full"
            />
            {!isCameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
                <Camera className="h-12 w-12 animate-pulse text-white" />
              </div>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Position the barcode within the frame
          </p>

          <div className="space-y-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <ImageIcon className="mr-2 h-5 w-5" />
              Can't Scan? Take a Photo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoUpload}
              className="hidden"
            />

            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                stopScanning();
                onClose();
              }}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
