# ATIBON - Module de Prise de Contrôle à Distance + Network Discovery

## 🖥️ Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        ATIBON Infrastructure Manager                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐     WebSocket      ┌────────────────────────┐  │
│  │   FRONTEND (React)   │◄──────────────────►│  BACKEND (Flask)       │  │
│  │                      │                     │                        │  │
│  │  • RemoteDesktop     │   frame (JPEG)     │  • RemoteDesktopSession│  │
│  │  • NetworkTopology   │◄──────────────────►│  • NetworkScanner      │  │
│  │  • Dashboard         │   mouse/key events │  • TargetManager       │  │
│  │  • Glassmorphism UI  │───────────────────►│  • Socket.IO           │  │
│  │                      │                     │  • Relay Multi-cibles  │  │
│  └──────────────────────┘                     └────────────────────────┘  │
│           ▲                                          │                    │
│           │                                          ▼                    │
│           │                              ┌──────────────────────┐        │
│           └──────────────────────────────│  Réseau Local        │        │
│                                          │  ┌─────┐ ┌─────┐    │        │
│                                          │  │SSH  │ │VNC  │    │        │
│                                          │  └─────┘ └─────┘    │        │
│                                          │  ┌─────┐ ┌─────┐    │        │
│                                          │  │RDP  │ │SMB  │    │        │
│                                          │  └─────┘ └─────┘    │        │
│                                          └──────────────────────┘        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## 📁 Structure des fichiers

```
├── backend/
│   ├── server.py              # Serveur Flask + WebSocket + Relay multi-cibles
│   └── network_scanner.py     # Module de découverte réseau (Port Sweep)
├── src/
│   ├── components/
│   │   ├── RemoteDesktopViewer.tsx  # Prise de contrôle à distance
│   │   └── NetworkTopology.tsx      # Topologie réseau & sélecteur d'hôtes
│   ├── App.tsx                # Application ATIBON principale
│   ├── index.css              # Styles globaux (Glassmorphism)
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

## 🌐 Module de Découverte Réseau

### `backend/network_scanner.py`

Scanner de sous-réseau complet qui détecte automatiquement :

| Fonctionnalité | Description |
|---|---|
| **Ping Sweep** | Détection d'hôtes actifs (ICMP + TCP fallback) |
| **Port Scan** | Scan TCP des ports standards (SSH, VNC, RDP, SMB, HTTP...) |
| **Banner Grabbing** | Récupération des bannières de service |
| **DNS Reverse** | Résolution inverse des adresses IP |
| **MAC Detection** | Détection des adresses MAC via ARP |
| **Vendor Lookup** | Identification du fabricant via OUI |
| **OS Fingerprint** | Estimation basique du système d'exploitation |
| **Gateway Detection** | Identification de la passerelle par défaut |

**Ports scannés par défaut :**
- `22` (SSH), `23` (Telnet), `80` (HTTP), `135/139/445` (SMB)
- `443` (HTTPS), `3389` (RDP), `5900-5905` (VNC), `8080` (HTTP alt)

### Routes API - Découverte Réseau

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/network/subnet` | GET | Détecte le sous-réseau local |
| `/api/network/scan` | POST | Lance un scan asynchrone |
| `/api/network/scan/sync` | POST | Lance un scan synchrone |
| `/api/network/scan/status` | GET | Statut du scan en cours |
| `/api/network/hosts` | GET | Liste des hôtes découverts |
| `/api/network/host/<ip>` | GET | Détails d'un hôte |
| `/api/network/host/<ip>/scan` | POST | Scan détaillé d'un hôte |
| `/api/network/host/<ip>/services` | GET | Services de contrôle distant |

### Routes API - Gestion des Cibles

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/targets` | GET | Toutes les cibles avec état |
| `/api/targets/select` | POST | Sélectionne une cible |
| `/api/targets/selected` | GET | Cible actuellement sélectionnée |
| `/api/targets/release` | POST | Libère la cible |
| `/api/relay/start` | POST | Démarre le relay de flux |
| `/api/relay/stop` | POST | Arrête le relay |
| `/api/relay/status` | GET | Statut du relay actif |

### Composant React - NetworkTopology

Le composant `NetworkTopology.tsx` offre :

| Fonctionnalité | Description |
|---|---|
| **Scan réseau** | Lancement du balayage avec barre de progression |
| **Vue grille** | Cartes interactives des hôtes découverts |
| **Vue liste** | Tableau détaillé avec toutes les colonnes |
| **Vue topologie** | Représentation graphique en étoile |
| **Filtrage** | Par service (SSH, VNC, RDP, HTTP, Gateway) |
| **Recherche** | Par IP, hostname, vendor, OS |
| **Tri** | Par IP, nom, latence, nombre de services |
| **Détail hôte** | Panneau latéral avec ports, bannières, actions |
| **Relay rapide** | Boutons VNC/RDP/SSH pour connexion instantanée |
| **Statistiques** | Compteurs temps réel par type de service |

## 🔐 Sécurité

- Authentification à implémenter (JWT recommandé)
- Chiffrement WSS pour la production
- Rate limiting sur les événements WebSocket
- Validation des coordonnées souris (bornes écran)
- Logs d'audit pour toutes les actions
- **Restriction du scan aux plages IP autorisées**
- **Vérification des credentials avant relay**

## 📝 Notes

- En mode **simulation** (sans `mss`), le backend génère un frame de terminal interactif
- Le throttling souris est à ~60Hz pour éviter la surcharge WebSocket
- La qualité JPEG est ajustable de 10% à 100%
- Résolutions supportées : 640×480 à 1920×1080
