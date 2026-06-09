export interface ProductData {
  barcode: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  collectionId?: string; // selected GHL collection id (category)
  weight: string;
  dimensions: string;
  images: string[];
  averagePrice: string;
  seoTitle: string;
  seoDescription: string;
  quantity: number;
  // SLOC = the store's storage-location code. Stored in GHL's native price.sku
  // field (GHL's API field name is fixed); the app labels it "SLOC" throughout.
  slocCode: string;
  isFeatured: boolean;
  // Photos already uploaded to the GHL media library (staff camera/upload). Each
  // carries the GHL media id, so create attaches them directly instead of
  // re-importing by URL. images[] holds the display URLs (incl external lookup
  // images that still need importing); imageMedia is matched to those by url.
  imageMedia?: { id: string; url: string }[];
  estimatedFields: string[];
  dataSource: "api" | "ai" | "manual";
  confidence: "high" | "medium" | "low";
}

export interface GHLProduct {
  _id: string;
  name: string;
  description?: string;
  statementDescriptor?: string;
  isFeatured?: boolean;
  availableInStore?: boolean;
  variants?: GHLVariant[];
  medias?: GHLMedia[];
}

export interface GHLVariant {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  availableQuantity?: number;
}

export interface GHLMedia {
  url: string;
  title?: string;
  type: string;
  isFeatured?: boolean;
}

export interface GHLInventoryItem {
  _id: string;
  name: string;
  sku?: string;
  availableQuantity: number;
  availableInStore?: boolean;
}
