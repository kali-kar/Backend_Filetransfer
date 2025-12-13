/**
 * WebRTC Signaling Server
 * 
 * This server only handles signaling (SDP offer/answer and ICE candidates).
 * NO file data passes through this server - all file transfer happens
 * directly between peers via WebRTC DataChannels.
 */

const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);

// CORS middleware for cross-origin requests
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Signaling server is running' });
});

// WebSocket server for signaling
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false
});

// Store active rooms: roomId -> Set of WebSocket connections
const rooms = new Map();

/**
 * Generate a random room ID
 */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Broadcast message to all peers in a room except sender
 */
function broadcastToRoom(roomId, message, excludeWs) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

/**
 * Remove WebSocket from room
 */
function removeFromRoom(roomId, ws) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.delete(ws);
  
  if (room.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty)`);
  } else {
    // Notify other peers that someone left
    broadcastToRoom(roomId, { type: 'peer-left' }, ws);
  }
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  let currentRoomId = null;
  const clientIp = req.socket.remoteAddress;
  
  console.log(`New WebSocket connection from ${clientIp}`);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'create-room':
          // Generate new room ID
          const newRoomId = generateRoomId();
          currentRoomId = newRoomId;
          
          if (!rooms.has(newRoomId)) {
            rooms.set(newRoomId, new Set());
          }
          rooms.get(newRoomId).add(ws);
          
          ws.send(JSON.stringify({
            type: 'room-created',
            roomId: newRoomId
          }));
          
          console.log(`Room created: ${newRoomId} (from ${clientIp})`);
          break;
          
        case 'join-room':
          const joinRoomId = message.roomId;
          
          if (!rooms.has(joinRoomId)) {
            rooms.set(joinRoomId, new Set());
          }
          
          const room = rooms.get(joinRoomId);
          
          if (room.size >= 2) {
            ws.send(JSON.stringify({
              type: 'room-full',
              message: 'Room is full (maximum 2 peers allowed)'
            }));
            return;
          }
          
          currentRoomId = joinRoomId;
          room.add(ws);
          
          // Notify the other peer that someone joined
          broadcastToRoom(joinRoomId, {
            type: 'peer-joined'
          }, ws);
          
          ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: joinRoomId
          }));
          
          console.log(`Peer joined room: ${joinRoomId} (from ${clientIp})`);
          break;
          
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Forward signaling messages to other peers in the room
          if (currentRoomId) {
            broadcastToRoom(currentRoomId, message, ws);
          }
          break;
          
        default:
          console.log(`Unknown message type: ${message.type} from ${clientIp}`);
      }
    } catch (error) {
      console.error(`Error handling message from ${clientIp}:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  ws.on('close', () => {
    console.log(`WebSocket connection closed (${clientIp})`);
    if (currentRoomId) {
      removeFromRoom(currentRoomId, ws);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
    if (currentRoomId) {
      removeFromRoom(currentRoomId, ws);
    }
  });
  
  // Send ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
