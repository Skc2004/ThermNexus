package com.thermalnexus.controller;

import org.java_websocket.server.WebSocketServer;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import java.net.InetSocketAddress;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class TelemetryServer extends WebSocketServer {
    private final Set<WebSocket> conns;

    public TelemetryServer(int port) {
        super(new InetSocketAddress(port));
        conns = Collections.newSetFromMap(new ConcurrentHashMap<>());
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        conns.add(conn);
        System.out.println("New UI connection established: " + conn.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        conns.remove(conn);
        System.out.println("UI connection lost: " + conn.getRemoteSocketAddress());
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        // Will be used for Manual Overrides from the UI mapped back into GhostLink
        System.out.println("Received override command: " + message);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        ex.printStackTrace();
    }

    @Override
    public void onStart() {
        System.out.println("Telemetry WebSocket server streaming on Port: " + getPort());
    }

    public void broadcastTelemetry(int currentPwm, long lastHeartbeat, boolean isFailsafe) {
        if (conns.isEmpty()) return;
        
        String json = String.format("{\"pwm\":%d, \"heartbeat\":%d, \"failsafe\":%b}", 
                currentPwm, lastHeartbeat, isFailsafe);
        broadcast(json);
    }
}
