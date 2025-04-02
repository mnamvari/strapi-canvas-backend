'use strict';

module.exports = {
  register(/* { strapi } */) {},

  bootstrap({ strapi }) {
    console.log("Initializing Socket.IO server...");
    const { Server } = require("socket.io");

    const io = new Server(strapi.server.httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
      }
    });
  
    // Attach Socket.IO instance to Strapi
    strapi.io = io;

    // Initialize rooms for canvas sessions
    strapi.rooms = new Map();

    // Set up event handlers
    io.on('connection', (socket) => {
      console.log(`New connection: ${socket.id}`);

      // Handle joining canvas room
      socket.on('join-canvas', (canvasId) => {
        console.log(`join-canvas: ${canvasId}`);
        socket.join(canvasId);
        
        // Initialize room if it doesn't exist
        if (!strapi.rooms.has(canvasId)) {
          strapi.rooms.set(canvasId, {
            lines: [],
            participants: new Set(),
          });
        }
        
        const room = strapi.rooms.get(canvasId);
        room.participants.add(socket.id);
        
        // Send current state to the new participant
        socket.emit('canvas-state', {
          lines: room.lines,
          participantCount: room.participants.size
        });
        
        // Notify others about new participant
        io.to(canvasId).emit('participant-count', room.participants.size);
        
        console.log(`Socket ${socket.id} joined canvas ${canvasId}`);
      });

      // Handle drawing events
      socket.on('draw', ({ canvasId, line }) => {
        console.log(`Draw event received for canvas ${canvasId}:`, line);
        const room = strapi.rooms.get(canvasId);
        
        if (room) {
          // Add the new line to the canvas state
          room.lines.push(line);
          
          // Broadcast to all other clients in this room
          socket.to(canvasId).emit('line-added', line);
          console.log(`Broadcasting line-added to room ${canvasId}`);
        }
      });

      // Handle line updates (while drawing)
      socket.on('update-line', ({ canvasId, lineId, points }) => {
        const room = strapi.rooms.get(canvasId);
        
        if (room) {
          // Find the line by ID
          const lineIndex = room.lines.findIndex(line => line.id === lineId);
          if (lineIndex !== -1) {
            // Update the line points
            room.lines[lineIndex].points = points;
            
            // Broadcast to all other clients in this room
            socket.to(canvasId).emit('line-updated', { lineId, points });
          }
        }
      });

      // Handle canvas clear
      socket.on('clear-canvas', (canvasId) => {
        const room = strapi.rooms.get(canvasId);
        
        if (room) {
          room.lines = [];
          io.to(canvasId).emit('canvas-cleared');
        }
      });

      // Handle disconnections
      socket.on('disconnect', () => {
        // Find all rooms this socket was part of
        for (const [canvasId, room] of strapi.rooms.entries()) {
          if (room.participants.has(socket.id)) {
            room.participants.delete(socket.id);
            
            // Notify remaining participants
            io.to(canvasId).emit('participant-count', room.participants.size);
            
            // Clean up empty rooms after 30 seconds (as per requirements)
            if (room.participants.size === 0) {
              setTimeout(() => {
                if (room.participants.size === 0) {
                  strapi.rooms.delete(canvasId);
                  console.log(`Removed empty canvas ${canvasId}`);
                }
              }, 30000);
            }
          }
        }
        
        console.log(`Socket disconnected: ${socket.id}`);
      });
    });
  },

  /**
   * Services to expose 
   */
  services: {
    realtime: require('./services')
  }
};