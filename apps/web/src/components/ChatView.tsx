/**
 * ChatView — full chat interface with markdown rendering, code blocks,
 * streaming indicators, and tool activity.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useMessages, type Message } from '../hooks'
import { writeClipboard } from '../lib/platform'

interface ChatViewProps {
  sessionId: string
}

export function ChatView({ sessionId }: ChatViewProps) {
  const {
    messages,
    loading,
    sending,
    sendMessage,
    cancelProcessing,
    scrollRef,
  } = useMessages(sessionId)
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return
    const text = input
    setInput('')
    await sendMessage(text)
  }, [input, sending, sendMessage])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isProcessing = messages.some(m => m.isStreaming)

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {loading && messages.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              Loading messages...
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={msg.id ?? i} message={msg} />
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 text-muted text-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>Agent is thinking...</span>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-surface">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Shift+Enter for newline)"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 min-h-[42px] max-h-[200px]"
                rows={1}
                disabled={sending}
              />
            </div>

            {isProcessing ? (
              <button
                onClick={cancelProcessing}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/20 transition-colors flex-shrink-0"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex-shrink-0"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const content = extractTextContent(message.content)

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'order-last' : ''}`}>
        {/* Role label */}
        <div className={`text-[11px] text-muted mb-1 ${isUser ? 'text-right' : ''}`}>
          {isUser ? 'You' : 'Agent'}
        </div>

        {/* Message content */}
        <div className={`rounded-xl px-4 py-2.5 ${
          isUser
            ? 'bg-accent text-white rounded-tr-sm'
            : 'bg-surface border border-border rounded-tl-sm'
        }`}>
          <MessageContent content={content} isUser={isUser} />
        </div>

        {/* Tool activity */}
        {message.toolUse && message.toolUse.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {message.toolUse.map((tool, i) => (
              <div key={i} className="text-[11px] text-muted flex items-center gap-1.5 px-1">
                <span className="text-accent">⚙</span>
                <span className="font-mono">{tool.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message Content Renderer
// ---------------------------------------------------------------------------

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  // Split content into text and code blocks
  const parts = parseContentBlocks(content)

  return (
    <div className="text-sm leading-relaxed space-y-2">
      {parts.map((part, i) => {
        if (part.type === 'code') {
          return (
            <CodeBlock
              key={i}
              code={part.content}
              language={part.language}
            />
          )
        }
        return (
          <div
            key={i}
            className={`whitespace-pre-wrap break-words ${
              isUser ? '' : 'prose prose-sm prose-invert max-w-none'
            }`}
            // Simple markdown-like rendering for inline formatting
            dangerouslySetInnerHTML={{
              __html: renderInlineMarkdown(part.content),
            }}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Code Block
// ---------------------------------------------------------------------------

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await writeClipboard(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group rounded-lg bg-[#0d1117] border border-border overflow-hidden my-2">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-border text-[11px]">
        <span className="text-muted font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="text-muted hover:text-foreground transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {/* Code */}
      <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-[#e6edf3] font-mono">{code}</code>
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parsing Helpers
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: 'text' | 'code'
  content: string
  language?: string
}

function parseContentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim()
      if (text) blocks.push({ type: 'text', content: text })
    }

    blocks.push({
      type: 'code',
      language: match[1] || undefined,
      content: match[2].trimEnd(),
    })

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  const remaining = content.slice(lastIndex).trim()
  if (remaining) blocks.push({ type: 'text', content: remaining })

  if (blocks.length === 0) blocks.push({ type: 'text', content })

  return blocks
}

function extractTextContent(content: string | { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text!)
      .join('\n\n')
  }
  return JSON.stringify(content)
}

function renderInlineMarkdown(text: string): string {
  return text
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-[#1e293b] text-[#e6edf3] px-1.5 py-0.5 rounded text-[13px] font-mono">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-accent underline">$1</a>')
}
