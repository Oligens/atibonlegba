# ATIBON - Module de Prise de Contrôle à Distance

## 🖥️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ATIBON Remote Desktop                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐     WebSocket      ┌───────────────┐  │
│  │   FRONTEND (React)   │◄──────────────────►│  BACKEND      │  │
│  │                      │                     │  (Flask)      │  │
│  │  • Canvas rendering  │   frame (JPEG)     │               │  │
│  │  • Mouse capture     │◄──────────────────►│  • MSS capture│  │
│  │  • Keyboard capture  │   mouse/key events │  • PyAutoGUI  │  │
│  │  • Glassmorphism UI  │───────────────────►│  • Socket.IO  │  │
│  │                      │                     │               │  │
│  └──────────────────────┘                     └───────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Structure des fichiers

```
├── backend/
│   └── server.py              # Serveur Flask + WebSocket
├── src/
│   ├── components/
│   │   └── RemoteDesktopViewer.tsx  # Composant principal
│   ├── App.tsx                # Application ATIBON
│   ├── index.css              # Styles globaux
│   └── main.tsx               # Point d'entrée
└── README.md
```

## 🚀 Installation & Lancement

### Backend (Python)

```bash
# Installation des dépendances
pip install flask flask-socketio flask-cors mss pillow pyautogui pynput

# Lancement du serveur
python backend/server.py --host 0.0.0.0 --port 5000 --fps 15 --quality 60
```

### Frontend (React)

```bash
# Installation
npm install

# Développement
npm run dev

# Production
npm run build
```

## 🔧 Fonctionnalités

### Frontend (`RemoteDesktopViewer.tsx`)

| Fonctionnalité | Description |
|---|---|
| **Visualisation Canvas** | Rendu temps réel du flux JPEG via `<canvas>` |
| **Contrôle Souris** | Mouvement, clic gauche/droit, double-clic, scroll |
| **Contrôle Clavier** | Touches simples, combinaisons (Ctrl+C, Alt+Tab...) |
| **Verrouillage** | Bloque toutes les entrées (mode observation) |
| **Modes d'entrée** | Souris seule, Clavier seul, Les deux |
| **Presse-papier** | Envoi de texte vers la machine distante |
| **Raccourcis** | Ctrl+Alt+Del, Alt+Tab, Ctrl+C/V |
| **Capture d'écran** | Export PNG du frame actuel |
| **Plein écran** | Mode immersif via Fullscreen API |
| **Statistiques** | FPS, latence, frame count, résolution |

### Backend (`server.py`)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/status` | GET | Statut de la session |
| `/api/settings` | POST | Mise à jour des paramètres |
| `/api/stream/start` | POST | Démarrer le flux |
| `/api/stream/stop` | POST | Arrêter le flux |
| `/api/lock` | POST | Verrouiller/déverrouiller |

| WebSocket Event | Direction | Description |
|---|---|---|
| `connect` | → | Client connecté |
| `disconnect` | → | Client déconnecté |
| `start_stream` | ← → | Démarrer le streaming |
| `stop_stream` | ← → | Arrêter le streaming |
| `frame` | ← | Frame JPEG base64 |
| `mouse_move` | → | Déplacement souris |
| `mouse_click` | → | Clic souris |
| `mouse_scroll` | → | Scroll souris |
| `key_press` | → | Appui touche |
| `key_combo` | → | Combinaison de touches |
| `clipboard_text` | → | Texte presse-papier |
| `update_settings` | ← → | Paramètres session |

## 🎨 Design System

```
Couleurs principales :
  • Or/Doré :    #D4AF37  (borders, accents, titres)
  • Cyan :       #00F0FF  (infos, indicateurs, liens)
  • Fond :       #050510 → #0a0a1a (gradient sombre)
  • Texte :      #e0e0e0  (principal)
  • Muted :      #888     (secondaire)

Glassmorphism :
  • background: rgba(10, 10, 20, 0.85)
  • backdrop-filter: blur(20px)
  • border: 1px solid rgba(212, 175, 55, 0.15)
  • box-shadow: 0 0 20px rgba(0, 240, 255, 0.1)
```

## 🔐 Sécurité

- Authentification à implémenter (JWT recommandé)
- Chiffrement WSS pour la production
- Rate limiting sur les événements WebSocket
- Validation des coordonnées souris (bornes écran)
- Logs d'audit pour toutes les actions

## 📝 Notes

- En mode **simulation** (sans `mss`), le backend génère un frame de terminal interactif
- Le throttling souris est à ~60Hz pour éviter la surcharge WebSocket
- La qualité JPEG est ajustable de 10% à 100%
- Résolutions supportées : 640×480 à 1920×1080
