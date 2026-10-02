"""
=============================================================================
ATIBON - Module de Découverte Réseau (Network Discovery / Port Sweep)
=============================================================================
Scanner de sous-réseau qui détecte automatiquement :
  - Hôtes actifs (ping sweep)
  - Services ouverts (SSH:22, VNC:5900, RDP:3389, SMB:445, HTTP:80/8080)
  - Informations système (hostname, MAC, OS fingerprint basique)
  - Latence réseau

Dépendances :
  pip install python-nmap scapy netifaces psutil
  (Optionnel) pip install python-libnmap

Usage :
  from network_scanner import NetworkScanner
  scanner = NetworkScanner("192.168.1.0/24")
  hosts = scanner.scan()
=============================================================================
"""

import ipaddress
import logging
import os
import platform
import socket
import struct
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from threading import Lock
from typing import Optional, List, Dict, Set, Tuple, Callable

logger = logging.getLogger("ATIBON-NetworkScanner")

# ---------------------------------------------------------------------------
# Types & Constantes
# ---------------------------------------------------------------------------

class ServiceType(Enum):
    SSH = "ssh"
    VNC = "vnc"
    RDP = "rdp"
    SMB = "smb"
    HTTP = "http"
    HTTPS = "https"
    RDP_ALT = "rdp-alt"
    TELNET = "telnet"
    FTP = "ftp"
    UNKNOWN = "unknown"


