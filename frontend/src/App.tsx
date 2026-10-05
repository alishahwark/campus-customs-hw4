import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ChatProductMatch, getProduct, getProducts, imageFileUrl, imageUrl, logIn, PageContext, Product, signUp, User } from './api'
import { ChatWidget } from './components/ChatWidget'
import { ProductCard } from './components/ProductCard'

type Page = 'home' | 'products' | 'about' | 'login' | 'signup' | 'product' | 'account'
const USER_STORAGE_KEY = 'campus_customs_user'
const RECENT_PRODUCTS_KEY = 'campus_customs_recent_products'
const CART_STORAGE_KEY = 'campus_customs_cart'

type CartItem = {
  product_id: string
  name: string
  price: number
  image_url: string
  size: string
  quantity: number
  stock: number
}

type CartItemInput = Omit<CartItem, 'quantity'>

function readStoredCart(): CartItem[] {
  try {
    const stored = window.localStorage.getItem(CART_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CartItem => Boolean(
      item && typeof item.product_id === 'string' && typeof item.name === 'string'
      && typeof item.price === 'number' && typeof item.image_url === 'string'
      && typeof item.size === 'string' && typeof item.quantity === 'number'
      && typeof item.stock === 'number' && item.quantity > 0 && item.stock > 0,
    ))
  } catch {
    return []
  }
}

function readRecentProductIds(): string[] {
  try {
    const stored = window.localStorage.getItem(RECENT_PRODUCTS_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function rememberRecentlyViewed(productId: string) {
  const ids = [productId, ...readRecentProductIds().filter((id) => id !== productId)].slice(0, 6)
  window.localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(ids))
}

function readStoredUser(): User | null {
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY)
    return stored ? JSON.parse(stored) as User : null
  } catch {
    return null
  }
}

function getRoute(): { page: Page; productId?: string } {
  const parts = window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'products' && parts[1]) return { page: 'product', productId: parts[1] }
  if (parts[0] === 'products') return { page: 'products' }
  if (parts[0] === 'about') return { page: 'about' }
  if (parts[0] === 'login') return { page: 'login' }
  if (parts[0] === 'create-account') return { page: 'signup' }
  if (parts[0] === 'account') return { page: 'account' }
  return { page: 'home' }
}

