import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Cpu } from 'lucide-react';

export default function AIAssistant({ setAcousticMode, setCryoBoost, saveFanCurve }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Hello! I am Nexus, your local thermal AI. How can I optimize your system today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleCommand = (cmdStr) => {
    try {
      // Look for JSON command block within the LLM's text
      const match = cmdStr.match(/```json\n([\s\S]*?)\n```/);
      if (match) {
        const cmd = JSON.parse(match[1]);
        if (cmd.action === "cryoboost") {
          fetch('http://localhost:8889/action/cryoboost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: cmd.duration || 30 }) });
          setCryoBoost(true);
          setTimeout(() => setCryoBoost(false), (cmd.duration || 30) * 1000);
        } else if (cmd.action === "acoustic_mode") {
          setAcousticMode(cmd.enabled);
          fetch('http://localhost:8889/config/acoustic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: cmd.enabled }) });
        }
      }
    } catch (e) {
      console.error("Failed to parse LLM command", e);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);

    const systemPrompt = `You are Nexus, an AI assistant controlling the ThermNexus cooling system. 
You can help the user by explaining thermals or issuing JSON commands to control the fans.
Available JSON commands (wrap in \`\`\`json blocks):
1. {"action": "cryoboost", "duration": 30} - Turns fans to 100% to purge heat. Use when user says they are about to game or need max cooling.
2. {"action": "acoustic_mode", "enabled": true/false} - Turns on/off silent fan smoothing. Use when user wants quiet operation.
Always include a friendly conversational response alongside any JSON commands. Keep answers brief.`;

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3', // Or phi3, mistral, etc. user will configure
          prompt: userMsg,
          system: systemPrompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error('Ollama not running or model not found.');
      }

      const data = await response.json();
      const reply = data.response;
      
      setMessages(prev => [...prev, { role: 'assistant', text: reply }]);
      handleCommand(reply);
      
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Connection Error: Make sure Ollama is running locally on port 11434 and 'llama3' is pulled. (${error.message})` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full glass-panel overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/20">
        <h2 className="text-[11px] font-black tracking-[0.25em] text-white/60 uppercase flex items-center gap-2">
          <Cpu size={14} className="text-purple-400" /> Nexus AI Link
        </h2>
        <div className="text-[9px] text-white/30 uppercase tracking-widest font-bold">Ollama / Llama3</div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 thin-scrollbar" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex flex-shrink-0 items-center justify-center ${msg.role === 'user' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={`px-4 py-3 rounded-2xl max-w-[80%] text-sm ${msg.role === 'user' ? 'bg-blue-500/20 text-white rounded-tr-sm' : 'bg-black/30 border border-white/5 text-white/80 rounded-tl-sm'}`}>
              <pre className="whitespace-pre-wrap font-sans font-medium text-xs leading-relaxed">{msg.text}</pre>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Loader2 size={14} className="animate-spin" />
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-black/20 border-t border-white/10">
        <div className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask Nexus to optimize thermals..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
            disabled={loading}
          />
          <button 
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center hover:bg-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
