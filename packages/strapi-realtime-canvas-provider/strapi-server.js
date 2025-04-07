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

    // Initialize global z-index counter and locking mechanism for each canvas
    strapi.zIndexCounters = new Map();
    strapi.zIndexLocks = new Map();

    // Add user data structure to store email info
    strapi.canvasUsers = new Map();
    strapi.canvasOwners = new Map();

    // Function to get next z-index with locking to prevent race conditions
    const getNextZIndex = async (canvasId) => {
      // Initialize lock if it doesn't exist
      if (!strapi.zIndexLocks.has(canvasId)) {
        strapi.zIndexLocks.set(canvasId, false);
      }

      // Initialize counter if it doesn't exist
      if (!strapi.zIndexCounters.has(canvasId)) {
        strapi.zIndexCounters.set(canvasId, 0);
      }

      // Wait for lock to be available
      while (strapi.zIndexLocks.get(canvasId)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Acquire lock
      strapi.zIndexLocks.set(canvasId, true);

      try {
        // Get and increment counter
        const nextIndex = strapi.zIndexCounters.get(canvasId);
        strapi.zIndexCounters.set(canvasId, nextIndex + 1);
        return nextIndex;
      } finally {
        // Release lock
        strapi.zIndexLocks.set(canvasId, false);
      }
    };

    // Set up event handlers
    io.on('connection', (socket) => {
      console.log(`New connection: ${socket.id}`);

      let userData = {
        userId: null,
        email: 'Anonymous',
        authenticated: false
      };

      // Extract and verify token
      const token = socket.handshake.auth?.token;

      const processAuthentication = async () => {
        if (token) {
          try {
            // Verify token and get user info
            const decoded = await strapi.plugins['users-permissions'].services.jwt.verify(token);
            if (decoded && decoded.id) {
              const user = await strapi.entityService.findOne('plugin::users-permissions.user', decoded.id, {
                populate: ['role']
              });

              if (user) {
                userData = {
                  userId: user.id,
                  email: user.email,
                  authenticated: true
                };

                // Store user data
                strapi.canvasUsers = strapi.canvasUsers || new Map();
                strapi.canvasUsers.set(socket.id, userData);

                console.log(`Authenticated user connected: ${userData.email}`);
              }
            }
          } catch (error) {
            // Just log the error and continue as anonymous
            console.log('Token authentication failed:', error.message);
          }
        }
      };

      // Call authentication process but don't block connection
      processAuthentication();

      // Handle joining canvas room
      socket.on('join-canvas', (canvasId) => {
        console.log(`join-canvas: ${canvasId}`);
        try {
          strapi.rooms = strapi.rooms || new Map();
          strapi.canvasUsers = strapi.canvasUsers || new Map();
          strapi.canvasOwners = strapi.canvasOwners || new Map();

          socket.join(canvasId);
          console.log(`Socket ${socket.id} joined canvas ${canvasId}`);

          // Initialize room if it doesn't exist
          if (!strapi.rooms.has(canvasId)) {
            strapi.rooms.set(canvasId, {
              shapes: [],
              participants: new Set(),
            });
          }

          const room = strapi.rooms.get(canvasId);
          room.participants.add(socket.id);

          // Set first authenticated user as owner
          if (userData.authenticated && !strapi.canvasOwners.has(canvasId)) {
            strapi.canvasOwners.set(canvasId, userData.email);
            console.log(`Set ${userData.email} as canvas owner for ${canvasId}`);
          }

          const participantDetails = Array.from(room.participants)
              .map(id => {
                const user = strapi.canvasUsers?.get(id) || {email: 'Anonymous', userId: null};
                return {
                  id,
                  email: user.email,
                  isOwner: user.email === strapi.canvasOwners.get(canvasId)
                };
              });

          // Send current state to the new participant
          socket.emit('canvas-state', {
            shapes: room.shapes,
            participantCount: room.participants.size,
            participants: participantDetails,
            owner: strapi.canvasOwners.get(canvasId) || null,
          });

          // Broadcast updated participant list to all users
          io.to(canvasId).emit('participants-updated', {
            participants: participantDetails,
            owner: strapi.canvasOwners.get(canvasId) || null,
          });

          // Notify others about new participant
          io.to(canvasId).emit('participant-count', room.participants.size);
        } catch (error) {
          console.error(`Error handling join-canvas:`, error);
          socket.emit('error', {message: 'Failed to join canvas'});
        }
      });
      // Handle drawing events
      socket.on('draw-shape', async ({ canvasId, shape }) => {
        console.log(`Draw-shape event received for canvas ${canvasId}:`, shape);
        const room = strapi.rooms.get(canvasId);

        if (room) {
          // Get z-index from server
          const zIndex = await getNextZIndex(canvasId);
          console.log("Z-index assigned:", zIndex);

          // Add z-index to the line
          const shapeWithZIndex = { ...shape, zIndex };

          // Add the new shape to the canvas state
          room.shapes.push(shapeWithZIndex);

          // Broadcast to all other clients in this room
          socket.to(canvasId).emit('shape-added', shapeWithZIndex);
          console.log(`Broadcasting shape-added to room ${canvasId}`);
          // Assign the shape z-index to the client
          socket.emit('shape-z-index-assigned', { shapeId: shape.id, zIndex });
        }
      });

      // Handle shape updates (while drawing)
      socket.on('update-shape', ({ canvasId, shapeId, updatedShape }) => {
        const room = strapi.rooms.get(canvasId);

        if (room) {
          // Find the shape by ID
          const shapeIndex = room.shapes.findIndex(shape => shape.id === shapeId);
          if (shapeIndex !== -1) {
            // Update the shape
            room.shapes[shapeIndex] = updatedShape;

            // Broadcast to all other clients in this room
            socket.to(canvasId).emit('shape-updated', { shapeId, updatedShape });
          }
        }
      });

      // Handle canvas clear
      socket.on('clear-canvas', (canvasId) => {
        const room = strapi.rooms.get(canvasId);

        if (room) {
          room.shapes = [];
          io.to(canvasId).emit('canvas-cleared');
        }
      });

      // Handle disconnections
      socket.on('disconnect', () => {
        // Remove user email association
        strapi.canvasUsers.delete(socket.id);

        // Find all rooms this socket was part of
        for (const [canvasId, room] of strapi.rooms.entries()) {
          if (room.participants.has(socket.id)) {
            room.participants.delete(socket.id);

            const participantDetails = Array.from(room.participants).map(id => {
              const user = strapi.canvasUsers.get(id);
              return {
                id,
                email: user?.email || 'Anonymous',
                isOwner: user?.email === strapi.canvasOwners.get(canvasId)
              };
            });

            // Broadcast updated participant list
            io.to(canvasId).emit('participants-updated', {
              participants: participantDetails,
              owner: strapi.canvasOwners.get(canvasId) || null
            });

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
