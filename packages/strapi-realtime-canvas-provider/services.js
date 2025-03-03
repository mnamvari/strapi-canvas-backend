'use strict';

module.exports = ({ strapi }) => ({
  // Get current state of a canvas
  getCanvasState(canvasId) {
    const room = strapi.rooms.get(canvasId);
    return room || { lines: [], participants: new Set() };
  },
  
  // Broadcast an event to all clients in a room
  broadcastToCanvas(canvasId, event, data) {
    strapi.io.to(canvasId).emit(event, data);
  },
  
  // Get participant count for a canvas
  getParticipantCount(canvasId) {
    const room = strapi.rooms.get(canvasId);
    return room ? room.participants.size : 0;
  }
});