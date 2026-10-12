import { Server } from 'socket.io';

let io;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true },
  });
  io.on('connection', (socket) => {
    socket.on('join', (showId) => socket.join(`show:${Number(showId)}`));
    socket.on('leave', (showId) => socket.leave(`show:${Number(showId)}`));
  });
  return io;
}

/** Tell everyone looking at this show that the seat map changed. Clients refetch. */
export function notifySeatsChanged(showId) {
  io?.to(`show:${Number(showId)}`).emit('seats:changed', { showId: Number(showId) });
}
