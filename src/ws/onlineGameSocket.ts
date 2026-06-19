import { Server as IOServer } from 'socket.io';
import * as http from 'http';
import { config } from '../config.js';
import { getGame, startGame, updateInput } from '../modules/osmaLiga/onlineGames.js';
import { InputState } from '../gameEngine/types.js';

export function attachSocketIO(httpServer: http.Server): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io/',
  });

  io.on('connection', (socket) => {
    let roomCode: string | null = null;
    let playerTeam: 'home' | 'guest' | null = null;

    socket.on('join_game', ({ gameCode, playerToken }: { gameCode: string; playerToken: string }) => {
      const code = (gameCode ?? '').toUpperCase();
      const room = getGame(code);
      if (!room) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (room.hostToken === playerToken) {
        playerTeam = 'home';
      } else if (room.guestToken === playerToken) {
        playerTeam = 'guest';
      } else {
        socket.emit('error', { message: 'Invalid token' });
        return;
      }

      roomCode = code;
      void socket.join(code);
      socket.emit('joined_game', { role: playerTeam, status: room.status });

      // Training challenges have no real host client to click "Spustit zápas" —
      // auto-start as soon as the real opponent (guest) connects.
      // The home side then has no controller and plays passively until a
      // training-challenge AI profile is wired into the engine (see TODO.md).
      if (
        room.isTrainingChallenge &&
        playerTeam === 'guest' &&
        room.guestToken !== null &&
        (!room.gameState || room.gameState.status === 'waiting')
      ) {
        const started = startGame(code, (event, data) => {
          io.to(code).emit(event, data);
        });
        if (started) {
          io.to(code).emit('game_started', {});
        }
      }
    });

    socket.on('start_game', () => {
      if (!roomCode || playerTeam !== 'home') {
        socket.emit('error', { message: 'Only host can start' });
        return;
      }
      const room = getGame(roomCode);
      if (!room || room.guestToken === null) {
        socket.emit('error', { message: 'Waiting for guest' });
        return;
      }
      if (room.gameState && room.gameState.status !== 'waiting') {
        socket.emit('error', { message: 'Game already started' });
        return;
      }

      const code = roomCode;
      const started = startGame(code, (event, data) => {
        io.to(code).emit(event, data);
      });

      if (started) {
        io.to(code).emit('game_started', {});
      } else {
        socket.emit('error', { message: 'Failed to start game' });
      }
    });

    socket.on('input', (inputData: InputState) => {
      if (!roomCode || !playerTeam) return;
      // Validate and sanitize
      const clean: InputState = {
        up: !!inputData.up,
        down: !!inputData.down,
        left: !!inputData.left,
        right: !!inputData.right,
        kick: !!inputData.kick,
      };
      updateInput(roomCode, playerTeam, clean);
    });
  });

  return io;
}