class HostStatus(Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    FILTERED = "filtered"
    UNKNOWN = "unknown"


class PortState(Enum):
    OPEN = "open"
    CLOSED = "closed"
    FILTERED = "filtered"


# Ports standards à scanner avec leur service associé
DEFAULT_PORTS: Dict[int, ServiceType] = {
    21: ServiceType.FTP,
    22: ServiceType.SSH,
    23: ServiceType.TELNET,
    80: ServiceType.HTTP,
    135: ServiceType.SMB,      # MS RPC
    139: ServiceType.SMB,      # NetBIOS
    443: ServiceType.HTTPS,
    445: ServiceType.SMB,      # SMB over TCP
    3389: ServiceType.RDP,     # RDP
    5900: ServiceType.VNC,     # VNC
    5901: ServiceType.VNC,     # VNC (display 1)
    5902: ServiceType.VNC,     # VNC (display 2)
    5903: ServiceType.VNC,     # VNC (display 3)
    5904: ServiceType.VNC,     # VNC (display 4)
    5905: ServiceType.VNC,     # VNC (display 5)
    8080: ServiceType.HTTP,    # HTTP alt
    8443: ServiceType.HTTPS,   # HTTPS alt
    3306: ServiceType.UNKNOWN, # MySQL
    5432: ServiceType.UNKNOWN, # PostgreSQL
    6379: ServiceType.UNKNOWN, # Redis
    27017: ServiceType.UNKNOWN,# MongoDB
}

# Bannières de service pour fingerprinting
SERVICE_BANNERS: Dict[ServiceType, str] = {
    ServiceType.SSH: "SSH-",
    ServiceType.VNC: "RFB",
    ServiceType.HTTP: "HTTP/",
    ServiceType.FTP: "220",
    ServiceType.TELNET: "",
}


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class OpenPort:
    """Représente un port ouvert détecté sur un hôte."""
    port: int
    state: PortState
    service: ServiceType
    banner: str = ""
    version: str = ""

    def to_dict(self) -> dict:
        return {
            "port": self.port,
            "state": self.state.value,
            "service": self.service.value,
            "banner": self.banner[:200] if self.banner else "",
            "version": self.version,
        }


@dataclass
class DiscoveredHost:
    """Représente un hôte découvert sur le réseau."""
    ip: str
    mac: str = ""
    hostname: str = ""
    vendor: str = ""
    status: HostStatus = HostStatus.UNKNOWN
    os_guess: str = ""
    latency_ms: float = 0.0
    open_ports: List[OpenPort] = []
    services: List[str] = []
    last_seen: str = ""
    is_gateway: bool = False
    notes: str = ""
    scan_timestamp: float = 0.0

    def to_dict(self) -> dict:
        return {
            "ip": self.ip,
            "mac": self.mac,
            "hostname": self.hostname,
            "vendor": self.vendor,
            "status": self.status.value,
            "os_guess": self.os_guess,
            "latency_ms": round(self.latency_ms, 2),
            "open_ports": [p.to_dict() for p in self.open_ports],
            "services": self.services,
            "last_seen": self.last_seen,
            "is_gateway": self.is_gateway,
            "notes": self.notes,
            "scan_timestamp": self.scan_timestamp,
            # Champs pratiques pour le frontend
            "has_ssh": any(p.service == ServiceType.SSH for p in self.open_ports),
            "has_vnc": any(p.service == ServiceType.VNC for p in self.open_ports),
            "has_rdp": any(p.service == ServiceType.RDP for p in self.open_ports),
            "has_smb": any(p.service == ServiceType.SMB for p in self.open_ports),
            "has_http": any(p.service in (ServiceType.HTTP, ServiceType.HTTPS) for p in self.open_ports),
            "remote_protocols": [
                p.service.value for p in self.open_ports
                if p.service in (ServiceType.SSH, ServiceType.VNC, ServiceType.RDP)
            ],
        }


@dataclass
class ScanResult:
    """Résultat complet d'un scan réseau."""
    subnet: str
    scan_start: float = 0.0
    scan_end: float = 0.0
    total_hosts_scanned: int = 0
    hosts_found: int = 0
    hosts: List[DiscoveredHost] = []
    errors: List[str] = []

    @property
    def duration_seconds(self) -> float:
        return self.scan_end - self.scan_start

    def to_dict(self) -> dict:
        return {
            "subnet": self.subnet,
            "scan_start": self.scan_start,
            "scan_end": self.scan_end,
            "duration_seconds": round(self.duration_seconds, 2),
            "total_hosts_scanned": self.total_hosts_scanned,
            "hosts_found": self.hosts_found,
            "hosts": [h.to_dict() for h in self.hosts],
            "errors": self.errors,
        }


# ---------------------------------------------------------------------------
# NetworkScanner - Classe principale
# ---------------------------------------------------------------------------

class NetworkScanner:
    """
    Scanner de sous-réseau complet pour la découverte d'hôtes et services.

    Méthodes de scan :
      - Ping sweep (ICMP / TCP connect)
      - Port scan (TCP connect avec banner grabbing)
      - DNS reverse lookup
      - OS fingerprint basique (TTL analysis)
      - Détection de services de contrôle distant (SSH, VNC, RDP)
    """

    def __init__(
        self,
        subnet: str = "192.168.1.0/24",
        timeout: float = 2.0,
        max_workers: int = 100,
        ports: Optional[List[int]] = None,
        enable_banner_grab: bool = True,
        enable_dns_lookup: bool = True,
        enable_os_guess: bool = True,
    ):
        self.subnet = ipaddress.ip_network(subnet, strict=False)
        self.timeout = timeout
        self.max_workers = max_workers
        self.ports = ports or list(DEFAULT_PORTS.keys())
        self.enable_banner_grab = enable_banner_grab
        self.enable_dns_lookup = enable_dns_lookup
        self.enable_os_guess = enable_os_guess
        self._lock = Lock()
        self._progress_callback: Optional[Callable[[int, int], None]] = None
        self._is_scanning = False
        self._current_scan: Optional[ScanResult] = None

        logger.info(f"NetworkScanner initialisé: subnet={self.subnet}, "
                    f"ports={len(self.ports)}, workers={self.max_workers}")

    @property
    def is_scanning(self) -> bool:
        return self._is_scanning

    @property
    def current_scan(self) -> Optional[ScanResult]:
        return self._current_scan

    def set_progress_callback(self, callback: Callable[[int, int], None]):
        """Définit un callback pour suivre la progression du scan."""
        self._progress_callback = callback

    # -----------------------------------------------------------------------
    # Méthode principale de scan
    # -----------------------------------------------------------------------

    def scan(self, progress_callback: Optional[Callable] = None) -> ScanResult:
        """
        Lance un scan complet du sous-réseau.
        Retourne un ScanResult avec tous les hôtes découverts.
        """
        if progress_callback:
            self._progress_callback = progress_callback

        result = ScanResult(subnet=str(self.subnet))
        result.scan_start = time.time()
        self._is_scanning = True
        self._current_scan = result

        logger.info(f"Démarrage du scan: {self.subnet} ({len(list(self.subnet.hosts()))} hôtes potentiels)")

        try:
            # Phase 1: Ping sweep pour trouver les hôtes actifs
            active_ips = self._ping_sweep()
            result.total_hosts_scanned = len(list(self.subnet.hosts()))

            logger.info(f"Ping sweep terminé: {len(active_ips)} hôtes actifs détectés")

            # Phase 2: Scan de ports sur les hôtes actifs
            scanned_hosts = self._scan_hosts_ports(active_ips)
            result.hosts = scanned_hosts
            result.hosts_found = len(scanned_hosts)

        except Exception as e:
            error_msg = f"Erreur pendant le scan: {str(e)}"
            logger.error(error_msg)
            result.errors.append(error_msg)

        finally:
            result.scan_end = time.time()
            self._is_scanning = False
            self._current_scan = result

        logger.info(f"Scan terminé en {result.duration_seconds:.2f}s — "
                    f"{result.hosts_found} hôtes trouvés sur {result.total_hosts_scanned}")

        return result

    # -----------------------------------------------------------------------
    # Phase 1: Ping Sweep (détection d'hôtes actifs)
    # -----------------------------------------------------------------------

    def _ping_sweep(self) -> List[str]:
        """
        Détecte les hôtes actifs via ping ICMP ou TCP fallback.
        Utilise le threading pour paralléliser les pings.
        """
        active_ips: List[str] = []
        hosts = list(self.subnet.hosts())
        scanned = 0

        def check_host(ip: str) -> Optional[Tuple[str, float]]:
            """Ping un hôte et retourne (ip, latency_ms) si actif."""
            start = time.perf_counter()
            is_alive = self._ping_host(ip)
            latency = (time.perf_counter() - start) * 1000

            if is_alive:
                return (ip, latency)
            return None

        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(hosts))) as executor:
            futures = {executor.submit(check_host, str(ip)): str(ip) for ip in hosts}

            for future in as_completed(futures):
                scanned += 1
                if self._progress_callback:
                    self._progress_callback(scanned, len(hosts))

                try:
                    result = future.result(timeout=self.timeout + 1)
                    if result:
                        ip, latency = result
                        with self._lock:
                            active_ips.append(ip)
                        logger.debug(f"Hôte actif: {ip} (latence: {latency:.1f}ms)")
                except Exception as e:
                    logger.debug(f"Erreur ping {futures[future]}: {e}")

        return sorted(active_ips, key=lambda ip: ipaddress.ip_address(ip))

    def _ping_host(self, ip: str) -> bool:
        """
        Ping un hôte via ICMP (si root) ou TCP fallback.
        """
        system = platform.system().lower()

        # Méthode 1: TCP connect sur port 80/443/22 (fonctionne sans root)
        for port in [80, 443, 22, 135, 445]:
            if self._tcp_ping(ip, port):
                return True

        # Méthode 2: Commande système ping (nécessite parfois root)
        try:
            if system == "windows":
                cmd = ["ping", "-n", "1", "-w", str(int(self.timeout * 1000)), ip]
            else:
                cmd = ["ping", "-c", "1", "-W", str(int(self.timeout)), ip]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout + 2,
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return False

    def _tcp_ping(self, ip: str, port: int, timeout: Optional[float] = None) -> bool:
        """Tente une connexion TCP pour vérifier si l'hôte est actif."""
        timeout = timeout or self.timeout
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((ip, port))
            sock.close()
            return result == 0
        except (socket.timeout, socket.error, OSError):
            return False

    # -----------------------------------------------------------------------
    # Phase 2: Scan de ports sur les hôtes actifs
    # -----------------------------------------------------------------------

    def _scan_hosts_ports(self, active_ips: List[str]) -> List[DiscoveredHost]:
        """
        Pour chaque hôte actif, scan les ports et collecte les informations.
        """
        hosts: List[DiscoveredHost] = []
        scanned = 0

        def scan_single_host(ip: str) -> DiscoveredHost:
            """Scan complet d'un hôte unique."""
            host = DiscoveredHost(
                ip=ip,
                status=HostStatus.ONLINE,
                scan_timestamp=time.time(),
                last_seen=datetime.now().isoformat(),
            )

            # Résolution DNS inverse
            if self.enable_dns_lookup:
                host.hostname = self._reverse_dns(ip)

            # Détection MAC (si sur le même sous-réseau)
            host.mac = self._get_mac_address(ip)

            # Détection vendor depuis MAC
            if host.mac:
                host.vendor = self._lookup_vendor(host.mac)

            # Scan des ports
            open_ports = self._scan_ports(ip)
            host.open_ports = open_ports

            # Services déduits des ports ouverts
            host.services = list(set(
                port.service.value for port in open_ports
            ))

            # OS fingerprint basique
            if self.enable_os_guess:
                host.os_guess = self._guess_os(open_ports, ip)

            # Détection gateway
            host.is_gateway = self._is_gateway(ip)

            # Latence
            start = time.perf_counter()
            self._tcp_ping(ip, 80, timeout=1.0)
            host.latency_ms = (time.perf_counter() - start) * 1000

            return host

        with ThreadPoolExecutor(max_workers=min(50, len(active_ips))) as executor:
            futures = {executor.submit(scan_single_host, ip): ip for ip in active_ips}

            for future in as_completed(futures):
                scanned += 1
                try:
                    host = future.result(timeout=30)
                    with self._lock:
                        hosts.append(host)
                    logger.info(
                        f"[{scanned}/{len(active_ips)}] {host.ip} — "
                        f"{len(host.open_ports)} ports ouverts — "
                        f"services: {', '.join(host.services) or 'aucun'}"
                    )
                except Exception as e:
                    logger.error(f"Erreur scan {futures[future]}: {e}")

        # Trier par IP
        hosts.sort(key=lambda h: ipaddress.ip_address(h.ip))
        return hosts

    def _scan_ports(self, ip: str) -> List[OpenPort]:
        """
        Scan les ports configurés sur un hôte.
        Effectue un banner grabbing si activé.
        """
        open_ports: List[OpenPort] = []

        def check_port(port: int) -> Optional[OpenPort]:
            """Vérifie un port unique."""
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(self.timeout)
                result = sock.connect_ex((ip, port))

                if result == 0:
                    service = DEFAULT_PORTS.get(port, ServiceType.UNKNOWN)
                    banner = ""

                    # Banner grabbing
                    if self.enable_banner_grab:
                        banner = self._grab_banner(sock, service)

                    sock.close()
                    return OpenPort(
                        port=port,
                        state=PortState.OPEN,
                        service=service,
                        banner=banner,
                    )
                else:
                    sock.close()
                    return None

            except (socket.timeout, socket.error, OSError):
                return None

        with ThreadPoolExecutor(max_workers=min(50, len(self.ports))) as executor:
            futures = {executor.submit(check_port, port): port for port in self.ports}

            for future in as_completed(futures):
                try:
                    port_result = future.result(timeout=self.timeout + 2)
                    if port_result:
                        with self._lock:
                            open_ports.append(port_result)
                except Exception:
                    pass

        # Trier par numéro de port
        open_ports.sort(key=lambda p: p.port)
        return open_ports

    def _grab_banner(self, sock: socket.socket, service: ServiceType) -> str:
        """
        Tente de récupérer la bannière d'un service.
        """
        try:
            sock.settimeout(2.0)

            # Pour certains services, il faut envoyer une requête
            if service == ServiceType.HTTP:
                sock.sendall(b"HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n")
            elif service == ServiceType.HTTPS:
                return "[HTTPS - TLS handshake required]"

            # Lire la réponse
            banner = sock.recv(1024).decode("utf-8", errors="ignore").strip()
            return banner[:200] if banner else ""

        except (socket.timeout, socket.error, OSError):
            return ""

    # -----------------------------------------------------------------------
    # Méthodes utilitaires
    # -----------------------------------------------------------------------

    def _reverse_dns(self, ip: str) -> str:
        """Résolution DNS inverse."""
        try:
            hostname, _, _ = socket.gethostbyaddr(ip)
            return hostname
        except (socket.herror, socket.gaierror, OSError):
            return ""

    def _get_mac_address(self, ip: str) -> str:
        """
        Récupère l'adresse MAC d'un hôte sur le réseau local.
        Utilise ARP sur Linux/Mac, ou la table ARP sur Windows.
        """
        system = platform.system().lower()

        try:
            if system == "linux":
                # Lire la table ARP
                with open("/proc/net/arp", "r") as f:
                    for line in f:
                        if ip in line:
                            parts = line.split()
                            if len(parts) >= 4:
                                return parts[3].upper()

            elif system == "darwin":
                result = subprocess.run(
                    ["arp", "-n", ip],
                    capture_output=True, text=True, timeout=5
                )
                for line in result.stdout.split("\n"):
                    if ip in line:
                        parts = line.split()
                        for part in parts:
                            if ":" in part and len(part) == 17:
                                return part.upper()

            elif system == "windows":
                result = subprocess.run(
                    ["arp", "-a", ip],
                    capture_output=True, text=True, timeout=5
                )
                for line in result.stdout.split("\n"):
                    if ip in line:
                        parts = line.split()
                        for part in parts:
                            if "-" in part and len(part) == 17:
                                return part.replace("-", ":").upper()

        except (FileNotFoundError, subprocess.TimeoutExpired, OSError, IOError):
            pass

        return ""

    def _lookup_vendor(self, mac: str) -> str:
        """
        Identifie le fabricant à partir des 3 premiers octets de l'adresse MAC.
        Base de données simplifiée des OUI courants.
        """
        oui_prefix = mac.replace(":", "").replace("-", "")[:6].upper()

        # Base de données OUI simplifiée (les plus courants)
        OUI_DATABASE = {
            "00:50:56": "VMware",
            "00:0C:29": "VMware",
            "00:1C:42": "Parallels",
            "08:00:27": "VirtualBox",
            "00:15:5D": "Microsoft Hyper-V",
            "60:45:BD": "Microsoft",
            "AC:DE:48": "Microsoft",
            "B4:2E:99": "Apple",
            "3C:22:FB": "Apple",
            "A4:83:E7": "Apple",
            "F8:FF:C2": "Apple",
            "3C:15:FB": "Apple",
            "DC:A6:32": "Raspberry Pi",
            "B8:27:EB": "Raspberry Pi",
            "E4:5F:01": "Raspberry Pi",
            "D8:3A:DD": "Raspberry Pi",
            "00:1A:11": "Google",
            "54:60:09": "Google",
            "F4:F5:E8": "Google",
            "00:1E:06": "WIBRAIN (Odroid)",
            "00:16:3E": "Xen",
            "52:54:00": "QEMU/KVM",
            "00:1C:14": "QEMU/KVM",
            "DE:AD:BE": "Unknown VM",
            "00:03:FF": "Microsoft",
            "4C:ED:FB": "ASUS",
            "00:1D:09": "Dell",
            "00:14:22": "Dell",
            "B0:83:FE": "Dell",
            "3C:EC:EF": "Supermicro",
            "00:25:90": "Supermicro",
            "00:0A:F7": "Broadcom",
            "00:1B:21": "Intel",
            "00:1E:67": "Intel",
            "3C:97:0E": "Intel",
            "A4:C3:F0": "Intel",
            "48:51:B7": "Intel",
            "8C:8C:AB": "Intel",
            "D4:3D:7E": "Intel",
            "F8:63:3F": "Intel",
            "00:15:17": "Intel",
            "44:85:00": "Intel",
            "68:05:CA": "Intel",
            "C8:5B:76": "Intel",
            "00:50:F2": "Microsoft",
            "7C:B2:7D": "Intel",
            "30:86:42": "Arista",
            "00:17:F2": "Apple",
            "F0:18:98": "Apple",
            "C8:2A:14": "Apple",
            "68:FE:F7": "Apple",
            "44:2A:60": "Apple",
            "00:26:BB": "Apple",
            "CC:08:E0": "Apple",
            "14:10:9F": "Apple",
            "70:56:81": "Apple",
            "0C:4D:E9": "Apple",
            "34:36:3B": "Apple",
            "78:4F:43": "Apple",
            "98:01:A7": "Apple",
            "28:6A:BA": "Apple",
            "E0:B9:BA": "Apple",
            "D0:23:DB": "Apple",
            "B0:65:BD": "Apple",
            "00:25:00": "Apple",
            "A8:60:B6": "Apple",
            "BC:52:B7": "Apple",
            "F0:D1:A9": "Apple",
            "9C:04:EB": "Apple",
            "34:15:9E": "Apple",
            "50:EA:F6": "SEGA",
            "FC:25:3F": "Apple",
            "1C:36:BB": "Apple",
            "3C:07:54": "Apple",
            "88:E9:FE": "Apple",
            "C0:1A:DA": "Apple",
            "40:A6:D9": "Apple",
            "78:31:C1": "Apple",
            "78:3A:84": "Apple",
            "54:4E:90": "Apple",
            "6C:40:08": "Apple",
            "24:A0:74": "Apple",
            "F0:99:BF": "Apple",
            "68:DB:CA": "Apple",
            "88:66:A5": "Apple",
            "8C:85:90": "Apple",
            "C8:69:CD": "Apple",
            "D0:E1:40": "Apple",
            "8C:7C:92": "Apple",
            "70:DE:E2": "Apple",
            "18:E7:F4": "Apple",
            "B0:CA:68": "Apple",
            "C8:BC:C8": "Apple",
            "48:74:6E": "Apple",
            "7C:6D:F8": "Intel",
            "48:F1:7F": "Intel",
            "98:54:1B": "Intel",
            "0C:7A:15": "Intel",
            "40:A3:CC": "Intel",
            "E8:6A:64": "Samsung",
            "B0:72:BF": "Murata (Samsung)",
            "94:B8:6D": "Intel",
            "30:3A:64": "Intel",
            "80:86:F2": "Intel",
            "E4:70:B8": "Intel",
            "50:7B:9D": "LCFC(Lenovo)",
            "5C:80:B6": "Intel",
            "C4:B3:01": "Cisco",
            "00:19:07": "Cisco",
            "00:17:94": "Cisco",
            "00:0E:0C": "Intel",
            "00:0E:B6": "Riverbed",
            "00:1C:C4": "HP",
            "00:25:B3": "HP",
            "2C:27:D7": "HP",
            "9C:B6:D0": "HP",
            "00:1B:78": "HP",
            "00:1E:4F": "HP",
            "00:21:5A": "HP",
            "00:23:7D": "HP",
            "00:24:81": "HP",
            "00:26:55": "HP",
            "2C:44:FD": "HP",
            "30:8D:99": "HP",
            "9C:8E:99": "HP",
            "00:04:23": "Intel",
            "00:08:02": "HP",
            "00:08:C7": "HP",
            "00:0A:57": "HP",
            "00:0B:CD": "Hewlett Packard",
            "00:0D:9D": "HP",
            "00:0F:20": "HP",
            "00:11:0A": "HP",
            "00:12:79": "HP",
            "00:13:21": "HP",
            "00:14:38": "HP",
            "00:15:60": "HP",
            "00:17:A4": "HP",
            "00:18:FE": "HP",
            "00:19:B8": "HP",
            "00:1A:4B": "HP",
            "00:1C:C4": "HP",
            "00:1F:29": "HP",
            "00:21:5A": "HP",
            "00:22:64": "HP",
            "00:23:7D": "HP",
            "00:24:81": "HP",
            "00:25:B3": "HP",
            "00:26:55": "HP",
        }

        # Recherche avec différents formats
        for prefix_fmt in [oui_prefix, f"{oui_prefix[:2]}:{oui_prefix[2:4]}:{oui_prefix[4:6]}"]:
            if prefix_fmt in OUI_DATABASE:
                return OUI_DATABASE[prefix_fmt]

        # Détection VM par préfixe
        if oui_prefix.startswith("005056") or oui_prefix.startswith("000C29"):
            return "VMware"
        if oui_prefix.startswith("080027"):
            return "VirtualBox"
        if oui_prefix.startswith("525400"):
            return "QEMU/KVM"
        if oui_prefix.startswith("00163E"):
            return "Xen"

        return "Unknown"

    def _guess_os(self, open_ports: List[OpenPort], ip: str) -> str:
        """
        Estime le système d'exploitation basé sur les ports ouverts.
        Analyse heuristique simple (pas de fingerprint TCP avancé).
        """
        services = set(p.service for p in open_ports)
        ports = set(p.port for p in open_ports)

        # Indicateurs Windows
        windows_indicators = {
            ServiceType.RDP in services,
            135 in ports,  # MS RPC
            139 in ports,  # NetBIOS
            445 in ports,  # SMB
        }

        # Indicateurs Linux/Unix
        linux_indicators = {
            ServiceType.SSH in services,
            445 not in ports,
            135 not in ports,
        }

        windows_score = sum(windows_indicators)
        linux_score = sum(linux_indicators)

        # Vérifier les bannières
        for port in open_ports:
            if "Windows" in port.banner or "Microsoft" in port.banner:
                return "Windows"
            if "Linux" in port.banner or "Ubuntu" in port.banner or "Debian" in port.banner:
                return "Linux"
            if "FreeBSD" in port.banner:
                return "FreeBSD"
            if "macOS" in port.banner or "Darwin" in port.banner:
                return "macOS"

        if windows_score >= 2:
            return "Windows (probable)"
        elif linux_score >= 2 and ServiceType.SSH in services:
            return "Linux/Unix (probable)"
        elif ServiceType.VNC in services and ServiceType.SSH in services:
            return "Linux/Unix (VNC+SSH)"
        elif ServiceType.RDP in services:
            return "Windows (RDP détecté)"
        elif ServiceType.SSH in services:
            return "Linux/Unix (SSH détecté)"

        return "Inconnu"

    def _is_gateway(self, ip: str) -> bool:
        """Vérifie si l'IP est la passerelle par défaut."""
        try:
            system = platform.system().lower()

            if system == "linux":
                result = subprocess.run(
                    ["ip", "route", "show", "default"],
                    capture_output=True, text=True, timeout=5
                )
                return ip in result.stdout

            elif system == "windows":
                result = subprocess.run(
                    ["route", "print", "0.0.0.0"],
                    capture_output=True, text=True, timeout=5
                )
                return ip in result.stdout

            elif system == "darwin":
                result = subprocess.run(
                    ["netstat", "-rn", "-f", "inet"],
                    capture_output=True, text=True, timeout=5
                )
                return ip in result.stdout

        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass

        return False

    # -----------------------------------------------------------------------
    # Méthodes de scan rapide (single host)
    # -----------------------------------------------------------------------

    def scan_single_host(self, ip: str) -> DiscoveredHost:
        """
        Scan rapide d'un hôte unique.
        Utile pour vérifier l'état d'une machine spécifique.
        """
        host = DiscoveredHost(
            ip=ip,
            scan_timestamp=time.time(),
            last_seen=datetime.now().isoformat(),
        )

        # Vérifier si l'hôte est actif
        is_alive = self._ping_host(ip)
        if not is_alive:
            host.status = HostStatus.OFFLINE
            return host

        host.status = HostStatus.ONLINE

        # DNS inverse
        host.hostname = self._reverse_dns(ip)

        # MAC
        host.mac = self._get_mac_address(ip)
        if host.mac:
            host.vendor = self._lookup_vendor(host.mac)

        # Ports
        host.open_ports = self._scan_ports(ip)
        host.services = list(set(p.service.value for p in host.open_ports))

        # OS guess
        host.os_guess = self._guess_os(host.open_ports, ip)

        # Gateway check
        host.is_gateway = self._is_gateway(ip)

        return host

    def quick_check(self, ip: str) -> bool:
        """Vérification rapide si un hôte est actif (ping only)."""
        return self._ping_host(ip)

    # -----------------------------------------------------------------------
    # Méthodes de scan pour services distants spécifiques
    # -----------------------------------------------------------------------

    def check_remote_desktop_services(self, ip: str) -> Dict[str, bool]:
        """
        Vérifie rapidement la disponibilité des services de bureau distant.
        Retourne un dict avec l'état de chaque protocole.
        """
        services = {
            "ssh": False,
            "vnc": False,
            "rdp": False,
        }

        # SSH (port 22)
        services["ssh"] = self._tcp_ping(ip, 22)

        # VNC (ports 5900-5905)
        for port in range(5900, 5906):
            if self._tcp_ping(ip, port):
                services["vnc"] = True
                break

        # RDP (port 3389)
        services["rdp"] = self._tcp_ping(ip, 3389)

        return services

    def get_vnc_displays(self, ip: str) -> List[int]:
        """Détecte les displays VNC actifs sur un hôte."""
        displays = []
        for port in range(5900, 5910):
            if self._tcp_ping(ip, port):
                displays.append(port - 5900)
        return displays


