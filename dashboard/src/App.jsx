import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line } from 'recharts';
import { History, Cpu, Activity, Settings, Zap, Power, Disc, Thermometer, Wind, Shield, BrainCircuit, SlidersHorizontal, AlertTriangle, Radio, Gauge, Clock, TrendingDown, Layers, Stethoscope, HeartPulse, FlaskConical, Bell, Play } from 'lucide-react';
import { fetchHistoricData, fetchCapabilities } from './api';
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
  const [capabilities, setCapabilities] = useState({ can_control_gpu: false, can_control_dvfs: false });

  // ── Hardware Limits ──
  const [targetCpuFreq, setTargetCpuFreq] = useState(0);
  const [targetPl1, setTargetPl1] = useState(0);
  const [targetGpuWatts, setTargetGpuWatts] = useState(0);
  const [targetVoltageOffset, setTargetVoltageOffset] = useState(0);
  const [perCoreFreqs, setPerCoreFreqs] = useState([0,0,0,0,0,0,0,0]);

  const [onBattery, setOnBattery] = useState(false);
  const [acousticMode, setAcousticMode] = useState(false);
  const [cryoBoost, setCryoBoost] = useState(false);
  const [fanCurve, setFanCurve] = useState({ enabled: false, curve: [] });

  // ── Active Profile ──
  const [activeProfile, setActiveProfile] = useState({ app: 'idle', mode: 'default', cpu_usage: 0 });

  useEffect(() => {
    fetchCapabilities().then(setCapabilities);
    fetch('http://localhost:8889/config/fancurve')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setFanCurve(data.data);
      })
      .catch(() => {});
  }, []);

  const saveFanCurve = (newCurveConfig) => {
    setFanCurve(newCurveConfig);
    fetch('http://localhost:8889/config/fancurve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCurveConfig)
    }).catch(console.error);
  };

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

  // ── Profile Polling ──
  const [profiles, setProfiles] = useState({});
  const [systemProcesses, setSystemProcesses] = useState([]);

  useEffect(() => {
    const fetchProfile = () => {
      fetch('http://localhost:8889/profile/active')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') setActiveProfile(data.data);
        }).catch(() => {});
      
      fetch('http://localhost:8889/system/processes')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') setSystemProcesses(data.data);
        }).catch(() => {});
    };
    
    fetch('http://localhost:8889/config/profiles')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setProfiles(data.data);
      }).catch(() => {});

    const interval = setInterval(fetchProfile, 2000);
    fetchProfile();
    return () => clearInterval(interval);
  }, []);

  const saveProfiles = (newProfiles) => {
    setProfiles(newProfiles);
    fetch('http://localhost:8889/config/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProfiles)
    }).catch(console.error);
  };

  useEffect(() => {
    const fetchContext = () => {
      fetch('http://localhost:8889/doctor/prescription')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') setOnBattery(data.on_battery);
        })
        .catch(() => {});
    };
    fetchContext();
    const intv = setInterval(fetchContext, 5000);
    return () => clearInterval(intv);
  }, []);

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

          if (p.target_cpu_freq !== undefined) setTargetCpuFreq(p.target_cpu_freq);
          if (p.target_pl1_watts !== undefined) setTargetPl1(p.target_pl1_watts);
          if (p.target_gpu_watts !== undefined) setTargetGpuWatts(p.target_gpu_watts);
          if (p.target_voltage_offset_mv !== undefined) setTargetVoltageOffset(p.target_voltage_offset_mv);
          if (p.per_core_freqs) setPerCoreFreqs(p.per_core_freqs);

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
              mode: p.ui_lock ? 'MANUAL' : (p.failsafe ? 'FAILSAFE' : 'AI-RL'),
              pwm: p.pwm,
              cpu: p.cpu_temp ? p.cpu_temp.toFixed(1) : '0',
              pred: p.predicted ? p.predicted.toFixed(1) : '—',
              hbAge: p.heartbeat ? (Date.now() - p.heartbeat) : '—',
              freq: p.target_cpu_freq || '—',
              gpuW: p.target_gpu_watts || '—'
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
          <span className="text-[10px] font-black tracking-[0.25em] text-white/60 flex items-center gap-3">
            THERMNEXUS <span className="text-white/20">// COMMAND CENTER</span>
            <div className="h-3 w-px bg-white/10 mx-1" />
            <span className="text-white/40 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${activeProfile.mode === 'silent' ? 'bg-teal-400/80' : activeProfile.mode === 'performance' ? 'bg-orange-500/80 animate-pulse' : 'bg-blue-400/80'}`} />
              PROFILE: <span className={activeProfile.mode === 'silent' ? 'text-teal-300' : activeProfile.mode === 'performance' ? 'text-orange-400' : 'text-blue-300'}>{activeProfile.mode.toUpperCase()}</span>
              {activeProfile.app !== 'idle' && <span className="text-white/20 lowercase text-[8px]">({activeProfile.app})</span>}
            </span>
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
            <div className="w-6 h-px bg-white/5 mx-auto" />
            <SidebarBtn icon={Stethoscope} active={page === 'diagnostics'} color="orange" onClick={() => setPage('diagnostics')} title="Health Diagnostics" />
            <SidebarBtn icon={FlaskConical} active={page === 'ailab'} color="purple" onClick={() => setPage('ailab')} title="AI Lab" />
            <SidebarBtn icon={Bell} active={page === 'alerts'} color="teal" onClick={() => setPage('alerts')} title="Alert Center" />
            <SidebarBtn icon={Layers} active={page === 'profiles'} color="blue" onClick={() => setPage('profiles')} title="App Profiles" />
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
            heartbeatAge={heartbeatAge} capabilities={capabilities}
            targetCpuFreq={targetCpuFreq} targetPl1={targetPl1} targetGpuWatts={targetGpuWatts} targetVoltageOffset={targetVoltageOffset}
            acousticMode={acousticMode} setAcousticMode={setAcousticMode}
            cryoBoost={cryoBoost} setCryoBoost={setCryoBoost} onBattery={onBattery}
            perCoreFreqs={perCoreFreqs}
          />}

          {page === 'cpu' && <CpuPage coreTemps={coreTemps} cpuTemp={cpuTemp} gpuTemp={gpuTemp} watts={watts} data={data} isOnline={isOnline} status={status} perCoreFreqs={perCoreFreqs} />}

          {page === 'cooling' && <CoolingPage
            currentPwm={currentPwm} uiLock={uiLock} failsafe={failsafe}
            manualPwm={manualPwm} handleSlider={handleSlider}
            releaseOverride={releaseOverride} engageManual={engageManual}
            efficacy={efficacy} cpuTemp={cpuTemp} data={data}
            isOnline={isOnline} status={status}
            fanCurve={fanCurve} saveFanCurve={saveFanCurve}
          />}

          {page === 'algo' && <AlgoPage
            algoLog={algoLog} uiLock={uiLock} failsafe={failsafe}
            predictedTemp={predictedTemp} cpuTemp={cpuTemp} confidence={confidence}
            heartbeatAge={heartbeatAge} heartbeatRaw={heartbeatRaw}
            currentPwm={currentPwm} isOnline={isOnline} status={status}
            capabilities={capabilities}
          />}

          {page === 'diagnostics' && <DiagnosticsPage isOnline={isOnline} status={status} />}

          {page === 'ailab' && <AILabPage isOnline={isOnline} status={status} />}

          {page === 'alerts' && <AlertsPage isOnline={isOnline} status={status} />}
          {page === 'profiles' && <ProfilePage isOnline={isOnline} status={status} profiles={profiles} saveProfiles={saveProfiles} systemProcesses={systemProcesses} activeProfile={activeProfile} />}

        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: DASHBOARD (main overview)
