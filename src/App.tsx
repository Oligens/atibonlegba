/**
 * =============================================================================
 * ATIBON - Interface Principale
 * =============================================================================
 * Application de gestion de bureau distant avec design Glassmorphism.
 * Intègre le module RemoteDesktopViewer pour la prise de contrôle à distance.
 * =============================================================================
 */

import React, { useState } from "react";
import {
  Monitor,
  Server,
  Shield,
  Activity,
  Settings,
  Users,
  Network,
  Terminal,
  LayoutDashboard,
  ChevronRight,
  Zap,
  Globe,
  Lock,
} from "lucide-react";
import RemoteDesktopViewer from "./components/RemoteDesktopViewer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ActiveView = "dashboard" | "remote-desktop" | "machines" | "logs";

interface MachineInfo {
  id: string;
  name: string;
  ip: string;
  status: "online" | "offline" | "busy";
  os: string;
  cpu: number;
  ram: number;
  uptime: string;
}

// ---------------------------------------------------------------------------
// Données simulées
// ---------------------------------------------------------------------------
const MOCK_MACHINES: MachineInfo[] = [
  { id: "1", name: "SRV-PROD-01", ip: "192.168.1.10", status: "online", os: "Ubuntu 22.04", cpu: 23, ram: 45, uptime: "42j 3h" },
  { id: "2", name: "SRV-PROD-02", ip: "192.168.1.11", status: "online", os: "Windows Server 2022", cpu: 67, ram: 78, uptime: "15j 12h" },
  { id: "3", name: "SRV-DEV-01", ip: "192.168.1.20", status: "busy", os: "Debian 12", cpu: 89, ram: 62, uptime: "7j 5h" },
  { id: "4", name: "SRV-DB-01", ip: "192.168.1.30", status: "online", os: "CentOS 9", cpu: 34, ram: 55, uptime: "120j 8h" },
  { id: "5", name: "SRV-BACKUP", ip: "192.168.1.40", status: "offline", os: "Ubuntu 20.04", cpu: 0, ram: 0, uptime: "—" },
  { id: "6", name: "SRV-WEB-01", ip: "192.168.1.50", status: "online", os: "Alpine Linux", cpu: 12, ram: 28, uptime: "89j 1h" },
];

