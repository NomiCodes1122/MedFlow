import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { config } from '../config/index.js';
import { logger } from '../common/logging/logger.js';

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  if (io) {
    return io;
  }

  io = new SocketServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.on('connection', (socket: Socket) => {
    const clientIp = socket.handshake.address;
    logger.info(
      { socketId: socket.id, ip: clientIp, query: socket.handshake.query },
      'Socket.IO client connected'
    );

    socket.on('disconnect', (reason: string) => {
      logger.info({ socketId: socket.id, reason }, 'Socket.IO client disconnected');
    });

    socket.on('error', (err: Error) => {
      logger.error({ socketId: socket.id, err: err.message }, 'Socket.IO error on socket connection');
    });
  });

  logger.info('Socket.IO server initialized successfully');
  return io;
}

export function getSocketServer(): SocketServer {
  if (!io) {
    throw new Error('Socket.IO server has not been initialized. Call initSocketServer first.');
  }
  return io;
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;

  return new Promise<void>((resolve) => {
    io?.close(() => {
      logger.info('Socket.IO server closed cleanly');
      io = null;
      resolve();
    });
  });
}
