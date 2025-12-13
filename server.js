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
  perMessageDeflate: false,
  clientTracking: true,
  // Handle WebSocket upgrade requests
  verifyClient: (info) => {
    // Allow all origins for WebSocket connections (CORS handled at HTTP level)
    return true;
  }
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
  const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  
  console.log(`New WebSocket connection from ${clientIp}`);
  
  // Send initial connection confirmation after connection is fully established
  // Use setImmediate to ensure connection is ready
  setImmediate(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connection established' }));
      } catch (error) {
        console.error(`Error sending connection confirmation to ${clientIp}:`, error);
      }
    }
  });
  
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
  
  // Send ping to keep connection alive (important for Render)
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (error) {
        console.error(`Error sending ping to ${clientIp}:`, error);
        clearInterval(pingInterval);
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
  
  // Handle pong response
  ws.on('pong', () => {
    // Connection is alive
  });
});

// Handle WebSocket server errors
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Signaling server running on ${HOST}:${PORT}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT} (or wss:// in production)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    wss.close(() => {
      console.log('WebSocket server closed');
      process.exit(0);
    });
  });
});