// ---------------------------------------------------------------------------
// Composant App
// ---------------------------------------------------------------------------
const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveView>("remote-desktop");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #050510 0%, #0a0a1a 50%, #0d0d20 100%)",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* ================================================================== */}
      {/* SIDEBAR */}
      {/* ================================================================== */}
      <aside
        className={`flex flex-col border-r transition-all duration-300 ${
          sidebarCollapsed ? "w-16" : "w-56"
        }`}
        style={{
          background: "rgba(8, 8, 18, 0.95)",
          borderColor: "rgba(212, 175, 55, 0.2)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "rgba(212, 175, 55, 0.15)" }}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #D4AF37, #b8942e)",
              boxShadow: "0 0 15px rgba(212, 175, 55, 0.3)",
            }}
          >
            <Zap size={16} className="text-black" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-sm font-bold tracking-wider" style={{ color: "#D4AF37" }}>
                ATIBON
              </h1>
              <p className="text-[10px]" style={{ color: "#666" }}>
                Infrastructure Manager
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {[
            { id: "dashboard" as ActiveView, icon: LayoutDashboard, label: "Tableau de bord" },
            { id: "remote-desktop" as ActiveView, icon: Monitor, label: "Bureau Distant" },
            { id: "machines" as ActiveView, icon: Server, label: "Machines" },
            { id: "logs" as ActiveView, icon: Terminal, label: "Logs & Monitoring" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                sidebarCollapsed ? "justify-center" : ""
              }`}
              style={{
                background: activeView === item.id
                  ? "rgba(212, 175, 55, 0.12)"
                  : "transparent",
                border: activeView === item.id
                  ? "1px solid rgba(212, 175, 55, 0.3)"
                  : "1px solid transparent",
                color: activeView === item.id ? "#D4AF37" : "#888",
              }}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Toggle sidebar */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="mx-2 mb-4 p-2 rounded-lg transition-all hover:scale-105"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#666",
          }}
        >
          <ChevronRight
            size={16}
            className={`transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`}
          />
        </button>
      </aside>

      {/* ================================================================== */}
      {/* MAIN CONTENT */}
      {/* ================================================================== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header
          className="flex items-center justify-between px-6 py-3 border-b"
          style={{
            background: "rgba(10, 10, 20, 0.8)",
            borderColor: "rgba(212, 175, 55, 0.15)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="flex items-center gap-3">
            <Monitor size={20} style={{ color: "#00F0FF" }} />
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "#eee" }}>
                {activeView === "remote-desktop"
                  ? "Prise de Contrôle à Distance"
                  : activeView === "dashboard"
                  ? "Tableau de Bord"
                  : activeView === "machines"
                  ? "Gestion des Machines"
                  : "Logs & Monitoring"}
              </h2>
              <p className="text-xs" style={{ color: "#666" }}>
                Module de bureau distant — Type TeamViewer / VNC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{
              background: "rgba(0, 240, 255, 0.05)",
              border: "1px solid rgba(0, 240, 255, 0.2)",
            }}>
              <Globe size={14} style={{ color: "#00F0FF" }} />
              <span className="text-xs font-mono" style={{ color: "#00F0FF" }}>
                atibon.local
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{
              background: "rgba(212, 175, 55, 0.05)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
            }}>
              <Shield size={14} style={{ color: "#D4AF37" }} />
              <span className="text-xs" style={{ color: "#D4AF37" }}>Admin</span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {activeView === "remote-desktop" ? (
            <RemoteDesktopViewer />
          ) : activeView === "dashboard" ? (
            <DashboardView machines={MOCK_MACHINES} onOpenRemote={() => setActiveView("remote-desktop")} />
          ) : activeView === "machines" ? (
            <MachinesView machines={MOCK_MACHINES} />
          ) : (
            <LogsView />
          )}
        </div>
      </main>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard View
// ---------------------------------------------------------------------------
const DashboardView: React.FC<{ machines: MachineInfo[]; onOpenRemote: () => void }> = ({ machines, onOpenRemote }) => {
  const onlineCount = machines.filter((m) => m.status === "online").length;
  const avgCpu = Math.round(machines.filter(m => m.cpu > 0).reduce((a, m) => a + m.cpu, 0) / machines.filter(m => m.cpu > 0).length);
  const avgRam = Math.round(machines.filter(m => m.ram > 0).reduce((a, m) => a + m.ram, 0) / machines.filter(m => m.ram > 0).length);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Machines en ligne", value: `${onlineCount}/${machines.length}`, icon: Server, color: "#00F0FF" },
          { label: "CPU Moyen", value: `${avgCpu}%`, icon: Activity, color: "#D4AF37" },
          { label: "RAM Moyenne", value: `${avgRam}%`, icon: Network, color: "#00ff64" },
          { label: "Sessions actives", value: "2", icon: Users, color: "#ff66cc" },
        ].map((stat, i) => (
          <div
            key={i}
            className="p-4 rounded-xl"
            style={{
              background: "rgba(15, 15, 30, 0.8)",
              border: "1px solid rgba(212, 175, 55, 0.15)",
              backdropFilter: "blur(20px)",
              boxShadow: `0 0 20px ${stat.color}10`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: "#888" }}>{stat.label}</span>
              <stat.icon size={16} style={{ color: stat.color }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Quick Access - Remote Desktop */}
      <div
        className="p-6 rounded-xl mb-6 cursor-pointer transition-all hover:scale-[1.01]"
        onClick={onOpenRemote}
        style={{
          background: "linear-gradient(135deg, rgba(212, 175, 55, 0.08), rgba(0, 240, 255, 0.05))",
          border: "1px solid rgba(212, 175, 55, 0.3)",
          boxShadow: "0 0 30px rgba(212, 175, 55, 0.05)",
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{
              background: "rgba(212, 175, 55, 0.1)",
              border: "1px solid rgba(212, 175, 55, 0.3)",
            }}
          >
            <Monitor size={28} style={{ color: "#D4AF37" }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold" style={{ color: "#D4AF37" }}>
              Bureau Distant
            </h3>
            <p className="text-sm" style={{ color: "#888" }}>
              Prenez le contrôle d'une machine distante en temps réel — Souris, Clavier, Écran
            </p>
          </div>
          <ChevronRight size={24} style={{ color: "#D4AF37" }} />
        </div>
      </div>

      {/* Machines List */}
      <div className="rounded-xl overflow-hidden" style={{
        background: "rgba(15, 15, 30, 0.6)",
        border: "1px solid rgba(212, 175, 55, 0.15)",
      }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(212, 175, 55, 0.1)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "#D4AF37" }}>
            État des Machines
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          {machines.map((machine) => (
            <div key={machine.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: machine.status === "online" ? "#00ff64" : machine.status === "busy" ? "#ffa500" : "#ff4444",
                    boxShadow: `0 0 6px ${machine.status === "online" ? "#00ff64" : machine.status === "busy" ? "#ffa500" : "#ff4444"}`,
                  }}
                />
                <div>
                  <p className="text-sm font-mono font-semibold" style={{ color: "#ddd" }}>{machine.name}</p>
                  <p className="text-xs" style={{ color: "#666" }}>{machine.ip} • {machine.os}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs font-mono" style={{ color: "#00F0FF" }}>CPU {machine.cpu}%</p>
                  <p className="text-xs font-mono" style={{ color: "#D4AF37" }}>RAM {machine.ram}%</p>
                </div>
                <span className="text-xs" style={{ color: "#555" }}>{machine.uptime}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Machines View
// ---------------------------------------------------------------------------
const MachinesView: React.FC<{ machines: MachineInfo[] }> = ({ machines }) => (
  <div className="p-6 overflow-y-auto h-full">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {machines.map((machine) => (
        <div
          key={machine.id}
          className="p-4 rounded-xl transition-all hover:scale-[1.02] cursor-pointer"
          style={{
            background: "rgba(15, 15, 30, 0.8)",
            border: "1px solid rgba(212, 175, 55, 0.15)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server size={16} style={{ color: "#D4AF37" }} />
              <span className="text-sm font-bold font-mono" style={{ color: "#ddd" }}>{machine.name}</span>
            </div>
            <div
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                background: machine.status === "online" ? "rgba(0, 255, 100, 0.1)" : machine.status === "busy" ? "rgba(255, 165, 0, 0.1)" : "rgba(255, 50, 50, 0.1)",
                color: machine.status === "online" ? "#00ff64" : machine.status === "busy" ? "#ffa500" : "#ff4444",
                border: `1px solid ${machine.status === "online" ? "rgba(0, 255, 100, 0.3)" : machine.status === "busy" ? "rgba(255, 165, 0, 0.3)" : "rgba(255, 50, 50, 0.3)"}`,
              }}
            >
              {machine.status.toUpperCase()}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span style={{ color: "#888" }}>IP</span>
              <span className="font-mono" style={{ color: "#00F0FF" }}>{machine.ip}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "#888" }}>OS</span>
              <span style={{ color: "#aaa" }}>{machine.os}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "#888" }}>Uptime</span>
              <span style={{ color: "#aaa" }}>{machine.uptime}</span>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] w-8" style={{ color: "#666" }}>CPU</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${machine.cpu}%`,
                      background: machine.cpu > 80 ? "#ff4444" : machine.cpu > 50 ? "#ffa500" : "#00F0FF",
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono w-8 text-right" style={{ color: "#aaa" }}>{machine.cpu}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] w-8" style={{ color: "#666" }}>RAM</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${machine.ram}%`,
                      background: machine.ram > 80 ? "#ff4444" : machine.ram > 50 ? "#D4AF37" : "#00ff64",
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono w-8 text-right" style={{ color: "#aaa" }}>{machine.ram}%</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Logs View
// ---------------------------------------------------------------------------
const LogsView: React.FC = () => {
  const logs = [
    { time: "14:32:01", level: "INFO", msg: "Session Remote Desktop démarrée sur SRV-PROD-01" },
    { time: "14:31:45", level: "INFO", msg: "Connexion WebSocket établie (client: 192.168.1.100)" },
    { time: "14:30:22", level: "WARN", msg: "Latence élevée détectée: 245ms vers SRV-DEV-01" },
    { time: "14:29:10", level: "INFO", msg: "Authentification réussie pour l'utilisateur admin" },
    { time: "14:28:55", level: "ERROR", msg: "Échec de connexion à SRV-BACKUP (timeout 10s)" },
    { time: "14:27:33", level: "INFO", msg: "Capture d'écran enregistrée: atibon-capture-1700000000.png" },
    { time: "14:26:01", level: "INFO", msg: "Paramètres mis à jour: FPS=30, Quality=80%" },
    { time: "14:25:44", level: "WARN", msg: "SRV-PROD-02: Utilisation CPU > 80% depuis 5 minutes" },
    { time: "14:24:12", level: "INFO", msg: "Verrouillage de session activé par admin" },
    { time: "14:23:00", level: "INFO", msg: "Module Remote Desktop initialisé avec succès" },
  ];

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(5, 5, 12, 0.9)",
          border: "1px solid rgba(212, 175, 55, 0.15)",
        }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgba(212, 175, 55, 0.1)" }}>
          <div className="flex items-center gap-2">
            <Terminal size={14} style={{ color: "#D4AF37" }} />
            <h3 className="text-sm font-semibold" style={{ color: "#D4AF37" }}>
              Journal d'activité
            </h3>
          </div>
          <span className="text-xs" style={{ color: "#555" }}>Dernières 24h</span>
        </div>
        <div className="font-mono text-xs">
          {logs.map((log, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-2 border-b hover:bg-white/[0.02]"
              style={{ borderColor: "rgba(255,255,255,0.03)" }}
            >
              <span style={{ color: "#555" }}>{log.time}</span>
              <span
                className="w-12 text-center rounded px-1"
                style={{
                  color: log.level === "ERROR" ? "#ff4444" : log.level === "WARN" ? "#ffa500" : "#00ff64",
                  background: log.level === "ERROR" ? "rgba(255,50,50,0.1)" : log.level === "WARN" ? "rgba(255,165,0,0.1)" : "rgba(0,255,100,0.05)",
                }}
              >
                {log.level}
              </span>
              <span style={{ color: "#aaa" }}>{log.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