function App() {
  const [route, setRoute] = useState(getRoute)
  const [user, setUser] = useState<User | null>(readStoredUser)
  const [pageContext, setPageContext] = useState<PageContext | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>(readStoredCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartNotice, setCartNotice] = useState('')
  const [conciergeMatches, setConciergeMatches] = useState<ChatProductMatch[]>([])

  useEffect(() => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems))
  }, [cartItems])

  useEffect(() => {
    if (!cartNotice) return
    const timeout = window.setTimeout(() => setCartNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [cartNotice])

  useEffect(() => {
    const handlePopState = () => setRoute(getRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    setPageContext(null)
  }, [route.page, route.productId])

  useEffect(() => {
    const revealItems = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.08 })
    revealItems.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  })

  function navigate(path: string) {
    window.history.pushState({}, '', path)
    setRoute(getRoute())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleAuthenticated(nextUser: User) {
    setUser(nextUser)
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser))
  }

  function signOut() {
    setUser(null)
    window.localStorage.removeItem(USER_STORAGE_KEY)
    navigate('/')
  }

  function addToCart(item: CartItemInput) {
    setCartItems((current) => {
      const existing = current.find((cartItem) => cartItem.product_id === item.product_id && cartItem.size === item.size)
      if (existing) {
        return current.map((cartItem) => cartItem === existing
          ? { ...cartItem, quantity: Math.min(cartItem.quantity + 1, cartItem.stock) }
          : cartItem)
      }
      return [...current, { ...item, quantity: 1 }]
    })
    setCartNotice(`${item.name} · ${item.size} added to your bag.`)
    setCartOpen(true)
  }

  function updateCartQuantity(productId: string, size: string, change: number) {
    setCartItems((current) => current.flatMap((item) => {
      if (item.product_id !== productId || item.size !== size) return [item]
      const quantity = Math.min(item.stock, Math.max(0, item.quantity + change))
      return quantity === 0 ? [] : [{ ...item, quantity }]
    }))
  }

  function removeFromCart(productId: string, size: string) {
    setCartItems((current) => current.filter((item) => !(item.product_id === productId && item.size === size)))
  }

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0)

  return (
    <>
      <Header cartCount={cartCount} onNavigate={navigate} onOpenCart={() => setCartOpen(true)} onSignOut={signOut} user={user} />
      <main>
        {route.page === 'home' && <HomePage onNavigate={navigate} />}
        {route.page === 'products' && <ProductsPage onNavigate={navigate} />}
        {route.page === 'product' && <ProductDetailPage onAddToCart={addToCart} onNavigate={navigate} onProductContextChange={setPageContext} productId={route.productId ?? ''} />}
        {route.page === 'about' && <AboutPage onNavigate={navigate} />}
        {route.page === 'login' && <AccountPage mode="login" onAuthenticated={handleAuthenticated} onNavigate={navigate} />}
        {route.page === 'signup' && <AccountPage mode="signup" onAuthenticated={handleAuthenticated} onNavigate={navigate} />}
        {route.page === 'account' && <AccountDashboard onNavigate={navigate} onSignOut={signOut} user={user} />}
      </main>
      {conciergeMatches.length > 0 && <ConciergeResults matches={conciergeMatches} onClear={() => setConciergeMatches([])} onNavigate={navigate} />}
      <Footer onNavigate={navigate} />
      <ChatWidget onNavigate={navigate} onProductMatches={setConciergeMatches} pageContext={pageContext} userId={user?.id ?? null} />
      {cartNotice && <div aria-live="polite" className="cart-notice">{cartNotice}</div>}
      {cartOpen && <CartDrawer cartItems={cartItems} onClose={() => setCartOpen(false)} onNavigate={navigate} onRemove={removeFromCart} onUpdateQuantity={updateCartQuantity} />}
    </>
  )
}

type NavigationProps = { onNavigate: (path: string) => void }
type HeaderProps = NavigationProps & { user: User | null; onSignOut: () => void; cartCount: number; onOpenCart: () => void }

function Header({ cartCount, onNavigate, onOpenCart, onSignOut, user }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  function navigateFromMenu(path: string) {
    setMenuOpen(false)
    onNavigate(path)
  }
  return <>
    <div className="announcement-bar">Made for New Haven. Worn everywhere.</div>
    <header className={`site-header ${scrolled ? 'site-header--scrolled' : ''}`}>
      <div className="header-inner">
        <button className="wordmark" onClick={() => navigateFromMenu('/')} type="button"><span className="wordmark__mark">CC</span><span><strong>Campus</strong> Customs</span></button>
        <nav aria-label="Primary navigation" className={`main-nav ${menuOpen ? 'main-nav--open' : ''}`}><NavButton label="Home" onClick={() => navigateFromMenu('/')} /><NavButton label="Products" onClick={() => navigateFromMenu('/products')} /><NavButton label="About" onClick={() => navigateFromMenu('/about')} /><NavButton label="Account" onClick={() => navigateFromMenu(user ? '/account' : '/login')} /></nav>
        <div className="header-actions"><button aria-label="Search products" className="header-icon" onClick={() => navigateFromMenu('/products')} type="button">⌕</button>{user ? <><span className="header-user">Hi, {user.first_name || user.name}</span><button className="header-link" onClick={onSignOut} type="button">Sign out</button></> : <><button className="header-link" onClick={() => navigateFromMenu('/login')} type="button">Log in</button><button className="account-button" onClick={() => navigateFromMenu('/create-account')} type="button">Create account</button></>}<button aria-label={`Open bag${cartCount ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`} className="bag-button" onClick={onOpenCart} type="button">Bag <span>{cartCount}</span></button></div>
        <button aria-expanded={menuOpen} aria-label="Toggle navigation" className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} type="button"><span /><span /></button>
      </div>
    </header>
  </>
}

