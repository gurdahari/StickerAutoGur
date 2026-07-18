
import React, { useState, useRef, useEffect } from 'react';
import { createChat, type ChatSession } from '../services/aiService';
import { ChatMessage } from '../types';
import { MessageSquare, Send, User, Bot, X } from 'lucide-react';

const ChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: "Ready to optimize your conversion architecture. What specific niche vertical are you targeting today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatRef = useRef<ChatSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !chatRef.current) {
      chatRef.current = createChat();
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !chatRef.current) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const response = await chatRef.current.sendMessage({ message: userMsg });
      const text = response.text || "I couldn't generate a response.";
      setMessages(prev => [...prev, { role: 'model', text: text }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "System connectivity error. Please retry." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-50 transition-all ${
          isOpen ? 'bg-slate-700 rotate-90' : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-110'
        }`}
      >
        {isOpen ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-3rem)] h-[500px] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="bg-indigo-900/50 p-4 border-b border-slate-700 flex items-center gap-3">
             <div className="bg-indigo-500 p-2 rounded-full">
               <Bot className="w-5 h-5 text-white" />
             </div>
             <div>
               <h3 className="font-bold text-white">E-Commerce Architect</h3>
               <p className="text-xs text-indigo-200">Powered by OpenAI</p>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === 'user' ? 'bg-slate-600' : 'bg-indigo-600'
                }`}>
                  {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
                </div>
                <div className={`p-3 rounded-2xl text-sm max-w-[80%] ${
                   msg.role === 'user' 
                   ? 'bg-slate-700 text-white rounded-tr-none' 
                   : 'bg-indigo-900/30 text-slate-200 border border-indigo-900/50 rounded-tl-none'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
               <div className="flex gap-3">
                 <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                 </div>
                 <div className="bg-indigo-900/30 p-3 rounded-2xl rounded-tl-none flex items-center gap-1">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                 </div>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="p-4 border-t border-slate-700 bg-slate-900/50">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about strategy..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              <button 
                type="submit" 
                disabled={loading || !input.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatBot;
