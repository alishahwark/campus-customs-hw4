import { FormEvent, useEffect, useState } from 'react'
import { ChatHistoryMessage, ChatProductMatch, getChatHistory, imageFileUrl, PageContext, Product, sendChatMessage } from '../api'
import { ProductCard as ProductCardComponent } from './ProductCard'

type ChatMessage = { id: number; role: 'assistant' | 'user'; content: string; products?: ChatProductMatch[] }
type ChatWidgetProps = { userId: number | null; pageContext: PageContext | null; onNavigate: (path: string) => void }
const greeting: ChatMessage = { id: 1, role: 'assistant', content: 'Hi! I can help you find your next Yale favorite. Ask me about products, colors, or sizes.' }

function matchAsProduct(match: ChatProductMatch): Product {
  return {
    product_id: match.product_id,
    name: match.name,
    garment_type: '',
    description: match.description,
    colors: [],
    search_tags: [],
    image_file_path: match.image_file_path,
    image_url: imageFileUrl(match.image_file_path),
    price: match.price,
  }
}

function historyAsMessage(message: ChatHistoryMessage, index: number): ChatMessage {
  return { id: index + 1, role: message.role, content: message.content, products: message.products }
}

export function ChatWidget({ onNavigate, pageContext, userId }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])

  useEffect(() => {
    let active = true
    if (userId === null) {
      setMessages([greeting])
      setIsLoadingHistory(false)
      return () => { active = false }
    }

    setIsLoadingHistory(true)
    getChatHistory(userId)
      .then((response) => {
        if (!active) return
        setMessages(response.messages.length > 0 ? response.messages.map(historyAsMessage) : [greeting])
      })
      .catch(() => {
        if (active) setMessages([greeting])
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false)
      })
    return () => { active = false }
  }, [userId])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    const userMessageId = Date.now()
    setMessages((current) => [...current, { id: userMessageId, role: 'user', content }])
    setDraft('')
    setIsSending(true)
    sendChatMessage(content, userId, pageContext)
    .then((response) => setMessages((current) => [...current, { id: userMessageId + 1, role: 'assistant', content: response.message, products: response.products }]))
      .catch((error) => setMessages((current) => [...current, { id: userMessageId + 1, role: 'assistant', content: error instanceof Error ? error.message : 'The shopping assistant is temporarily unavailable.' }]))
      .finally(() => setIsSending(false))
  }

  return <div className={`chat-widget ${isOpen ? 'chat-widget--open' : ''}`}>
    {isOpen && <section aria-label="Campus Concierge chat" className="chat-panel"><div className="chat-panel__header"><div><p className="eyebrow">Campus Customs · Yale Essentials</p><h2>Campus Concierge</h2><span className="chat-panel__status">Here to help you find your classic.</span></div><button aria-label="Close chat" className="icon-button" onClick={() => setIsOpen(false)} type="button">×</button></div><div className="chat-panel__messages">{isLoadingHistory && <p className="chat-message chat-message--assistant">Loading your conversation...</p>}{messages.map((message) => <div className={`chat-message-group chat-message-group--${message.role}`} key={message.id}><p className={`chat-message chat-message--${message.role}`}>{message.content}</p>{message.products && message.products.length > 0 && <div className="chat-products">{message.products.map((product) => <ProductCardComponent key={product.product_id} onSelect={(productId) => onNavigate(`/products/${encodeURIComponent(productId)}`)} product={matchAsProduct(product)} />)}</div>}</div>)}</div><form className="chat-panel__form" onSubmit={handleSubmit}><input aria-label="Message the Campus Concierge" disabled={isSending || isLoadingHistory} onChange={(event) => setDraft(event.target.value)} placeholder={isSending ? 'Finding an answer...' : 'Ask the Concierge...'} value={draft} /><button aria-label="Send message" className="send-button" disabled={isSending || isLoadingHistory} type="submit">↑</button></form></section>}
    {!isOpen && <button aria-label="Open Campus Concierge" className="chat-launcher" onClick={() => setIsOpen(true)} type="button"><span className="chat-launcher__dot" />Campus Concierge</button>}
  </div>
}
