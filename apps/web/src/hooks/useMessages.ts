/**
 * Message hooks for chat view.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { apiAtom } from '../lib/atoms'

export interface Message {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string | { type: string; text?: string }[]
  createdAt?: number
  toolUse?: { name: string; input: unknown }[]
  isStreaming?: boolean
}

export function useMessages(sessionId: string | null) {
  const api = useAtomValue(apiAtom)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load messages
  const loadMessages = useCallback(async () => {
    if (!api || !sessionId) {
      setMessages([])
      return
    }
    setLoading(true)
    try {
      const result = await api.getMessages(sessionId) as Message[]
      setMessages(result)
    } catch (err) {
      console.error('[useMessages] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [api, sessionId])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Listen for updates
  useEffect(() => {
    if (!api || !sessionId) return
    return api.onSessionEvent((...args: unknown[]) => {
      // Only refresh for events related to this session
      const event = args[0] as any
      if (event?.sessionId === sessionId || !event?.sessionId) {
        loadMessages()
      }
    })
  }, [api, sessionId, loadMessages])

  // Send message
  const sendMessage = useCallback(async (
    text: string,
    attachments?: File[]
  ) => {
    if (!api || !sessionId || !text.trim()) return

    setSending(true)
    try {
      // Convert files to attachments format if needed
      const fileAttachments = attachments?.map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
      }))

      await api.sendMessage(sessionId, text.trim(), fileAttachments)
      // Messages will update via event listener
    } catch (err) {
      console.error('[useMessages] Failed to send:', err)
    } finally {
      setSending(false)
    }
  }, [api, sessionId])

  // Cancel processing
  const cancelProcessing = useCallback(async () => {
    if (!api || !sessionId) return
    try {
      await api.cancelProcessing(sessionId)
    } catch (err) {
      console.error('[useMessages] Failed to cancel:', err)
    }
  }, [api, sessionId])

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return {
    messages,
    loading,
    sending,
    sendMessage,
    cancelProcessing,
    scrollRef,
    refresh: loadMessages,
  }
}
