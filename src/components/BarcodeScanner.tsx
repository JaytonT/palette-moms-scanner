import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Camera, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

// In-app camera, PHOTO FIRST. Tapping Capture freezes the current frame and hands
// it straight to AI identify (the item is recognised from the picture). No barcode
// reticle, no "center the barcode" gate: barcodes are unreliable on this stock, so
// the flow is just "photograph the item." The captured photo also becomes the
// product image.
interface BarcodeScannerProps {
  onPhotoCapture: (file: File) => void;
  isScanning: boolean;
  onClose: () => void;
}

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    // focusMode is not in the TS lib yet; harmless where unsupported.
    advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
  },
};

export const BarcodeScanner = ({ onPhotoCapture, isScanning, onClose }: BarcodeScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.onloadedmetadata = null;
      videoRef.current.onplaying = null;
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
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
        description: "This browser can't access the camera. Use 'Choose a Photo' instead.",
      });
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      const markReady = () => {
        if (!doneRef.current) setIsCameraReady(true);
      };
      video.onloadedmetadata = () => void video.play().then(markReady).catch(() => {});
      video.onplaying = markReady;
      video.srcObject = stream;
      void video.play().then(markReady).catch(() => {});
    } catch (err) {
      console.error("Error starting camera:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Camera Error", {
        description: msg || "Could not access camera. Try 'Choose a Photo' instead.",
      });
    }
  };

  // Freeze the current frame as a full-resolution JPEG and send it to identify.
  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || doneRef.current) return;
    setIsCapturing(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setIsCapturing(false);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setIsCapturing(false);
          toast.error("Could not capture the photo. Try again.");
          return;
        }
        doneRef.current = true;
        const file = new File([blob], "item-photo.jpg", { type: "image/jpeg" });
        stopCamera();
        onPhotoCapture(file);
      },
      "image/jpeg",
      0.9
    );
  };

  // Pick an existing photo from the gallery instead of using the live camera.
  const handlePhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    doneRef.current = true;
    stopCamera();
    onPhotoCapture(file);
  };

  useEffect(() => {
    if (!isScanning) return;
    doneRef.current = false;
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

          <div className="relative overflow-hidden rounded-2xl shadow-elevated bg-black aspect-[3/4]">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            {(!isCameraReady || isCapturing) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
                {isCapturing ? (
                  <div className="flex items-center gap-2 text-white">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm">Capturing...</span>
                  </div>
                ) : (
                  <Camera className="h-12 w-12 animate-pulse text-white" />
                )}
              </div>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Fill the frame with the item and tap Capture. We'll identify it from the photo.
          </p>

          <div className="space-y-3">
            <Button
              variant="default"
              size="lg"
              onClick={handleCapture}
              className="w-full"
              disabled={!isCameraReady || isCapturing}
            >
              <Camera className="mr-2 h-5 w-5" />
              Capture
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
              disabled={isCapturing}
            >
              <ImageIcon className="mr-2 h-5 w-5" />
              Choose a Photo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoPick}
              className="hidden"
              aria-label="Choose a photo"
              title="Choose a photo"
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
