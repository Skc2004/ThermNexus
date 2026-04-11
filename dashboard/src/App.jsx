import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts';
import { Cpu, Activity, Gamepad2, Settings, Crosshair, Zap, Power, Disc, Server, Thermometer, Wind } from 'lucide-react';

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
  const [coreTemps, setCoreTemps] = useState([0,0,0,0,0,0,0,0]);
  const [efficacy, setEfficacy] = useState(0);
  
  const wsRef = useRef(null);
  const lastAction = useRef({ pwm: 0, temp: 0, time: Date.now() });

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
        setCpuTemp(payload.cpu_temp ? payload.cpu_temp.toFixed(1) : "0.0");
        setGpuTemp(payload.gpu_temp ? payload.gpu_temp.toFixed(1) : "0.0");
        setWatts(payload.watts ? payload.watts.toFixed(1) : "0.0");
        if (payload.core_temps) setCoreTemps(payload.core_temps);

        // Action Efficacy Logic (Delta T / Delta PWM)
        const now = Date.now();
        if (now - lastAction.current.time > 5000) {
            const dT = lastAction.current.temp - payload.cpu_temp;
            const dP = payload.pwm - lastAction.current.pwm;
            if (dP > 10) {
                const eff = (dT / dP) * 100;
                setEfficacy(eff.toFixed(2));
            }
            lastAction.current = { pwm: payload.pwm, temp: payload.cpu_temp, time: now };
        }

        if (payload.predicted && payload.cpu_temp) {
             const diff = Math.abs(payload.predicted - payload.cpu_temp);
             let conf = 100 - (diff * 5);
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

    return () => wsRef.current && wsRef.current.close();
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

  const getHeatColor = (temp) => {
    if (temp < 40) return 'from-teal-500/40 to-teal-900/20 shadow-teal-500/20';
    if (temp < 55) return 'from-blue-500/40 to-blue-900/20 shadow-blue-500/20';
    if (temp < 70) return 'from-orange-500/40 to-orange-900/20 shadow-orange-500/20';
    return 'from-red-500/40 to-red-900/20 shadow-red-500/30';
  };

  return (
    <div className="min-h-screen bg-[#050506] text-[#c9d1d9] font-sans selection:bg-blue-500/30 overflow-hidden flex flex-col border border-white/5">
      
      {/* NATIVE OS DRAG BAR */}
      <div className="h-10 w-full flex justify-between items-center px-4 shrink-0 bg-white/[0.02]" style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex gap-3 items-center">
            <div className="w-4 h-4 rounded-full bg-blue-500/80 shadow-[0_0_10px_rgba(59,130,246,0.8)] border border-blue-400"></div>
            <span className="text-xs font-black tracking-[0.2em] text-white/70">THERMNEXUS <span className="opacity-40">// SYSTEM CORE</span></span>
        </div>
        <div className="flex gap-4" style={{ WebkitAppRegion: 'no-drag' }}>
            <div className="w-3 h-3 rounded-full bg-white/10"></div>
            <div className="w-3 h-3 rounded-full bg-white/10"></div>
            <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-2.5rem)]">
        {/* SIDEBAR */}
        <aside className="w-20 bg-white/[0.01] border-r border-white/5 flex flex-col items-center py-8 justify-between z-10">
           <div className="flex flex-col gap-8">
               <button className="p-3 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.3)]"><Activity size={24}/></button>
               <button className="p-3 text-white/20 hover:bg-white/5 rounded-xl transition-all"><Cpu size={24}/></button>
               <button className="p-3 text-white/20 hover:bg-white/5 rounded-xl transition-all"><Wind size={24}/></button>
               <button className="p-3 text-white/20 hover:bg-white/5 rounded-xl transition-all"><Settings size={24}/></button>
           </div>
           <button className="p-3 text-white/10 hover:text-red-500 rounded-xl transition-all"><Power size={24}/></button>
        </aside>

        {/* MAIN */}
        <main className="flex-1 p-6 overflow-y-auto thin-scrollbar">
            <header className="mb-8 flex justify-between items-center">
               <div>
                   <h1 className="text-3xl font-black text-white tracking-tight leading-tight">Adaptive Thermal Node</h1>
                   <p className="text-white/30 tracking-widest text-[10px] font-bold uppercase flex items-center gap-2">
                       <span className={`w-2 h-2 rounded-full ${status === 'Online' ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></span>
                       Hardware Link: {status} | Version 1.1.4
                   </p>
               </div>
               <div className="flex gap-4">
                   <div className={`px-4 py-2 rounded-xl flex items-center gap-2 text-[10px] font-black uppercase border ${uiLock ? 'bg-orange-500/20 border-orange-500 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.2)]' : 'border-white/5 text-white/20'}`}>
                        <Gamepad2 size={12}/> Manual Override
                   </div>
               </div>
            </header>

            <div className="grid grid-cols-12 gap-6 mb-6">
                {/* PHYSICS & THERMAL MAP */}
                <div className="col-span-8 grid grid-cols-2 gap-6">
                    {/* TILE: LIVE THERMAL MAP */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 relative">
                        <h3 className="text-white/30 text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2">
                           <Thermometer size={12}/> Live Thermal Grid (8-Core Map)
                        </h3>
                        <div className="grid grid-cols-4 gap-3 p-2 bg-black/40 rounded-2xl border border-white/5">
                            {coreTemps.map((temp, i) => (
                                <div key={i} className={`aspect-square rounded-lg bg-gradient-to-br ${getHeatColor(temp)} border border-white/10 flex flex-col items-center justify-center transition-all duration-500 shadow-lg`}>
                                    <span className="text-[10px] font-black text-white">{temp.toFixed(1)}°</span>
                                    <span className="text-[6px] font-bold text-white/40 uppercase">Core {i}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* TILE: ACTION IMPACT ANALYSIS */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between">
                         <h3 className="text-white/30 text-[10px] font-black tracking-widest uppercase mb-2 flex items-center gap-2">
                           <Activity size={12}/> Action Impact Analysis
                        </h3>
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className={`text-4xl font-black ${parseFloat(efficacy) > 0 ? 'text-green-500' : 'text-blue-400'}`}>
                                {efficacy > 0 ? '+' : ''}{efficacy}%
                            </span>
                            <span className="text-[10px] font-bold tracking-[0.3em] text-white/20 mt-2">COOLING EFFICACY RATE</span>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden mt-2">
                            <div className="h-full bg-green-500/50 rounded-full transition-all" style={{ width: `${Math.min(100, Math.abs(efficacy * 10))}%` }}></div>
                        </div>
                    </div>
                </div>

                {/* FAN OVERRIDE & POWER */}
                <div className="col-span-4 flex flex-col gap-6">
                    <div className={`flex-1 rounded-3xl p-6 border transition-all ${uiLock ? 'bg-orange-500/10 border-orange-500/30' : 'bg-white/[0.02] border-white/5'}`}>
                        <div className="flex justify-between items-start mb-4">
                             <h3 className="text-white/30 text-[10px] font-black tracking-widest uppercase">Fan Duty Factor</h3>
                             <Disc className={`${uiLock ? 'text-orange-500 animate-spin-slow' : 'text-white/10'}`} size={18}/>
                        </div>
                        <h2 className="text-4xl font-black text-white mb-6">{Math.round((currentPwm/255)*100)}%</h2>
                        <input type="range" min="0" max="255" value={uiLock ? currentPwm : 0} onChange={(e) => sendOverride(e.target.value)}
                               className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${uiLock ? 'bg-orange-900/50 accent-orange-500' : 'bg-white/5 accent-blue-500/0 opacity-30 shadow-none'}`}/>
                        {uiLock && <button onClick={releaseOverride} className="mt-4 w-full py-2 bg-red-500/80 hover:bg-red-500 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all">Detach Override</button>}
                    </div>
                </div>
            </div>

            {/* LOWER GRAPH TILE */}
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 h-64 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-white/40 font-black tracking-widest uppercase text-[10px]">Realtime Action/Physics Synchronization</h3>
                        <div className="flex gap-4 text-[10px] font-bold tracking-widest uppercase">
                            <span className="text-blue-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span> PWM Target</span>
                            <span className="text-purple-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-purple-400 rounded-full"></span> Core Temp Avg</span>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                        <defs>
                            <linearGradient id="pwmGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                            <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.05}/><stop offset="95%" stopColor="#a855f7" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                        <XAxis dataKey="time" stroke="#ffffff10" tick={{fill: '#ffffff20', fontSize: 8}} tickLine={false} axisLine={false}/>
                        <Tooltip contentStyle={{ backgroundColor: '#000000dd', border: '1px solid #ffffff10', borderRadius: '12px', backdropFilter: 'blur(10px)', fontSize: '10px' }}/>
                        <Area type="monotone" dataKey="pwm" stroke="#3b82f6" strokeWidth={2} fill="url(#pwmGrad)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="cpu" stroke="#a855f7" strokeWidth={2} fill="url(#tempGrad)" stopOpacity={0.5} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </main>
      </div>
    </div>
  );
}