function NavButton({ label, onClick }: { label: string; onClick: () => void }) { return <button className="nav-link" onClick={onClick} type="button">{label}</button> }

function HomePage({ onNavigate }: NavigationProps) {
  const [featured, setFeatured] = useState<Product[]>([])
  const [catalogue, setCatalogue] = useState<Product[]>([])
  useEffect(() => { getProducts().then((products) => { setCatalogue(products); setFeatured(products.slice(0, 4)) }).catch(() => { setCatalogue([]); setFeatured([]) }) }, [])
  const categoryTiles = [
    { label: 'Hoodies', query: 'hoodie', product: catalogue.find((product) => `${product.name} ${product.garment_type} ${product.search_tags.join(' ')}`.toLowerCase().includes('hoodie')) },
    { label: 'Sweatshirts', query: 'sweatshirt', product: catalogue.find((product) => `${product.name} ${product.garment_type} ${product.search_tags.join(' ')}`.toLowerCase().includes('sweatshirt')) },
    { label: 'T-Shirts', query: 't-shirt', product: catalogue.find((product) => `${product.name} ${product.garment_type} ${product.search_tags.join(' ')}`.toLowerCase().includes('t-shirt')) },
    { label: 'Accessories', query: 'hat', product: catalogue.find((product) => `${product.name} ${product.garment_type} ${product.search_tags.join(' ')}`.toLowerCase().includes('hat')) },
  ]
  return <>
    <section className="hero section-shell" data-reveal><div className="hero__content"><p className="eyebrow eyebrow--light">New Haven, Connecticut</p><h1>New Haven,<br /><em>worn well.</em></h1><p className="hero__copy">Yale essentials and campus classics made for the people, places, and traditions that stay with you.</p><button className="button button--light" onClick={() => onNavigate('/products')} type="button">Shop the collection <span>↗</span></button></div>{featured[0] && <div className="hero__image-panel"><img alt={featured[0].name} src={imageUrl(featured[0].image_url)} /><span>01 / Campus Classics</span></div>}<div className="hero__stamp" aria-hidden="true"><span>YALE</span><small>EST. 1701 · NEW HAVEN</small></div></section>
    <section className="intro section-shell section-shell--narrow" data-reveal><p className="eyebrow">The Campus Collection</p><h2>Made for Yale.<br /><em>Made to last.</em></h2><p className="intro__copy">From first days on the Green to late nights in the library, Campus Customs makes thoughtful, comfortable gear for every chapter of campus life.</p></section>
    <section className="featured section-shell" data-reveal><div className="section-heading"><div><p className="eyebrow">Yale Essentials</p><h2>The pieces you <em>come back to.</em></h2></div><button className="text-link text-link--button" onClick={() => onNavigate('/products')} type="button">Shop all pieces ↗</button></div><ProductGrid products={featured} onSelect={(id) => onNavigate(`/products/${encodeURIComponent(id)}`)} /></section>
    <section className="editorial-band section-shell" data-reveal><div className="editorial-band__image">{featured[1] && <img alt={featured[1].name} src={imageUrl(featured[1].image_url)} />}</div><div className="editorial-band__copy"><p className="eyebrow">From New Haven</p><h2>A little bit of<br /><em>the place.</em></h2><p>Campus Customs is shaped by the rhythm of Yale: the bells, the brick, the long walk home. Pieces with a point of view, for days that become stories.</p><button className="text-link text-link--button" onClick={() => onNavigate('/about')} type="button">Read our story ↗</button></div></section>
    <section className="style-section section-shell" data-reveal><div className="section-heading"><div><p className="eyebrow">The campus edit</p><h2>Shop by <em>category.</em></h2></div><span className="collection-number">CC / 04</span></div><div className="category-grid">{categoryTiles.map((category, index) => <button className="category-tile" key={category.label} onClick={() => onNavigate(`/products?q=${encodeURIComponent(category.query)}`)} type="button">{category.product && <img alt="" src={imageUrl(category.product.image_url)} />}<span className="category-tile__number">0{index + 1}</span><strong>{category.label}</strong><em>↗</em></button>)}</div></section>
    <section className="callout section-shell" data-reveal><div><p className="eyebrow eyebrow--light">Campus Classics</p><h2>Wear the place<br /><em>wherever you go.</em></h2></div><button className="button button--light" onClick={() => onNavigate('/products')} type="button">Explore the collection <span>↗</span></button></section>
  </>
}