// ══════════════════════════════════════════════
function DashboardPage({ viewMode, isOnline, status, cpuTemp, gpuTemp, watts, currentPwm, confidence, coreTemps, avgTemp, uiLock, failsafe, efficacy, manualPwm, handleSlider, releaseOverride, engageManual, chartData, predictedTemp, heartbeatAge, capabilities, targetCpuFreq, targetPl1, targetGpuWatts, targetVoltageOffset, acousticMode, setAcousticMode, cryoBoost, setCryoBoost, onBattery, perCoreFreqs }) {
  return (
    <>
      {/* Header */}
      <header className="flex justify-between items-start animate-slide-in">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight leading-none flex items-center gap-3">
            Adaptive Thermal Node
            {onBattery && <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest flex items-center gap-2"><Zap size={10} /> Battery Saver Active</span>}
          </h1>
          <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
            <StatusDot online={isOnline} /> Hardware Link: {status}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              fetch('http://localhost:8889/action/cryoboost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: 30 }) })
              .then(() => setCryoBoost(true));
              setTimeout(() => setCryoBoost(false), 30000);
            }}
            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all shadow-[0_0_20px_rgba(56,189,248,0.2)] ${
              cryoBoost ? 'bg-cyan-500 text-white border-cyan-400 animate-pulse' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20'
            }`}
          >
            {cryoBoost ? '❄ Purging Heat...' : '❄ Cryo-Boost'}
          </button>
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

        {/* 3D Isometric Thermal + Frequency Map */}
        <div className="col-span-4 glass-panel p-5 flex flex-col overflow-hidden relative">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Thermometer size={11} className="text-blue-400/60" /> 3D Core Topology
            <span className="text-[7px] text-purple-400/50 ml-auto">TEMP + FREQ</span>
          </h3>
          
          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-[7px] text-white/25">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gradient-to-r from-blue-500 to-red-500" /> Height = Temp</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500/50" /> Label = AI Freq Cap</span>
          </div>
          
          <div className="flex-1 flex items-center justify-center">
            <div 
              className="grid grid-cols-4 gap-3 transition-all duration-[2000ms] ease-out"
              style={{
                transform: 'perspective(1000px) rotateX(55deg) rotateZ(-45deg)',
                transformStyle: 'preserve-3d'
              }}
            >
              {coreTemps.map((temp, i) => {
                const hc = getHeatColor(temp);
                const zHeight = Math.max(10, (temp - 30) * 1.2);
                const coreFreq = (perCoreFreqs && perCoreFreqs[i]) || 0;
                // Frequency color: green=full turbo, amber=throttled, red=heavily throttled
                const freqPct = coreFreq > 0 ? Math.min(1, (coreFreq - 800) / (5500 - 800)) : 0;
                const freqColor = freqPct > 0.7 ? 'text-emerald-400' : freqPct > 0.4 ? 'text-amber-400' : 'text-red-400';
                
                return (
                  <div 
                    key={i} 
                    className={`w-14 h-14 rounded-lg bg-gradient-to-br ${hc.bg} border border-white/[0.15] flex flex-col items-center justify-center transition-all duration-700 shadow-xl relative`}
                    style={{
                      transform: `translateZ(${zHeight}px)`,
                      transformStyle: 'preserve-3d',
                      boxShadow: `inset 0 0 10px rgba(255,255,255,0.1), -10px 10px 20px rgba(0,0,0,0.5)`
                    }}
                  >
                    {/* 3D Walls */}
                    <div className="absolute top-full left-0 w-full origin-top transform rotate-x-[-90deg] bg-black/40 border border-white/5 rounded-b-lg transition-all duration-700" style={{ height: `${zHeight}px` }} />
                    <div className="absolute top-0 left-full h-full origin-left transform rotate-y-[90deg] bg-black/60 border border-white/5 rounded-r-lg transition-all duration-700" style={{ width: `${zHeight}px` }} />
                    
                    <span className={`text-[10px] font-black mono ${hc.text} relative z-10 leading-none`}>{temp.toFixed(0)}°</span>
                    <span className="text-[5px] font-bold text-white/40 uppercase tracking-widest relative z-10">C{i}</span>
                    {coreFreq > 0 && (
                      <span className={`text-[6px] font-black mono ${freqColor} relative z-10 leading-none mt-0.5`}>
                        {coreFreq > 1000 ? `${(coreFreq/1000).toFixed(1)}G` : `${coreFreq}M`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="mt-4 flex items-center justify-between text-[9px] text-white/20 relative z-20">
            <span>Avg: <span className="mono text-white/40">{avgTemp.toFixed(1)}°C</span></span>
            <span>Max: <span className="mono text-white/40">{Math.max(...coreTemps).toFixed(1)}°C</span></span>
          </div>
        </div>

        {/* Control Authority & Hardware Limits */}
        <div className="col-span-4 flex flex-col gap-4">
          <ControlPanel uiLock={uiLock} manualPwm={manualPwm} handleSlider={handleSlider} releaseOverride={releaseOverride} engageManual={engageManual} confidence={confidence} currentPwm={currentPwm} acousticMode={acousticMode} setAcousticMode={setAcousticMode} />
          
          <HardwareLimitsPanel capabilities={capabilities} targetCpuFreq={targetCpuFreq} targetPl1={targetPl1} targetGpuWatts={targetGpuWatts} targetVoltageOffset={targetVoltageOffset} />
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
function CpuPage({ coreTemps, cpuTemp, gpuTemp, watts, data, isOnline, status, perCoreFreqs }) {
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
            const coreFreq = (perCoreFreqs && perCoreFreqs[i]) || 0;
            const freqPct = coreFreq > 0 ? Math.min(1, (coreFreq - 800) / (5500 - 800)) : 0;
            const freqColor = freqPct > 0.7 ? 'text-emerald-400' : freqPct > 0.4 ? 'text-amber-400' : 'text-red-400';
            
            return (
              <div key={i} className={`rounded-2xl bg-gradient-to-br ${hc.bg} border border-white/[0.07] p-4 flex flex-col items-center justify-center transition-all duration-700 shadow-lg ${hc.glow} hover:border-white/15 relative overflow-hidden aspect-square`}>
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
                <span className={`text-xl font-black mono ${hc.text} relative z-10`}>{temp.toFixed(1)}°</span>
                <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest relative z-10 mt-1">Core {i}</span>
                
                {coreFreq > 0 && (
                  <span className={`text-[9px] font-black mono ${freqColor} relative z-10 mt-2 bg-black/40 px-2 py-0.5 rounded border border-white/5`}>
                    {coreFreq > 1000 ? `${(coreFreq/1000).toFixed(1)}G` : `${coreFreq}M`}
                  </span>
                )}
                
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
function CoolingPage({ currentPwm, uiLock, failsafe, manualPwm, handleSlider, releaseOverride, engageManual, efficacy, cpuTemp, data, isOnline, status, fanCurve, saveFanCurve }) {
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

      <div className="glass-panel p-5 mt-4 animate-slide-in" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase flex items-center gap-2">
            <Activity size={11} className="text-purple-400/60" /> Custom Fan Curve Override
          </h3>
          <button 
            onClick={() => saveFanCurve({ ...fanCurve, enabled: !fanCurve.enabled })}
            className={`px-3 py-1 rounded-full text-[9px] font-black tracking-widest transition-all uppercase border ${fanCurve.enabled ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-white/5 text-white/30 border-white/10 hover:bg-white/10'}`}
          >
            {fanCurve.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        
        <div className={`grid grid-cols-4 gap-4 transition-all duration-500 ${fanCurve.enabled ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
          {fanCurve.curve && fanCurve.curve.map((pt, idx) => (
            <div key={idx} className="bg-black/20 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{pt.temp}°C Node</span>
                <span className="mono text-xs font-black text-purple-300">{pwmToPercent(pt.pwm)}%</span>
              </div>
              <input 
                type="range" min="0" max="255" value={pt.pwm} 
                onChange={(e) => {
                  const newCurve = [...fanCurve.curve];
                  newCurve[idx].pwm = parseInt(e.target.value);
                  saveFanCurve({ ...fanCurve, curve: newCurve });
                }}
                className="w-full accent-purple-500" 
              />
              <div className="flex justify-between text-[8px] text-white/20 font-bold mono mt-2">
                <span>0%</span><span>100%</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-white/20 mt-4 max-w-2xl leading-relaxed">
          When enabled, the Custom Fan Curve acts as an absolute override bounding the AI's cooling decisions. The AI will interpolate between the nodes you set above.
        </p>
      </div>

      <ChartPanel viewMode="live" chartData={data} />
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: ALGORITHM ACTIVITY
// ══════════════════════════════════════════════
function AlgoPage({ algoLog, uiLock, failsafe, predictedTemp, cpuTemp, confidence, heartbeatAge, currentPwm, isOnline, status, capabilities }) {
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
                <th className="pb-2 pr-4 font-bold">HB (ms)</th>
                {capabilities.can_control_dvfs && <th className="pb-2 pr-4 font-bold text-teal-400/60">Freq (MHz)</th>}
                {capabilities.can_control_gpu && <th className="pb-2 font-bold text-emerald-400/60">GPU (W)</th>}
              </tr>
            </thead>
            <tbody>
              {[...algoLog].reverse().map((entry, i) => (
                <tr key={i} className={`border-b border-white/[0.02] ${i === 0 ? 'text-white/60' : 'text-white/25'}`}>
                  <td className="py-1.5 pr-4">{entry.time}</td>
                  <td className={`py-1.5 pr-4 font-bold ${entry.mode === 'AI-RL' ? 'text-blue-400/70' : entry.mode === 'MANUAL' ? 'text-orange-400/70' : 'text-red-400/70'}`}>{entry.mode}</td>
                  <td className="py-1.5 pr-4">{entry.pwm}</td>
                  <td className="py-1.5 pr-4">{entry.cpu}</td>
                  <td className="py-1.5 pr-4">{entry.pred}</td>
                  <td className={`py-1.5 pr-4 ${parseInt(entry.hbAge) > 2000 ? 'text-red-400' : ''}`}>{entry.hbAge}</td>
                  {capabilities.can_control_dvfs && <td className="py-1.5 pr-4 text-teal-400/80">{entry.freq}</td>}
                  {capabilities.can_control_gpu && <td className="py-1.5 text-emerald-400/80">{entry.gpuW}</td>}
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

function ControlPanel({ uiLock, manualPwm, handleSlider, releaseOverride, engageManual, confidence, acousticMode, setAcousticMode }) {
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

      <div className="mb-5">
        <button onClick={() => {
            const nextState = !acousticMode;
            fetch('http://localhost:8889/config/acoustic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: nextState }) })
            .then(() => setAcousticMode(nextState));
          }}
          className={`w-full py-2.5 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center justify-center gap-2 border ${
            acousticMode ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-[0_0_16px_rgba(168,85,247,0.15)]' : 'bg-white/[0.02] text-white/20 border-white/[0.04] hover:bg-white/[0.04]'
          }`}>
          <Wind size={12} /> {acousticMode ? 'Acoustic Smoothing: ON' : 'Acoustic Smoothing: OFF'}
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

function HardwareLimitsPanel({ capabilities, targetCpuFreq, targetPl1, targetGpuWatts, targetVoltageOffset }) {
  return (
    <div className="glass-panel p-5 animate-fade-in flex-1">
      <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
        <Zap size={11} className="text-teal-400/60" /> Hardware AI Limits
      </h3>
      <div className="flex flex-col justify-center h-full gap-5">
        
        {/* CPU Frequency */}
        {capabilities.can_control_dvfs && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-end">
              <span className="text-[9px] font-bold text-teal-400/80 tracking-widest uppercase">CPU Freq</span>
              <span className="mono text-[11px] font-black text-teal-300">{targetCpuFreq} <span className="text-[8px] text-teal-500/50 font-sans">MHz</span></span>
            </div>
            <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-teal-500/80 to-cyan-400/80 rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(20,184,166,0.4)]" style={{ width: `${Math.min((targetCpuFreq / 5500) * 100, 100)}%` }} />
            </div>
          </div>
        )}

        {/* CPU Package Power */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-bold text-orange-400/80 tracking-widest uppercase">CPU PL1 limit</span>
            <span className="mono text-[11px] font-black text-orange-300">{targetPl1} <span className="text-[8px] text-orange-500/50 font-sans">W</span></span>
          </div>
          <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-orange-500/80 to-amber-400/80 rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(249,115,22,0.4)]" style={{ width: `${Math.min((targetPl1 / 150) * 100, 100)}%` }} />
          </div>
        </div>

        {/* Dynamic Voltage Offset */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-bold text-purple-400/80 tracking-widest uppercase">V-Offset</span>
            <span className="mono text-[11px] font-black text-purple-300">{targetVoltageOffset} <span className="text-[8px] text-purple-500/50 font-sans">mV</span></span>
          </div>
          <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden flex justify-end">
            <div className="h-full bg-gradient-to-l from-purple-500/80 to-pink-400/80 rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(168,85,247,0.4)]" style={{ width: `${Math.min((Math.abs(targetVoltageOffset) / 150) * 100, 100)}%` }} />
          </div>
        </div>

        {/* GPU Power */}
        {capabilities.can_control_gpu && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-end">
              <span className="text-[9px] font-bold text-emerald-400/80 tracking-widest uppercase">GPU limit</span>
              <span className="mono text-[11px] font-black text-emerald-300">{targetGpuWatts} <span className="text-[8px] text-emerald-500/50 font-sans">W</span></span>
            </div>
            <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500/80 to-green-400/80 rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(16,185,129,0.4)]" style={{ width: `${Math.min((targetGpuWatts / 350) * 100, 100)}%` }} />
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

// ══════════════════════════════════════════════
// ██  PAGE: DIAGNOSTICS
// ══════════════════════════════════════════════
function DiagnosticsPage({ isOnline, status }) {
  const [diagState, setDiagState] = useState({ status: 'idle', progress: 0, data_points: [], score: 0, message: '' });
  const [history, setHistory] = useState([]);
  const [prescription, setPrescription] = useState("Awaiting diagnosis...");

  const fetchStatus = useCallback(() => {
    fetch('http://localhost:8889/diagnostics/status')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setDiagState(data.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let interval;
    if (diagState.status !== 'idle' && diagState.status !== 'complete' && diagState.status !== 'error') {
      interval = setInterval(fetchStatus, 500);
    } else {
      fetchStatus();
    }
    return () => clearInterval(interval);
  }, [diagState.status, fetchStatus]);

  useEffect(() => {
    const fetchPrescription = () => {
      fetch('http://localhost:8889/doctor/prescription')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') setPrescription(data.prescription);
        })
        .catch(() => {});
    };
    fetchPrescription();
    const intv = setInterval(fetchPrescription, 2000);
    return () => clearInterval(intv);
  }, []);

  const startScan = () => {
    fetch('http://localhost:8889/diagnostics/start', { method: 'POST' })
      .then(() => fetchStatus());
  };

  useEffect(() => {
    fetch('http://localhost:8889/diagnostics/history')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          const formatted = data.data.map(d => ({
            ...d,
            dateStr: new Date(d.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          }));
          setHistory(formatted);
        }
      })
      .catch(() => {});
  }, [diagState.status]);

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none">Thermal Health Diagnostics</h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Stress Testing & Degradation Analysis
        </p>
      </header>

      <div className="flex flex-col gap-5 flex-1 min-h-0 animate-slide-in" style={{ animationDelay: '50ms' }}>
        <div className="glass-panel p-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black tracking-widest uppercase mb-1">Stressor Protocol</h2>
            <p className="text-xs text-white/40">This will lock fans and stress the CPU to 100% for 20 seconds to measure thermal dissipation.</p>
          </div>
          <button 
            onClick={startScan}
            disabled={diagState.status !== 'idle' && diagState.status !== 'complete' && diagState.status !== 'error'}
            className="px-6 py-3 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-orange-500/30 rounded-xl text-orange-400 font-black tracking-widest text-xs uppercase transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(249,115,22,0.15)]"
          >
            <Stethoscope size={16} />
            {diagState.status === 'idle' || diagState.status === 'complete' || diagState.status === 'error' ? 'Initiate Scan' : 'Scanning...'}
          </button>
        </div>

        <div className="grid grid-cols-12 gap-5 flex-1 min-h-0">
          <div className="col-span-8 glass-panel p-5 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase flex items-center gap-2">
                <Activity size={11} className="text-orange-400/60" /> Thermal Reaction Curve
              </h3>
              <span className="mono text-[10px] font-bold text-orange-400/80">{diagState.progress}%</span>
            </div>
            
            <div className="flex-1 min-h-[300px] h-full w-full relative">
              {diagState.data_points.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={diagState.data_points} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <YAxis domain={['auto', 'auto']} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }} />
                    <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/10 font-black tracking-widest text-sm uppercase">Awaiting Protocol Initialization</div>
              )}
            </div>
          </div>

          <div className="col-span-4 flex flex-col gap-5">
            <div className="glass-panel p-6 flex-1 flex flex-col justify-center">
              <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-6 text-center">Medical Report</h3>
              
              {diagState.status === 'complete' ? (
                <div className="flex flex-col items-center animate-fade-in text-center">
                  <span className={`text-6xl font-black mono mb-2 ${diagState.score > 80 ? 'text-emerald-400' : diagState.score > 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {diagState.score}
                  </span>
                  <span className="text-[10px] text-white/30 tracking-[0.2em] uppercase font-bold mb-6">Thermal Health Score</span>
                  
                  <div className={`p-4 rounded-xl border w-full ${diagState.score > 80 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : diagState.score > 50 ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>
                    <p className="text-xs font-bold leading-relaxed">{diagState.message}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full opacity-30">
                  <HeartPulse size={48} className={`mb-4 ${diagState.status !== 'idle' ? 'animate-pulse text-orange-400' : 'text-white'}`} />
                  <span className="text-[10px] font-bold tracking-widest uppercase">{diagState.status === 'idle' ? 'Ready' : `Phase: ${diagState.status}`}</span>
                </div>
              )}
            </div>

            {/* Doctor's Notes NLP */}
            <div className="glass-panel p-5 animate-slide-in" style={{ animationDelay: '150ms' }}>
              <h3 className="text-[9px] font-black tracking-[0.25em] text-emerald-400/60 uppercase mb-3 flex items-center gap-2">
                <Activity size={11} /> Doctor's Prescription
              </h3>
              <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
                <p className="text-[11px] text-emerald-300/80 leading-relaxed font-sans">{prescription}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Paste Degradation Timeline ── */}
        <div className="glass-panel p-5 mt-2 animate-slide-in" style={{ animationDelay: '100ms' }}>
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <History size={11} className="text-purple-400/60" /> Paste Degradation Timeline (Medical History)
          </h3>
          <div className="h-40 w-full">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={history} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis dataKey="dateStr" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }} />
                  <Bar dataKey="score" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-white/10 font-black tracking-widest text-xs uppercase">No Medical History Found</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: AI LAB (Training Observatory)
// ══════════════════════════════════════════════
function AILabPage({ isOnline, status }) {
  const [metrics, setMetrics] = useState({ actor_loss: 0, critic_loss: 0, reward: 0, entropy: 0, steps: 0 });
  const [metricsHistory, setMetricsHistory] = useState([]);

  useEffect(() => {
    const fetchMetrics = () => {
      fetch('http://localhost:8889/ai/metrics')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            setMetrics(data.data);
            setMetricsHistory(prev => {
              const next = [...prev, { 
                step: data.data.steps,
                actor: parseFloat(data.data.actor_loss?.toFixed(6) || 0),
                critic: parseFloat(data.data.critic_loss?.toFixed(6) || 0),
                reward: parseFloat(data.data.reward?.toFixed(4) || 0),
                entropy: parseFloat(data.data.entropy?.toFixed(4) || 0)
              }];
              return next.slice(-200); // keep last 200 data points
            });
          }
        })
        .catch(() => {});
    };
    fetchMetrics();
    const intv = setInterval(fetchMetrics, 1000);
    return () => clearInterval(intv);
  }, []);

  const resetBrain = () => {
    fetch('http://localhost:8889/ai/reset', { method: 'POST' })
      .then(() => { setMetricsHistory([]); })
      .catch(() => {});
  };

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none flex items-center gap-3">
          AI Training Observatory
          <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest">
            Step #{metrics.steps}
          </span>
        </h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Watch the neural network learn in real-time
        </p>
      </header>

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-3 animate-slide-in" style={{ animationDelay: '50ms' }}>
        <div className="glass-panel p-4">
          <span className="text-[9px] text-white/30 uppercase tracking-widest block">Actor Loss</span>
          <span className="text-xl font-black mono text-blue-400">{metrics.actor_loss?.toFixed(6) || '0'}</span>
        </div>
        <div className="glass-panel p-4">
          <span className="text-[9px] text-white/30 uppercase tracking-widest block">Critic Loss</span>
          <span className="text-xl font-black mono text-purple-400">{metrics.critic_loss?.toFixed(6) || '0'}</span>
        </div>
        <div className="glass-panel p-4">
          <span className="text-[9px] text-white/30 uppercase tracking-widest block">Reward Signal</span>
          <span className={`text-xl font-black mono ${(metrics.reward || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{metrics.reward?.toFixed(4) || '0'}</span>
        </div>
        <div className="glass-panel p-4">
          <span className="text-[9px] text-white/30 uppercase tracking-widest block">Policy Entropy</span>
          <span className="text-xl font-black mono text-amber-400">{metrics.entropy?.toFixed(4) || '0'}</span>
        </div>
      </div>

      {/* Loss Charts */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0 animate-slide-in" style={{ animationDelay: '100ms' }}>
        <div className="glass-panel p-5 flex flex-col">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Activity size={11} className="text-blue-400/60" /> Actor Loss Curve
          </h3>
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metricsHistory} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="step" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '10px', fontFamily: 'JetBrains Mono' }} />
                <Line type="monotone" dataKey="actor" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel p-5 flex flex-col">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Activity size={11} className="text-purple-400/60" /> Critic Loss Curve
          </h3>
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metricsHistory} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="step" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '10px', fontFamily: 'JetBrains Mono' }} />
                <Line type="monotone" dataKey="critic" stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Reward + Entropy Charts */}
      <div className="grid grid-cols-2 gap-4 animate-slide-in" style={{ animationDelay: '150ms' }}>
        <div className="glass-panel p-5">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <TrendingDown size={11} className="text-emerald-400/60" /> Reward History
          </h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricsHistory} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                <defs><linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="step" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '10px', fontFamily: 'JetBrains Mono' }} />
                <Area type="monotone" dataKey="reward" stroke="#10b981" fill="url(#rewardGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
              <BrainCircuit size={11} className="text-amber-400/60" /> Neural Network Controls
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/30">Architecture</span>
                <span className="mono text-[10px] text-white/60">Actor-Critic PPO (7D)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/30">Actor LR</span>
                <span className="mono text-[10px] text-blue-400">3e-4</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/30">Critic LR</span>
                <span className="mono text-[10px] text-purple-400">1e-3</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/30">γ (discount)</span>
                <span className="mono text-[10px] text-white/60">0.99</span>
              </div>
            </div>
          </div>
          <button
            onClick={resetBrain}
            className="mt-4 w-full py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 font-black tracking-widest text-[10px] uppercase transition-colors shadow-[0_0_15px_rgba(239,68,68,0.1)]"
          >
            ⚠ Reset Brain (Wipe All Weights)
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: ALERTS CENTER
// ══════════════════════════════════════════════
function AlertsPage({ isOnline, status }) {
  const [alerts, setAlerts] = useState([]);
  const [config, setConfig] = useState({ temp_threshold: 85, enabled: true });

  useEffect(() => {
    const fetchAlerts = () => {
      fetch('http://localhost:8889/alerts/history')
        .then(res => res.json())
        .then(data => { if (data.status === 'ok') setAlerts(data.data.reverse()); })
        .catch(() => {});
    };
    fetch('http://localhost:8889/alerts/config')
      .then(res => res.json())
      .then(data => { if (data.status === 'ok') setConfig(data.data); })
      .catch(() => {});
    fetchAlerts();
    const intv = setInterval(fetchAlerts, 5000);
    return () => clearInterval(intv);
  }, []);

  const updateConfig = (newConfig) => {
    setConfig(newConfig);
    fetch('http://localhost:8889/alerts/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).catch(() => {});
  };

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none flex items-center gap-3">
          Alert Center
          {alerts.length > 0 && <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest">{alerts.length} Events</span>}
        </h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Thermal event monitoring & notifications
        </p>
      </header>

      <div className="grid grid-cols-12 gap-5 flex-1 min-h-0 animate-slide-in" style={{ animationDelay: '50ms' }}>
        {/* Config Panel */}
        <div className="col-span-4 glass-panel p-6 flex flex-col gap-6">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase flex items-center gap-2">
            <Settings size={11} className="text-teal-400/60" /> Alert Configuration
          </h3>

          <div className="space-y-5">
            <div>
              <label className="text-[10px] text-white/30 block mb-2">Temperature Threshold (°C)</label>
              <input
                type="range" min="60" max="100" value={config.temp_threshold}
                onChange={(e) => updateConfig({ ...config, temp_threshold: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] mono text-white/40 mt-1">
                <span>60°C</span>
                <span className="text-teal-400 font-bold">{config.temp_threshold}°C</span>
                <span>100°C</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/30">Alerts Enabled</span>
              <button
                onClick={() => updateConfig({ ...config, enabled: !config.enabled })}
                className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                  config.enabled ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/[0.02] text-white/20 border-white/[0.04]'
                }`}
              >
                {config.enabled ? 'Active' : 'Disabled'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/30">Notification Method</span>
              <span className="text-[9px] mono text-white/40">Desktop (notify-send)</span>
            </div>
          </div>
        </div>

        {/* Alert History Log */}
        <div className="col-span-8 glass-panel p-5 flex flex-col">
          <h3 className="text-[9px] font-black tracking-[0.25em] text-white/25 uppercase mb-4 flex items-center gap-2">
            <Bell size={11} className="text-red-400/60" /> Event Log
          </h3>
          <div className="flex-1 overflow-y-auto thin-scrollbar space-y-2">
            {alerts.length > 0 ? alerts.map((alert, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/15' : 'bg-amber-500/5 border-amber-500/15'
              }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${alert.severity === 'critical' ? 'bg-red-400 animate-pulse' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-bold ${alert.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{alert.message}</p>
                  <p className="text-[9px] mono text-white/20">{new Date(alert.timestamp * 1000).toLocaleString()}</p>
                </div>
                <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${
                  alert.severity === 'critical' ? 'text-red-400 border-red-500/20 bg-red-500/10' : 'text-amber-400 border-amber-500/20 bg-amber-500/10'
                }`}>{alert.severity}</span>
              </div>
            )) : (
              <div className="flex-1 flex items-center justify-center text-white/10 font-black tracking-widest text-sm uppercase">
                No thermal alerts recorded
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════
// ██  PAGE: APP PROFILES
// ══════════════════════════════════════════════
function ProfilePage({ isOnline, status, profiles, saveProfiles, systemProcesses, activeProfile }) {
  const [searchTerm, setSearchTerm] = useState('');
  
  const modes = [
    { id: 'default', name: 'Default', color: 'blue' },
    { id: 'silent', name: 'Acoustic / Silent', color: 'teal' },
    { id: 'performance', name: 'Cryo-Boost', color: 'red' },
    { id: 'battery', name: 'Battery Saver', color: 'green' }
  ];

  const handleBind = (appName, mode) => {
    const newProfiles = { ...profiles };
    if (mode === 'default') {
      delete newProfiles[appName];
    } else {
      newProfiles[appName] = mode;
    }
    saveProfiles(newProfiles);
  };

  const filteredProcs = systemProcesses.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <>
      <header className="animate-slide-in">
        <h1 className="text-2xl font-black text-white tracking-tight leading-none">Application Profiles</h1>
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase mt-1.5 flex items-center gap-2">
          <StatusDot online={isOnline} /> {status} — Workload-aware thermal bindings
        </p>
      </header>

      <div className="grid grid-cols-12 gap-5 flex-1 min-h-0 animate-slide-in" style={{animationDelay: '50ms'}}>
        
        {/* Bound Apps List */}
        <div className="col-span-4 glass-panel p-6 flex flex-col min-h-0">
          <h2 className="text-[11px] font-black tracking-[0.25em] text-white/40 uppercase mb-4 flex items-center gap-2">
            <Shield size={14} /> Bound Processes
          </h2>
          <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
            {Object.keys(profiles).length === 0 ? (
              <div className="h-full flex items-center justify-center text-white/10 font-black tracking-widest text-xs uppercase text-center p-4">
                No apps bound. AI will use generic mode.
              </div>
            ) : (
              Object.entries(profiles).map(([appName, modeId]) => {
                const modeInfo = modes.find(m => m.id === modeId) || modes[0];
                const isActive = activeProfile && activeProfile.app === appName;
                return (
                  <div key={appName} className={`p-4 border rounded-xl flex items-center justify-between ${isActive ? 'bg-blue-500/10 border-blue-500/30' : 'bg-black/20 border-white/5'}`}>
                    <div>
                      <span className={`text-xs font-black block ${isActive ? 'text-blue-300' : 'text-white/80'}`}>{appName}</span>
                      <span className={`text-[9px] uppercase tracking-widest font-bold mt-1 block text-${modeInfo.color}-400`}>{modeInfo.name}</span>
                    </div>
                    <button 
                      onClick={() => handleBind(appName, 'default')}
                      className="w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/30 flex items-center justify-center text-red-400 font-bold transition-all"
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Active System Process Browser */}
        <div className="col-span-8 glass-panel p-6 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-black tracking-[0.25em] text-white/40 uppercase flex items-center gap-2">
              <Activity size={14} /> Process Browser
            </h2>
            <input 
              type="text" 
              placeholder="Search processes..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-xs text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
            {filteredProcs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-white/10 font-black tracking-widest text-xs uppercase">
                No active processes found
              </div>
            ) : (
              filteredProcs.map((proc, i) => {
                const currentMode = profiles[proc.name] || 'default';
                return (
                  <div key={i} className="p-3 bg-black/20 hover:bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-between transition-colors">
                    <div className="flex items-center gap-4 w-1/2">
                      <span className="text-xs font-bold text-white w-1/2 truncate" title={proc.name}>{proc.name}</span>
                      <div className="flex gap-3 text-[10px] mono text-white/40">
                        <span>CPU: {proc.cpu}%</span>
                        <span>MEM: {proc.mem}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {modes.map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => handleBind(proc.name, mode.id)}
                          className={`px-2 py-1 rounded text-[9px] font-black tracking-widest uppercase border transition-all ${
                            currentMode === mode.id 
                              ? `bg-${mode.color}-500/20 text-${mode.color}-300 border-${mode.color}-500/30` 
                              : 'bg-transparent text-white/20 border-transparent hover:bg-white/5'
                          }`}
                        >
                          {mode.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
