import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { History, Cpu, Activity, Settings, Zap, Power, Disc, Thermometer, Wind, Shield, BrainCircuit, SlidersHorizontal, AlertTriangle, Radio, Gauge, Clock, TrendingDown, Layers } from 'lucide-react';
import { fetchHistoricData } from './api';
import './App.css';

// ── Helpers ──
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pwmToPercent = (pwm) => Math.round((clamp(pwm, 0, 255) / 255) * 100);

const getHeatColor = (temp) => {
  if (temp < 35) return { bg: 'from-cyan-500/30 to-cyan-900/10', glow: 'shadow-cyan-500/20', text: 'text-cyan-300' };
  if (temp < 45) return { bg: 'from-teal-500/30 to-teal-900/10', glow: 'shadow-teal-500/20', text: 'text-teal-300' };
  if (temp < 55) return { bg: 'from-blue-500/30 to-blue-900/10', glow: 'shadow-blue-500/15', text: 'text-blue-300' };
  if (temp < 65) return { bg: 'from-amber-500/30 to-amber-900/10', glow: 'shadow-amber-500/20', text: 'text-amber-300' };
  if (temp < 75) return { bg: 'from-orange-500/35 to-orange-900/10', glow: 'shadow-orange-500/25', text: 'text-orange-300' };
  return { bg: 'from-red-500/40 to-red-900/15', glow: 'shadow-red-500/30', text: 'text-red-300' };
};

const StatusDot = ({ online }) => (
  <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse-glow' : 'bg-red-500'}`} />
);