function ProductsPage({ onNavigate }: NavigationProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [garmentType, setGarmentType] = useState('')
  const [color, setColor] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState('featured')
  const [recentIds, setRecentIds] = useState<string[]>(readRecentProductIds)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { getProducts().then(setProducts).catch(() => setError('The catalogue is taking a moment to load. Please try again.')).finally(() => setLoading(false)) }, [])
  const garmentTypes = useMemo(() => Array.from(new Set(products.map((product) => product.garment_type).filter(Boolean))).sort(), [products])
  const colors = useMemo(() => Array.from(new Set(products.flatMap((product) => product.colors))).sort(), [products])
  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const minimum = minPrice === '' ? null : Number(minPrice)
    const maximum = maxPrice === '' ? null : Number(maxPrice)
    const matching = products.filter((product) => {
      const searchable = [product.name, product.garment_type, product.description, ...product.colors, ...product.search_tags].join(' ').toLowerCase()
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (!garmentType || product.garment_type === garmentType)
        && (!color || product.colors.includes(color))
        && (minimum === null || product.price >= minimum)
        && (maximum === null || product.price <= maximum)
    })
    return [...matching].sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price
      if (sort === 'price-high') return b.price - a.price
      return a.name.localeCompare(b.name)
    })
  }, [color, garmentType, maxPrice, minPrice, products, query, sort])
  const recentProducts = recentIds.map((id) => products.find((product) => product.product_id === id)).filter((product): product is Product => Boolean(product))
  function clearCatalogueControls() {
    setQuery('')
    setGarmentType('')
    setColor('')
    setMinPrice('')
    setMaxPrice('')
    setSort('featured')
  }
  function clearRecentlyViewed() {
    window.localStorage.removeItem(RECENT_PRODUCTS_KEY)
    setRecentIds([])
  }
  const activeFilters: Array<{ label: string; clear: () => void }> = []
  if (query.trim()) activeFilters.push({ label: `Search: “${query.trim()}”`, clear: () => setQuery('') })
  if (garmentType) activeFilters.push({ label: garmentType, clear: () => setGarmentType('') })
  if (color) activeFilters.push({ label: color, clear: () => setColor('') })
  if (minPrice) activeFilters.push({ label: `From $${minPrice}`, clear: () => setMinPrice('') })
  if (maxPrice) activeFilters.push({ label: `Up to $${maxPrice}`, clear: () => setMaxPrice('') })
  if (sort === 'price-low') activeFilters.push({ label: 'Price: low to high', clear: () => setSort('featured') })
  if (sort === 'price-high') activeFilters.push({ label: 'Price: high to low', clear: () => setSort('featured') })
  const filterSummary = activeFilters.length > 0 ? activeFilters.map((filter) => filter.label).join(' · ') : 'Showing the complete Campus Customs collection'
  const resultTitle = query.trim() ? `Results for “${query.trim()}”` : garmentType ? `${garmentType} essentials` : color ? `${color} favorites` : activeFilters.length ? 'Your selected edit' : 'The full collection'
  const emptyMessage = activeFilters.length > 0 ? `No pieces match ${filterSummary.toLowerCase()}. Try removing a filter or broaden your search.` : 'No products are available right now.'
  return <section className="section-shell page-section" data-reveal><div className="page-intro"><p className="eyebrow">The Campus Collection</p><h1>Shop Campus<br /><em>Customs.</em></h1><p>Yale classics, campus staples, and New Haven originals.</p></div><div className="catalogue-toolbar"><div><p className="catalogue-count">{filteredProducts.length} {filteredProducts.length === 1 ? 'piece' : 'pieces'}</p><p className="catalogue-summary">{filterSummary}</p></div><label className="search-field"><span>⌕</span><input aria-label="Search products" onChange={(event) => setQuery(event.target.value)} placeholder="Search the collection" value={query} /></label></div><div aria-label="Filter and sort products" className="filter-panel"><label className="filter-field">Garment type<select aria-label="Filter by garment type" onChange={(event) => setGarmentType(event.target.value)} value={garmentType}><option value="">All types</option>{garmentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="filter-field">Color<select aria-label="Filter by color" onChange={(event) => setColor(event.target.value)} value={color}><option value="">All colors</option>{colors.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="filter-field">Min price<input aria-label="Minimum price" min="0" onChange={(event) => setMinPrice(event.target.value)} placeholder="$0" type="number" value={minPrice} /></label><label className="filter-field">Max price<input aria-label="Maximum price" min="0" onChange={(event) => setMaxPrice(event.target.value)} placeholder="No max" type="number" value={maxPrice} /></label><label className="filter-field">Sort<select aria-label="Sort products" onChange={(event) => setSort(event.target.value)} value={sort}><option value="featured">Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label><button className="text-link text-link--button" onClick={clearCatalogueControls} type="button">Clear filters</button></div>{activeFilters.length > 0 && <div aria-label="Selected filters" className="active-filter-row"><span className="active-filter-label">Selected</span>{activeFilters.map((filter) => <button className="active-filter" key={filter.label} onClick={filter.clear} type="button">{filter.label}<span aria-hidden="true">×</span></button>)}</div>}{loading && <p className="status-message">Loading the collection...</p>}{error && <p className="status-message status-message--error">{error}</p>}{!loading && !error && <><div className="catalogue-results-heading"><div><p className="eyebrow">{activeFilters.length > 0 ? 'Your tailored edit' : 'Campus Customs'}</p><h2>{resultTitle}</h2></div><p className="catalogue-results-count">{filteredProducts.length} {filteredProducts.length === 1 ? 'piece' : 'pieces'} found</p></div><ProductGrid emptyMessage={emptyMessage} products={filteredProducts} onSelect={(id) => onNavigate(`/products/${encodeURIComponent(id)}`)} />{recentProducts.length > 0 && <section aria-labelledby="recently-viewed-title" className="recently-viewed"><div className="section-heading"><div><p className="eyebrow">Your browsing trail</p><h2 id="recently-viewed-title">Recently <em>viewed.</em></h2></div><button className="text-link text-link--button" onClick={clearRecentlyViewed} type="button">Clear</button></div><ProductGrid className="recently-viewed-grid" products={recentProducts} onSelect={(id) => onNavigate(`/products/${encodeURIComponent(id)}`)} /></section>}</>}</section>
}

function ProductGrid({ products, onSelect, className = '', emptyMessage = 'No products match that search.' }: { products: Product[]; onSelect: (productId: string) => void; className?: string; emptyMessage?: string }) { if (products.length === 0) return <p className="status-message status-message--empty">{emptyMessage}</p>; return <div className={`product-grid ${className}`}>{products.map((product) => <ProductCard key={product.product_id} onSelect={onSelect} product={product} />)}</div> }

function ConciergeResults({ matches, onClear, onNavigate }: { matches: ChatProductMatch[]; onClear: () => void; onNavigate: (path: string) => void }) {
  const products: Product[] = matches.map((match) => ({ product_id: match.product_id, name: match.name, garment_type: '', description: match.description, colors: [], search_tags: [], image_file_path: match.image_file_path, image_url: imageFileUrl(match.image_file_path), price: match.price }))
  return <section aria-labelledby="concierge-results-title" className="concierge-results section-shell" data-reveal><div className="section-heading"><div><p className="eyebrow">Results from your Concierge</p><h2 id="concierge-results-title">A considered <em>edit.</em></h2></div><button className="text-link text-link--button" onClick={onClear} type="button">Clear results</button></div><ProductGrid products={products} onSelect={(id) => onNavigate(`/products/${encodeURIComponent(id)}`)} /></section>
}

function ProductDetailPage({ onAddToCart, productId, onNavigate, onProductContextChange }: { productId: string; onProductContextChange: (context: PageContext | null) => void; onAddToCart: (item: CartItemInput) => void } & NavigationProps) {
  const [product, setProduct] = useState<Product | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    onProductContextChange(null)
    getProduct(productId)
      .then((loadedProduct) => {
        if (!active) return
        setProduct(loadedProduct)
        setSelectedSize(loadedProduct.inventory?.find((item) => item.quantity > 0)?.size ?? '')
        rememberRecentlyViewed(loadedProduct.product_id)
        onProductContextChange({ product_id: loadedProduct.product_id, name: loadedProduct.name })
      })
      .catch(() => {
        if (active) setError('We could not find that product.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [onProductContextChange, productId])
  if (loading) return <section className="section-shell page-section"><p className="status-message">Loading product details...</p></section>
  if (error || !product) return <section className="section-shell page-section"><p className="status-message status-message--error">{error}</p><button className="button" onClick={() => onNavigate('/products')} type="button">Back to products</button></section>
  return <section className="section-shell page-section" data-reveal><button className="back-link" onClick={() => onNavigate('/products')} type="button">← Back to collection</button><div className="product-detail"><div className="product-detail__image-wrap"><img alt={product.name} className="product-detail__image" src={imageUrl(product.image_url)} /></div><div className="product-detail__content"><p className="eyebrow">{product.garment_type}</p><h1>{product.name}</h1><p className="product-detail__price">${product.price.toFixed(2)}</p><p className="product-detail__description">{product.description}</p><div className="detail-rule" /><p className="detail-label">Available colors</p><div className="color-list">{product.colors.map((color) => <span key={color}>{color}</span>)}</div><p className="detail-label">Select a size</p><div className="size-grid">{product.inventory?.map((item) => <button aria-pressed={selectedSize === item.size} className={`size-option ${selectedSize === item.size ? 'size-option--selected' : ''} ${item.quantity === 0 ? 'size-option--sold-out' : ''}`} disabled={item.quantity === 0} key={item.size} onClick={() => setSelectedSize(item.size)} type="button"><strong>{item.size}</strong><span>{item.quantity === 0 ? 'Out of stock' : item.quantity <= 3 ? `Low stock · ${item.quantity}` : `${item.quantity} available`}</span></button>)}</div><button className="button button--navy" disabled={!selectedSize} onClick={() => { const stock = product.inventory?.find((item) => item.size === selectedSize)?.quantity ?? 0; onAddToCart({ product_id: product.product_id, name: product.name, price: product.price, image_url: product.image_url, size: selectedSize, stock }) }} type="button">{selectedSize ? `Add ${selectedSize} to bag` : 'Select a size'} <span>↗</span></button></div></div></section>
}

function CartDrawer({ cartItems, onClose, onNavigate, onRemove, onUpdateQuantity }: { cartItems: CartItem[]; onClose: () => void; onNavigate: (path: string) => void; onRemove: (productId: string, size: string) => void; onUpdateQuantity: (productId: string, size: string, change: number) => void }) {
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0)
  const subtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0)
  return <div className="cart-layer"><button aria-label="Close shopping bag" className="cart-backdrop" onClick={onClose} type="button" /><aside aria-label="Shopping bag" className="cart-drawer"><div className="cart-drawer__header"><div><p className="eyebrow">Campus Customs</p><h2>Your bag <span>({itemCount})</span></h2></div><button aria-label="Close shopping bag" className="icon-button icon-button--dark" onClick={onClose} type="button">×</button></div>{cartItems.length === 0 ? <div className="cart-empty"><p className="cart-empty__mark">CC</p><h3>Your bag is waiting.</h3><p>Save your favorite Yale essentials here as you browse.</p><button className="button button--navy" onClick={() => { onClose(); onNavigate('/products') }} type="button">Browse the collection <span>↗</span></button></div> : <><div className="cart-drawer__items">{cartItems.map((item) => <div className="cart-item" key={`${item.product_id}-${item.size}`}><img alt="" className="cart-item__image" src={imageUrl(item.image_url)} /><div className="cart-item__details"><button className="cart-item__name" onClick={() => { onClose(); onNavigate(`/products/${encodeURIComponent(item.product_id)}`) }} type="button">{item.name}</button><p className="cart-item__meta">Size {item.size} · ${item.price.toFixed(2)}</p><div className="cart-item__footer"><div aria-label={`Quantity for ${item.name}`} className="quantity-control"><button aria-label={`Decrease ${item.name}`} disabled={item.quantity <= 1} onClick={() => onUpdateQuantity(item.product_id, item.size, -1)} type="button">−</button><span>{item.quantity}</span><button aria-label={`Increase ${item.name}`} disabled={item.quantity >= item.stock} onClick={() => onUpdateQuantity(item.product_id, item.size, 1)} type="button">+</button></div><button className="remove-link" onClick={() => onRemove(item.product_id, item.size)} type="button">Remove</button></div></div><p className="cart-item__total">${(item.price * item.quantity).toFixed(2)}</p></div>)}</div><div className="cart-drawer__summary"><div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div><button className="button button--navy cart-checkout" disabled type="button">Checkout coming soon</button><p>Checkout is not connected yet. Your bag is saved locally in this browser.</p></div></>}</aside></div>
}

function AboutPage({ onNavigate }: NavigationProps) { return <section className="section-shell page-section about-page"><div className="page-intro"><p className="eyebrow">Campus Customs · New Haven, Connecticut</p><h1>Made in the spirit<br />of <em>the place.</em></h1><p>Yale essentials and campus classics for the people, places, and traditions that stay with you.</p></div><div className="about-grid"><div className="about-quote">“The best campus gear is the gear that becomes part of your everyday.”<span>— The Campus Customs point of view</span></div><div className="about-copy"><p>Campus Customs is a collection of Yale essentials with a little more intention behind them. We look to the people, places, and rituals around New Haven for inspiration, then make pieces that feel good long after commencement.</p><p>Whether you are marking a first tradition or carrying one forward, these are clothes for showing up as yourself.</p><button className="button button--navy" onClick={() => onNavigate('/products')} type="button">Explore the collection <span>↗</span></button></div></div><div className="about-statement"><p className="eyebrow">From New Haven, for everywhere.</p><h2>Wear the place<br /><em>wherever you go.</em></h2><button className="text-link text-link--button" onClick={() => onNavigate('/products')} type="button">Shop Campus Customs ↗</button></div></section> }

type AccountPageProps = NavigationProps & { mode: 'login' | 'signup'; onAuthenticated: (user: User) => void }

function AccountPage({ mode, onAuthenticated, onNavigate }: AccountPageProps) {
  const isSignup = mode === 'signup'
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', confirm_password: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    setSuccess('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (isSignup && form.password !== form.confirm_password) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const response = isSignup
        ? await signUp(form)
        : await logIn({ email: form.email, password: form.password })
      onAuthenticated(response.user)
      setForm((current) => ({ ...current, password: '', confirm_password: '' }))
      onNavigate('/account')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="section-shell page-section account-page"><div className="account-card"><p className="eyebrow">Campus Customs</p><h1>{isSignup ? 'Make it yours.' : 'Welcome back.'}</h1><p>{isSignup ? 'Create an account to keep your favorites close.' : 'Sign in to continue shopping your collection.'}</p>{error && <p aria-live="polite" className="auth-status auth-status--error">{error}</p>}{success && <p aria-live="polite" className="auth-status auth-status--success">{success}</p>}<form onSubmit={handleSubmit}>{isSignup && <><label>First name<input autoComplete="given-name" onChange={(event) => updateField('first_name', event.target.value)} required type="text" value={form.first_name} /></label><label>Last name<input autoComplete="family-name" onChange={(event) => updateField('last_name', event.target.value)} required type="text" value={form.last_name} /></label></>}<label>Email<input autoComplete="email" onChange={(event) => updateField('email', event.target.value)} required type="email" value={form.email} /></label><label>Password<input autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} onChange={(event) => updateField('password', event.target.value)} required type="password" value={form.password} /></label>{isSignup && <label>Confirm password<input autoComplete="new-password" minLength={8} onChange={(event) => updateField('confirm_password', event.target.value)} required type="password" value={form.confirm_password} /></label>}<button className="button button--navy" disabled={submitting} type="submit">{submitting ? 'Working...' : isSignup ? 'Create account' : 'Log in'} <span>↗</span></button></form>{!success && <button className="text-link text-link--button" onClick={() => onNavigate(isSignup ? '/login' : '/create-account')} type="button">{isSignup ? 'Already have an account? Log in' : 'New here? Create an account'}</button>}</div></section>
}

function AccountDashboard({ onNavigate, onSignOut, user }: NavigationProps & { user: User | null; onSignOut: () => void }) {
  if (!user) {
    return <section className="section-shell page-section account-page"><div className="account-card"><p className="eyebrow">Campus Customs</p><h1>Your account.</h1><p>Sign in to view your account details, saved conversation, and shopping preferences.</p><button className="button button--navy" onClick={() => onNavigate('/login')} type="button">Log in <span>↗</span></button></div></section>
  }
  return <section className="section-shell page-section account-dashboard" data-reveal><div className="page-intro"><p className="eyebrow">Your Campus Customs account</p><h1>Welcome,<br /><em>{user.first_name || user.name}.</em></h1><p>Your account is connected to your saved chat history and shopping experience.</p></div><div className="account-dashboard__grid"><div className="account-profile"><p className="eyebrow">Profile</p><h2>{user.name}</h2><dl><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Member since</dt><dd>{new Date(user.created_at).toLocaleDateString()}</dd></div></dl></div><div className="account-dashboard__actions"><p className="eyebrow">Keep browsing</p><p>Your Campus Concierge conversations are saved to this signed-in account. Your password is never shown here.</p><button className="button button--navy" onClick={() => onNavigate('/products')} type="button">Shop the collection <span>↗</span></button><button className="text-link text-link--button" onClick={onSignOut} type="button">Sign out</button></div></div></section>
}

function Footer({ onNavigate }: NavigationProps) { return <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><button className="wordmark wordmark--footer" onClick={() => onNavigate('/')} type="button"><span className="wordmark__mark">CC</span><span><strong>Campus</strong> Customs</span></button><p>Made for your Yale days<br />and all the ones after.</p></div><div className="footer-group"><p className="footer-heading">Shop</p><button onClick={() => onNavigate('/products')} type="button">Products</button><button onClick={() => onNavigate('/products')} type="button">Campus classics</button><button onClick={() => onNavigate('/products?q=hoodie')} type="button">Apparel</button></div><div className="footer-group"><p className="footer-heading">About</p><button onClick={() => onNavigate('/about')} type="button">Our story</button><button onClick={() => onNavigate('/about')} type="button">Campus Customs</button></div><div className="footer-group"><p className="footer-heading">Account</p><button onClick={() => onNavigate('/login')} type="button">Log in</button><button onClick={() => onNavigate('/create-account')} type="button">Create account</button><button onClick={() => onNavigate('/products')} type="button">Campus Concierge</button></div></div><div className="footer-bottom"><span>Campus Customs</span><span>New Haven, Connecticut · © 2025</span></div></footer> }

export default App
