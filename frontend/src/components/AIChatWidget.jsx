import { useMemo, useRef, useState, useEffect } from 'react';
import api from '../services/api';
import './AIChatWidget.css';

const DEFAULT_PROMPTS = {
  shop: [
    'Summarize my pending orders',
    'Suggest what I should restock next',
    'Should I bid in the current auction?',
  ],
  fleet: [
    'Which truck is the highest priority right now?',
    'Explain the current warning in my fleet',
    'Summarize today’s shipment risks',
    'Prepare an auction trigger recommendation',
  ],
};

function formatSource(source) {
  return source === 'gemini' ? 'Gemini + app context' : 'App fallback logic';
}

export default function AIChatWidget({ page = 'shop', accent = 'light' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        page === 'fleet'
          ? 'Ask about fleet risk, truck status, warnings, or auction readiness. I only recommend actions in v1.'
          : 'Ask about orders, invoices, restocking, or whether an auction looks worthwhile. I only recommend actions in v1.',
      source: 'fallback',
      suggestedActions: [],
    },
  ]);
  const messageContainerRef = useRef(null);

  const quickPrompts = useMemo(() => DEFAULT_PROMPTS[page] || DEFAULT_PROMPTS.shop, [page]);

  useEffect(() => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const sendQuestion = async (question) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.post('/ai/chat', {
        question: trimmed,
        page,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: response.data.answer,
          source: response.data.source,
          suggestedActions: response.data.suggested_actions || [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          text: 'I could not reach the AI endpoint just now. Please try again in a moment.',
          source: 'fallback',
          suggestedActions: [],
        },
      ]);
      console.error('AI chat failed', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat-widget">
      {isOpen && (
        <div
          className="ai-chat-widget__panel"
          style={accent === 'dark' ? { background: '#0f172a', color: '#fff' } : undefined}
        >
          <div className="ai-chat-widget__header">
            <div>
              <h3>LiveTrack Copilot</h3>
              <p>{page === 'fleet' ? 'Fleet and auction assistant' : 'Shop and order assistant'}</p>
            </div>
            <button type="button" className="ai-chat-widget__close" onClick={() => setIsOpen(false)}>
              x
            </button>
          </div>

          <div className="ai-chat-widget__messages" ref={messageContainerRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`ai-chat-widget__message ai-chat-widget__message--${message.role}`}
              >
                <div>{message.text}</div>
                {message.role === 'assistant' && (
                  <>
                    <span className="ai-chat-widget__source">{formatSource(message.source)}</span>
                    {message.suggestedActions?.length > 0 && (
                      <div className="ai-chat-widget__actions">
                        {message.suggestedActions.map((action) => (
                          <button type="button" key={action} onClick={() => sendQuestion(action)}>
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="ai-chat-widget__composer">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendQuestion(input);
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about trucks, orders, auctions, or restocking"
              />
              <button type="submit" disabled={loading}>
                {loading ? '...' : 'Send'}
              </button>
            </form>

            <div className="ai-chat-widget__hints">
              {quickPrompts.map((prompt) => (
                <button type="button" key={prompt} onClick={() => sendQuestion(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`ai-chat-widget__toggle ${isOpen ? 'ai-chat-widget__toggle--open' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open AI copilot"
      >
        <span className="ai-chat-widget__toggle-ring ai-chat-widget__toggle-ring--outer" />
        <span className="ai-chat-widget__toggle-ring ai-chat-widget__toggle-ring--inner" />
        <span className="ai-chat-widget__toggle-core">
          <span className="ai-chat-widget__toggle-icon">✦</span>
          <span className="ai-chat-widget__toggle-text">
            <strong>AI</strong>
            <small>Copilot</small>
          </span>
        </span>
        <span className="ai-chat-widget__toggle-badge">LIVE</span>
      </button>
    </div>
  );
}
