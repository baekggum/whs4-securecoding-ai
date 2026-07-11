import { Link } from "react-router-dom";
import type { ProductListItem } from "../types";

// List view intentionally exposes only id + name (minimal-exposure
// principle, docs/architecture.md §4) — no price/thumbnail/status here.
export function ProductCard({ product }: { product: ProductListItem }) {
  return (
    <Link className="product-card" to={`/products/${product.id}`}>
      {product.name}
    </Link>
  );
}
