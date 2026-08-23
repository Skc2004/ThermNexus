import socket
import threading
import time
import json
import logging
import platform

log = logging.getLogger("Swarm")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [SWARM] %(message)s")

SWARM_PORT = 8890
MAGIC_HEADER = "THERMNEXUS_SWARM"

discovered_nodes = {}

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def broadcast_presence():
    """Broadcasts presence over UDP."""
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    
    local_ip = get_local_ip()
    hostname = platform.node()
    
    while True:
        try:
            payload = json.dumps({
                "magic": MAGIC_HEADER,
                "hostname": hostname,
                "ip": local_ip,
                "timestamp": time.time()
            }).encode('utf-8')
            udp_socket.sendto(payload, ('<broadcast>', SWARM_PORT))
        except Exception as e:
            log.debug(f"Broadcast error: {e}")
        time.sleep(5)

def listen_for_peers():
    """Listen for other ThermNexus nodes."""
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # Bind to all interfaces
    udp_socket.bind(('', SWARM_PORT))
    
    local_ip = get_local_ip()
    
    while True:
        try:
            data, addr = udp_socket.recvfrom(1024)
            peer_ip = addr[0]
            if peer_ip == local_ip:
                continue # Ignore self
                
            payload = json.loads(data.decode('utf-8'))
            if payload.get("magic") == MAGIC_HEADER:
                hostname = payload.get("hostname", "Unknown")
                if peer_ip not in discovered_nodes:
                    log.info(f"Discovered new ThermNexus Node: {hostname} ({peer_ip})")
                
                discovered_nodes[peer_ip] = {
                    "hostname": hostname,
                    "last_seen": time.time()
                }
        except Exception as e:
            pass

def prune_dead_nodes():
    """Remove nodes we haven't heard from in 15 seconds."""
    while True:
        now = time.time()
        to_delete = [ip for ip, data in discovered_nodes.items() if now - data["last_seen"] > 15]
        for ip in to_delete:
            log.info(f"Node lost: {discovered_nodes[ip]['hostname']} ({ip})")
            del discovered_nodes[ip]
        time.sleep(5)

def start_swarm():
    threading.Thread(target=broadcast_presence, daemon=True).start()
    threading.Thread(target=listen_for_peers, daemon=True).start()
    threading.Thread(target=prune_dead_nodes, daemon=True).start()
    log.info("ThermNexus Swarm Discovery active.")

if __name__ == "__main__":
    start_swarm()
    while True:
        time.sleep(1)
        with open("/tmp/thermnexus_nodes.json", "w") as f:
            json.dump(discovered_nodes, f)
