"""
=============================================================================
ATIBON - Module de Prise de Contrôle à Distance (Backend)
=============================================================================
Serveur Flask + WebSocket (Flask-SocketIO) pour :
  - Capture d'écran en temps réel via MSS (ou simulation)
  - Transmission du flux vidéo compressé (JPEG) via WebSocket
  - Réception et exécution des commandes souris/clavier
  - Support multi-résolution et verrouillage d'écran

Dépendances :
  pip install flask flask-socketio flask-cors mss pillow pyautogui pynput

Usage :
  python server.py [--host 0.0.0.0] [--port 5000] [--fps 15] [--quality 60]
=============================================================================
"""

import argparse
import base64
import io
import json
import logging
import sys
import time
from threading import Thread, Event, Lock
from typing import Optional, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect

# ---------------------------------------------------------------------------
# Configuration & Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ATIBON-RemoteDesktop")

# ---------------------------------------------------------------------------
# Imports conditionnels (capture d'écran réelle)
# ---------------------------------------------------------------------------
try:
    import mss
    import mss.tools
    MSS_AVAILABLE = True
except ImportError:
    MSS_AVAILABLE = False
    logger.warning("Module 'mss' non disponible — mode simulation activé")

try:
    import pyautogui
    pyautogui.FAILSAFE = False
    PYAUTOGUI_AVAILABLE = True
except ImportError:
    PYAUTOGUI_AVAILABLE = False
    logger.warning("Module 'pyautogui' non disponible — commandes souris/clavier simulées")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.warning("Module 'Pillow' non disponible")

# ---------------------------------------------------------------------------
# Application Flask
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["SECRET_KEY"] = "atibon-remote-desktop-secret-key"

