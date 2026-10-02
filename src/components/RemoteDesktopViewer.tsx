/**
 * =============================================================================
 * ATIBON - Module de Prise de Contrôle à Distance (Frontend)
 * =============================================================================
 * Composant RemoteDesktopViewer avec :
 *   - Visualisation temps réel via Canvas (flux JPEG base64)
 *   - Communication WebSocket (Socket.IO)
 *   - Capture des interactions souris/clavier
 *   - Barre d'outils de contrôle
 *   - Design Glassmorphism (thème sombre, bordures dorées #D4AF37, lueurs cyan #00F0FF)
 * =============================================================================
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { io, Socket } from "socket.io-client";
import {
  Monitor,
  MousePointer2,
  Keyboard,
  Lock,
  Unlock,
  Play,
  Square,
  Settings,
  Wifi,
  WifiOff,
  Maximize2,
  Minimize2,
  Camera,
  RefreshCw,
  Shield,
  ShieldOff,
  Volume2,
  Copy,
  Send,
  ChevronDown,
  Activity,
  Clock,
  Cpu,
  HardDrive,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------
interface SessionInfo {
  streaming: boolean;
  locked: boolean;
  fps: number;
  quality: number;
  resolution: [number, number];
  interactiveMode: boolean;
  connectedClients: number;
  frameCount: number;
  uptimeSeconds: number;
}

interface FrameData {
  image: string;
  timestamp: number;
  frame_number: number;
  resolution: [number, number];
}

interface ConnectionConfig {
  host: string;
  port: number;
  namespace: string;
}

type InputMode = "mouse" | "keyboard" | "both";
type ResolutionPreset = "640x480" | "800x600" | "1024x768" | "1280x720" | "1920x1080";

// ---------------------------------------------------------------------------
// Composant Principal
// ---------------------------------------------------------------------------
const RemoteDesktopViewer: React.FC = () => {
  // --- État de connexion ---
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // --- État des paramètres ---
  const [fps, setFps] = useState(15);
  const [quality, setQuality] = useState(60);
  const [resolution, setResolution] = useState<ResolutionPreset>("1280x720");
  const [inputMode, setInputMode] = useState<InputMode>("both");
  const [interactiveMode, setInteractiveMode] = useState(true);

  // --- État de l'interface ---
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [latency, setLatency] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState(0);
  const [showClipboardPanel, setShowClipboardPanel] = useState(false);
  const [clipboardText, setClipboardText] = useState("");

  // --- Configuration ---
  const [config, setConfig] = useState<ConnectionConfig>({
    host: "localhost",
    port: 5000,
    namespace: "/remote-desktop",
  });

  // --- Refs ---
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameTimestampRef = useRef<number>(0);
  const animationRef = useRef<number>(0);
  const mouseThrottleRef = useRef<number>(0);

  // --- Résolution en pixels ---
  const resolutionPixels = useMemo((): [number, number] => {
    const [w, h] = resolution.split("x").map(Number);
    return [w, h];
  }, [resolution]);

  // =========================================================================
  // WebSocket Connection
  // =========================================================================
  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      disconnect();
      return;
    }

    setConnectionError(null);

    const url = `http://${config.host}:${config.port}`;
    const socket = io(url, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
      console.log("[ATIBON] Connecté au serveur Remote Desktop");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setIsStreaming(false);
      console.log("[ATIBON] Déconnecté du serveur");
    });

    socket.on("connect_error", (error: Error) => {
      setConnectionError(`Erreur de connexion: ${error.message}`);
      setIsConnected(false);
    });

    socket.on("connected", (data: Record<string, unknown>) => {
      console.log("[ATIBON] Session info:", data);
    });

    socket.on("frame", (data: FrameData) => {
      const now = performance.now();
      setLatency(now - frameTimestampRef.current);
      frameTimestampRef.current = now;

      setCurrentFrame(data.image);
      setFrameCount(data.frame_number);
      setLastFrameTime(Date.now());
    });

    socket.on("stream_started", (data: Record<string, unknown>) => {
      setIsStreaming(true);
      console.log("[ATIBON] Streaming démarré:", data);
    });

    socket.on("stream_stopped", () => {
      setIsStreaming(false);
      setCurrentFrame(null);
      console.log("[ATIBON] Streaming arrêté");
    });

    socket.on("settings_updated", (data: Record<string, number>) => {
      if (data.fps) setFps(data.fps);
      if (data.quality) setQuality(data.quality);
      console.log("[ATIBON] Paramètres mis à jour:", data);
    });

    socketRef.current = socket;
  }, [config]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsStreaming(false);
    setCurrentFrame(null);
  }, []);

  // =========================================================================
  // Streaming Control
  // =========================================================================
  const startStream = useCallback(() => {
    if (!socketRef.current?.connected) return;

    socketRef.current.emit("start_stream", {
      fps,
      quality,
      resolution: resolutionPixels,
    });
    setIsStreaming(true);
  }, [fps, quality, resolutionPixels]);

  const stopStream = useCallback(() => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit("stop_stream");
    setIsStreaming(false);
    setCurrentFrame(null);
  }, []);

  const toggleLock = useCallback(() => {
    if (!socketRef.current?.connected) return;
    const newLockState = !isLocked;
    setIsLocked(newLockState);
    socketRef.current.emit("update_settings", {
      interactive_mode: !newLockState,
    });
  }, [isLocked]);

  // =========================================================================
  // Canvas Rendering
  // =========================================================================
  useEffect(() => {
    if (!currentFrame || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${currentFrame}`;
  }, [currentFrame]);

  // =========================================================================
  // Input Handlers - Mouse
  // =========================================================================
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isStreaming || !interactiveMode || inputMode === "keyboard") return;
      if (!socketRef.current?.connected) return;

      // Throttle à ~60Hz
      const now = Date.now();
      if (now - mouseThrottleRef.current < 16) return;
      mouseThrottleRef.current = now;

      const { x, y } = getCanvasCoordinates(e);
      socketRef.current.emit("mouse_move", {
        x,
        y,
        canvas_width: canvasRef.current?.width || resolutionPixels[0],
        canvas_height: canvasRef.current?.height || resolutionPixels[1],
      });
    },
    [isStreaming, interactiveMode, inputMode, getCanvasCoordinates, resolutionPixels]
  );

  const handleMouseClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isStreaming || !interactiveMode || inputMode === "keyboard") return;
      if (!socketRef.current?.connected) return;

      const { x, y } = getCanvasCoordinates(e);
      const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";

      socketRef.current.emit("mouse_click", {
        x,
        y,
        button,
        type: "click",
        canvas_width: canvasRef.current?.width || resolutionPixels[0],
        canvas_height: canvasRef.current?.height || resolutionPixels[1],
      });
    },
    [isStreaming, interactiveMode, inputMode, getCanvasCoordinates, resolutionPixels]
  );

  const handleMouseDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isStreaming || !interactiveMode || inputMode === "keyboard") return;
      if (!socketRef.current?.connected) return;

      const { x, y } = getCanvasCoordinates(e);
      socketRef.current.emit("mouse_click", {
        x,
        y,
        button: "left",
        type: "dblclick",
        canvas_width: canvasRef.current?.width || resolutionPixels[0],
        canvas_height: canvasRef.current?.height || resolutionPixels[1],
      });
    },
    [isStreaming, interactiveMode, inputMode, getCanvasCoordinates, resolutionPixels]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isStreaming || !interactiveMode || inputMode === "keyboard") return;
      if (!socketRef.current?.connected) return;

      const { x, y } = getCanvasCoordinates(e);
      socketRef.current.emit("mouse_click", {
        x,
        y,
        button: "right",
        type: "click",
        canvas_width: canvasRef.current?.width || resolutionPixels[0],
        canvas_height: canvasRef.current?.height || resolutionPixels[1],
      });
    },
    [isStreaming, interactiveMode, inputMode, getCanvasCoordinates, resolutionPixels]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!isStreaming || !interactiveMode || inputMode === "keyboard") return;
      if (!socketRef.current?.connected) return;

      const direction = e.deltaY < 0 ? "up" : "down";
      const amount = Math.abs(Math.round(e.deltaY / 100));

      socketRef.current.emit("mouse_scroll", { direction, amount });
    },
    [isStreaming, interactiveMode, inputMode]
  );

  // =========================================================================
  // Input Handlers - Keyboard
  // =========================================================================
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isStreaming || !interactiveMode || inputMode === "mouse") return;
      if (!socketRef.current?.connected) return;

      e.preventDefault();

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("ctrl");
      if (e.shiftKey) modifiers.push("shift");
      if (e.altKey) modifiers.push("alt");

      // Mapping des touches spéciales
      const keyMap: Record<string, string> = {
        Escape: "esc",
        Enter: "enter",
        Backspace: "backspace",
        Tab: "tab",
        " ": "space",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Delete: "delete",
        Home: "home",
        End: "end",
        PageUp: "pageup",
        PageDown: "pagedown",
        F1: "f1", F2: "f2", F3: "f3", F4: "f4",
        F5: "f5", F6: "f6", F7: "f7", F8: "f8",
        F9: "f9", F10: "f10", F11: "f11", F12: "f12",
      };

      const key = keyMap[e.key] || e.key.toLowerCase();

      socketRef.current.emit("key_press", {
        key,
        modifiers,
        type: "press",
      });
    },
    [isStreaming, interactiveMode, inputMode]
  );

  // =========================================================================
  // Clipboard / Text Transfer
  // =========================================================================
  const sendClipboardText = useCallback(() => {
    if (!socketRef.current?.connected || !clipboardText) return;
    socketRef.current.emit("clipboard_text", {
      text: clipboardText,
      direction: "to_remote",
    });
    setClipboardText("");
  }, [clipboardText]);

  const sendKeyCombo = useCallback(
    (keys: string[]) => {
      if (!socketRef.current?.connected) return;
      socketRef.current.emit("key_combo", { keys });
    },
    []
  );

  // =========================================================================
  // Fullscreen
  // =========================================================================
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // =========================================================================
  // Cleanup
  // =========================================================================
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex flex-col overflow-hidden ${
        isFullscreen ? "bg-black" : ""
      }`}
      style={{ minHeight: isFullscreen ? "100vh" : "600px" }}
    >
      {/* ================================================================== */}
      {/* HEADER / BARRE DE STATUT */}
      {/* ================================================================== */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          background: "rgba(10, 10, 20, 0.85)",
          borderColor: "rgba(212, 175, 55, 0.3)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: "rgba(212, 175, 55, 0.1)",
              border: "1px solid rgba(212, 175, 55, 0.3)",
            }}
          >
            <Monitor size={16} style={{ color: "#D4AF37" }} />
            <span
              className="text-sm font-semibold tracking-wide"
              style={{ color: "#D4AF37" }}
            >
              ATIBON Remote Desktop
            </span>
          </div>

          {/* Indicateur de connexion */}
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <>
                <Wifi size={14} style={{ color: "#00F0FF" }} />
                <span className="text-xs" style={{ color: "#00F0FF" }}>
                  Connecté
                </span>
              </>
            ) : (
              <>
                <WifiOff size={14} style={{ color: "#ff4444" }} />
                <span className="text-xs" style={{ color: "#ff4444" }}>
                  Déconnecté
                </span>
              </>
            )}
          </div>
        </div>

        {/* Statistiques temps réel */}
        <div className="flex items-center gap-4">
          {isStreaming && (
            <>
              <div className="flex items-center gap-1.5">
                <Activity size={12} style={{ color: "#00F0FF" }} />
                <span className="text-xs font-mono" style={{ color: "#aaa" }}>
                  FPS: {fps}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Cpu size={12} style={{ color: "#00F0FF" }} />
                <span className="text-xs font-mono" style={{ color: "#aaa" }}>
                  Frame #{frameCount}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={12} style={{ color: "#00F0FF" }} />
                <span className="text-xs font-mono" style={{ color: "#aaa" }}>
                  {latency.toFixed(0)}ms
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive size={12} style={{ color: "#00F0FF" }} />
                <span className="text-xs font-mono" style={{ color: "#aaa" }}>
                  {resolution}
                </span>
              </div>
            </>
          )}

          {/* Bouton paramètres */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-md transition-all hover:scale-110"
            style={{
              background: showSettings
                ? "rgba(212, 175, 55, 0.2)"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${showSettings ? "rgba(212, 175, 55, 0.5)" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            <Settings size={14} style={{ color: "#D4AF37" }} />
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* PANNEAU DE CONFIGURATION (Dropdown) */}
      {/* ================================================================== */}
      {showSettings && (
        <div
          className="absolute top-12 right-4 z-50 p-4 rounded-xl shadow-2xl"
          style={{
            background: "rgba(10, 10, 25, 0.95)",
            border: "1px solid rgba(212, 175, 55, 0.4)",
            backdropFilter: "blur(30px)",
            boxShadow: "0 0 30px rgba(0, 240, 255, 0.1), 0 0 60px rgba(212, 175, 55, 0.05)",
            minWidth: "320px",
          }}
        >
          <h3
            className="text-sm font-bold mb-3 tracking-wide"
            style={{ color: "#D4AF37" }}
          >
            ⚙️ Configuration de la Session
          </h3>

          {/* Host & Port */}
          <div className="mb-3">
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>
              Serveur distant
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.host}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, host: e.target.value }))
                }
                className="flex-1 px-2 py-1.5 rounded-md text-xs font-mono"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(212, 175, 55, 0.3)",
                  color: "#00F0FF",
                  outline: "none",
                }}
                placeholder="localhost"
              />
              <input
                type="number"
                value={config.port}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    port: parseInt(e.target.value) || 5000,
                  }))
                }
                className="w-20 px-2 py-1.5 rounded-md text-xs font-mono"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(212, 175, 55, 0.3)",
                  color: "#00F0FF",
                  outline: "none",
                }}
                placeholder="5000"
              />
            </div>
          </div>

          {/* FPS */}
          <div className="mb-3">
            <label className="text-xs mb-1 flex justify-between" style={{ color: "#888" }}>
              <span>Images/seconde</span>
              <span style={{ color: "#00F0FF" }}>{fps}</span>
            </label>
            <input
              type="range"
              min="1"
              max="60"
              value={fps}
              onChange={(e) => setFps(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #D4AF37 ${(fps / 60) * 100}%, rgba(255,255,255,0.1) ${(fps / 60) * 100}%)`,
              }}
            />
          </div>

          {/* Qualité */}
          <div className="mb-3">
            <label className="text-xs mb-1 flex justify-between" style={{ color: "#888" }}>
              <span>Qualité JPEG</span>
              <span style={{ color: "#00F0FF" }}>{quality}%</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #00F0FF ${(quality / 100) * 100}%, rgba(255,255,255,0.1) ${(quality / 100) * 100}%)`,
              }}
            />
          </div>

          {/* Résolution */}
          <div className="mb-3">
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>
              Résolution
            </label>
            <div className="relative">
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ResolutionPreset)}
                className="w-full px-2 py-1.5 rounded-md text-xs font-mono appearance-none cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(212, 175, 55, 0.3)",
                  color: "#00F0FF",
                  outline: "none",
                }}
              >
                <option value="640x480">640 × 480 (SD)</option>
                <option value="800x600">800 × 600 (SVGA)</option>
                <option value="1024x768">1024 × 768 (XGA)</option>
                <option value="1280x720">1280 × 720 (HD)</option>
                <option value="1920x1080">1920 × 1080 (Full HD)</option>
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "#D4AF37" }}
              />
            </div>
          </div>

          {/* Mode d'entrée */}
          <div className="mb-2">
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>
              Mode de contrôle
            </label>
            <div className="flex gap-1">
              {(["mouse", "keyboard", "both"] as InputMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  className="flex-1 px-2 py-1.5 rounded-md text-xs transition-all"
                  style={{
                    background:
                      inputMode === mode
                        ? "rgba(212, 175, 55, 0.2)"
                        : "rgba(255,255,255,0.05)",
                    border: `1px solid ${inputMode === mode ? "rgba(212, 175, 55, 0.5)" : "rgba(255,255,255,0.1)"}`,
                    color: inputMode === mode ? "#D4AF37" : "#888",
                  }}
                >
                  {mode === "mouse" ? "🖱️ Souris" : mode === "keyboard" ? "⌨️ Clavier" : "🖱️⌨️ Les deux"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* ZONE D'AFFICHAGE PRINCIPALE (Canvas) */}
      {/* ================================================================== */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        style={{
          background: "radial-gradient(ellipse at center, rgba(10, 15, 30, 1) 0%, rgba(5, 5, 15, 1) 100%)",
        }}
      >
        {/* Grille de fond */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "linear-gradient(rgba(212, 175, 55, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212, 175, 55, 0.3) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Canvas principal */}
        {isStreaming && currentFrame ? (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseMove={handleMouseMove}
            onClick={handleMouseClick}
            onDoubleClick={handleMouseDoubleClick}
            onContextMenu={handleContextMenu}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            className="relative z-10 max-w-full max-h-full cursor-crosshair outline-none"
            style={{
              border: `2px solid ${isLocked ? "rgba(255, 50, 50, 0.6)" : "rgba(212, 175, 55, 0.4)"}`,
              borderRadius: "4px",
              boxShadow: isLocked
                ? "0 0 20px rgba(255, 50, 50, 0.3), inset 0 0 20px rgba(255, 50, 50, 0.05)"
                : "0 0 20px rgba(0, 240, 255, 0.15), inset 0 0 20px rgba(0, 240, 255, 0.02)",
              imageRendering: "auto",
            }}
          />
        ) : (
          /* État hors streaming */
          <div className="relative z-10 flex flex-col items-center justify-center gap-4 p-8">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(212, 175, 55, 0.05)",
                border: "2px solid rgba(212, 175, 55, 0.2)",
                boxShadow: "0 0 40px rgba(212, 175, 55, 0.1)",
              }}
            >
              <Monitor size={40} style={{ color: "#D4AF37" }} />
            </div>
            <div className="text-center">
              <p
                className="text-lg font-semibold mb-1"
                style={{ color: "#D4AF37" }}
              >
                Bureau Distant
              </p>
              <p className="text-sm" style={{ color: "#666" }}>
                {isConnected
                  ? "Cliquez sur ▶ Démarrer pour lancer le flux"
                  : "Connectez-vous d'abord au serveur distant"}
              </p>
            </div>

            {/* Erreur de connexion */}
            {connectionError && (
              <div
                className="px-4 py-2 rounded-lg text-sm"
                style={{
                  background: "rgba(255, 50, 50, 0.1)",
                  border: "1px solid rgba(255, 50, 50, 0.3)",
                  color: "#ff6666",
                }}
              >
                {connectionError}
              </div>
            )}
          </div>
        )}

        {/* Overlay de verrouillage */}
        {isLocked && isStreaming && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center"
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              className="flex flex-col items-center gap-3 p-6 rounded-xl"
              style={{
                background: "rgba(30, 0, 0, 0.8)",
                border: "2px solid rgba(255, 50, 50, 0.5)",
                boxShadow: "0 0 30px rgba(255, 50, 50, 0.2)",
              }}
            >
              <Lock size={32} style={{ color: "#ff4444" }} />
              <span className="text-sm font-bold" style={{ color: "#ff4444" }}>
                SESSION VERROUILLÉE
              </span>
              <span className="text-xs" style={{ color: "#ff8888" }}>
                Les entrées souris/clavier sont bloquées
              </span>
            </div>
          </div>
        )}

        {/* Indicateur de mode interactif */}
        {isStreaming && !isLocked && (
          <div
            className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2 py-1 rounded-md"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              border: "1px solid rgba(0, 240, 255, 0.3)",
            }}
          >
            {inputMode === "mouse" || inputMode === "both" ? (
              <MousePointer2 size={12} style={{ color: "#00F0FF" }} />
            ) : null}
            {inputMode === "keyboard" || inputMode === "both" ? (
              <Keyboard size={12} style={{ color: "#00F0FF" }} />
            ) : null}
            <span className="text-xs" style={{ color: "#00F0FF" }}>
              {inputMode === "both"
                ? "Interactif"
                : inputMode === "mouse"
                ? "Souris seule"
                : "Clavier seul"}
            </span>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* PANNEAU CLIPBOARD */}
      {/* ================================================================== */}
      {showClipboardPanel && (
        <div
          className="absolute bottom-20 right-4 z-50 p-4 rounded-xl"
          style={{
            background: "rgba(10, 10, 25, 0.95)",
            border: "1px solid rgba(212, 175, 55, 0.4)",
            backdropFilter: "blur(30px)",
            width: "300px",
          }}
        >
          <h4 className="text-xs font-bold mb-2" style={{ color: "#D4AF37" }}>
            📋 Transfert Presse-papier
          </h4>
          <textarea
            value={clipboardText}
            onChange={(e) => setClipboardText(e.target.value)}
            className="w-full h-20 px-2 py-1.5 rounded-md text-xs font-mono resize-none mb-2"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(212, 175, 55, 0.3)",
              color: "#00F0FF",
              outline: "none",
            }}
            placeholder="Texte à envoyer vers la machine distante..."
          />
          <button
            onClick={sendClipboardText}
            disabled={!clipboardText || !isConnected}
            className="w-full px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
            style={{
              background: clipboardText && isConnected
                ? "rgba(212, 175, 55, 0.2)"
                : "rgba(255,255,255,0.05)",
              border: "1px solid rgba(212, 175, 55, 0.4)",
              color: clipboardText && isConnected ? "#D4AF37" : "#555",
            }}
          >
            <Send size={12} className="inline mr-1" />
            Envoyer vers la machine distante
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* BARRE D'OUTILS DE CONTRÔLE */}
      {/* ================================================================== */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t"
        style={{
          background: "rgba(10, 10, 20, 0.9)",
          borderColor: "rgba(212, 175, 55, 0.3)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Boutons gauche */}
        <div className="flex items-center gap-2">
          {/* Connexion / Déconnexion */}
          <button
            onClick={connect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
            style={{
              background: isConnected
                ? "rgba(255, 50, 50, 0.15)"
                : "rgba(0, 240, 255, 0.15)",
              border: `1px solid ${isConnected ? "rgba(255, 50, 50, 0.4)" : "rgba(0, 240, 255, 0.4)"}`,
              color: isConnected ? "#ff6666" : "#00F0FF",
              boxShadow: isConnected
                ? "0 0 10px rgba(255, 50, 50, 0.1)"
                : "0 0 10px rgba(0, 240, 255, 0.1)",
            }}
          >
            {isConnected ? (
              <>
                <WifiOff size={14} />
                Déconnecter
              </>
            ) : (
              <>
                <Wifi size={14} />
                Connecter
              </>
            )}
          </button>

          {/* Démarrer / Arrêter le flux */}
          <button
            onClick={isStreaming ? stopStream : startStream}
            disabled={!isConnected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: isStreaming
                ? "rgba(255, 165, 0, 0.15)"
                : "rgba(0, 255, 100, 0.15)",
              border: `1px solid ${isStreaming ? "rgba(255, 165, 0, 0.4)" : "rgba(0, 255, 100, 0.4)"}`,
              color: isStreaming ? "#ffa500" : "#00ff64",
              boxShadow: isStreaming
                ? "0 0 10px rgba(255, 165, 0, 0.1)"
                : "0 0 10px rgba(0, 255, 100, 0.1)",
            }}
          >
            {isStreaming ? (
              <>
                <Square size={12} />
                Arrêter
              </>
            ) : (
              <>
                <Play size={12} />
                Démarrer
              </>
            )}
          </button>

          {/* Verrouillage */}
          <button
            onClick={toggleLock}
            disabled={!isConnected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: isLocked
                ? "rgba(255, 50, 50, 0.15)"
                : "rgba(212, 175, 55, 0.1)",
              border: `1px solid ${isLocked ? "rgba(255, 50, 50, 0.4)" : "rgba(212, 175, 55, 0.3)"}`,
              color: isLocked ? "#ff4444" : "#D4AF37",
            }}
          >
            {isLocked ? (
              <>
                <Lock size={12} />
                Verrouillé
              </>
            ) : (
              <>
                <Unlock size={12} />
                Verrouiller
              </>
            )}
          </button>
        </div>

        {/* Boutons centre - Raccourcis clavier */}
        <div className="flex items-center gap-1">
          {/* Ctrl+Alt+Del */}
          <button
            onClick={() => sendKeyCombo(["ctrl", "alt", "delete"])}
            disabled={!isConnected || isLocked}
            className="px-2 py-1.5 rounded-md text-xs transition-all hover:scale-105 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#aaa",
            }}
            title="Ctrl+Alt+Suppr"
          >
            Ctrl+Alt+Del
          </button>

          {/* Alt+Tab */}
          <button
            onClick={() => sendKeyCombo(["alt", "tab"])}
            disabled={!isConnected || isLocked}
            className="px-2 py-1.5 rounded-md text-xs transition-all hover:scale-105 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#aaa",
            }}
            title="Alt+Tab"
          >
            Alt+Tab
          </button>

          {/* Ctrl+C */}
          <button
            onClick={() => sendKeyCombo(["ctrl", "c"])}
            disabled={!isConnected || isLocked}
            className="px-2 py-1.5 rounded-md text-xs transition-all hover:scale-105 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#aaa",
            }}
            title="Ctrl+C"
          >
            Ctrl+C
          </button>

          {/* Ctrl+V */}
          <button
            onClick={() => sendKeyCombo(["ctrl", "v"])}
            disabled={!isConnected || isLocked}
            className="px-2 py-1.5 rounded-md text-xs transition-all hover:scale-105 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#aaa",
            }}
            title="Ctrl+V"
          >
            Ctrl+V
          </button>
        </div>

        {/* Boutons droite */}
        <div className="flex items-center gap-2">
          {/* Presse-papier */}
          <button
            onClick={() => setShowClipboardPanel(!showClipboardPanel)}
            disabled={!isConnected}
            className="p-1.5 rounded-md transition-all hover:scale-110 disabled:opacity-30"
            style={{
              background: showClipboardPanel
                ? "rgba(212, 175, 55, 0.2)"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${showClipboardPanel ? "rgba(212, 175, 55, 0.4)" : "rgba(255,255,255,0.1)"}`,
            }}
            title="Presse-papier"
          >
            <Copy size={14} style={{ color: "#D4AF37" }} />
          </button>

          {/* Capture d'écran */}
          <button
            onClick={() => {
              if (canvasRef.current) {
                const link = document.createElement("a");
                link.download = `atibon-capture-${Date.now()}.png`;
                link.href = canvasRef.current.toDataURL("image/png");
                link.click();
              }
            }}
            disabled={!isStreaming}
            className="p-1.5 rounded-md transition-all hover:scale-110 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            title="Capture d'écran"
          >
            <Camera size={14} style={{ color: "#00F0FF" }} />
          </button>

          {/* Plein écran */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md transition-all hover:scale-110"
            style={{
              background: isFullscreen
                ? "rgba(212, 175, 55, 0.2)"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${isFullscreen ? "rgba(212, 175, 55, 0.4)" : "rgba(255,255,255,0.1)"}`,
            }}
            title="Plein écran"
          >
            {isFullscreen ? (
              <Minimize2 size={14} style={{ color: "#D4AF37" }} />
            ) : (
              <Maximize2 size={14} style={{ color: "#aaa" }} />
            )}
          </button>

          {/* Rafraîchir */}
          <button
            onClick={() => {
              if (isStreaming) {
                stopStream();
                setTimeout(startStream, 500);
              }
            }}
            disabled={!isConnected || !isStreaming}
            className="p-1.5 rounded-md transition-all hover:scale-110 disabled:opacity-30"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            title="Rafraîchir le flux"
          >
            <RefreshCw size={14} style={{ color: "#aaa" }} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemoteDesktopViewer;
