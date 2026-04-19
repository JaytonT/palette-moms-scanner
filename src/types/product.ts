export interface ProductData {
  barcode: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  weight: string;
  dimensions: string;
  images: string[];
  averagePrice: string;
  seoTitle: string;
  seoDescription: string;
  quantity: number;
  skuCode: string;
  isFeatured: boolean;
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
