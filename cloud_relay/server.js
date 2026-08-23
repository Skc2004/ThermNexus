const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let latestTelemetry = {};

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // When the Python local node pushes data
  socket.on('push_telemetry', (data) => {
    latestTelemetry = data;
    // Broadcast to all listening web/mobile clients
    socket.broadcast.emit('telemetry_update', data);
  });

  // When a mobile client requests the latest state
  socket.on('request_state', () => {
    socket.emit('telemetry_update', latestTelemetry);
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ThermNexus Cloud Relay listening on port ${PORT}`);
});
