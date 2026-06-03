import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Button } from "./ui/button";
import { Camera, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BarcodeScannerProps {
  onScanSuccess: (barcode: string) => void;
  isScanning: boolean;
  onClose: () => void;
}

// Retail 1D formats only. Locking the format list is half the reliability win:
// it stops the decoder wasting frames hunting QR / data-matrix / aztec.
const ZXING_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

function makeZxingReader(): BrowserMultiFormatReader {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
}

// The browser-native BarcodeDetector is hardware-backed and far faster than a
// JS decoder, but it is absent on iOS Safari. Feature-detect; fall back to ZXing.
type NativeDetector = {
  detect: (src: CanvasImageSource | Blob) => Promise<Array<{ rawValue: string }>>;
};
function getNativeDetector(): NativeDetector | null {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (opts: unknown) => NativeDetector })
    .BarcodeDetector;
  if (!BD) return null;
  try {
    return new BD({ formats: NATIVE_FORMATS });
  } catch {
    return null;
  }
}

// Decode a still image (a photo the user took or one the client sent).
// This is the most forgiving path: one frame, no motion blur, TRY_HARDER on.
async function decodeImageFile(file: File): Promise<string | null> {
  const native = getNativeDetector();
  if (native) {
    try {
      const bitmap = await createImageBitmap(file);
      const found = await native.detect(bitmap);
      (bitmap as ImageBitmap).close?.();
      if (found && found.length > 0) return found[0].rawValue;
    } catch {
      // fall through to ZXing
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const result = await makeZxingReader().decodeFromImageUrl(url);
    return result.getText();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    // focusMode is not in the TS lib yet; harmless where unsupported.
    advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
  },
};

export const BarcodeScanner = ({ onScanSuccess, isScanning, onClose }: BarcodeScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isDecodingPhoto, setIsDecodingPhoto] = useState(false);

  const stopCamera = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        /* noop */
      }
      controlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraReady(false);
  };

  const handleHit = (text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopCamera();
    onScanSuccess(text);
  };

  const startCamera = async () => {
    if (!window.isSecureContext) {
      toast.error("Camera requires HTTPS", {
        description: "Open the app over HTTPS (or localhost) to use the camera.",
      });
      onClose();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera not supported", {
        description: "This browser can't access the camera. Use 'Scan from Photo' instead.",
      });
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const native = getNativeDetector();

    try {
      // One owned stream for the whole scan. ZXing decodes from it as the
      // reliable baseline on every device (it passes the 1D decode test suite).
      // Native BarcodeDetector, when present, runs alongside purely for speed.
      // It is NEVER trusted alone: many Android Chrome builds expose
      // BarcodeDetector while detect() always returns [] (the platform barcode
      // module is not provisioned), which silently made the scanner never read.
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      const controls = await makeZxingReader().decodeFromStream(stream, video, (result) => {
        if (result) handleHit(result.getText());
      });
      controlsRef.current = controls;
      setIsCameraReady(true);

      if (native) {
        // Race the native detector for speed. First engine to hit wins;
        // handleHit is idempotent via doneRef, so a double hit is harmless.
        let loggedErr = false;
        const loop = async () => {
          if (!streamRef.current || doneRef.current) return;
          if (video.videoWidth > 0) {
            try {
              const codes = await native.detect(video);
              if (codes && codes.length > 0) {
                handleHit(codes[0].rawValue);
                return;
              }
            } catch (e) {
              if (!loggedErr) {
                loggedErr = true;
                console.warn("Native BarcodeDetector failed; ZXing is carrying the scan:", e);
              }
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      }
    } catch (err) {
      console.error("Error starting scanner:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Camera Error", {
        description: msg || "Could not access camera. Try 'Scan from Photo' instead.",
      });
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    stopCamera();
    setIsDecodingPhoto(true);
    const code = await decodeImageFile(file);
    setIsDecodingPhoto(false);
    if (code) {
      handleHit(code);
    } else {
      toast.error("No barcode found in that photo", {
        description: "Fill the frame with the barcode, keep it flat, avoid glare, then try again.",
      });
      void startCamera(); // resume live scanning so they can retry
    }
  };

  useEffect(() => {
    if (!isScanning) return;
    doneRef.current = false;
    // Defer until after paint so the <video> element exists.
    const rafId = requestAnimationFrame(() => void startCamera());
    return () => {
      cancelAnimationFrame(rafId);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning]);

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
              stopCamera();
              onClose();
            }}
          >
            <X className="h-6 w-6" />
          </Button>

          <div className="relative overflow-hidden rounded-2xl shadow-elevated bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            {/* Wide reticle: retail barcodes are wide and short, guide accordingly. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[28%] w-[82%] rounded-lg border-2 border-white/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
            </div>
            {(!isCameraReady || isDecodingPhoto) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
                {isDecodingPhoto ? (
                  <div className="flex items-center gap-2 text-white">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm">Reading photo...</span>
                  </div>
                ) : (
                  <Camera className="h-12 w-12 animate-pulse text-white" />
                )}
              </div>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Hold the barcode flat inside the box. Wide barcodes scan best filling the frame.
          </p>

          <div className="space-y-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
              disabled={isDecodingPhoto}
            >
              <ImageIcon className="mr-2 h-5 w-5" />
              Scan from Photo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="hidden"
              aria-label="Upload barcode photo"
              title="Upload barcode photo"
            />

            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                stopCamera();
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
