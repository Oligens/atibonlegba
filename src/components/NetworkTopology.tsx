/**
 * =============================================================================
 * ATIBON - Network Topology / Host Selector
 * =============================================================================
 * Tableau de bord réseau qui affiche les ordinateurs découverts sous forme
 * de cartes interactives. Permet de :
 *   - Lancer un scan réseau
 *   - Visualiser les hôtes actifs avec leurs services
 *   - Sélectionner une cible pour le relay de flux
 *   - Connecter instantanément au bureau distant d'une machine
 *
 * Design : Glassmorphism (thème sombre, bordures dorées #D4AF37, lueurs cyan #00F0FF)
 * =============================================================================
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Radar,
  Server,
  Monitor,
  Globe,
  Wifi,
  WifiOff,
  Play,
  Square,
  RefreshCw,
  Shield,
  Terminal,
  Lock,
  Unlock,
  ChevronRight,
  Cpu,
  HardDrive,
  Clock,
  Activity,
  Network,
  Search,
  Filter,
  ArrowRight,
  Zap,
  Eye,
  EyeOff,
  Radio,
  Satellite,
  Layers,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  MousePointer2,
  Keyboard,
  Settings,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

interface OpenPort {
  port: number;
  state: string;
  service: string;
  banner: string;
  version: string;
}

interface DiscoveredHost {
  ip: string;
  mac: string;
  hostname: string;
  vendor: string;
  status: string;
  os_guess: string;
  latency_ms: number;
  open_ports: OpenPort[];
  services: string[];
  last_seen: string;
  is_gateway: boolean;
  notes: string;
  scan_timestamp: number;
  has_ssh: boolean;
  has_vnc: boolean;
  has_rdp: boolean;
  has_smb: boolean;
  has_http: boolean;
  remote_protocols: string[];
  session_status?: string;
  is_selected?: boolean;
}

interface ScanResult {
  subnet: string;
  scan_start: number;
  scan_end: number;
  duration_seconds: number;
  total_hosts_scanned: number;
  hosts_found: number;
  hosts: DiscoveredHost[];
  errors: string[];
}

type FilterType = "all" | "remote" | "ssh" | "vnc" | "rdp" | "http" | "gateway";
type SortType = "ip" | "hostname" | "latency" | "services" | "status";

// ---------------------------------------------------------------------------
// Composant Principal
// ---------------------------------------------------------------------------

const NetworkTopology: React.FC = () => {
  // --- État de connexion ---
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // --- État du scan ---
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [scanDuration, setScanDuration] = useState(0);

  // --- État de la cible ---
  const [selectedHost, setSelectedHost] = useState<DiscoveredHost | null>(null);
  const [relayActive, setRelayActive] = useState(false);
  const [relayProtocol, setRelayProtocol] = useState<string>("");

  // --- État de l'interface ---
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("ip");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHostDetail, setSelectedHostDetail] = useState<DiscoveredHost | null>(null);
  const [showScanConfig, setShowScanConfig] = useState(false);
  const [subnetInput, setSubnetInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "topology">("grid");

  // --- Config ---
  const [apiBase, setApiBase] = useState("http://localhost:5000");

  // --- Refs ---
  const socketRef = useRef<Socket | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // =========================================================================
  // WebSocket Connection
  // =========================================================================

  const connectWebSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io(apiBase, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 3,
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (error: Error) => {
      setConnectionError(error.message);
    });

    // Namespace /network
    const networkSocket = io(`${apiBase}/network`, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    networkSocket.on("connected", () => {
      console.log("[ATIBON] Connecté au namespace /network");
    });

    networkSocket.on("scan_complete", (data: { hosts_found: number; duration: number; hosts: DiscoveredHost[] }) => {
      setIsScanning(false);
      setScanProgress(100);
      if (data.hosts) {
        setHosts(data.hosts);
      }
    });

    networkSocket.on("scan_error", (data: { error: string }) => {
      setIsScanning(false);
      setConnectionError(data.error);
    });

    networkSocket.on("target_selected", (data: { ip: string }) => {
      const host = hosts.find((h) => h.ip === data.ip);
      if (host) setSelectedHost(host);
    });

    networkSocket.on("relay_started", (data: { ip: string; protocol: string }) => {
      setRelayActive(true);
      setRelayProtocol(data.protocol);
    });

    networkSocket.on("relay_stopped", () => {
      setRelayActive(false);
      setRelayProtocol("");
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      networkSocket.disconnect();
    };
  }, [apiBase, hosts]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      socketRef.current?.disconnect();
    };
  }, [connectWebSocket]);

  // =========================================================================
  // API Calls
  // =========================================================================

  const fetchHosts = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/network/hosts`);
      const data = await res.json();
      if (data.hosts) setHosts(data.hosts);
    } catch (err) {
      console.error("Erreur fetch hosts:", err);
    }
  }, [apiBase]);

  const startScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(0);

    try {
      const body = subnetInput ? { subnet: subnetInput } : {};
      const res = await fetch(`${apiBase}/api/network/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.status === "scanning") {
        // Polling pour suivre la progression
        progressIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`${apiBase}/api/network/scan/status`);
            const statusData = await statusRes.json();

            if (!statusData.is_scanning) {
              setIsScanning(false);
              setScanProgress(100);
              if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
              }
              // Récupérer les résultats
              await fetchHosts();
              if (statusData.last_scan) {
                setLastScanResult(statusData.last_scan);
                setScanDuration(statusData.last_scan.duration_seconds);
              }
            } else {
              setScanProgress((prev) => Math.min(prev + 5, 90));
            }
          } catch {
            // Ignorer les erreurs de polling
          }
        }, 1000);
      }
    } catch (err) {
      setIsScanning(false);
      setConnectionError("Impossible de lancer le scan");
    }
  }, [apiBase, subnetInput, fetchHosts]);

  const selectTarget = useCallback(
    async (host: DiscoveredHost) => {
      setSelectedHost(host);
      try {
        await fetch(`${apiBase}/api/targets/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: host.ip }),
        });
      } catch (err) {
        console.error("Erreur sélection cible:", err);
      }
    },
    [apiBase]
  );

  const startRelay = useCallback(
    async (host: DiscoveredHost, protocol: string) => {
      try {
        const res = await fetch(`${apiBase}/api/relay/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: host.ip, protocol }),
        });
        const data = await res.json();
        if (data.status === "relay_active") {
          setRelayActive(true);
          setRelayProtocol(protocol);
          setSelectedHost(host);
        }
      } catch (err) {
        console.error("Erreur relay:", err);
      }
    },
    [apiBase]
  );

  const stopRelay = useCallback(async () => {
    try {
      await fetch(`${apiBase}/api/relay/stop`, { method: "POST" });
      setRelayActive(false);
      setRelayProtocol("");
    } catch (err) {
      console.error("Erreur stop relay:", err);
    }
  }, [apiBase]);

  const scanSingleHost = useCallback(
    async (ip: string) => {
      try {
        const res = await fetch(`${apiBase}/api/network/host/${ip}/scan`, {
          method: "POST",
        });
        const data = await res.json();
        setSelectedHostDetail(data);
      } catch (err) {
        console.error("Erreur scan host:", err);
      }
    },
    [apiBase]
  );

  // =========================================================================
  // Filtrage & Tri
  // =========================================================================

  const filteredHosts = React.useMemo(() => {
    let result = [...hosts];

    // Filtre par recherche
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (h) =>
          h.ip.includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          h.vendor.toLowerCase().includes(q) ||
          h.os_guess.toLowerCase().includes(q)
      );
    }

    // Filtre par type
    switch (filter) {
      case "remote":
        result = result.filter((h) => h.remote_protocols.length > 0);
        break;
      case "ssh":
        result = result.filter((h) => h.has_ssh);
        break;
      case "vnc":
        result = result.filter((h) => h.has_vnc);
        break;
      case "rdp":
        result = result.filter((h) => h.has_rdp);
        break;
      case "http":
        result = result.filter((h) => h.has_http);
        break;
      case "gateway":
        result = result.filter((h) => h.is_gateway);
        break;
    }

    // Tri
    switch (sortBy) {
      case "ip":
        result.sort((a, b) => {
          const aParts = a.ip.split(".").map(Number);
          const bParts = b.ip.split(".").map(Number);
          for (let i = 0; i < 4; i++) {
            if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
          }
          return 0;
        });
        break;
      case "hostname":
        result.sort((a, b) => a.hostname.localeCompare(b.hostname));
        break;
      case "latency":
        result.sort((a, b) => a.latency_ms - b.latency_ms);
        break;
      case "services":
        result.sort((a, b) => b.services.length - a.services.length);
        break;
    }

    return result;
  }, [hosts, searchQuery, filter, sortBy]);

  // =========================================================================
  // Statistiques
  // =========================================================================

  const stats = React.useMemo(() => {
    const total = hosts.length;
    const withSSH = hosts.filter((h) => h.has_ssh).length;
    const withVNC = hosts.filter((h) => h.has_vnc).length;
    const withRDP = hosts.filter((h) => h.has_rdp).length;
    const withHTTP = hosts.filter((h) => h.has_http).length;
    const gateways = hosts.filter((h) => h.is_gateway).length;
    const avgLatency =
      hosts.length > 0
        ? Math.round(hosts.reduce((a, h) => a + h.latency_ms, 0) / hosts.length)
        : 0;

    return { total, withSSH, withVNC, withRDP, withHTTP, gateways, avgLatency };
  }, [hosts]);

  // =========================================================================
  // Render Helpers
  // =========================================================================

  const getServiceIcon = (service: string) => {
    switch (service) {
      case "ssh":
        return <Terminal size={12} />;
      case "vnc":
        return <Monitor size={12} />;
      case "rdp":
        return <DesktopIcon size={12} />;
      case "smb":
        return <HardDrive size={12} />;
      case "http":
      case "https":
        return <Globe size={12} />;
      default:
        return <Zap size={12} />;
    }
  };

  const getProtocolColor = (protocol: string) => {
    switch (protocol) {
      case "ssh":
        return "#00ff64";
      case "vnc":
        return "#00F0FF";
      case "rdp":
        return "#D4AF37";
      case "smb":
        return "#ff66cc";
      case "http":
      case "https":
        return "#ff9900";
      default:
        return "#888";
    }
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 10) return "#00ff64";
    if (ms < 50) return "#00F0FF";
    if (ms < 100) return "#D4AF37";
    if (ms < 200) return "#ffa500";
    return "#ff4444";
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ================================================================== */}
      {/* HEADER DU MODULE RÉSEAU */}
      {/* ================================================================== */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{
          background: "rgba(10, 10, 20, 0.9)",
          borderColor: "rgba(212, 175, 55, 0.2)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: "rgba(212, 175, 55, 0.08)",
              border: "1px solid rgba(212, 175, 55, 0.25)",
            }}
          >
            <Satellite size={16} style={{ color: "#D4AF37" }} />
            <span className="text-sm font-bold" style={{ color: "#D4AF37" }}>
              Network Topology
            </span>
          </div>

          {/* Statut connexion */}
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <>
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: "#00ff64", boxShadow: "0 0 6px #00ff64" }}
                />
                <span className="text-xs" style={{ color: "#00ff64" }}>
                  Backend connecté
                </span>
              </>
            ) : (
              <>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: "#ff4444" }}
                />
                <span className="text-xs" style={{ color: "#ff4444" }}>
                  Déconnecté
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Bouton scan */}
          <button
            onClick={startScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:scale-105 disabled:opacity-50"
            style={{
              background: isScanning
                ? "rgba(255, 165, 0, 0.15)"
                : "linear-gradient(135deg, rgba(212, 175, 55, 0.2), rgba(0, 240, 255, 0.1))",
              border: `1px solid ${isScanning ? "rgba(255, 165, 0, 0.4)" : "rgba(212, 175, 55, 0.4)"}`,
              color: isScanning ? "#ffa500" : "#D4AF37",
              boxShadow: "0 0 15px rgba(212, 175, 55, 0.1)",
            }}
          >
            {isScanning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scan en cours...
              </>
            ) : (
              <>
                <Radar size={14} />
                Scanner le réseau
              </>
            )}
          </button>

          {/* Config scan */}
          <button
            onClick={() => setShowScanConfig(!showScanConfig)}
            className="p-2 rounded-lg transition-all hover:scale-110"
            style={{
              background: showScanConfig ? "rgba(212, 175, 55, 0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${showScanConfig ? "rgba(212, 175, 55, 0.3)" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            <Settings size={14} style={{ color: "#D4AF37" }} />
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* CONFIGURATION SCAN (Dropdown) */}
      {/* ================================================================== */}
      {showScanConfig && (
        <div
          className="px-5 py-3 border-b flex items-center gap-4 flex-shrink-0"
          style={{
            background: "rgba(15, 15, 30, 0.9)",
            borderColor: "rgba(212, 175, 55, 0.1)",
          }}
        >
          <label className="text-xs" style={{ color: "#888" }}>
            Sous-réseau :
          </label>
          <input
            type="text"
            value={subnetInput}
            onChange={(e) => setSubnetInput(e.target.value)}
            placeholder="192.168.1.0/24 (auto si vide)"
            className="px-3 py-1.5 rounded-md text-xs font-mono flex-1 max-w-xs"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
              color: "#00F0FF",
              outline: "none",
            }}
          />
          <label className="text-xs" style={{ color: "#888" }}>
            API :
          </label>
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            className="px-3 py-1.5 rounded-md text-xs font-mono w-48"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
              color: "#00F0FF",
              outline: "none",
            }}
          />
        </div>
      )}

      {/* ================================================================== */}
      {/* BARRE DE PROGRESSION SCAN */}
      {/* ================================================================== */}
      {isScanning && (
        <div className="px-5 py-2 flex-shrink-0" style={{ background: "rgba(10, 10, 20, 0.8)" }}>
          <div className="flex items-center gap-3 mb-1">
            <Radar size={12} className="animate-spin" style={{ color: "#00F0FF" }} />
            <span className="text-xs" style={{ color: "#00F0FF" }}>
              Balayage du sous-réseau en cours...
            </span>
            <span className="text-xs font-mono ml-auto" style={{ color: "#D4AF37" }}>
              {scanProgress}%
            </span>
          </div>
          <div
            className="w-full h-1 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${scanProgress}%`,
                background: "linear-gradient(90deg, #D4AF37, #00F0FF)",
                boxShadow: "0 0 10px rgba(0, 240, 255, 0.5)",
              }}
            />
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STATISTIQUES & FILTRES */}
      {/* ================================================================== */}
      <div
        className="px-5 py-3 border-b flex items-center gap-4 flex-wrap flex-shrink-0"
        style={{
          background: "rgba(10, 10, 20, 0.7)",
          borderColor: "rgba(212, 175, 55, 0.1)",
        }}
      >
        {/* Stats rapides */}
        <div className="flex items-center gap-3">
          <StatBadge icon={<Server size={12} />} label="Hôtes" value={stats.total} color="#D4AF37" />
          <StatBadge icon={<Terminal size={12} />} label="SSH" value={stats.withSSH} color="#00ff64" />
          <StatBadge icon={<Monitor size={12} />} label="VNC" value={stats.withVNC} color="#00F0FF" />
          <StatBadge icon={<DesktopIcon size={12} />} label="RDP" value={stats.withRDP} color="#D4AF37" />
          <StatBadge icon={<Globe size={12} />} label="HTTP" value={stats.withHTTP} color="#ff9900" />
          <StatBadge icon={<Activity size={12} />} label="Latence" value={`${stats.avgLatency}ms`} color="#00F0FF" />
        </div>

        <div className="flex-1" />

        {/* Recherche */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#666" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="pl-7 pr-3 py-1.5 rounded-md text-xs w-40"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#ddd",
              outline: "none",
            }}
          />
        </div>

        {/* Filtre */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterType)}
          className="px-2 py-1.5 rounded-md text-xs"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(212, 175, 55, 0.2)",
            color: "#D4AF37",
            outline: "none",
          }}
        >
          <option value="all">Tous</option>
          <option value="remote">Contrôle distant</option>
          <option value="ssh">SSH</option>
          <option value="vnc">VNC</option>
          <option value="rdp">RDP</option>
          <option value="http">HTTP</option>
          <option value="gateway">Passerelles</option>
        </select>

        {/* Tri */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortType)}
          className="px-2 py-1.5 rounded-md text-xs"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(212, 175, 55, 0.2)",
            color: "#D4AF37",
            outline: "none",
          }}
        >
          <option value="ip">Tri: IP</option>
          <option value="hostname">Tri: Nom</option>
          <option value="latency">Tri: Latence</option>
          <option value="services">Tri: Services</option>
        </select>

        {/* Vue */}
        <div className="flex gap-1">
          {(["grid", "list", "topology"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="p-1.5 rounded-md transition-all"
              style={{
                background: viewMode === mode ? "rgba(212, 175, 55, 0.15)" : "transparent",
                border: `1px solid ${viewMode === mode ? "rgba(212, 175, 55, 0.3)" : "transparent"}`,
              }}
            >
              {mode === "grid" ? <Layers size={12} style={{ color: viewMode === mode ? "#D4AF37" : "#666" }} /> :
               mode === "list" ? <Filter size={12} style={{ color: viewMode === mode ? "#D4AF37" : "#666" }} /> :
               <Network size={12} style={{ color: viewMode === mode ? "#D4AF37" : "#666" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================== */}
      {/* CONTENU PRINCIPAL */}
      {/* ================================================================== */}
      <div className="flex-1 overflow-hidden flex">
        {/* Liste des hôtes */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredHosts.length === 0 ? (
            <EmptyState isScanning={isScanning} onStartScan={startScan} />
          ) : viewMode === "grid" ? (
            <GridView
              hosts={filteredHosts}
              selectedHost={selectedHost}
              relayActive={relayActive}
              onSelect={selectTarget}
              onRelay={startRelay}
              onDetail={scanSingleHost}
              getServiceIcon={getServiceIcon}
              getProtocolColor={getProtocolColor}
              getLatencyColor={getLatencyColor}
            />
          ) : viewMode === "list" ? (
            <ListView
              hosts={filteredHosts}
              selectedHost={selectedHost}
              relayActive={relayActive}
              onSelect={selectTarget}
              onRelay={startRelay}
              onDetail={scanSingleHost}
              getServiceIcon={getServiceIcon}
              getProtocolColor={getProtocolColor}
              getLatencyColor={getLatencyColor}
            />
          ) : (
            <TopologyView
              hosts={filteredHosts}
              selectedHost={selectedHost}
              onSelect={selectTarget}
              onRelay={startRelay}
              getLatencyColor={getLatencyColor}
            />
          )}
        </div>

        {/* Panneau de détail hôte */}
        {selectedHostDetail && (
          <HostDetailPanel
            host={selectedHostDetail}
            relayActive={relayActive && selectedHost?.ip === selectedHostDetail.ip}
            relayProtocol={relayProtocol}
            onClose={() => setSelectedHostDetail(null)}
            onRelay={startRelay}
            getServiceIcon={getServiceIcon}
            getProtocolColor={getProtocolColor}
          />
        )}
      </div>

      {/* ================================================================== */}
      {/* BARRE INFÉRIEURE - CIBLE SÉLECTIONNÉE */}
      {/* ================================================================== */}
      {selectedHost && (
        <div
          className="flex items-center justify-between px-5 py-2.5 border-t flex-shrink-0"
          style={{
            background: "rgba(10, 10, 20, 0.95)",
            borderColor: "rgba(212, 175, 55, 0.3)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: relayActive ? "rgba(0, 255, 100, 0.1)" : "rgba(212, 175, 55, 0.1)",
                border: `1px solid ${relayActive ? "rgba(0, 255, 100, 0.3)" : "rgba(212, 175, 55, 0.3)"}`,
              }}
            >
              <Monitor size={16} style={{ color: relayActive ? "#00ff64" : "#D4AF37" }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#D4AF37" }}>
                {selectedHost.hostname || selectedHost.ip}
              </p>
              <p className="text-xs" style={{ color: "#888" }}>
                {selectedHost.ip} • {selectedHost.os_guess || "OS inconnu"} •{" "}
                {selectedHost.remote_protocols.join(", ") || "Aucun protocole distant"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {relayActive ? (
              <button
                onClick={stopRelay}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                style={{
                  background: "rgba(255, 50, 50, 0.15)",
                  border: "1px solid rgba(255, 50, 50, 0.4)",
                  color: "#ff4444",
                }}
              >
                <Square size={12} />
                Arrêter le relay
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                {selectedHost.has_vnc && (
                  <button
                    onClick={() => startRelay(selectedHost, "vnc")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                    style={{
                      background: "rgba(0, 240, 255, 0.1)",
                      border: "1px solid rgba(0, 240, 255, 0.3)",
                      color: "#00F0FF",
                    }}
                  >
                    <Monitor size={12} />
                    VNC
                  </button>
                )}
                {selectedHost.has_rdp && (
                  <button
                    onClick={() => startRelay(selectedHost, "rdp")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                    style={{
                      background: "rgba(212, 175, 55, 0.1)",
                      border: "1px solid rgba(212, 175, 55, 0.3)",
                      color: "#D4AF37",
                    }}
                  >
                    <DesktopIcon size={12} />
                    RDP
                  </button>
                )}
                {selectedHost.has_ssh && (
                  <button
                    onClick={() => startRelay(selectedHost, "ssh")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                    style={{
                      background: "rgba(0, 255, 100, 0.1)",
                      border: "1px solid rgba(0, 255, 100, 0.3)",
                      color: "#00ff64",
                    }}
                  >
                    <Terminal size={12} />
                    SSH
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// Composants auxiliaires
// ===========================================================================

// --- Icône Desktop personnalisée ---
const DesktopIcon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }> = ({
  size = 16,
  className,
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// --- StatBadge ---
const StatBadge: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}> = ({ icon, label, value, color }) => (
  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.03)" }}>
    <span style={{ color }}>{icon}</span>
    <span className="text-[10px]" style={{ color: "#666" }}>
      {label}
    </span>
    <span className="text-xs font-bold font-mono" style={{ color }}>
      {value}
    </span>
  </div>
);

// --- EmptyState ---
const EmptyState: React.FC<{ isScanning: boolean; onStartScan: () => void }> = ({
  isScanning,
  onStartScan,
}) => (
  <div className="flex flex-col items-center justify-center h-full gap-4">
    <div
      className="w-24 h-24 rounded-full flex items-center justify-center"
      style={{
        background: "rgba(212, 175, 55, 0.05)",
        border: "2px solid rgba(212, 175, 55, 0.15)",
        boxShadow: "0 0 40px rgba(212, 175, 55, 0.05)",
      }}
    >
      <Radar size={40} style={{ color: "#D4AF37" }} className={isScanning ? "animate-spin" : ""} />
    </div>
    <div className="text-center">
      <p className="text-lg font-semibold mb-1" style={{ color: "#D4AF37" }}>
        {isScanning ? "Balayage en cours..." : "Aucun hôte découvert"}
      </p>
      <p className="text-sm" style={{ color: "#666" }}>
        {isScanning
          ? "Le scanner recherche les machines actives sur le réseau"
          : "Lancez un scan pour découvrir les ordinateurs du réseau local"}
      </p>
    </div>
    {!isScanning && (
      <button
        onClick={onStartScan}
        className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, rgba(212, 175, 55, 0.15), rgba(0, 240, 255, 0.08))",
          border: "1px solid rgba(212, 175, 55, 0.4)",
          color: "#D4AF37",
          boxShadow: "0 0 20px rgba(212, 175, 55, 0.1)",
        }}
      >
        <Radar size={16} />
        Lancer le scan réseau
      </button>
    )}
  </div>
);

// --- GridView ---
const GridView: React.FC<{
  hosts: DiscoveredHost[];
  selectedHost: DiscoveredHost | null;
  relayActive: boolean;
  onSelect: (host: DiscoveredHost) => void;
  onRelay: (host: DiscoveredHost, protocol: string) => void;
  onDetail: (ip: string) => void;
  getServiceIcon: (service: string) => React.ReactNode;
  getProtocolColor: (protocol: string) => string;
  getLatencyColor: (ms: number) => string;
}> = ({ hosts, selectedHost, relayActive, onSelect, onRelay, onDetail, getServiceIcon, getProtocolColor, getLatencyColor }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
    {hosts.map((host) => {
      const isSelected = selectedHost?.ip === host.ip;
      const isRelaying = relayActive && isSelected;

      return (
        <div
          key={host.ip}
          onClick={() => onSelect(host)}
          className="p-4 rounded-xl cursor-pointer transition-all hover:scale-[1.02] group"
          style={{
            background: isSelected
              ? "rgba(212, 175, 55, 0.08)"
              : "rgba(15, 15, 30, 0.7)",
            border: `1px solid ${
              isRelaying
                ? "rgba(0, 255, 100, 0.4)"
                : isSelected
                ? "rgba(212, 175, 55, 0.4)"
                : "rgba(255,255,255,0.08)"
            }`,
            backdropFilter: "blur(10px)",
            boxShadow: isRelaying
              ? "0 0 20px rgba(0, 255, 100, 0.1)"
              : isSelected
              ? "0 0 15px rgba(212, 175, 55, 0.08)"
              : "none",
          }}
        >
          {/* Header de la carte */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: "#00ff64",
                  boxShadow: "0 0 6px #00ff64",
                }}
              />
              <span className="text-sm font-bold font-mono" style={{ color: "#ddd" }}>
                {host.hostname || host.ip}
              </span>
            </div>
            {host.is_gateway && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                style={{
                  background: "rgba(255, 165, 0, 0.15)",
                  color: "#ffa500",
                  border: "1px solid rgba(255, 165, 0, 0.3)",
                }}
              >
                GW
              </span>
            )}
          </div>

          {/* IP & OS */}
          <div className="mb-3">
            <p className="text-xs font-mono" style={{ color: "#00F0FF" }}>
              {host.ip}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#666" }}>
              {host.os_guess || "OS inconnu"}
            </p>
          </div>

          {/* Latence */}
          <div className="flex items-center gap-1.5 mb-3">
            <Activity size={10} style={{ color: getLatencyColor(host.latency_ms) }} />
            <span className="text-xs font-mono" style={{ color: getLatencyColor(host.latency_ms) }}>
              {host.latency_ms.toFixed(1)}ms
            </span>
          </div>

          {/* Services */}
          <div className="flex flex-wrap gap-1 mb-3">
            {host.services.slice(0, 5).map((service) => (
              <span
                key={service}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  background: `${getProtocolColor(service)}15`,
                  color: getProtocolColor(service),
                  border: `1px solid ${getProtocolColor(service)}30`,
                }}
              >
                {getServiceIcon(service)}
                {service.toUpperCase()}
              </span>
            ))}
            {host.services.length > 5 && (
              <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ color: "#666" }}>
                +{host.services.length - 5}
              </span>
            )}
          </div>

          {/* Protocoles distants */}
          {host.remote_protocols.length > 0 && (
            <div className="flex items-center gap-1 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <span className="text-[10px]" style={{ color: "#888" }}>Contrôle:</span>
              {host.remote_protocols.map((proto) => (
                <button
                  key={proto}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRelay(host, proto);
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all hover:scale-110"
                  style={{
                    background: `${getProtocolColor(proto)}20`,
                    color: getProtocolColor(proto),
                    border: `1px solid ${getProtocolColor(proto)}40`,
                  }}
                >
                  {proto.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* Vendor */}
          {host.vendor && host.vendor !== "Unknown" && (
            <p className="text-[10px] mt-2" style={{ color: "#555" }}>
              {host.vendor}
            </p>
          )}
        </div>
      );
    })}
  </div>
);

// --- ListView ---
const ListView: React.FC<{
  hosts: DiscoveredHost[];
  selectedHost: DiscoveredHost | null;
  relayActive: boolean;
  onSelect: (host: DiscoveredHost) => void;
  onRelay: (host: DiscoveredHost, protocol: string) => void;
  onDetail: (ip: string) => void;
  getServiceIcon: (service: string) => React.ReactNode;
  getProtocolColor: (protocol: string) => string;
  getLatencyColor: (ms: number) => string;
}> = ({ hosts, selectedHost, relayActive, onSelect, onRelay, onDetail, getServiceIcon, getProtocolColor, getLatencyColor }) => (
  <div className="space-y-1">
    {/* Header */}
    <div
      className="grid grid-cols-12 gap-2 px-4 py-2 rounded-lg text-xs font-semibold"
      style={{ color: "#888" }}
    >
      <div className="col-span-1">Statut</div>
      <div className="col-span-2">Hôte</div>
      <div className="col-span-2">IP</div>
      <div className="col-span-2">OS</div>
      <div className="col-span-2">Services</div>
      <div className="col-span-1">Latence</div>
      <div className="col-span-2">Actions</div>
    </div>

    {hosts.map((host) => {
      const isSelected = selectedHost?.ip === host.ip;

      return (
        <div
          key={host.ip}
          onClick={() => onSelect(host)}
          className="grid grid-cols-12 gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-all items-center"
          style={{
            background: isSelected ? "rgba(212, 175, 55, 0.06)" : "rgba(15, 15, 30, 0.5)",
            border: `1px solid ${isSelected ? "rgba(212, 175, 55, 0.2)" : "transparent"}`,
          }}
        >
          <div className="col-span-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: "#00ff64", boxShadow: "0 0 4px #00ff64" }}
            />
          </div>
          <div className="col-span-2">
            <p className="text-xs font-mono font-semibold truncate" style={{ color: "#ddd" }}>
              {host.hostname || "—"}
            </p>
            {host.vendor && host.vendor !== "Unknown" && (
              <p className="text-[10px] truncate" style={{ color: "#555" }}>{host.vendor}</p>
            )}
          </div>
          <div className="col-span-2">
            <p className="text-xs font-mono" style={{ color: "#00F0FF" }}>{host.ip}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs truncate" style={{ color: "#aaa" }}>{host.os_guess || "—"}</p>
          </div>
          <div className="col-span-2 flex flex-wrap gap-0.5">
            {host.services.slice(0, 3).map((s) => (
              <span
                key={s}
                className="px-1 py-0.5 rounded text-[9px] font-bold"
                style={{
                  background: `${getProtocolColor(s)}15`,
                  color: getProtocolColor(s),
                }}
              >
                {s.toUpperCase()}
              </span>
            ))}
          </div>
          <div className="col-span-1">
            <span className="text-xs font-mono" style={{ color: getLatencyColor(host.latency_ms) }}>
              {host.latency_ms.toFixed(0)}ms
            </span>
          </div>
          <div className="col-span-2 flex gap-1">
            {host.remote_protocols.map((proto) => (
              <button
                key={proto}
                onClick={(e) => {
                  e.stopPropagation();
                  onRelay(host, proto);
                }}
                className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105"
                style={{
                  background: `${getProtocolColor(proto)}15`,
                  color: getProtocolColor(proto),
                  border: `1px solid ${getProtocolColor(proto)}30`,
                }}
              >
                {proto.toUpperCase()}
              </button>
            ))}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDetail(host.ip);
              }}
              className="px-2 py-1 rounded text-[10px] transition-all hover:scale-105"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "#888",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <Eye size={10} />
            </button>
          </div>
        </div>
      );
    })}
  </div>
);

// --- TopologyView (Vue réseau simplifiée) ---
const TopologyView: React.FC<{
  hosts: DiscoveredHost[];
  selectedHost: DiscoveredHost | null;
  onSelect: (host: DiscoveredHost) => void;
  onRelay: (host: DiscoveredHost, protocol: string) => void;
  getLatencyColor: (ms: number) => string;
}> = ({ hosts, selectedHost, onSelect, onRelay, getLatencyColor }) => {
  const gateways = hosts.filter((h) => h.is_gateway);
  const others = hosts.filter((h) => !h.is_gateway);

  return (
    <div className="relative h-full min-h-[500px]">
      {/* Lignes de connexion SVG */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
        {others.map((host, i) => {
          const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2;
          const radius = 200;
          const cx = 50;
          const cy = 50;
          const x = cx + Math.cos(angle) * 35;
          const y = cy + Math.sin(angle) * 35;
          return (
            <line
              key={host.ip}
              x1={`${cx}%`}
              y1={`${cy}%`}
              x2={`${x}%`}
              y2={`${y}%`}
              stroke="rgba(212, 175, 55, 0.15)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          );
        })}
      </svg>

      {/* Centre - Passerelle */}
      {gateways.length > 0 && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
            onClick={() => onSelect(gateways[0])}
            style={{
              background: "rgba(255, 165, 0, 0.1)",
              border: "2px solid rgba(255, 165, 0, 0.4)",
              boxShadow: "0 0 20px rgba(255, 165, 0, 0.2)",
            }}
          >
            <Globe size={24} style={{ color: "#ffa500" }} />
          </div>
          <p className="text-center text-[10px] mt-1" style={{ color: "#ffa500" }}>
            {gateways[0].hostname || "Gateway"}
          </p>
        </div>
      )}

      {/* Hôtes en cercle */}
      {others.map((host, i) => {
        const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2;
        const radius = 38;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius;
        const isSelected = selectedHost?.ip === host.ip;

        return (
          <div
            key={host.ip}
            className="absolute z-10 cursor-pointer transition-all hover:scale-110"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
            }}
            onClick={() => onSelect(host)}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: isSelected ? "rgba(212, 175, 55, 0.15)" : "rgba(15, 15, 30, 0.8)",
                border: `2px solid ${isSelected ? "rgba(212, 175, 55, 0.5)" : "rgba(255,255,255,0.1)"}`,
                boxShadow: isSelected ? "0 0 15px rgba(212, 175, 55, 0.2)" : "none",
              }}
            >
              <Server size={18} style={{ color: isSelected ? "#D4AF37" : "#888" }} />
            </div>
            <p className="text-center text-[9px] font-mono mt-1 whitespace-nowrap" style={{ color: "#aaa" }}>
              {host.ip.split(".").slice(-1)[0]}
            </p>
            {/* Indicateur protocoles */}
            {host.remote_protocols.length > 0 && (
              <div className="flex justify-center gap-0.5 mt-0.5">
                {host.remote_protocols.map((p) => (
                  <div
                    key={p}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: p === "ssh" ? "#00ff64" : p === "vnc" ? "#00F0FF" : "#D4AF37",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// --- HostDetailPanel ---
const HostDetailPanel: React.FC<{
  host: DiscoveredHost;
  relayActive: boolean;
  relayProtocol: string;
  onClose: () => void;
  onRelay: (host: DiscoveredHost, protocol: string) => void;
  getServiceIcon: (service: string) => React.ReactNode;
  getProtocolColor: (protocol: string) => string;
}> = ({ host, relayActive, relayProtocol, onClose, onRelay, getServiceIcon, getProtocolColor }) => (
  <div
    className="w-80 border-l overflow-y-auto flex-shrink-0"
    style={{
      background: "rgba(8, 8, 18, 0.95)",
      borderColor: "rgba(212, 175, 55, 0.2)",
      backdropFilter: "blur(20px)",
    }}
  >
    {/* Header */}
    <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(212, 175, 55, 0.1)" }}>
      <h3 className="text-sm font-bold" style={{ color: "#D4AF37" }}>
        Détails de l'hôte
      </h3>
      <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
        <X size={14} style={{ color: "#888" }} />
      </button>
    </div>

    <div className="p-4 space-y-4">
      {/* Infos principales */}
      <div className="space-y-2">
        <InfoRow label="IP" value={host.ip} color="#00F0FF" />
        <InfoRow label="Hostname" value={host.hostname || "—"} color="#ddd" />
        <InfoRow label="MAC" value={host.mac || "—"} color="#aaa" />
        <InfoRow label="Vendor" value={host.vendor || "—"} color="#aaa" />
        <InfoRow label="OS" value={host.os_guess || "—"} color="#D4AF37" />
        <InfoRow label="Latence" value={`${host.latency_ms.toFixed(1)}ms`} color="#00F0FF" />
        <InfoRow label="Gateway" value={host.is_gateway ? "Oui" : "Non"} color={host.is_gateway ? "#ffa500" : "#666"} />
      </div>

      {/* Ports ouverts */}
      <div>
        <h4 className="text-xs font-semibold mb-2" style={{ color: "#D4AF37" }}>
          Ports ouverts ({host.open_ports.length})
        </h4>
        <div className="space-y-1">
          {host.open_ports.map((port) => (
            <div
              key={port.port}
              className="flex items-center justify-between px-2 py-1.5 rounded-md"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold" style={{ color: getProtocolColor(port.service) }}>
                  {port.port}
                </span>
                <span className="flex items-center gap-1 text-xs" style={{ color: getProtocolColor(port.service) }}>
                  {getServiceIcon(port.service)}
                  {port.service.toUpperCase()}
                </span>
              </div>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                style={{
                  background: "rgba(0, 255, 100, 0.1)",
                  color: "#00ff64",
                }}
              >
                OPEN
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bannières */}
      {host.open_ports.some((p) => p.banner) && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: "#D4AF37" }}>
            Bannières de service
          </h4>
          <div className="space-y-1">
            {host.open_ports
              .filter((p) => p.banner)
              .map((port) => (
                <div key={port.port} className="px-2 py-1.5 rounded-md" style={{ background: "rgba(0, 0, 0, 0.3)" }}>
                  <p className="text-[10px] font-mono" style={{ color: "#00F0FF" }}>
                    [{port.port}] {port.banner.slice(0, 80)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Actions de contrôle */}
      {host.remote_protocols.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: "#D4AF37" }}>
            Prise de contrôle
          </h4>
          <div className="space-y-1.5">
            {host.remote_protocols.map((proto) => (
              <button
                key={proto}
                onClick={() => onRelay(host, proto)}
                disabled={relayActive}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] disabled:opacity-50"
                style={{
                  background: `${getProtocolColor(proto)}10`,
                  border: `1px solid ${getProtocolColor(proto)}30`,
                  color: getProtocolColor(proto),
                }}
              >
                <span className="flex items-center gap-2">
                  {proto === "ssh" ? <Terminal size={14} /> : proto === "vnc" ? <Monitor size={14} /> : <DesktopIcon size={14} />}
                  {proto.toUpperCase()}
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
);

// --- InfoRow helper ---
const InfoRow: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div className="flex justify-between items-center">
    <span className="text-xs" style={{ color: "#666" }}>
      {label}
    </span>
    <span className="text-xs font-mono truncate ml-2 max-w-[160px]" style={{ color }}>
      {value}
    </span>
  </div>
);

export default NetworkTopology;