// ── Stat Card ──
// eslint-disable-next-line no-unused-vars
const StatCard = ({ icon: Icon, label, value, unit, color = 'blue' }) => {
  const glowMap = { blue: 'hover:shadow-blue-500/10', purple: 'hover:shadow-purple-500/10', orange: 'hover:shadow-orange-500/10', teal: 'hover:shadow-teal-500/10', red: 'hover:shadow-red-500/10', green: 'hover:shadow-emerald-500/10' };
  const textMap = { blue: 'text-blue-400', purple: 'text-purple-400', orange: 'text-orange-400', teal: 'text-teal-400', red: 'text-red-400', green: 'text-emerald-400' };
  return (
    <div className={`glass-panel p-4 flex flex-col gap-1.5 transition-shadow ${glowMap[color]} hover:shadow-lg`}>
      <div className="flex items-center gap-2">
        <Icon size={13} className={`${textMap[color]} opacity-70`} />
        <span className="text-[9px] font-bold tracking-[0.2em] text-white/30 uppercase">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-black mono ${textMap[color]}`}>{value}</span>
        {unit && <span className="text-[10px] font-semibold text-white/20">{unit}</span>}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════
// ██  MAIN DASHBOARD
// ══════════════════════════════════════════════
export default function App() {
  // ── Live State ──
  const [data, setData] = useState([]);
  const [page, setPage] = useState('dashboard'); // dashboard | cpu | cooling | settings
  const [viewMode, setViewMode] = useState('live');
  const [historicData, setHistoricData] = useState([]);
  const [status, setStatus] = useState('Disconnected');
  const [uiLock, setUiLock] = useState(false);
  const [currentPwm, setCurrentPwm] = useState(0);
  const [failsafe, setFailsafe] = useState(false);

  // ── Telemetry ──
  const [cpuTemp, setCpuTemp] = useState(0);
  const [gpuTemp, setGpuTemp] = useState(0);
  const [watts, setWatts] = useState(0);
  const [confidence, setConfidence] = useState(100);
  const [coreTemps, setCoreTemps] = useState([0, 0, 0, 0, 0, 0, 0, 0]);
  const [efficacy, setEfficacy] = useState(0);
  const [predictedTemp, setPredictedTemp] = useState(0);
  const [heartbeatAge, setHeartbeatAge] = useState(0);
  const [heartbeatRaw, setHeartbeatRaw] = useState(0);

  // ── Manual Override ──
  const [manualPwm, setManualPwm] = useState(128);

  // ── Algorithm Log ──
  const [algoLog, setAlgoLog] = useState([]);

  const wsRef = useRef(null);
  const lastAction = useRef({ pwm: 0, temp: 0, time: 0 });

  // ── Historic Data Fetch ──
  useEffect(() => {
    if (viewMode === 'historic') {
      fetchHistoricData(24, 800).then(res => {
        const mapped = res.map(d => ({
          time: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          pwm: d.pwm,
          cpu: d.cpu_temp
        }));
        setHistoricData(mapped);
      });
    }
  }, [viewMode]);

  // ── WebSocket Connection ──
  useEffect(() => {
    let reconnectDelay = 1000;
    let reconnectTimer = null;
    let ws = null;

    function connect() {
      ws = new WebSocket('ws://localhost:8888');
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('Online');
        reconnectDelay = 1000;
      };

      ws.onclose = () => {
        setStatus('Reconnecting...');
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 10000);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          const p = JSON.parse(event.data);
          setUiLock(p.ui_lock);
          setCurrentPwm(p.pwm);
          setFailsafe(p.failsafe);
          setCpuTemp(p.cpu_temp ? parseFloat(p.cpu_temp.toFixed(1)) : 0);
          setGpuTemp(p.gpu_temp ? parseFloat(p.gpu_temp.toFixed(1)) : 0);
          setWatts(p.watts ? parseFloat(p.watts.toFixed(1)) : 0);
          setPredictedTemp(p.predicted ? parseFloat(p.predicted.toFixed(1)) : 0);
          if (p.core_temps) setCoreTemps(p.core_temps);

          // Heartbeat age tracking
          if (p.heartbeat) {
            const age = Date.now() - p.heartbeat;
            setHeartbeatAge(age);
            setHeartbeatRaw(p.heartbeat);
          }

          // Efficacy
          const now = Date.now();
          if (now - lastAction.current.time > 5000) {
            const dT = lastAction.current.temp - p.cpu_temp;
            const dP = p.pwm - lastAction.current.pwm;
            if (dP > 10) setEfficacy(parseFloat(((dT / dP) * 100).toFixed(2)));
            lastAction.current = { pwm: p.pwm, temp: p.cpu_temp, time: now };
          }

          // AI Confidence
          if (p.predicted && p.cpu_temp) {
            const diff = Math.abs(p.predicted - p.cpu_temp);
            setConfidence(clamp(Math.round(100 - diff * 5), 0, 100));
          }

          // Algorithm activity log
          setAlgoLog(prev => {
            const entry = {
              time: new Date().toLocaleTimeString('en-US', { hour12: false }),
              mode: p.ui_lock ? 'MANUAL' : (p.failsafe ? 'FAILSAFE' : 'AI-MPC'),
              pwm: p.pwm,
              cpu: p.cpu_temp ? p.cpu_temp.toFixed(1) : '0',
              pred: p.predicted ? p.predicted.toFixed(1) : '—',
              hbAge: p.heartbeat ? (Date.now() - p.heartbeat) : '—',
            };
            const newLog = [...prev, entry];
            return newLog.slice(-30);
          });

          const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' });
          setData(prev => {
            const newData = [...prev, {
              time: timestamp,
              pwm: p.pwm,
              cpu: p.cpu_temp ? parseFloat(p.cpu_temp.toFixed(1)) : 0,
              gpu: p.gpu_temp ? parseFloat(p.gpu_temp.toFixed(1)) : 0
            }];
            return newData.slice(-60);
          });
        } catch { /* silently ignore */ }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current && wsRef.current.close();
    };
  }, []);

  // ── WebSocket Commands ──
  const sendOverride = useCallback((val) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "MANUAL_OVERRIDE", pwm: parseInt(val) }));
  }, []);

  const releaseOverride = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "RELEASE_OVERRIDE" }));
  }, []);

  const engageManual = () => {
    setManualPwm(currentPwm || 128);
    sendOverride(currentPwm || 128);
  };

  const handleSlider = (e) => {
    const v = parseInt(e.target.value);
    setManualPwm(v);
    sendOverride(v);
  };

  const isOnline = status === 'Online';
  const chartData = viewMode === 'live' ? data : historicData;
  const avgTemp = coreTemps.length ? (coreTemps.reduce((a, b) => a + b, 0) / coreTemps.length) : 0;

  // ══════════════════════════════════════════════
  return (
    <div className="h-screen w-screen bg-[#030305] text-[#c9d1d9] font-sans selection:bg-blue-500/30 flex flex-col overflow-hidden">

      {/* ── FAILSAFE BANNER ── */}
      {failsafe && (
        <div className="w-full bg-red-500/15 border-b border-red-500/40 px-4 py-2 flex items-center gap-3 animate-fade-in shrink-0 z-50">
          <AlertTriangle size={16} className="text-red-400 animate-pulse-glow" />
          <span className="text-xs font-bold text-red-300 tracking-wide uppercase">
            FAILSAFE ACTIVE — Python IPC heartbeat lost. Fan control reverted to BIOS.
          </span>
          <span className="ml-auto mono text-[10px] text-red-400/50">HB Age: {heartbeatAge}ms</span>
        </div>
      )}

      {/* ── NATIVE OS DRAG BAR ── */}
      <div className="h-10 w-full flex justify-between items-center px-5 shrink-0 bg-white/[0.015] border-b border-white/[0.04]" style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex gap-3 items-center">
          <div className="w-3.5 h-3.5 rounded-full bg-blue-500/80 shadow-[0_0_10px_rgba(59,130,246,0.7)] border border-blue-400/60" />
          <span className="text-[10px] font-black tracking-[0.25em] text-white/60">
            THERMNEXUS <span className="text-white/20">// COMMAND CENTER</span>
          </span>
        </div>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className="text-[9px] mono text-white/15 tracking-wider">v1.2.0</span>
          <div className="flex gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-white/10 hover:bg-yellow-400/60 transition-colors cursor-pointer" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/10 hover:bg-green-400/60 transition-colors cursor-pointer" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/10 hover:bg-red-400/70 transition-colors cursor-pointer" />
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ═══════════ SIDEBAR ═══════════ */}
        <aside className="w-[68px] bg-white/[0.01] border-r border-white/[0.04] flex flex-col items-center py-6 justify-between shrink-0">
          <div className="flex flex-col gap-5">
            <SidebarBtn icon={Activity} active={page === 'dashboard'} color="blue" onClick={() => { setPage('dashboard'); setViewMode('live'); }} title="Live Dashboard" />
            <SidebarBtn icon={History} active={viewMode === 'historic'} color="purple" onClick={() => { setPage('dashboard'); setViewMode('historic'); }} title="Historic Data" />
            <div className="w-6 h-px bg-white/5 mx-auto" />
            <SidebarBtn icon={Cpu} active={page === 'cpu'} color="blue" onClick={() => setPage('cpu')} title="CPU Detail" />
            <SidebarBtn icon={Wind} active={page === 'cooling'} color="teal" onClick={() => setPage('cooling')} title="Cooling & Fan" />
            <SidebarBtn icon={BrainCircuit} active={page === 'algo'} color="purple" onClick={() => setPage('algo')} title="Algorithm Activity" />
          </div>
          <SidebarBtn icon={Power} className="hover:!text-red-400" title="Shutdown" />
        </aside>

        {/* ═══════════ MAIN CONTENT ═══════════ */}
        <main className="flex-1 p-5 overflow-y-auto thin-scrollbar flex flex-col gap-5 min-w-0">

          {page === 'dashboard' && <DashboardPage
            viewMode={viewMode} isOnline={isOnline} status={status}
            cpuTemp={cpuTemp} gpuTemp={gpuTemp} watts={watts} currentPwm={currentPwm}
            confidence={confidence} coreTemps={coreTemps} avgTemp={avgTemp}
            uiLock={uiLock} failsafe={failsafe} efficacy={efficacy}
            manualPwm={manualPwm} handleSlider={handleSlider}
            releaseOverride={releaseOverride} engageManual={engageManual}
            chartData={chartData} predictedTemp={predictedTemp}
            heartbeatAge={heartbeatAge}
          />}

          {page === 'cpu' && <CpuPage coreTemps={coreTemps} cpuTemp={cpuTemp} gpuTemp={gpuTemp} watts={watts} data={data} isOnline={isOnline} status={status} />}

          {page === 'cooling' && <CoolingPage
            currentPwm={currentPwm} uiLock={uiLock} failsafe={failsafe}
            manualPwm={manualPwm} handleSlider={handleSlider}
            releaseOverride={releaseOverride} engageManual={engageManual}
            efficacy={efficacy} cpuTemp={cpuTemp} data={data}
            isOnline={isOnline} status={status}
          />}

          {page === 'algo' && <AlgoPage
            algoLog={algoLog} uiLock={uiLock} failsafe={failsafe}
            predictedTemp={predictedTemp} cpuTemp={cpuTemp} confidence={confidence}
            heartbeatAge={heartbeatAge} heartbeatRaw={heartbeatRaw}
            currentPwm={currentPwm} isOnline={isOnline} status={status}
          />}

        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: DASHBOARD (main overview)
// ══════════════════════════════════════════════
function DashboardPage({ viewMode, isOnline, status, cpuTemp, gpuTemp, watts, currentPwm, confidence, coreTemps, avgTemp, uiLock, failsafe, efficacy, manualPwm, handleSlider, releaseOverride, engageManual, chartData, predictedTemp, heartbeatAge }) {
  return (
    <>
      {/* Header */}
      <header className="flex justify-between items-start animate-slide-in">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight leading-none">Adaptive Thermal Node</h1>
          <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
            <StatusDot online={isOnline} /> Hardware Link: {status}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
            uiLock ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' :
            failsafe ? 'bg-red-500/15 border-red-500/30 text-red-400' :
            'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}>
            {uiLock ? '⚡ Manual' : failsafe ? '⚠ Failsafe' : '🧠 AI Active'}
          </div>
        </div>
      </header>

      {/* Stat Cards */}
      <div className="grid grid-cols-6 gap-3 animate-slide-in" style={{ animationDelay: '50ms' }}>
        <StatCard icon={Thermometer} label="CPU Avg" value={cpuTemp} unit="°C" color="blue" />
        <StatCard icon={Thermometer} label="GPU" value={gpuTemp} unit="°C" color="purple" />
        <StatCard icon={Zap} label="Package" value={watts} unit="W" color="orange" />
        <StatCard icon={Gauge} label="Fan Duty" value={pwmToPercent(currentPwm)} unit="%" color="teal" />
        <StatCard icon={BrainCircuit} label="AI Pred" value={predictedTemp} unit="°C" color={confidence > 70 ? 'green' : 'red'} />
        <StatCard icon={Clock} label="HB Age" value={heartbeatAge < 9999 ? heartbeatAge : '—'} unit="ms" color={heartbeatAge < 2000 ? 'green' : 'red'} />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 animate-slide-in" style={{ animationDelay: '100ms' }}>

        {/* Thermal Map */}
        <div className="col-span-4 glass-panel p-5 flex flex-col">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Thermometer size={11} className="text-blue-400/60" /> 8-Core Thermal Map
          </h3>
          <div className="grid grid-cols-4 gap-2 flex-1">
            {coreTemps.map((temp, i) => {
              const hc = getHeatColor(temp);
              return (
                <div key={i} className={`rounded-xl bg-gradient-to-br ${hc.bg} border border-white/[0.07] flex flex-col items-center justify-center transition-all duration-700 shadow-lg ${hc.glow} hover:border-white/15 relative overflow-hidden`}>
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
                  <span className={`text-sm font-black mono ${hc.text} relative z-10`}>{temp.toFixed(1)}°</span>
                  <span className="text-[7px] font-bold text-white/30 uppercase tracking-widest relative z-10 mt-0.5">C{i}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-[9px] text-white/20">
            <span>Avg: <span className="mono text-white/40">{avgTemp.toFixed(1)}°C</span></span>
            <span>Max: <span className="mono text-white/40">{Math.max(...coreTemps).toFixed(1)}°C</span></span>
          </div>
        </div>

        {/* Control Authority */}
        <div className="col-span-4 flex flex-col gap-4">
          <ControlPanel uiLock={uiLock} manualPwm={manualPwm} handleSlider={handleSlider} releaseOverride={releaseOverride} engageManual={engageManual} confidence={confidence} currentPwm={currentPwm} />
        </div>

        {/* Right Column */}
        <div className="col-span-4 flex flex-col gap-4">
          <div className="glass-panel p-5 flex-1 flex flex-col justify-between">
            <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-2 flex items-center gap-2">
              <Activity size={11} className="text-emerald-400/60" /> Cooling Efficacy
            </h3>
            <div className="flex-1 flex flex-col items-center justify-center">
              <span className={`text-4xl font-black mono ${parseFloat(efficacy) > 0 ? 'text-emerald-400' : 'text-blue-400'}`}>
                {efficacy > 0 ? '+' : ''}{efficacy}%
              </span>
              <span className="text-[9px] font-bold tracking-[0.25em] text-white/15 mt-2 uppercase">ΔT / ΔPWM Rate</span>
            </div>
            <div className="h-1 w-full bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500/60 to-teal-400/40 rounded-full transition-all duration-700" style={{ width: `${clamp(Math.abs(efficacy * 10), 0, 100)}%` }} />
            </div>
          </div>

          {/* System Bus */}
          <div className="glass-panel p-5">
            <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-3 flex items-center gap-2">
              <Radio size={11} className="text-white/30" /> System Bus
            </h3>
            <div className="space-y-2.5">
              <SystemRow label="Rust Daemon" status={isOnline} detail="ws://8888" />
              <SystemRow label="Python ML" status={!failsafe && isOnline} detail={`HB: ${heartbeatAge}ms`} />
              <SystemRow label="REST API" status={isOnline} detail=":8889" />
              <SystemRow label="Failsafe" status={!failsafe} detail={failsafe ? 'TRIGGERED' : 'Clear'} warn={failsafe} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Chart */}
      <ChartPanel viewMode={viewMode} chartData={chartData} />
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: CPU DETAIL
// ══════════════════════════════════════════════
function CpuPage({ coreTemps, cpuTemp, gpuTemp, watts, data, isOnline, status }) {
  const coreBarData = coreTemps.map((t, i) => ({ name: `C${i}`, temp: parseFloat(t.toFixed(1)) }));
  const maxTemp = Math.max(...coreTemps);
  const minTemp = Math.min(...coreTemps);
  const spread = (maxTemp - minTemp).toFixed(1);

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none">Processor Deep Dive</h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Per-core thermal analysis
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4 animate-slide-in" style={{ animationDelay: '50ms' }}>
        {/* Per-Core Temps */}
        <div className="col-span-8 glass-panel p-5">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Cpu size={11} className="text-blue-400/60" /> Per-Core Temperature Distribution
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coreBarData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.15)', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '11px', fontFamily: 'JetBrains Mono' }} />
                <Bar dataKey="temp" fill="#3b82f6" radius={[6, 6, 0, 0]} fillOpacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Stats */}
        <div className="col-span-4 flex flex-col gap-4">
          <div className="glass-panel p-5 flex-1">
            <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4">Thermal Summary</h3>
            <div className="space-y-4">
              <MetricRow label="CPU Average" value={`${cpuTemp}°C`} color="blue" />
              <MetricRow label="GPU Temp" value={`${gpuTemp}°C`} color="purple" />
              <MetricRow label="Package Power" value={`${watts}W`} color="orange" />
              <MetricRow label="Core Spread" value={`${spread}°C`} color={parseFloat(spread) > 10 ? 'red' : 'teal'} />
              <MetricRow label="Hottest Core" value={`C${coreTemps.indexOf(maxTemp)} @ ${maxTemp.toFixed(1)}°C`} color="red" />
              <MetricRow label="Coolest Core" value={`C${coreTemps.indexOf(minTemp)} @ ${minTemp.toFixed(1)}°C`} color="teal" />
            </div>
          </div>
        </div>
      </div>

      {/* Large Thermal Map */}
      <div className="glass-panel p-5 animate-slide-in" style={{ animationDelay: '100ms' }}>
        <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4">Core Grid — Live</h3>
        <div className="grid grid-cols-8 gap-3">
          {coreTemps.map((temp, i) => {
            const hc = getHeatColor(temp);
            return (
              <div key={i} className={`rounded-2xl bg-gradient-to-br ${hc.bg} border border-white/[0.07] p-4 flex flex-col items-center justify-center transition-all duration-700 shadow-lg ${hc.glow} hover:border-white/15 relative overflow-hidden aspect-square`}>
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
                <span className={`text-xl font-black mono ${hc.text} relative z-10`}>{temp.toFixed(1)}°</span>
                <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest relative z-10 mt-1">Core {i}</span>
                <div className="w-full h-1 bg-white/5 rounded-full mt-2 relative z-10 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${temp > 75 ? 'bg-red-400' : temp > 55 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${clamp(temp, 0, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CPU Temp History */}
      <ChartPanel viewMode="live" chartData={data} />
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: COOLING & FAN
// ══════════════════════════════════════════════
function CoolingPage({ currentPwm, uiLock, failsafe, manualPwm, handleSlider, releaseOverride, engageManual, efficacy, cpuTemp, data, isOnline, status }) {
  const fanRpm = Math.round((currentPwm / 255) * 2000);
  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none">Cooling & Fan Control</h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Active thermal management
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4 animate-slide-in" style={{ animationDelay: '50ms' }}>
        {/* Fan Status */}
        <div className="col-span-4 glass-panel p-6 flex flex-col items-center justify-center">
          <Disc className={`mb-4 ${currentPwm > 0 ? 'text-blue-400 animate-spin-slow' : 'text-white/10'}`} size={48} />
          <span className="text-4xl font-black mono text-white">{pwmToPercent(currentPwm)}%</span>
          <span className="text-[10px] text-white/25 font-bold tracking-widest uppercase mt-1">Fan Duty Cycle</span>
          <div className="mt-4 grid grid-cols-2 gap-4 w-full text-center">
            <div>
              <span className="mono text-lg font-bold text-blue-300">{currentPwm}</span>
              <span className="text-[9px] text-white/20 block uppercase tracking-wider">PWM Raw</span>
            </div>
            <div>
              <span className="mono text-lg font-bold text-teal-300">~{fanRpm}</span>
              <span className="text-[9px] text-white/20 block uppercase tracking-wider">Est. RPM</span>
            </div>
          </div>
        </div>

        {/* Control Authority */}
        <div className="col-span-4">
          <ControlPanel uiLock={uiLock} manualPwm={manualPwm} handleSlider={handleSlider} releaseOverride={releaseOverride} engageManual={engageManual} confidence={100} currentPwm={currentPwm} />
        </div>

        {/* Cooling Performance */}
        <div className="col-span-4 glass-panel p-5 flex flex-col justify-between">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <TrendingDown size={11} className="text-emerald-400/60" /> Cooling Performance
          </h3>
          <div className="space-y-4 flex-1">
            <MetricRow label="Efficacy Rate" value={`${efficacy}%`} color={parseFloat(efficacy) > 0 ? 'green' : 'blue'} />
            <MetricRow label="Current Temp" value={`${cpuTemp}°C`} color="blue" />
            <MetricRow label="Fan Mode" value={uiLock ? 'MANUAL' : failsafe ? 'BIOS (Failsafe)' : 'AI Predictive'} color={uiLock ? 'orange' : failsafe ? 'red' : 'green'} />
            <MetricRow label="PWM Output" value={`${currentPwm} / 255`} color="teal" />
          </div>
          <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[9px] text-white/25 block">
              {uiLock ? '⚡ You are directly controlling fan speed. AI is bypassed.' :
               failsafe ? '⚠ Python ML heartbeat lost. BIOS is managing fans.' :
               '🧠 AI MPC is optimizing fan speed based on thermal predictions.'}
            </span>
          </div>
        </div>
      </div>

      <ChartPanel viewMode="live" chartData={data} />
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: ALGORITHM ACTIVITY
// ══════════════════════════════════════════════
function AlgoPage({ algoLog, uiLock, failsafe, predictedTemp, cpuTemp, confidence, heartbeatAge, currentPwm, isOnline, status }) {
  const modeColor = uiLock ? 'orange' : failsafe ? 'red' : 'blue';
  const modeLabel = uiLock ? 'MANUAL OVERRIDE' : failsafe ? 'FAILSAFE / BIOS' : 'AI PREDICTIVE (MPC)';

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none">Algorithm Activity Monitor</h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Real-time control loop telemetry
        </p>
      </header>

      {/* Pipeline Status */}
      <div className="grid grid-cols-4 gap-4 animate-slide-in" style={{ animationDelay: '50ms' }}>
        <div className={`glass-panel p-5 border-${modeColor}-500/20`}>
          <span className="text-[9px] font-black tracking-[0.2em] text-white/25 uppercase block mb-2">Active Mode</span>
          <span className={`text-lg font-black text-${modeColor}-400`}>{modeLabel}</span>
        </div>
        <div className="glass-panel p-5">
          <span className="text-[9px] font-black tracking-[0.2em] text-white/25 uppercase block mb-2">GhostLink IPC</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-black mono ${heartbeatAge < 2000 ? 'text-emerald-400' : 'text-red-400'}`}>{heartbeatAge}ms</span>
            <span className="text-[9px] text-white/20">heartbeat age</span>
          </div>
        </div>
        <div className="glass-panel p-5">
          <span className="text-[9px] font-black tracking-[0.2em] text-white/25 uppercase block mb-2">AI Prediction</span>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-black mono text-purple-400">{predictedTemp}°C</span>
            <span className="text-[9px] text-white/20">T+5s forecast</span>
          </div>
          <span className="text-[9px] mono text-white/15 mt-1 block">Actual: {cpuTemp}°C | Δ{Math.abs(predictedTemp - cpuTemp).toFixed(1)}°</span>
        </div>
        <div className="glass-panel p-5">
          <span className="text-[9px] font-black tracking-[0.2em] text-white/25 uppercase block mb-2">Model Confidence</span>
          <div className="flex items-center gap-3">
            <span className={`text-lg font-black mono ${confidence > 70 ? 'text-emerald-400' : confidence > 40 ? 'text-amber-400' : 'text-red-400'}`}>{confidence}%</span>
            <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${confidence > 70 ? 'bg-emerald-400' : confidence > 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${confidence}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Diagram */}
      <div className="glass-panel p-5 animate-slide-in" style={{ animationDelay: '100ms' }}>
        <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
          <Layers size={11} className="text-white/30" /> Control Pipeline
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <PipelineStage label="eBPF Probe" detail="Page faults" active={!failsafe && !uiLock} />
          <PipelineArrow active={!failsafe && !uiLock} />
          <PipelineStage label="PyTorch LSTM" detail={`Pred: ${predictedTemp}°C`} active={!failsafe && !uiLock} />
          <PipelineArrow active={!failsafe && !uiLock} />
          <PipelineStage label="MPC Optimizer" detail="scipy.minimize" active={!failsafe && !uiLock} />
          <PipelineArrow active={true} />
          <PipelineStage label="GhostLink" detail={`${heartbeatAge}ms`} active={heartbeatAge < 2000} warn={heartbeatAge >= 2000} />
          <PipelineArrow active={true} />
          <PipelineStage label="Rust Daemon" detail="100Hz loop" active={isOnline} />
          <PipelineArrow active={true} />
          <PipelineStage label="PWM Write" detail={`${currentPwm}/255`} active={true} highlight />
        </div>
      </div>

      {/* Live Log Table */}
      <div className="glass-panel p-5 flex-1 min-h-0 animate-slide-in overflow-hidden" style={{ animationDelay: '150ms' }}>
        <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-3 flex items-center gap-2">
          <Activity size={11} className="text-white/30" /> Live Decision Log
        </h3>
        <div className="overflow-y-auto thin-scrollbar max-h-64">
          <table className="w-full text-[10px] mono">
            <thead>
              <tr className="text-white/20 text-left border-b border-white/5">
                <th className="pb-2 pr-4 font-bold">Time</th>
                <th className="pb-2 pr-4 font-bold">Mode</th>
                <th className="pb-2 pr-4 font-bold">PWM</th>
                <th className="pb-2 pr-4 font-bold">CPU°C</th>
                <th className="pb-2 pr-4 font-bold">Pred°C</th>
                <th className="pb-2 font-bold">HB (ms)</th>
              </tr>
            </thead>
            <tbody>
              {[...algoLog].reverse().map((entry, i) => (
                <tr key={i} className={`border-b border-white/[0.02] ${i === 0 ? 'text-white/60' : 'text-white/25'}`}>
                  <td className="py-1.5 pr-4">{entry.time}</td>
                  <td className={`py-1.5 pr-4 font-bold ${entry.mode === 'AI-MPC' ? 'text-blue-400/70' : entry.mode === 'MANUAL' ? 'text-orange-400/70' : 'text-red-400/70'}`}>{entry.mode}</td>
                  <td className="py-1.5 pr-4">{entry.pwm}</td>
                  <td className="py-1.5 pr-4">{entry.cpu}</td>
                  <td className="py-1.5 pr-4">{entry.pred}</td>
                  <td className={`py-1.5 ${parseInt(entry.hbAge) > 2000 ? 'text-red-400' : ''}`}>{entry.hbAge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════
// ██  SHARED COMPONENTS
// ══════════════════════════════════════════════

function ControlPanel({ uiLock, manualPwm, handleSlider, releaseOverride, engageManual, confidence }) {
  return (
    <div className={`glass-panel p-5 h-full flex flex-col transition-all duration-500 ${
      uiLock ? 'border-orange-500/30 shadow-[0_0_30px_rgba(249,115,22,0.08)]' : 'border-blue-500/20 shadow-[0_0_30px_rgba(59,130,246,0.05)]'
    }`}>
      <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
        <Shield size={11} className={uiLock ? 'text-orange-400/60' : 'text-blue-400/60'} /> Control Authority
      </h3>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <button onClick={releaseOverride}
          className={`py-3 px-3 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center justify-center gap-2 ${
            !uiLock ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-[0_0_16px_rgba(59,130,246,0.15)]' : 'bg-white/[0.02] text-white/20 border border-white/[0.04] hover:bg-white/[0.04]'
          }`}>
          <BrainCircuit size={14} /> AI Control
        </button>
        <button onClick={engageManual}
          className={`py-3 px-3 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center justify-center gap-2 ${
            uiLock ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-[0_0_16px_rgba(249,115,22,0.15)]' : 'bg-white/[0.02] text-white/20 border border-white/[0.04] hover:bg-white/[0.04]'
          }`}>
          <SlidersHorizontal size={14} /> Manual
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        {uiLock ? (
          <div className="w-full animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold text-orange-400/60 tracking-widest uppercase">Manual PWM</span>
              <span className="mono text-2xl font-black text-orange-300">{pwmToPercent(manualPwm)}%</span>
            </div>
            <input type="range" min="0" max="255" value={manualPwm} onChange={handleSlider} className="w-full override-active" />
            <div className="flex justify-between text-[8px] mono text-white/15 mt-1.5 px-0.5">
              <span>0</span><span>64</span><span>128</span><span>192</span><span>255</span>
            </div>
            <div className="mt-4 p-3 rounded-xl bg-orange-500/5 border border-orange-500/15">
              <div className="flex items-center gap-2">
                <Disc className="text-orange-400 animate-spin-slow" size={14} />
                <span className="text-[9px] font-bold text-orange-300/70 tracking-wide">Fan locked at PWM {manualPwm} — AI bypassed</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3 shadow-[0_0_24px_rgba(59,130,246,0.08)]">
              <BrainCircuit size={28} className="text-blue-400 animate-breathe" />
            </div>
            <span className="text-[10px] font-bold text-blue-300/50 tracking-[0.2em] uppercase block">AI Predictive Control</span>
            <span className="text-[9px] text-white/20 mt-1 block">PyTorch IPC → Rust Daemon → PWM</span>
            <div className="mt-3 flex items-center justify-center gap-3">
              <span className="text-[9px] text-white/15">Confidence</span>
              <div className="w-24 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${confidence}%` }} />
              </div>
              <span className="mono text-[10px] text-blue-300/60">{confidence}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartPanel({ viewMode, chartData }) {
  return (
    <div className="glass-panel p-5 h-52 shrink-0 animate-slide-in relative overflow-hidden" style={{ animationDelay: '150ms' }}>
      <div className="absolute -bottom-8 left-1/4 w-1/2 h-16 bg-blue-500/[0.03] blur-3xl rounded-full pointer-events-none" />
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase flex items-center gap-2">
          {viewMode === 'live' ? <Activity size={11} className="text-blue-400/60" /> : <History size={11} className="text-purple-400/60" />}
          {viewMode === 'live' ? 'Realtime Action/Physics Sync' : 'Historic 24hr SQLite Window'}
        </h3>
        <div className="flex gap-5 text-[9px] font-bold tracking-widest uppercase">
          <span className="text-blue-400/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-blue-400 rounded-full" /> PWM</span>
          <span className="text-purple-400/70 flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-purple-400 rounded-full" /> CPU</span>
        </div>
      </div>
      <div className="h-[calc(100%-2rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="pwmGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
              <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.08} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
            <XAxis dataKey="time" stroke="rgba(255,255,255,0.04)" tick={{ fill: 'rgba(255,255,255,0.12)', fontSize: 8, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(255,255,255,0.04)" tick={{ fill: 'rgba(255,255,255,0.1)', fontSize: 8, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', backdropFilter: 'blur(16px)', fontSize: '10px', fontFamily: 'JetBrains Mono' }} />
            <Area type="monotone" dataKey="pwm" stroke="#3b82f6" strokeWidth={1.5} fill="url(#pwmGrad)" isAnimationActive={false} dot={false} />
            <Area type="monotone" dataKey="cpu" stroke="#a855f7" strokeWidth={1.5} fill="url(#tempGrad)" isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PipelineStage({ label, detail, active, warn, highlight }) {
  return (
    <div className={`px-4 py-3 rounded-xl border text-center min-w-[100px] transition-all ${
      warn ? 'bg-red-500/10 border-red-500/30' :
      highlight ? 'bg-emerald-500/10 border-emerald-500/30' :
      active ? 'bg-blue-500/10 border-blue-500/20' :
      'bg-white/[0.02] border-white/5 opacity-40'
    }`}>
      <span className={`text-[10px] font-bold block ${warn ? 'text-red-300' : highlight ? 'text-emerald-300' : active ? 'text-blue-300' : 'text-white/30'}`}>{label}</span>
      <span className="text-[8px] text-white/20 mono block mt-0.5">{detail}</span>
    </div>
  );
}

function PipelineArrow({ active }) {
  return <span className={`text-lg ${active ? 'text-blue-400/40' : 'text-white/10'}`}>→</span>;
}

// eslint-disable-next-line no-unused-vars
function SidebarBtn({ icon: Icon, active, color = 'white', onClick, className = '', title }) {
  const activeStyles = {
    blue: 'bg-blue-500/15 text-blue-400 border border-blue-500/40 shadow-[0_0_16px_rgba(59,130,246,0.15)]',
    purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/40 shadow-[0_0_16px_rgba(168,85,247,0.15)]',
    teal: 'bg-teal-500/15 text-teal-400 border border-teal-500/40 shadow-[0_0_16px_rgba(20,184,166,0.15)]',
    white: '',
  };
  return (
    <button onClick={onClick} title={title}
      className={`p-2.5 rounded-xl transition-all duration-200 ${
        active ? activeStyles[color] || activeStyles.blue : 'text-white/15 hover:bg-white/[0.04] hover:text-white/30 border border-transparent'
      } ${className}`}>
      <Icon size={20} />
    </button>
  );
}

function SystemRow({ label, status, detail, warn }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${warn ? 'bg-red-400 animate-pulse' : status ? 'bg-emerald-400/80' : 'bg-white/10'}`} />
        <span className="text-[10px] font-semibold text-white/40">{label}</span>
      </div>
      <span className={`text-[9px] mono ${warn ? 'text-red-400/80 font-bold' : 'text-white/15'}`}>{detail}</span>
    </div>
  );
}

function MetricRow({ label, value, color = 'blue' }) {
  const textMap = { blue: 'text-blue-400', purple: 'text-purple-400', orange: 'text-orange-400', teal: 'text-teal-400', red: 'text-red-400', green: 'text-emerald-400' };
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-white/30">{label}</span>
      <span className={`mono text-[11px] font-bold ${textMap[color]}`}>{value}</span>
    </div>
  );
}
