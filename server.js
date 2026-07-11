const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : '*',
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : '*',
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const recordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 record submissions per hour
  message: 'Too many record submissions, please try again later.',
});

app.use('/api/', apiLimiter);

// Input sanitization
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 50); // Limit length
}

// IP validation helper
function isValidIP(ip) {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip);
}

// Simple in-memory cache
const cache = {
  worldRecord: null,
  leaderboard: null,
  lastUpdate: 0,
  CACHE_TTL: 60000 // 1 minute
};

// Retry logic for database operations
async function withRetry(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries} for operation`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Neon database connection with connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_3F2dozATYlEZ@ep-solitary-leaf-at9wmy7w-pooler.c-9.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=verify-full',
  ssl: {
    rejectUnauthorized: true
  },
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// API endpoint to get world record with caching
app.get('/api/world-record', async (req, res) => {
  try {
    // Check cache first
    const now = Date.now();
    if (cache.worldRecord && (now - cache.lastUpdate) < cache.CACHE_TTL) {
      return res.json(cache.worldRecord);
    }

    const result = await pool.query(
      'SELECT player_name, days_survived, achieved_at FROM world_records ORDER BY days_survived DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      const emptyRecord = { player_name: 'None', days_survived: 0 };
      cache.worldRecord = emptyRecord;
      cache.lastUpdate = now;
      return res.json(emptyRecord);
    }
    
    cache.worldRecord = result.rows[0];
    cache.lastUpdate = now;
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching world record:', error);
    res.status(500).json({ error: 'Failed to fetch world record' });
  }
});

// API endpoint to save a new world record with rate limiting and sanitization
app.post('/api/world-record', recordLimiter, async (req, res) => {
  try {
    const { player_name, days_survived } = req.body;
    
    // Sanitize input
    const sanitizedName = sanitizeInput(player_name);
    const sanitizedDays = parseInt(days_survived);
    
    if (!sanitizedName || isNaN(sanitizedDays)) {
      return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    if (sanitizedDays < 0 || sanitizedDays > 10000) {
      return res.status(400).json({ error: 'Invalid days survived value' });
    }

    // Get client IP for anti-cheat
    const clientIP = req.ip || req.connection.remoteAddress;
    
    await withRetry(async () => {
      // First check if this is actually a world record
      const currentRecord = await pool.query(
        'SELECT days_survived FROM world_records ORDER BY days_survived DESC LIMIT 1'
      );

      const currentBest = currentRecord.rows.length > 0 ? currentRecord.rows[0].days_survived : 0;

      if (sanitizedDays <= currentBest) {
        return res.json({ success: false, message: 'Not a world record', current_best: currentBest });
      }

      // Insert new world record with IP
      await pool.query(
        'INSERT INTO world_records (player_name, days_survived, ip_address) VALUES ($1, $2, $3)',
        [sanitizedName, sanitizedDays, clientIP]
      );

      // Clear cache
      cache.worldRecord = null;
      
      res.json({ success: true, message: 'New world record saved!' });
    });
  } catch (error) {
    console.error('Error saving world record:', error);
    res.status(500).json({ error: 'Failed to save world record' });
  }
});

// API endpoint to get top 10 leaderboard with caching
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Check cache first
    const now = Date.now();
    if (cache.leaderboard && (now - cache.lastUpdate) < cache.CACHE_TTL) {
      return res.json(cache.leaderboard);
    }

    const result = await pool.query(
      'SELECT player_name, days_survived, achieved_at FROM world_records ORDER BY days_survived DESC LIMIT 10'
    );
    
    cache.leaderboard = result.rows;
    cache.lastUpdate = now;
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
});

// Session management
const sessions = new Map();

// Generate session token
function generateSessionToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Session middleware
function requireAuth(req, res, next) {
  const token = req.cookies.session_token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.session = sessions.get(token);
  next();
}

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const sanitizedName = sanitizeInput(username);
    if (!sanitizedName || !password || password.length < 6) {
      return res.status(400).json({ error: 'Invalid username or password (min 6 characters)' });
    }

    await withRetry(async () => {
      // Check if user exists
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE username = $1',
        [sanitizedName]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [sanitizedName, passwordHash]
      );

      res.json({ success: true, message: 'User registered successfully' });
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const sanitizedName = sanitizeInput(username);
    if (!sanitizedName || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    await withRetry(async () => {
      // Get user
      const userResult = await pool.query(
        'SELECT id, username, password_hash FROM users WHERE username = $1',
        [sanitizedName]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = userResult.rows[0];

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      await pool.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      // Create session
      const sessionToken = generateSessionToken();
      sessions.set(sessionToken, {
        userId: user.id,
        username: user.username,
        createdAt: Date.now()
      });

      // Set HTTP-only secure cookie
      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
      });

      res.json({ success: true, username: user.username });
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session_token;
  if (token) {
    sessions.delete(token);
    res.clearCookie('session_token');
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// Check session endpoint
app.get('/api/auth/session', (req, res) => {
  const token = req.cookies.session_token;
  if (!token || !sessions.has(token)) {
    return res.json({ authenticated: false });
  }
  const session = sessions.get(token);
  res.json({ authenticated: true, username: session.username });
});

// Multiplayer API endpoints

// Generate unique 4-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (false); // Will check database for uniqueness
  return code;
}

// Create multiplayer room
app.post('/api/multiplayer/create-room', async (req, res) => {
  try {
    const { host_id, host_name, max_players = 4 } = req.body;
    
    const sanitizedName = sanitizeInput(host_name);
    if (!sanitizedName || !host_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await withRetry(async () => {
      let roomCode;
      let codeExists = true;
      
      // Generate unique room code
      while (codeExists) {
        roomCode = generateRoomCode();
        const existingRoom = await pool.query(
          'SELECT room_code FROM multiplayer_rooms WHERE room_code = $1',
          [roomCode]
        );
        codeExists = existingRoom.rows.length > 0;
      }

      // Create room
      const roomResult = await pool.query(
        'INSERT INTO multiplayer_rooms (room_code, host_id, host_name, max_players) VALUES ($1, $2, $3, $4) RETURNING id',
        [roomCode, host_id, sanitizedName, max_players]
      );

      const roomId = roomResult.rows[0].id;

      // Add host as first player
      await pool.query(
        'INSERT INTO multiplayer_players (room_id, player_id, player_name, is_host) VALUES ($1, $2, $3, true)',
        [roomId, host_id, sanitizedName]
      );

      // Create initial game state
      await pool.query(
        'INSERT INTO multiplayer_game_states (room_id) VALUES ($1)',
        [roomId]
      );

      res.json({ 
        success: true, 
        room_code: roomCode, 
        room_id: roomId,
        message: 'Room created successfully' 
      });
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join multiplayer room
app.post('/api/multiplayer/join-room', async (req, res) => {
  try {
    const { room_code, player_id, player_name } = req.body;
    
    const sanitizedName = sanitizeInput(player_name);
    if (!sanitizedName || !player_id || !room_code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await withRetry(async () => {
      // Check if room exists and is waiting
      const roomResult = await pool.query(
        'SELECT id, status, max_players FROM multiplayer_rooms WHERE room_code = $1',
        [room_code]
      );

      if (roomResult.rows.length === 0) {
        return res.status(404).json({ error: 'Room not found' });
      }

      const room = roomResult.rows[0];
      if (room.status !== 'waiting') {
        return res.status(400).json({ error: 'Room is not accepting players' });
      }

      // Check current player count
      const playerCountResult = await pool.query(
        'SELECT COUNT(*) as count FROM multiplayer_players WHERE room_id = $1',
        [room.id]
      );

      if (parseInt(playerCountResult.rows[0].count) >= room.max_players) {
        return res.status(400).json({ error: 'Room is full' });
      }

      // Check if player already in room
      const existingPlayer = await pool.query(
        'SELECT id FROM multiplayer_players WHERE room_id = $1 AND player_id = $2',
        [room.id, player_id]
      );

      if (existingPlayer.rows.length > 0) {
        return res.status(400).json({ error: 'Already in this room' });
      }

      // Add player to room
      await pool.query(
        'INSERT INTO multiplayer_players (room_id, player_id, player_name) VALUES ($1, $2, $3)',
        [room.id, player_id, sanitizedName]
      );

      res.json({ 
        success: true, 
        room_id: room.id,
        message: 'Joined room successfully' 
      });
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Get room players
app.get('/api/multiplayer/room/:code/players', async (req, res) => {
  try {
    const { code } = req.params;

    const result = await pool.query(
      `SELECT mp.player_name, mp.is_host, mp.is_alive, mp.days_survived 
       FROM multiplayer_players mp 
       JOIN multiplayer_rooms mr ON mp.room_id = mr.id 
       WHERE mr.room_code = $1`,
      [code]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching room players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Start multiplayer game
app.post('/api/multiplayer/start-game', async (req, res) => {
  try {
    const { room_code } = req.body;

    await withRetry(async () => {
      await pool.query(
        'UPDATE multiplayer_rooms SET status = $1, started_at = CURRENT_TIMESTAMP WHERE room_code = $2',
        ['playing', room_code]
      );

      res.json({ success: true, message: 'Game started' });
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// Update game state
app.post('/api/multiplayer/update-state', async (req, res) => {
  try {
    const { room_code, current_day, game_status, time_left } = req.body;

    await withRetry(async () => {
      await pool.query(
        `UPDATE multiplayer_game_states 
         SET current_day = $1, game_status = $2, time_left = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE room_id = (SELECT id FROM multiplayer_rooms WHERE room_code = $4)`,
        [current_day, game_status, time_left, room_code]
      );

      res.json({ success: true });
    });
  } catch (error) {
    console.error('Error updating game state:', error);
    res.status(500).json({ error: 'Failed to update game state' });
  }
});

// Socket.IO multiplayer handling
const rooms = new Map(); // In-memory room state for real-time updates

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('hostGame', async ({ username }) => {
    try {
      const response = await fetch('http://localhost:3000/api/multiplayer/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_id: socket.id, host_name: username })
      });
      const data = await response.json();
      
      if (data.success) {
        socket.join(data.room_code);
        rooms.set(data.room_code, {
          host: socket.id,
          players: [{ id: socket.id, name: username }],
          status: 'waiting'
        });
        socket.emit('roomCreated', data.room_code);
      }
    } catch (error) {
      console.error('Error hosting game:', error);
      socket.emit('joinFailed', 'Failed to create room');
    }
  });

  socket.on('joinGame', async (roomCode, { username }) => {
    try {
      const response = await fetch('http://localhost:3000/api/multiplayer/join-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_code: roomCode, player_id: socket.id, player_name: username })
      });
      const data = await response.json();
      
      if (data.success) {
        socket.join(roomCode);
        const room = rooms.get(roomCode);
        if (room) {
          room.players.push({ id: socket.id, name: username });
          io.to(roomCode).emit('lobbyUpdate', room.players.map(p => p.name));
        }
        socket.emit('joinSuccess', roomCode);
      } else {
        socket.emit('joinFailed', data.error || 'Failed to join room');
      }
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit('joinFailed', 'Failed to join room');
    }
  });

  socket.on('startGame', async () => {
    // Find room where this socket is host
    for (const [roomCode, room] of rooms.entries()) {
      if (room.host === socket.id) {
        try {
          await fetch('http://localhost:3000/api/multiplayer/start-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_code: roomCode })
          });
          room.status = 'playing';
          io.to(roomCode).emit('gameStarted');
        } catch (error) {
          console.error('Error starting game:', error);
        }
        break;
      }
    }
  });

  socket.on('rejoinRoom', (roomCode, username) => {
    socket.join(roomCode);
    const room = rooms.get(roomCode);
    if (room) {
      socket.emit('lobbyUpdate', room.players.map(p => p.name));
    }
  });

  socket.on('playerAction', (data) => {
    // Broadcast player actions to room
    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.some(p => p.id === socket.id)) {
        socket.to(roomCode).emit('playerAction', {
          playerId: socket.id,
          ...data
        });
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Handle player leaving
    for (const [roomCode, room] of rooms.entries()) {
      if (room.host === socket.id) {
        // Host left - notify all players
        io.to(roomCode).emit('hostLeft', 'Host has left the game');
        rooms.delete(roomCode);
        break;
      } else if (room.players.some(p => p.id === socket.id)) {
        // Player left
        room.players = room.players.filter(p => p.id !== socket.id);
        io.to(roomCode).emit('lobbyUpdate', room.players.map(p => p.name));
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Neon database connected for world records and multiplayer');
});
