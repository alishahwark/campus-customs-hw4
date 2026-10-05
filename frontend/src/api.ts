export type InventoryItem = {
  size: string
  quantity: number
}

export type Product = {
  product_id: string
  name: string
  garment_type: string
  description: string
  colors: string[]
  search_tags: string[]
  image_file_path: string
  image_url: string
  price: number
  inventory?: InventoryItem[]
}

export type User = {
  id: number
  name: string
  email: string
  first_name: string | null
  last_name: string | null
  created_at: string
}

export type SignupPayload = {
  first_name: string
  last_name: string
  email: string
  password: string
  confirm_password: string
}

export type LoginPayload = {
  email: string
  password: string
}

export type ChatProductMatch = {
  product_id: string
  name: string
  price: number
  description: string
  image_file_path: string
}

export type PageContext = {
  product_id: string
  name: string
}

export type ChatHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
  products: ChatProductMatch[]
  created_at: string
}

export type ChatHistoryResponse = {
  messages: ChatHistoryMessage[]
}

export type ChatResponse = {
  message: string
  products: ChatProductMatch[]
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({})) as { detail?: string }
  if (!response.ok) throw new Error(body.detail ?? `Request failed: ${response.status}`)
  return body as T
}

export function getProducts(): Promise<Product[]> { return request<Product[]>('/api/products') }
export function getProduct(productId: string): Promise<Product> { return request<Product>(`/api/products/${encodeURIComponent(productId)}`) }
export function imageUrl(path: string): string {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${API_BASE_URL}${path}`
}
export function imageFileUrl(filePath: string): string { return `${API_BASE_URL}/images/${encodeURIComponent(filePath.split('/').pop() ?? '')}` }
export function signUp(payload: SignupPayload): Promise<{ message: string; user: User }> { return post('/api/auth/signup', payload) }
export function logIn(payload: LoginPayload): Promise<{ message: string; user: User }> { return post('/api/auth/login', payload) }
export function getChatHistory(userId: number): Promise<ChatHistoryResponse> { return request<ChatHistoryResponse>(`/api/chat/history?user_id=${encodeURIComponent(userId)}`) }
export function sendChatMessage(message: string, userId: number | null = null, pageContext: PageContext | null = null): Promise<ChatResponse> {
  return post('/api/chat', { message, user_id: userId, page_context: pageContext })
}
