import React, { useState, useRef, useEffect } from 'react'
import { Rnd } from 'react-rnd'
import { useApp } from '../context/AppContext'
import {
  MessageCircle,
  X,
  Send,
  Bot,
  User,
  Sparkles,
  HelpCircle,
  ChevronRight,
  Minimize2,
  Maximize2,
  Volume2,
  ExternalLink,
  ArrowRightCircle
} from 'lucide-react'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Initialize Gemini API
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

// Extended FAQ Data with Actions (Fallback and Keywords)
const getFaqKnowledge = (navigate) => [
  // ... existing keywords can stay as fallback or training data ...
]

const suggestedQuestions = [
  'Who has the best attendance?',
  'Add a new member',
  'Go to Analytics',
  'Summary of this month',
  'Draft an announcement'
]

const AIChatAssistant = ({ isOpen, onClose, onNavigate }) => {
  const { setDashboardTab, members, currentTable, monthlyTables } = useApp()

  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: 'Hi! 👋 I\'m your TMH Assistant powered by Google Gemini. I have access to your member data and can answer questions or navigate for you!',
      timestamp: new Date()
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Speech Synthesis
  const speak = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel() // Stop previous
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    }
  }

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Enhanced navigate wrapper
  const handleNavigate = (view, options) => {
    if (onNavigate) onNavigate(view, options)
    if (view === 'dashboard' && options?.tab) {
      setDashboardTab(options.tab)
    }
    if (onClose) onClose()
  }

  const handleSend = async () => {
    if (!inputValue.trim()) return

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: inputValue.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsTyping(true)

    try {
      // 1. Prepare Context
      // Limit members list size to avoid token limits if list is huge, though Flash handles ~1M tokens.
      const membersContext = members?.map(m =>
        `- ${m.full_name} (${m.gender}, ${m.current_level}, Status: ${m.is_visitor ? 'Visitor' : 'Member'})`
      ).join('\n') || "No members found."

      const context = `
        You are the TMH Teen Ministry Assistant, an AI agent helping to manage a church youth group.
        
        SYSTEM CONTEXT:
        - Current Month/Table: ${currentTable}
        - Total Members: ${members?.length || 0}
        - Available Tables: ${monthlyTables?.join(', ') || 'None'}
        - List of Members:\n${membersContext}
        
        INSTRUCTIONS:
        1. Answer users' questions about their data (attendance, member lists, stats).
        2. BE BRIEF. Limit answers to 1-2 paragraphs.
        3. NAVIGATION: If the user explicitly asks to "Go to" or "Open" a page, verify which page and add a short confirmation.
           (The system will check your text for keywords 'dashboard', 'settings', 'admin', 'analytics' to add a button).
        4. If asked to add a member, say "I can open the form for you."
        
        USER QUESTION: "${userMessage.text}"
      `

      // 2. Call Gemini
      const result = await model.generateContent(context)
      const response = await result.response
      const botText = response.text()

      // 3. Determine Action based on User Intent (Hybrid approach)
      let action = null
      const lowerText = userMessage.text.toLowerCase()
      const botLower = botText.toLowerCase()

      if (lowerText.includes('dashboard') || lowerText.includes('home')) {
        action = { label: 'Go to Dashboard', onClick: () => handleNavigate('dashboard') }
      } else if (lowerText.includes('settings')) {
        action = { label: 'Open Settings', onClick: () => handleNavigate('settings') }
      } else if (lowerText.includes('admin')) {
        action = { label: 'Open Admin', onClick: () => handleNavigate('admin') }
      } else if (lowerText.includes('analytics') || lowerText.includes('stats')) {
        action = { label: 'View Analytics', onClick: () => handleNavigate('analytics') }
      } else if (lowerText.includes('add member') || lowerText.includes('new member')) {
        action = { label: 'Add Member', onClick: () => handleNavigate('dashboard', { openModal: 'addMember' }) }
      }

      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: botText,
        action: action,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, botMessage])

    } catch (error) {
      console.error("Gemini Error:", error)
      let errorMessage = "I'm having trouble connecting to Gemini. Please check your internet connection."
      if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
        errorMessage = "I'm receiving too many requests right now. Please wait a moment before asking again."
      }
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        type: 'bot',
        text: errorMessage,
        timestamp: new Date()
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const handleQuickQuestion = (question) => {
    setInputValue(question)
    setTimeout(() => handleSend(), 100)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  const InnerContent = (
    <>
      {/* Header */}
      <div className={`chat-header bg-gradient-to-r from-orange-500 to-purple-600 p-4 flex items-center justify-between ${!isMobile ? 'cursor-move select-none' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">TMH Assistant</h3>
            <p className="text-[10px] text-white/70">{isMobile ? 'AI Assistant' : 'Drag to move • Resize corners'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white"
            title="Close"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
        {messages.map((message) => (
          <div key={message.id} className={`flex flex-col ${message.type === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`flex gap-2 max-w-[90%] ${message.type === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-sm ${message.type === 'user'
                ? 'bg-orange-500 text-white'
                : 'bg-white/80 dark:bg-gray-800/80 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-900'
                }`}>
                {message.type === 'user' ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              </div>

              <div className={`px-4 py-3 rounded-2xl text-sm shadow-sm backdrop-blur-sm ${message.type === 'user'
                ? 'bg-orange-500 text-white rounded-tr-none'
                : 'bg-white/80 dark:bg-gray-800/80 text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-100 dark:border-gray-700'
                }`}>
                <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>

                {/* Action Button (Bot Only) */}
                {message.action && (
                  <button
                    onClick={message.action.onClick}
                    className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg text-xs font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors w-full"
                  >
                    <ArrowRightCircle className="w-3.5 h-3.5" />
                    {message.action.label}
                  </button>
                )}
              </div>
            </div>

            {/* Speak Button (Bot Only) */}
            {message.type === 'bot' && (
              <button
                onClick={() => speak(message.text)}
                className="ml-11 mt-1 text-gray-400 hover:text-purple-500 transition-colors p-1"
                title="Read aloud"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-2 items-center ml-1">
            <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600 flex items-center justify-center">
              <Bot className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex gap-1 bg-gray-200/50 dark:bg-gray-700/50 px-3 py-2 rounded-full">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Chips */}
      {messages.length < 4 && (
        <div className="px-4 py-2 bg-transparent border-t border-gray-100/20 dark:border-gray-700/20">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleQuickQuestion(q)}
                className="whitespace-nowrap px-3 py-1.5 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 transition-all shadow-sm"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 bg-white/50 dark:bg-gray-800/50 backdrop-blur-md border-t border-gray-200/50 dark:border-gray-700/50 pb-safe">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask AI or say 'Go to...'"
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200/50 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/80 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm backdrop-blur-sm"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="p-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-purple-200 dark:shadow-none"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-gray-900 safe-area-bottom">
        {InnerContent}
      </div>
    )
  }

  return (
    <Rnd
      default={{
        x: typeof window !== 'undefined' && window.innerWidth - 420 > 0 ? window.innerWidth - 420 : 20,
        y: typeof window !== 'undefined' && window.innerHeight - 600 > 0 ? window.innerHeight - 600 : 80,
        width: 380,
        height: 550
      }}
      minWidth={300}
      minHeight={400}
      bounds="window"
      style={{ display: 'flex', flexDirection: 'column' }}
      className="z-50 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden"
      dragHandleClassName="chat-header"
    >
      {InnerContent}
    </Rnd>
  )
}

export default AIChatAssistant
