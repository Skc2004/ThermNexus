import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts';
import { Cpu, Activity, Gamepad2, Settings, Crosshair, Zap, Power, Disc, Server } from 'lucide-react';

export default function App() {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState('Disconnected');
  const [uiLock, setUiLock] = useState(false);
  const [currentPwm, setCurrentPwm] = useState(0);
  const [failsafe, setFailsafe] = useState(false);
  
  // Real Physics Sensors tied to Native WebSockets
  const [cpuTemp, setCpuTemp] = useState(0);
  const [gpuTemp, setGpuTemp] = useState(0);
  const [watts, setWatts] = useState(0);
  const [confidence, setConfidence] = useState(100);
  
  const wsRef = useRef(null);

  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:8888');

    wsRef.current.onopen = () => setStatus('Online');
    wsRef.current.onclose = () => setStatus('Disconnected');
    
    wsRef.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setUiLock(payload.ui_lock);
        setCurrentPwm(payload.pwm);
        setFailsafe(payload.failsafe);
        // Absorb native physics variables unconditionally without modification
        setCpuTemp(payload.cpu_temp ? payload.cpu_temp.toFixed(1) : "0.0");
        setGpuTemp(payload.gpu_temp ? payload.gpu_temp.toFixed(1) : "0.0");
        setWatts(payload.watts ? payload.watts.toFixed(1) : "0.0");

        // Map confidence tracking relative to predicted temp differences
        if (payload.predicted && payload.cpu_temp) {
             const diff = Math.abs(payload.predicted - payload.cpu_temp);
             let conf = 100 - (diff * 5); // 1 degree diff drops confidence slightly
             setConfidence(Math.max(0, Math.min(100, conf)));
        }
        
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" });
        
        setData(prev => {
          const newData = [...prev, {
            time: timestamp,
            pwm: payload.pwm,
            cpu: payload.cpu_temp ? parseFloat(payload.cpu_temp.toFixed(1)) : 0,
            gpu: payload.gpu_temp ? parseFloat(payload.gpu_temp.toFixed(1)) : 0
          }];
          return newData.slice(-40); 
        });
      } catch (e) {}
    };

    return () => wsRef.current.close();
  }, []);

  const sendOverride = (val) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "MANUAL_OVERRIDE", pwm: parseInt(val) }));
      }
  };
  
  const releaseOverride = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "RELEASE_OVERRIDE" }));
      }
  }

  // Handle Electron Application close
  const closeApp = () => {
     window.close();
  }

  const confidenceData = [
    { name: 'Base', val: 100, fill: '#1a1d24' },
    { name: 'AI Confidence', val: uiLock ? 0 : confidence, fill: uiLock ? '#ef4444' : '#3b82f6' }
  ];

  return (
    <div className="min-h-screen bg-black/60 text-[#c9d1d9] font-sans selection:bg-blue-500/30 overflow-hidden flex flex-col" style={{ backdropFilter: 'blur(30px)' }}>
      
      {/* NATIVE OS DRAG BAR */}
      <div className="h-10 w-full flex justify-between items-center px-4 shrink-0 bg-transparent" style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex gap-3 items-center">
            <div className="w-4 h-4 rounded-full bg-blue-500/80 shadow-[0_0_10px_rgba(59,130,246,0.8)] border border-blue-400"></div>
            <span className="text-xs font-black tracking-[0.2em] text-white/70">THERMALNEXUS <span className="opacity-40">// EMBEDDED SYSTEM OS</span></span>
        </div>
        <div className="flex gap-4" style={{ WebkitAppRegion: 'no-drag' }}>
            <button onClick={closeApp} className="w-3 h-3 rounded-full border border-white/10 bg-red-500/50 hover:bg-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,1)] transition-all"></button>
            <button className="w-3 h-3 rounded-full border border-white/10 bg-yellow-500/50 hover:bg-yellow-500 transition-all"></button>
            <button className="w-3 h-3 rounded-full border border-white/10 bg-green-500/50 hover:bg-green-500 transition-all"></button>
        </div>
      </div>

      {/* CORE WRAPPER */}
      <div className="flex h-[calc(100vh-2.5rem)]">
        
        {/* SIDEBAR NAVIGATION */}
        <aside className="w-20 bg-white/[0.02] border-r border-white/5 flex flex-col items-center py-8 justify-between z-10">
           <div className="flex flex-col gap-8">
               <button className="p-3 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:scale-110 transition-transform"><Activity size={24}/></button>
               <button className="p-3 text-white/40 hover:bg-white/5 hover:text-white rounded-xl transition-all"><Crosshair size={24}/></button>
               <button className="p-3 text-white/40 hover:bg-white/5 hover:text-white rounded-xl transition-all"><Cpu size={24}/></button>
               <button className="p-3 text-white/40 hover:bg-white/5 hover:text-white rounded-xl transition-all"><Settings size={24}/></button>
           </div>
           <button className="p-3 text-white/20 hover:text-red-500 rounded-xl transition-all"><Power size={24}/></button>
        </aside>

        {/* MAIN DASHBOARD */}
        <main className="flex-1 p-8 overflow-y-auto">
            {/* HEROGRAM INTRO */}
            <header className="mb-10 flex justify-between items-end">
               <div>
                   <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/50 tracking-tight leading-tight mb-2">
                       Aero-Acoustic Engine
                   </h1>
                   <p className="text-gray-500 tracking-widest text-sm font-semibold uppercase flex items-center gap-3">
                       <span className={`w-2 h-2 rounded-full ${status === 'Online' ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-red-500'}`}></span>
                       RUST DAEMON / MULTI-DEVICE X-RAY / STATUS: {status}
                   </p>
               </div>
               
               <div className="flex items-center gap-4 bg-white/[0.03] p-2 rounded-2xl border border-white/10 backdrop-blur-md">
                   <div className={`px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${uiLock ? 'bg-orange-500 text-black shadow-[0_0_20px_rgba(249,115,22,0.4)]' : 'text-white/50'}`}>
                        <Gamepad2 size={16}/> Manual Override
                   </div>
                   <div className={`px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${!uiLock ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'text-white/50'}`}>
                        <Zap size={16}/> DeepMind PyTorch
                   </div>
               </div>
            </header>

            {/* THREE-COLUMN METRICS TILESET */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
               
               {/* TILE 1: PHYSICS MATRIX */}
               <div className="bg-gradient-to-br from-white/[0.05] to-transparent border border-white/[0.08] rounded-3xl p-6 relative overflow-hidden backdrop-blur-2xl shadow-2xl">
                   <div className="absolute top-0 right-0 p-4 opacity-20"><Server size={80}/></div>
                   <h3 className="text-white/40 text-xs font-black tracking-widest uppercase mb-6">Realtime Physics Constraints</h3>
                   
                   <div className="space-y-4">
                       <div className="flex justify-between items-baseline">
                           <span className="text-gray-400 font-medium">Core Temp (N0)</span>
                           <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">{cpuTemp}°C</span>
                       </div>
                       <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{width: `${cpuTemp}%`}}></div></div>
                       
                       <div className="flex justify-between items-baseline pt-2">
                           <span className="text-gray-400 font-medium">GPU Hotspot</span>
                           <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-300">{gpuTemp}°C</span>
                       </div>
                       <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{width: `${gpuTemp}%`}}></div></div>
                   </div>
               </div>

                {/* TILE 2: AI CONFIDENCE RADIAL */}
                <div className="bg-gradient-to-br from-white/[0.05] to-transparent border border-white/[0.08] rounded-3xl p-6 relative backdrop-blur-2xl shadow-2xl flex flex-col items-center justify-center">
                    <h3 className="text-white/40 text-xs font-black tracking-widest uppercase absolute top-6 left-6 w-full text-left">PyTorch RL Confidence</h3>
                    
                    <div className="w-40 h-40 relative mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" barSize={8} data={confidenceData} startAngle={90} endAngle={-270}>
                                <RadialBar background={{ fill: '#ffffff0a' }} dataKey="val" cornerRadius={10} />
                            </RadialBarChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black text-white">{uiLock ? '0' : confidence.toFixed(1)}<span className="text-lg opacity-50">%</span></span>
                            <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold opacity-80 mt-1">{uiLock ? 'SUSPENDED' : 'ACCURACY'}</span>
                        </div>
                    </div>
                </div>

                {/* TILE 3: FAN DUTY CYCLE OVERRIDE TILE */}
                <div className={`rounded-3xl p-6 relative backdrop-blur-2xl shadow-2xl transition-all duration-500 flex flex-col justify-between ${uiLock ? 'bg-gradient-to-br from-orange-500/20 to-transparent border border-orange-500/30 shadow-[0_0_40px_rgba(249,115,22,0.15)]' : 'bg-gradient-to-br from-white/[0.05] to-transparent border border-white/[0.08]'}`}>
                    <div className="flex justify-between items-start">
                         <h3 className={`text-xs font-black tracking-widest uppercase ${uiLock ? 'text-orange-400' : 'text-white/40'}`}>Global Hardware Extractor</h3>
                         <Disc className={`${uiLock ? 'text-orange-500 animate-spin-slow' : 'text-white/10'}`} size={24}/>
                    </div>

                    <div className="my-auto">
                        <h2 className="text-5xl font-black text-white tracking-tighter mb-4">{Math.round((currentPwm/255)*100)}<span className="text-2xl text-white/30">%</span></h2>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between w-full">
                            <span className="text-[10px] font-bold tracking-widest text-white/30">0 RPM</span>
                            <span className="text-[10px] font-bold tracking-widest text-white/30">MAX RPM</span>
                        </div>
                        <input 
                            type="range" min="0" max="255" value={uiLock ? currentPwm : 0} 
                            onChange={(e) => sendOverride(e.target.value)}
                            className={`w-full h-2 rounded-lg appearance-none cursor-pointer transition-colors ${uiLock ? 'bg-orange-900/50 accent-orange-500' : 'bg-gray-800 accent-blue-500/0 grayscale'}`}
                        />
                        {uiLock && (
                            <button onClick={releaseOverride} className="mt-4 w-full py-3 bg-red-500 border border-red-400 hover:bg-red-400 rounded-xl text-xs font-black tracking-widest text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all">
                                DETACH HARDWARE OVERRIDE
                            </button>
                        )}
                    </div>
                </div>

            </div>

            {/* LIVE TELEMETRY GRAPH */}
            <div className="h-72 w-full bg-gradient-to-t from-white/[0.02] to-transparent border border-white/[0.08] rounded-3xl p-6 relative overflow-hidden backdrop-blur-md">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-white/80 font-bold tracking-widest uppercase text-sm">Realtime Sub-Microsecond Action Engine</h3>
                    <div className="flex gap-4 text-xs font-black tracking-widest uppercase mt-1">
                        <span className="text-blue-400 flex items-center gap-2"><span className="w-2 h-2 bg-blue-400 rounded-full"></span> PWM Native Target</span>
                        <span className="text-purple-400 flex items-center gap-2"><span className="w-2 h-2 bg-purple-400 rounded-full"></span> System Thermals</span>
                    </div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <defs>
                        <linearGradient id="pwmGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="time" stroke="#ffffff30" tick={{fill: '#ffffff50', fontSize: 10}} tickLine={false} axisLine={false}/>
                    <YAxis stroke="#ffffff30" tick={{fill: '#ffffff50', fontSize: 10}} tickLine={false} axisLine={false}/>
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172aee', borderColor: '#1e293b', borderRadius: '16px', boxShadow: '0 0 20px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', padding: '16px' }}
                        itemStyle={{ fontWeight: 'bold' }}
                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase', marginBottom: '8px' }}
                    />
                    <Area type="monotone" dataKey="pwm" stroke="#3b82f6" strokeWidth={3} fill="url(#pwmGrad)" activeDot={{r: 6, fill: '#60a5fa', strokeWidth: 0}} />
                    <Area type="monotone" dataKey="cpu" stroke="#a855f7" strokeWidth={2} fill="url(#tempGrad)" strokeDasharray="5 5" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

        </main>
      </div>

    </div>
  );
}