CORS(app, resources={r"/api/*": {"origins": "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_interval=25,
    ping_timeout=60,
    max_http_buffer_size=10 * 1024 * 1024,  # 10 MB
)

# ---------------------------------------------------------------------------
# État global de la session de bureau distant
# ---------------------------------------------------------------------------
class RemoteDesktopSession:
    """Gère l'état d'une session de bureau distant."""

    def __init__(self):
        self.is_streaming: bool = False
        self.is_locked: bool = False
        self.fps: int = 15
        self.quality: int = 60
        self.resolution: Tuple[int, int] = (1280, 720)
        self.interactive_mode: bool = True  # True = souris+clavier actif
        self._stream_thread: Optional[Thread] = None
        self._stop_event: Event = Event()
        self._lock: Lock = Lock()
        self.connected_clients: int = 0
        self.frame_count: int = 0
        self.session_start_time: Optional[float] = None

    def start_streaming(self):
        with self._lock:
            if self.is_streaming:
                return
            self.is_streaming = True
            self._stop_event.clear()
            self.session_start_time = time.time()
            self.frame_count = 0
            self._stream_thread = Thread(target=self._capture_loop, daemon=True)
            self._stream_thread.start()
            logger.info(f"Streaming démarré @ {self.fps} FPS, qualité {self.quality}%")

    def stop_streaming(self):
        with self._lock:
            if not self.is_streaming:
                return
            self._stop_event.set()
            self.is_streaming = False
            if self._stream_thread:
                self._stream_thread.join(timeout=3)
            logger.info("Streaming arrêté")

    def _capture_loop(self):
        """Boucle principale de capture d'écran."""
        interval = 1.0 / self.fps

        while not self._stop_event.is_set():
            start = time.perf_counter()

            try:
                frame_data = self._capture_frame()
                if frame_data and self.connected_clients > 0:
                    socketio.emit("frame", {
                        "image": frame_data,
                        "timestamp": time.time(),
                        "frame_number": self.frame_count,
                        "resolution": list(self.resolution),
                    }, namespace="/remote-desktop")
                    self.frame_count += 1
            except Exception as e:
                logger.error(f"Erreur capture: {e}")

            # Contrôle du framerate
            elapsed = time.perf_counter() - start
            sleep_time = interval - elapsed
            if sleep_time > 0:
                self._stop_event.wait(sleep_time)

    def _capture_frame(self) -> Optional[str]:
        """Capture un frame d'écran et le retourne en base64 JPEG."""
        if MSS_AVAILABLE and PIL_AVAILABLE:
            return self._capture_real_frame()
        else:
            return self._capture_simulated_frame()

    def _capture_real_frame(self) -> Optional[str]:
        """Capture réelle via MSS."""
        try:
            with mss.mss() as sct:
                monitor = sct.monitors[1]  # Écran principal
                screenshot = sct.grab(monitor)

                # Redimensionner si nécessaire
                img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
                img = img.resize(self.resolution, Image.LANCZOS)

                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=self.quality, optimize=True)
                return base64.b64encode(buffer.getvalue()).decode("utf-8")
        except Exception as e:
            logger.error(f"Erreur capture réelle: {e}")
            return None

    def _capture_simulated_frame(self) -> Optional[str]:
        """Frame simulé (interface de terminal/bureau)."""
        if not PIL_AVAILABLE:
            return self._generate_svg_frame()

        try:
            width, height = self.resolution
            img = Image.new("RGB", (width, height), color=(15, 15, 25))

            # Dessiner une grille
            from PIL import ImageDraw
            draw = ImageDraw.Draw(img)

            # Grille de fond
            for x in range(0, width, 40):
                draw.line([(x, 0), (x, height)], fill=(25, 30, 45), width=1)
            for y in range(0, height, 40):
                draw.line([(0, y), (width, y)], fill=(25, 30, 45), width=1)

            # Barre de titre simulée
            draw.rectangle([(0, 0), (width, 35)], fill=(20, 20, 35))
            draw.text((10, 8), "ATIBON Remote Desktop — Session Active", fill=(212, 175, 55))

            # Heure et statut
            current_time = time.strftime("%H:%M:%S")
            draw.text((width - 120, 8), f"Frame #{self.frame_count} | {current_time}", fill=(0, 240, 255))

            # Zone de terminal simulée
            term_x, term_y = 20, 50
            term_w, term_h = width - 40, height - 70
            draw.rectangle([(term_x, term_y), (term_x + term_w, term_y + term_h)],
                          outline=(212, 175, 55), width=2)

            # Lignes de terminal
            terminal_lines = [
                f"root@atibon-remote:~$ # Session démarrée à {time.strftime('%Y-%m-%d %H:%M:%S')}",
                f"root@atibon-remote:~$ uptime",
                f"  {time.strftime('%H:%M:%S')} up 42 days, 3:17, 2 users, load average: 0.12, 0.08, 0.05",
                f"root@atibon-remote:~$ free -h",
                f"              total    used    free    shared  buff/cache  available",
                f"  Mem:        16Gi     4.2Gi   8.1Gi   256Mi    3.7Gi      11.5Gi",
                f"  Swap:       4.0Gi    0B      4.0Gi",
                f"root@atibon-remote:~$ _",
            ]

            y_offset = term_y + 15
            for i, line in enumerate(terminal_lines):
                color = (0, 240, 255) if line.startswith("root@") else (180, 180, 200)
                draw.text((term_x + 10, y_offset + i * 22), line, fill=color)

            # Curseur clignotant
            if int(time.time() * 2) % 2 == 0:
                cursor_y = y_offset + len(terminal_lines) * 22
                draw.rectangle([(term_x + 10, cursor_y), (term_x + 20, cursor_y + 16)],
                              fill=(0, 240, 255))

            # Indicateur de verrouillage
            if self.is_locked:
                draw.rectangle([(width//2 - 100, height//2 - 30),
                               (width//2 + 100, height//2 + 30)],
                              fill=(30, 0, 0), outline=(255, 50, 50), width=2)
                draw.text((width//2 - 60, height//2 - 10), "🔒 LOCKED", fill=(255, 50, 50))

            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=self.quality, optimize=True)
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
        except Exception as e:
            logger.error(f"Erreur frame simulé: {e}")
            return None

    def _generate_svg_frame(self) -> Optional[str]:
        """Fallback SVG encodé en base64."""
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{self.resolution[0]}" height="{self.resolution[1]}">
            <rect width="100%" height="100%" fill="#0f0f19"/>
            <text x="50%" y="50%" text-anchor="middle" fill="#D4AF37" font-size="24">
                ATIBON Remote Desktop - Frame #{self.frame_count}
            </text>
            <text x="50%" y="60%" text-anchor="middle" fill="#00F0FF" font-size="16">
                {time.strftime('%H:%M:%S')}
            </text>
        </svg>"""
        return base64.b64encode(svg.encode()).decode("utf-8")


# Instance globale de session
session = RemoteDesktopSession()

# ---------------------------------------------------------------------------
# Routes REST API
# ---------------------------------------------------------------------------
@app.route("/api/status", methods=["GET"])
def get_status():
    """Retourne le statut de la session de bureau distant."""
    uptime = 0
    if session.session_start_time:
        uptime = time.time() - session.session_start_time

    return jsonify({
        "streaming": session.is_streaming,
        "locked": session.is_locked,
        "fps": session.fps,
        "quality": session.quality,
        "resolution": list(session.resolution),
        "interactive_mode": session.interactive_mode,
        "connected_clients": session.connected_clients,
        "frame_count": session.frame_count,
        "uptime_seconds": round(uptime, 2),
        "mss_available": MSS_AVAILABLE,
        "pyautogui_available": PYAUTOGUI_AVAILABLE,
    })


@app.route("/api/settings", methods=["POST"])
def update_settings():
    """Met à jour les paramètres de la session."""
    data = request.get_json()

    if "fps" in data:
        session.fps = max(1, min(60, int(data["fps"])))
    if "quality" in data:
        session.quality = max(10, min(100, int(data["quality"])))
    if "resolution" in data:
        res = tuple(data["resolution"])
        if len(res) == 2 and all(isinstance(v, int) for v in res):
            session.resolution = res
    if "interactive_mode" in data:
        session.interactive_mode = bool(data["interactive_mode"])

    logger.info(f"Paramètres mis à jour: FPS={session.fps}, Quality={session.quality}, "
                f"Resolution={session.resolution}, Interactive={session.interactive_mode}")

    return jsonify({"status": "ok", "settings": {
        "fps": session.fps,
        "quality": session.quality,
        "resolution": list(session.resolution),
        "interactive_mode": session.interactive_mode,
    }})


@app.route("/api/stream/start", methods=["POST"])
def start_stream():
    """Démarre le flux vidéo."""
    session.start_streaming()
    return jsonify({"status": "started", "streaming": True})


@app.route("/api/stream/stop", methods=["POST"])
def stop_stream():
    """Arrête le flux vidéo."""
    session.stop_streaming()
    return jsonify({"status": "stopped", "streaming": False})


@app.route("/api/lock", methods=["POST"])
def toggle_lock():
    """Verrouille/déverrouille la session."""
    session.is_locked = not session.is_locked
    state = "locked" if session.is_locked else "unlocked"
    logger.info(f"Session {state}")
    return jsonify({"status": state, "locked": session.is_locked})


# ---------------------------------------------------------------------------
# WebSocket Events
# ---------------------------------------------------------------------------
@socketio.on("connect", namespace="/remote-desktop")
def handle_connect():
    """Client WebSocket connecté."""
    session.connected_clients += 1
    logger.info(f"Client connecté (total: {session.connected_clients})")
    emit("connected", {
        "message": "Connecté au serveur ATIBON Remote Desktop",
        "session_info": {
            "streaming": session.is_streaming,
            "resolution": list(session.resolution),
            "fps": session.fps,
        }
    })


@socketio.on("disconnect", namespace="/remote-desktop")
def handle_disconnect():
    """Client WebSocket déconnecté."""
    session.connected_clients = max(0, session.connected_clients - 1)
    logger.info(f"Client déconnecté (total: {session.connected_clients})")

    if session.connected_clients == 0:
        session.stop_streaming()


@socketio.on("start_stream", namespace="/remote-desktop")
def handle_start_stream(data=None):
    """Démarre le streaming via WebSocket."""
    if data:
        if "fps" in data:
            session.fps = max(1, min(60, int(data["fps"])))
        if "quality" in data:
            session.quality = max(10, min(100, int(data["quality"])))
        if "resolution" in data:
            session.resolution = tuple(data["resolution"])

    session.start_streaming()
    emit("stream_started", {
        "fps": session.fps,
        "quality": session.quality,
        "resolution": list(session.resolution),
    })


@socketio.on("stop_stream", namespace="/remote-desktop")
def handle_stop_stream():
    """Arrête le streaming via WebSocket."""
    session.stop_streaming()
    emit("stream_stopped", {"message": "Streaming arrêté"})


@socketio.on("mouse_move", namespace="/remote-desktop")
def handle_mouse_move(data):
    """Déplacement de la souris sur la machine distante."""
    if not session.interactive_mode or session.is_locked:
        return

    x = data.get("x", 0)
    y = data.get("y", 0)

    # Mapper les coordonnées depuis la résolution du canvas vers la résolution réelle
    canvas_width = data.get("canvas_width", session.resolution[0])
    canvas_height = data.get("canvas_height", session.resolution[1])

    real_x = int(x * session.resolution[0] / canvas_width)
    real_y = int(y * session.resolution[1] / canvas_height)

    if PYAUTOGUI_AVAILABLE:
        try:
            pyautogui.moveTo(real_x, real_y)
        except Exception as e:
            logger.debug(f"Erreur déplacement souris: {e}")

    logger.debug(f"Mouse move: ({real_x}, {real_y})")


@socketio.on("mouse_click", namespace="/remote-desktop")
def handle_mouse_click(data):
    """Clic de souris sur la machine distante."""
    if not session.interactive_mode or session.is_locked:
        return

    x = data.get("x", 0)
    y = data.get("y", 0)
    button = data.get("button", "left")  # left, right, middle
    click_type = data.get("type", "click")  # click, dblclick, down, up

    canvas_width = data.get("canvas_width", session.resolution[0])
    canvas_height = data.get("canvas_height", session.resolution[1])

    real_x = int(x * session.resolution[0] / canvas_width)
    real_y = int(y * session.resolution[1] / canvas_height)

    if PYAUTOGUI_AVAILABLE:
        try:
            if click_type == "dblclick":
                pyautogui.doubleClick(real_x, real_y, button=button)
            elif click_type == "down":
                pyautogui.mouseDown(real_x, real_y, button=button)
            elif click_type == "up":
                pyautogui.mouseUp(real_x, real_y, button=button)
            else:
                pyautogui.click(real_x, real_y, button=button)
        except Exception as e:
            logger.error(f"Erreur clic souris: {e}")

    logger.info(f"Mouse {click_type}: ({real_x}, {real_y}) button={button}")


@socketio.on("mouse_scroll", namespace="/remote-desktop")
def handle_mouse_scroll(data):
    """Scroll de la souris sur la machine distante."""
    if not session.interactive_mode or session.is_locked:
        return

    direction = data.get("direction", "down")  # up, down, left, right
    amount = data.get("amount", 3)

    if PYAUTOGUI_AVAILABLE:
        try:
            if direction in ("up", "down"):
                clicks = amount if direction == "up" else -amount
                pyautogui.scroll(clicks)
            else:
                clicks = amount if direction == "right" else -amount
                pyautogui.hscroll(clicks)
        except Exception as e:
            logger.error(f"Erreur scroll: {e}")

    logger.debug(f"Scroll {direction}: amount={amount}")


@socketio.on("key_press", namespace="/remote-desktop")
def handle_key_press(data):
    """Appui de touche clavier sur la machine distante."""
    if not session.interactive_mode or session.is_locked:
        return

    key = data.get("key", "")
    modifiers = data.get("modifiers", [])  # ["ctrl", "shift", "alt"]
    key_type = data.get("type", "press")  # press, down, up

    if PYAUTOGUI_AVAILABLE and key:
        try:
            # Gestion des combinaisons de touches
            hotkeys = modifiers + [key] if modifiers else [key]

            if key_type == "down":
                pyautogui.keyDown(key)
            elif key_type == "up":
                pyautogui.keyUp(key)
            elif len(hotkeys) > 1:
                pyautogui.hotkey(*hotkeys)
            else:
                pyautogui.press(key)
        except Exception as e:
            logger.error(f"Erreur touche clavier: {e}")

    logger.info(f"Key {key_type}: {key} modifiers={modifiers}")


@socketio.on("key_combo", namespace="/remote-desktop")
def handle_key_combo(data):
    """Combinaison de touches (ex: Ctrl+Alt+Del)."""
    if not session.interactive_mode or session.is_locked:
        return

    keys = data.get("keys", [])

    if PYAUTOGUI_AVAILABLE and keys:
        try:
            pyautogui.hotkey(*keys)
        except Exception as e:
            logger.error(f"Erreur combinaison touches: {e}")

    logger.info(f"Key combo: {keys}")


@socketio.on("clipboard_text", namespace="/remote-desktop")
def handle_clipboard(data):
    """Transfert de texte via presse-papier."""
    text = data.get("text", "")
    direction = data.get("direction", "to_remote")  # to_remote, from_remote

    if PYAUTOGUI_AVAILABLE and direction == "to_remote" and text:
        try:
            pyautogui.write(text, interval=0.02)
        except Exception as e:
            logger.error(f"Erreur presse-papier: {e}")

    logger.info(f"Clipboard {direction}: {len(text)} chars")


@socketio.on("update_settings", namespace="/remote-desktop")
def handle_update_settings(data):
    """Mise à jour des paramètres via WebSocket."""
    if "fps" in data:
        session.fps = max(1, min(60, int(data["fps"])))
    if "quality" in data:
        session.quality = max(10, min(100, int(data["quality"])))
    if "resolution" in data:
        session.resolution = tuple(data["resolution"])
    if "interactive_mode" in data:
        session.interactive_mode = bool(data["interactive_mode"])

    emit("settings_updated", {
        "fps": session.fps,
        "quality": session.quality,
        "resolution": list(session.resolution),
        "interactive_mode": session.interactive_mode,
    })


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="ATIBON Remote Desktop Server")
    parser.add_argument("--host", default="0.0.0.0", help="Adresse d'écoute")
    parser.add_argument("--port", type=int, default=5000, help="Port d'écoute")
    parser.add_argument("--fps", type=int, default=15, help="Images par seconde")
    parser.add_argument("--quality", type=int, default=60, help="Qualité JPEG (1-100)")
    parser.add_argument("--debug", action="store_true", help="Mode debug")
    args = parser.parse_args()

    session.fps = args.fps
    session.quality = args.quality

    logger.info("=" * 60)
    logger.info("  ATIBON Remote Desktop Server")
    logger.info("=" * 60)
    logger.info(f"  Host:     {args.host}")
    logger.info(f"  Port:     {args.port}")
    logger.info(f"  FPS:      {args.fps}")
    logger.info(f"  Quality:  {args.quality}%")
    logger.info(f"  MSS:      {'✓' if MSS_AVAILABLE else '✗ (simulation)'}")
    logger.info(f"  PyAutoGUI:{'✓' if PYAUTOGUI_AVAILABLE else '✗ (simulé)'}")
    logger.info("=" * 60)

    socketio.run(app, host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