# ---------------------------------------------------------------------------
# Fonctions utilitaires de haut niveau
# ---------------------------------------------------------------------------

def get_local_subnet() -> str:
    """
    Détecte automatiquement le sous-réseau local.
    Retourne le CIDR du réseau local (ex: '192.168.1.0/24').
    """
    try:
        import netifaces
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                for addr in addrs[netifaces.AF_INET]:
                    ip = addr.get("addr", "")
                    netmask = addr.get("netmask", "")
                    if ip and netmask and not ip.startswith("127."):
                        network = ipaddress.ip_network(f"{ip}/{netmask}", strict=False)
                        return str(network)
    except ImportError:
        pass

    # Fallback: détection basique
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()

        # Supposer un /24
        parts = local_ip.split(".")
        return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    except Exception:
        return "192.168.1.0/24"


def quick_network_scan(subnet: Optional[str] = None) -> ScanResult:
    """
    Lance un scan rapide du réseau local.
    Si aucun sous-réseau n'est fourni, détecte automatiquement.
    """
    if not subnet:
        subnet = get_local_subnet()

    scanner = NetworkScanner(
        subnet=subnet,
        timeout=1.5,
        max_workers=150,
        enable_banner_grab=False,  # Plus rapide
    )
    return scanner.scan()


# ---------------------------------------------------------------------------
# Point d'entrée (test standalone)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    logging.basicConfig(level=logging.INFO)

    subnet = get_local_subnet()
    print(f"\n{'='*60}")
    print(f"  ATIBON Network Scanner")
    print(f"  Sous-réseau détecté: {subnet}")
    print(f"{'='*60}\n")

    scanner = NetworkScanner(
        subnet=subnet,
        timeout=2.0,
        max_workers=100,
    )

    def progress(current: int, total: int):
        pct = (current / total) * 100
        print(f"\r  Progression: {current}/{total} ({pct:.1f}%)", end="", flush=True)

    scanner.set_progress_callback(progress)

    print("  Lancement du scan...\n")
    result = scanner.scan()

    print(f"\n\n{'='*60}")
    print(f"  Résultats du scan")
    print(f"{'='*60}")
    print(f"  Durée: {result.duration_seconds:.2f}s")
    print(f"  Hôtes scannés: {result.total_hosts_scanned}")
    print(f"  Hôtes actifs: {result.hosts_found}")
    print(f"{'='*60}\n")

    for host in result.hosts:
        protocols = []
        if host.has_ssh:
            protocols.append("SSH")
        if host.has_vnc:
            protocols.append("VNC")
        if host.has_rdp:
            protocols.append("RDP")
        if host.has_smb:
            protocols.append("SMB")

        print(f"  {host.ip:<18} {host.hostname or '—':<25} "
              f"{'|'.join(protocols) or '—':<20} "
              f"{host.os_guess or '—'}")

    print(f"\n{'='*60}\n")
