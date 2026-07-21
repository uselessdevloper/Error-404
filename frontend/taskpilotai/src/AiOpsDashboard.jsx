import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Cpu, 
  Activity, 
  Terminal, 
  Sliders, 
  ShieldAlert, 
  Settings, 
  HelpCircle, 
  Plus, 
  Search, 
  Bell, 
  CheckCircle, 
  Play, 
  User, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight, 
  MoreVertical,
  Code,
  Send,
  Zap,
  Check
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

export default function AiOpsDashboard() {
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [investigated, setInvestigated] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      id: 1,
      sender: 'system',
      text: 'OpsPilot AI engine initialized. Ready to diagnose incoming platform alerts.',
      isCode: false
    },
    {
      id: 2,
      sender: 'ai',
      text: 'I detected a spike in API response latencies on the /v1/ingest gateway. Recommended action:\n```bash\nkubectl scale deployment api-gateway --replicas=5\n```',
      isCode: true
    }
  ]);
  const [inputVal, setInputVal] = useState('');

  // Mock Bar Chart Data
  const chartData = [
    { name: 'Mon', latency: 190 },
    { name: 'Tue', latency: 220 },
    { name: 'Wed', latency: 290 },
    { name: 'Thu', latency: 480, highlighted: true }, // Highlighted peak bar
    { name: 'Fri', latency: 240 },
    { name: 'Sat', latency: 170 },
    { name: 'Sun', latency: 150 },
  ];

  // Table Data
  const initialIncidents = [
    { id: 'INC-2094', service: 'Auth API Service', region: 'us-east-1', severity: 'High', status: 'Triaging', time: '5 mins ago' },
    { id: 'INC-2093', service: 'CSV Stream Parser', region: 'eu-west-1', severity: 'Critical', status: 'Investigating', time: '12 mins ago' },
    { id: 'INC-2092', service: 'Notification Dispatcher', region: 'ap-south-1', severity: 'Low', status: 'Healthy', time: '1 hr ago' },
    { id: 'INC-2091', service: 'Payment Hook Processor', region: 'us-west-2', severity: 'High', status: 'Blocked', time: '2 hrs ago' },
  ];

  const [incidents, setIncidents] = useState(initialIncidents);

  // Nav Items
  const navItems = [
    { id: 'Dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'Agents', icon: Cpu, label: 'AI Agents' },
    { id: 'Performance', icon: Activity, label: 'Telemetry' },
    { id: 'Console', icon: Terminal, label: 'Ops Console' },
    { id: 'Tuning', icon: Sliders, label: 'Model Tuning' },
    { id: 'Alerts', icon: ShieldAlert, label: 'Active Incidents' },
  ];

  // Custom chat message submit
  const handleSendChat = (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    
    const userMsg = {
      id: Date.now(),
      sender: 'user',
      text: inputVal,
      isCode: false
    };

    setChatMessages(prev => [...prev, userMsg]);
    setInputVal('');

    // AI dynamic auto-reply
    setTimeout(() => {
      let aiText = "Analyzing your request... Checking log streams and server capacity metrics.";
      const query = inputVal.toLowerCase();
      if (query.includes('scale') || query.includes('kubectl') || query.includes('replicas')) {
        aiText = "Executing cluster scaling. Scaling replicas to 5. Verify live status with:\n```bash\nkubectl get pods -n production -l app=api-gateway\n```";
      } else if (query.includes('status') || query.includes('check')) {
        aiText = "System Health is at 96%. All agent node pools are functional. Disk I/O is within safe thresholds.";
      }
      
      setChatMessages(prev => [...prev, {
        id: Date.now() + 1,
        sender: 'ai',
        text: aiText,
        isCode: aiText.includes('```')
      }]);
    }, 800);
  };

  const filteredIncidents = incidents.filter(inc => 
    inc.service.toLowerCase().includes(searchQuery.toLowerCase()) || 
    inc.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex min-h-screen bg-[#0B0D12] text-[#F5F7FA] font-sans antialiased selection:bg-[#3B9EFF]/30">
      
      {/* ─── FIXED LEFT SIDEBAR ─── */}
      <aside className="fixed inset-y-0 left-0 w-[260px] bg-[#0A0E14] border-r border-white/5 flex flex-col justify-between z-30">
        
        {/* Top brand header */}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#3B9EFF] flex items-center justify-center shadow-lg shadow-[#3B9EFF]/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">OpsPilot AI</h1>
              <span className="text-[10px] uppercase tracking-widest font-extrabold text-[#5A6272]">Autonomous AI Ops</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 group text-left ${
                    isActive 
                      ? 'bg-[#3B9EFF]/10 border-l-2 border-[#3B9EFF] text-[#3B9EFF]' 
                      : 'text-[#8B93A1] hover:text-white hover:bg-white/5 border-l-2 border-transparent'
                  }`}
                >
                  <Icon className={`w-4.5 h-4.5 transition-transform duration-200 group-hover:scale-105 ${isActive ? 'text-[#3B9EFF]' : 'text-[#8B93A1] group-hover:text-white'}`} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom actions & profile profile links */}
        <div className="p-6 border-t border-white/5 space-y-4">
          <button className="w-full py-3 bg-[#3B9EFF] hover:bg-[#3B9EFF]/90 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#3B9EFF]/15 transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#3B9EFF]/50">
            <Plus className="w-4 h-4" />
            New Simulation
          </button>
          
          <div className="space-y-2">
            <a href="#settings" className="flex items-center gap-3 text-xs font-medium text-[#8B93A1] hover:text-white px-2 py-1 transition-colors">
              <Settings className="w-4 h-4" />
              Settings
            </a>
            <a href="#support" className="flex items-center gap-3 text-xs font-medium text-[#8B93A1] hover:text-white px-2 py-1 transition-colors">
              <HelpCircle className="w-4 h-4" />
              Developer Docs
            </a>
          </div>
        </div>
      </aside>

      {/* ─── MAIN CONTENT AREA ─── */}
      <main className="ml-[260px] flex-1 flex flex-col min-h-screen bg-[#0B0D12]">
        
        {/* Top Header Bar */}
        <header className="h-[70px] border-b border-white/5 px-8 flex items-center justify-between bg-[#0B0D12]/80 backdrop-blur sticky top-0 z-20">
          
          {/* Left status indicator */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#8B93A1]">Cluster Status</span>
            <div className="flex items-center gap-1.5 bg-[#151920] border border-white/5 px-3 py-1 rounded-full text-[11px] font-bold text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Healthy
            </div>
          </div>

          {/* Right actions: Search, Bell, Profile */}
          <div className="flex items-center gap-4">
            <div className="relative w-64">
              <input
                type="text"
                placeholder="Search telemetry..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#151920] border border-white/5 hover:border-white/10 focus:border-[#3B9EFF]/40 text-xs text-[#F5F7FA] placeholder-[#5A6272] rounded-xl pl-9 pr-4 py-2 outline-none transition-all focus:ring-2 focus:ring-[#3B9EFF]/10"
              />
              <Search className="w-4 h-4 text-[#5A6272] absolute left-3 top-2.5" />
            </div>

            <button className="relative w-9 h-9 bg-[#151920] border border-white/5 hover:border-white/10 hover:text-white text-[#8B93A1] rounded-xl flex items-center justify-center transition-colors">
              <Bell className="w-4.5 h-4.5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#E8877A] rounded-full"></span>
            </button>

            <button className="w-9 h-9 bg-[#151920] border border-white/5 hover:border-white/10 hover:text-white text-[#8B93A1] rounded-xl flex items-center justify-center transition-colors">
              <RefreshCw className="w-4.5 h-4.5" />
            </button>

            <div className="w-9 h-9 rounded-full bg-[#3B9EFF]/20 border border-[#3B9EFF]/30 flex items-center justify-center text-xs font-bold text-[#3B9EFF] cursor-pointer">
              U
            </div>
          </div>
        </header>

        {/* Dynamic Inner Container */}
        <div className="p-8 space-y-8 flex-1">
          
          {/* Dashboard Page Title */}
          <div>
            <h1 className="text-3xl font-light text-white tracking-tight">AI Agent Operations</h1>
            <p className="text-xs text-[#8B93A1] mt-1.5">Autonomous log parsing, incident triaging, and real-time model capacity scaling.</p>
          </div>

          {/* ─── GRID: STAT CARDS ─── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            
            {/* Card 1 */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#5A6272]">Active Agents</span>
              <div className="text-2xl font-bold mt-2 text-white">14 Nodes</div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold mt-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>+12% vs last month</span>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#5A6272]">Telemetry Speed</span>
              <div className="text-2xl font-bold mt-2 text-white">240 ms</div>
              <div className="flex items-center gap-1 text-[11px] text-[#E8877A] font-bold mt-1">
                <ArrowDownRight className="w-3.5 h-3.5" />
                <span>-35ms latency spike</span>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#5A6272]">AI Workload</span>
              <div className="text-2xl font-bold mt-2 text-white">78.4%</div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold mt-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Optimal Capacity</span>
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#5A6272]">Compute Cost</span>
              <div className="text-2xl font-bold mt-2 text-white">$1,248.50</div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold mt-1">
                <ArrowDownRight className="w-3.5 h-3.5" />
                <span>-8% cost optimized</span>
              </div>
            </div>

          </div>

          {/* ─── GRID: CHARTS, GAUGE & PRIORITY CARD ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left 2/3: Bar Chart Card */}
            <div className="lg:col-span-2 bg-[#151920] border border-white/5 rounded-2xl p-6 flex flex-col justify-between hover:border-white/10 transition-all duration-200">
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-wide">API Gateway Latency History</h2>
                    <p className="text-[10px] text-[#8B93A1] mt-0.5">Average API request execution time (ms) over past 7 days</p>
                  </div>
                  <span className="text-[10px] font-extrabold text-[#3B9EFF] bg-[#3B9EFF]/10 px-2.5 py-1 rounded-full uppercase tracking-wider">Hourly Stream</span>
                </div>

                <div className="h-56 mt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis 
                        dataKey="name" 
                        stroke="#5A6272" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke="#5A6272" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(value) => `${value}ms`}
                      />
                      <Tooltip 
                        cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                        contentStyle={{ 
                          background: '#1A1F28', 
                          borderColor: 'rgba(255,255,255,0.05)', 
                          borderRadius: '12px',
                          fontSize: '11px',
                          color: '#F5F7FA'
                        }}
                      />
                      <Bar dataKey="latency" radius={[6, 6, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.highlighted ? '#3B9EFF' : 'rgba(59, 130, 246, 0.15)'} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Small telemetry status stats row below */}
              <div className="grid grid-cols-4 gap-2 pt-5 border-t border-white/5 mt-4 text-center">
                <div>
                  <div className="text-[10px] uppercase font-extrabold text-[#5A6272]">Success Rate</div>
                  <div className="text-xs font-bold text-white mt-1">99.85%</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-extrabold text-[#5A6272]">Avg Latency</div>
                  <div className="text-xs font-bold text-white mt-1">240ms</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-extrabold text-[#5A6272]">Cost Per Run</div>
                  <div className="text-xs font-bold text-white mt-1">$0.012</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-extrabold text-[#5A6272]">Active Load</div>
                  <div className="text-xs font-bold text-white mt-1">4.8k ops</div>
                </div>
              </div>
            </div>

            {/* Right 1/3: Health Gauge & Stepper Combined Card */}
            <div className="space-y-6">
              
              {/* Radial Score Gauge Card */}
              <div className="bg-[#151920] border border-[#3B9EFF]/20 rounded-2xl p-6 flex flex-col items-center justify-center hover:border-[#3B9EFF]/40 transition-all duration-300">
                <span className="text-[10px] uppercase tracking-widest font-extrabold text-[#5A6272] mb-3">System Health Score</span>
                
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    {/* Track ring */}
                    <circle 
                      cx="50" 
                      cy="50" 
                      r="40" 
                      stroke="rgba(255,255,255,0.03)" 
                      strokeWidth="8" 
                      fill="transparent" 
                    />
                    {/* Accent progress ring */}
                    <circle 
                      cx="50" 
                      cy="50" 
                      r="40" 
                      stroke="#3B9EFF" 
                      strokeWidth="8" 
                      fill="transparent" 
                      strokeDasharray="251.2"
                      strokeDashoffset="10.04" // 96% progress
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-3xl font-extrabold text-white">96%</span>
                    <span className="text-[9px] uppercase tracking-wider font-extrabold text-[#3B9EFF] block mt-0.5">Optimal</span>
                  </div>
                </div>

                <div className="text-center mt-3 text-[11px] text-[#8B93A1] font-medium">
                  23 active nodes validating incoming event logs.
                </div>
              </div>

              {/* Horizontal Stepper Pipeline */}
              <div className="bg-[#151920] border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#5A6272]">Pipeline Execution</span>
                <h3 className="text-xs font-bold text-white mt-1">Autonomous Triaging Stream</h3>
                
                <div className="flex items-center justify-between mt-6 px-1.5 relative">
                  
                  {/* Thin connector track line */}
                  <div className="absolute top-[11px] left-8 right-8 h-[2px] bg-white/5 z-0"></div>
                  <div className="absolute top-[11px] left-8 w-[60%] h-[2px] bg-[#3B9EFF] z-0"></div>

                  {/* Step 1 */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-[#3B9EFF] text-white flex items-center justify-center shadow shadow-[#3B9EFF]/20">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <span className="text-[9px] font-bold text-white mt-1.5">Ingest</span>
                  </div>

                  {/* Step 2 */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-[#3B9EFF] text-white flex items-center justify-center shadow shadow-[#3B9EFF]/20">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <span className="text-[9px] font-bold text-white mt-1.5">Parse</span>
                  </div>

                  {/* Step 3 */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-[#1A1F28] border-2 border-[#3B9EFF] text-[#3B9EFF] flex items-center justify-center">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#3B9EFF] animate-pulse"></span>
                    </div>
                    <span className="text-[9px] font-bold text-[#3B9EFF] mt-1.5">Triage</span>
                  </div>

                  {/* Step 4 */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-[#1A1F28] border-2 border-white/5 text-[#5A6272] flex items-center justify-center font-bold text-[10px]">
                      4
                    </div>
                    <span className="text-[9px] font-bold text-[#5A6272] mt-1.5">Scale</span>
                  </div>

                </div>
              </div>

            </div>

          </div>

          {/* ─── GRID: PRIORITY ALERT CARD & DATA TABLE & COPILOT ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Priority/Alert Card */}
            <div className="bg-[#151920] border-l-4 border-[#E8877A] border-y border-r border-white/5 rounded-2xl p-6 flex flex-col justify-between hover:border-white/10 transition-colors">
              <div>
                <div className="flex justify-between items-start">
                  <span className="bg-[#E8877A]/10 text-[#E8877A] text-[9px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Critical Alert
                  </span>
                  <span className="text-[10px] text-[#5A6272] font-semibold">Logged 5m ago</span>
                </div>
                
                <h3 className="text-base font-bold text-white mt-4">API Gateway Ingress Timeout Peak</h3>
                <p className="text-[11.5px] text-[#8B93A1] mt-2 leading-relaxed text-sm">
                  Peak timeout rate reached 4.2% on enterprise ingest routes. Autonomous analysis suspects DB thread starvation. Scale application replication recommended.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-[#3B9EFF] text-xs font-bold flex items-center justify-center border border-[#3B9EFF]/20">
                    OP
                  </div>
                  <div>
                    <span className="text-[10px] text-[#5A6272] block font-bold uppercase tracking-wider">Assignee</span>
                    <span className="text-xs font-bold text-white">OpsPilot AI Engine</span>
                  </div>
                </div>

                <button 
                  onClick={() => setInvestigated(true)}
                  className={`px-4.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    investigated 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                      : 'bg-[#3B9EFF] hover:bg-[#3B9EFF]/90 text-white shadow shadow-[#3B9EFF]/15'
                  }`}
                >
                  {investigated ? '✓ Active Triaging' : 'Investigate'}
                </button>
              </div>
            </div>

            {/* Data Table Card */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">Incident Active Monitor</h3>
                  <p className="text-[10px] text-[#8B93A1] mt-0.5">Triaged log exceptions categorized by region</p>
                </div>
                <MoreVertical className="w-4.5 h-4.5 text-[#5A6272] cursor-pointer hover:text-white" />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 pb-2">
                      <th className="text-[10px] uppercase font-extrabold text-[#5A6272] pb-2">Target</th>
                      <th className="text-[10px] uppercase font-extrabold text-[#5A6272] pb-2">Region</th>
                      <th className="text-[10px] uppercase font-extrabold text-[#5A6272] pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncidents.map((inc) => (
                      <tr key={inc.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 pr-2">
                          <span className="text-xs font-bold text-white block">{inc.service}</span>
                          <span className="text-[10px] text-[#5A6272] font-semibold">{inc.id}</span>
                        </td>
                        <td className="py-3 text-xs text-[#8B93A1] font-semibold">{inc.region}</td>
                        <td className="py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9.5px] font-bold ${
                            inc.status === 'Healthy' ? 'bg-emerald-500/10 text-emerald-400' :
                            inc.status === 'Triaging' ? 'bg-[#3B9EFF]/10 text-[#3B9EFF]' :
                            inc.status === 'Investigating' ? 'bg-amber-500/10 text-amber-400' :
                            'bg-[#E8877A]/10 text-[#E8877A]'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              inc.status === 'Healthy' ? 'bg-emerald-500' :
                              inc.status === 'Triaging' ? 'bg-[#3B9EFF] animate-pulse' :
                              inc.status === 'Investigating' ? 'bg-amber-500' :
                              'bg-[#E8877A]'
                            }`}></span>
                            {inc.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Chat/Copilot Panel */}
            <div className="bg-[#151920] border border-white/5 rounded-2xl p-6 flex flex-col justify-between hover:border-white/10 transition-colors">
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-white tracking-wide">OpsPilot Copilot</h3>
                  <span className="text-[9.5px] font-extrabold text-[#3B9EFF] bg-[#3B9EFF]/10 px-2 py-0.5 rounded uppercase tracking-wider">AI Assistant</span>
                </div>

                {/* Messages feed */}
                <div className="bg-[#1A1F28] border border-white/5 rounded-xl p-3 h-48 overflow-y-auto space-y-3">
                  {chatMessages.map(msg => (
                    <div key={msg.id} className={`flex flex-col gap-1.5 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[11.5px] p-2.5 rounded-xl max-w-[90%] leading-relaxed ${
                        msg.sender === 'user' 
                          ? 'bg-[#3B9EFF] text-white font-semibold' 
                          : msg.sender === 'system'
                          ? 'bg-[#0B0D12] text-[#8B93A1] border border-white/5 font-semibold'
                          : 'bg-[#151920] text-[#F5F7FA] border border-white/5'
                      }`}>
                        {msg.isCode ? (
                          <div className="space-y-1.5">
                            <span className="block">{msg.text.split('\n')[0]}</span>
                            <pre className="bg-[#0B0D12] border border-white/5 rounded p-2 text-[10.5px] font-mono text-indigo-300 overflow-x-auto">
                              {msg.text.split('\n').slice(1).join('\n').replace(/```bash\n|```/g, '')}
                            </pre>
                          </div>
                        ) : (
                          msg.text
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat action triggers & input form */}
              <div className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => { setInputVal("check system status"); }}
                    className="bg-[#1A1F28] hover:bg-white/5 border border-white/5 hover:border-white/10 text-[9.5px] font-extrabold text-[#8B93A1] hover:text-white px-2 py-1.5 rounded-lg transition-all"
                  >
                    Check Status
                  </button>
                  <button 
                    type="button"
                    onClick={() => { setInputVal("scale api-gateway deployment replicas=5"); }}
                    className="bg-[#1A1F28] hover:bg-white/5 border border-white/5 hover:border-white/10 text-[9.5px] font-extrabold text-[#8B93A1] hover:text-white px-2 py-1.5 rounded-lg transition-all"
                  >
                    Scale Cluster
                  </button>
                </div>

                <form onSubmit={handleSendChat} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ask OpsPilot to triage or run commands..."
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    className="flex-1 bg-[#1A1F28] border border-white/5 hover:border-white/10 focus:border-[#3B9EFF]/40 text-xs text-[#F5F7FA] placeholder-[#5A6272] rounded-xl px-3 py-2 outline-none transition-all"
                  />
                  <button 
                    type="submit"
                    className="bg-[#3B9EFF] hover:bg-[#3B9EFF]/90 text-white w-9 h-9 rounded-xl flex items-center justify-center shadow shadow-[#3B9EFF]/15 transition-all"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>

            </div>

          </div>

        </div>

      </main>

    </div>
  );
}
