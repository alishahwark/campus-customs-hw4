import type { Product } from '../api'
import { imageUrl } from '../api'

type ProductCardProps = { product: Product; onSelect: (productId: string) => void }

export function ProductCard({ product, onSelect }: ProductCardProps) {
  return <button className="product-card" onClick={() => onSelect(product.product_id)} type="button">
    <div className="product-card__image-wrap"><img alt={product.name} className="product-card__image" src={imageUrl(product.image_url)} /></div>
    <div className="product-card__body"><div>{product.garment_type && <p className="eyebrow">{product.garment_type}</p>}<h3>{product.name}</h3></div><p className="price">${product.price.toFixed(2)}</p><p className="product-card__description">{product.description}</p><span className="text-link">View details <span aria-hidden="true">↗</span></span></div>
  </button>
}
