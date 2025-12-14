// server.js - FULL AUTHORITATIVE GAME ENGINE CODE

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server); 

const PORT = process.env.PORT || 3000;

// =======================================================
// GAME CONFIGURATION 
// =======================================================

const GAME_TICK = 50; // 20 updates per second (50ms)
const GAME_TICK_SECONDS = GAME_TICK / 1000;
// Player speed adjusted to feel similar to 6px/33ms from original logic
const PLAYER_SPEED = 6 * (1000 / 33) * GAME_TICK_SECONDS; 
const WOLF_SPEED = 5 * (1000 / 33) * GAME_TICK_SECONDS;
const MAP_SIZE = 600;
const MAX_WOLF_HP = 50;
const START_TIME_SECONDS = 60;

// Loot Table (Moved from client to server)
const loot = [
    { name: "Summoning Potion", type: "potion", icon: "🧪", rare: true },
    { name: "Iron Sword (+2 DMG)", type: "dmg", val: 2, icon: "⚔️" },
    { name: "Health Elixir (+20 HP)", type: "hp", val: 20, icon: "🍷" },
    { name: "Rotten Flesh (-5 HP)", type: "bad", val: -5, icon: "🥩" },
    { name: "Rusty Dagger (+1 DMG)", type: "dmg", val: 1, icon: "🗡️" },
    { name: "Magic Shield (+50 HP)", type: "hp", val: 50, icon: "🛡️" },
    { name: "Cursed Skull (-2 DMG)", type: "bad_dmg", val: -2, icon: "💀" },
];

// Initial Chest Positions
const chestPositions = [
    {x:100,y:100}, {x:300,y:100}, {x:500,y:100},
    {x:100,y:300}, {x:500,y:300},
    {x:100,y:500}, {x:300,y:500}, {x:500,y:500}
];

// =======================================================
// UTILITY FUNCTIONS
// =======================================================

const distance = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]); 
    return code;
}

function initPlayerState(id, username) {
    return {
        id,
        username,
        x: 300 + Math.random() * 50 - 25, // Spawn near center
        y: 300 + Math.random() * 50 - 25,
        dx: 0, // Server-controlled velocity
        dy: 0,
        hp: 10,
        dmg: 1,
        alive: true,
        inventory: [],
        companion: { active: false, level: 1, x: 0, y: 0, attackTimer: 0 },
        actionQueue: [], // For single-trigger events like loot/use item
    };
}

function spawnChests() {
    const chests = [];
    
    // Ensure potion exists (first chest)
    chests.push({ ...chestPositions[0], opened: false, reward: loot.find(i => i.type === 'potion') || loot[0] });

    for(let i=1; i<chestPositions.length; i++) {
        const randItem = loot[Math.floor(Math.random() * loot.length)];
        chests.push({ ...chestPositions[i], opened: false, reward: randItem });
    }
    return chests;
}


// =======================================================
// GAME ROOM STATE MANAGEMENT 
// =======================================================

// Global state to track rooms
const rooms = {};

// 2. Serve Client Files
app.use(express.static(path.join(__dirname, 'public'))); // Assuming all client files are in a 'public' folder

// =======================================================
// CORE GAME LOGIC / GAME LOOP
// =======================================================

function gameLoop(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameStarted || room.status === 'over') return;
    
    // 1. Check & Update Timer
    if (room.status === 'collection') {
        // Only decrease timer every 20 ticks (1 second)
        if (room.timerTickCount % (1000 / GAME_TICK) === 0) {
            room.timer--;
        }
        room.timerTickCount++;

        if (room.timer <= 0) {
            room.status = 'chase';
            room.message = "THE ALPHA WOLF IS HERE! RUN!";
            room.wolf = { 
                x: 50, 
                y: 50, 
                hp: MAX_WOLF_HP, 
                maxHp: MAX_WOLF_HP, 
                attackCooldown: Date.now() 
            };
        }
    }

    // 2. Process Player Inputs & Movement
    for (const playerId in room.players) {
        const player = room.players[playerId];
        if (!player.alive) continue;

        // Process movement
        if (player.dx !== 0 || player.dy !== 0) {
            player.x += player.dx * PLAYER_SPEED;
            player.y += player.dy * PLAYER_SPEED;

            // Clamp position
            player.x = clamp(player.x, 20, MAP_SIZE - 20);
            player.y = clamp(player.y, 20, MAP_SIZE - 20);
        }

        // Process single-trigger actions (Loot, Use Item, Upgrade)
        while (player.actionQueue.length > 0) {
            const action = player.actionQueue.shift();
            
            if (action.type === 'loot') {
                handleLootAction(player, room);
            } else if (action.type === 'useItem') {
                handleUseItemAction(player, room, action.data.index);
            } else if (action.type === 'upgradeCompanion') {
                handleUpgradeCompanion(player, room);
            }
        }

        // 3. Companion Movement
        if (player.companion.active) {
            // Simple follow
            player.companion.x += (player.x - player.companion.x) * 0.1;
            player.companion.y += (player.y - player.companion.y) * 0.1;
        }
    }

    // 4. Alpha Wolf & Combat Logic
    if (room.status === 'chase' || room.status === 'battle') {
        handleWolfAI(room);
    }
    
    // 5. Check Game Over Conditions
    const alivePlayers = Object.values(room.players).filter(p => p.alive);
    if (alivePlayers.length === 0) {
        endGame(roomCode, false, "All players have been defeated by the Alpha Wolf.");
        return;
    }
    if (room.wolf.hp <= 0 && room.status !== 'over') { // Check wolf HP only if game is not already over
        endGame(roomCode, true, "VICTORY! The Alpha Wolf has been defeated.");
        return;
    }

    // 6. Broadcast state
    io.to(roomCode).emit('gameStateUpdate', {
        status: room.status,
        timer: room.timer,
        players: room.players,
        chests: room.chests,
        wolf: room.wolf,
        endReason: room.endReason,
        message: room.message,
    });
    room.message = ''; // Clear temporary messages
}

function handleLootAction(player, room) {
    let found = false;
    for (let i = 0; i < room.chests.length; i++) {
        const c = room.chests[i];
        if (!c.opened && distance(player, c) < 50) {
            c.opened = true;
            
            // Apply Immediate Stats
            if (c.reward.type === 'hp') player.hp += c.reward.val;
            if (c.reward.type === 'dmg') player.dmg = Math.max(1, player.dmg + c.reward.val);
            if (c.reward.type === 'bad') player.hp += c.reward.val;
            if (c.reward.type === 'bad_dmg') player.dmg = Math.max(1, player.dmg + c.reward.val);
            
            // Add to Inventory
            if (c.reward.type === 'potion') {
                 // Potions are a special use case, they are added to inventory
                 player.inventory.push(c.reward);
            } else {
                 // For all other rewards, just update status and show message (don't store)
            }
            
            room.message = `${player.username} found: ${c.reward.name}`;
            found = true;
            
            if(player.hp <= 0) {
                player.alive = false;
                room.message = `${player.username} died from a cursed chest.`;
            }
            break; 
        }
    }
    if (!found) room.message = `${player.username}: No chest nearby.`;
}

function handleUseItemAction(player, room, index) {
    const item = player.inventory[index];
    if (!item) {
        room.message = `${player.username}: Slot ${index + 1} is empty.`;
        return;
    }

    if (item.type === 'potion') {
        if (player.companion.active) {
            room.message = `${player.username}: The Summoning Potion is already used.`;
            return;
        }
        player.companion.active = true;
        player.companion.level = 1;
        player.companion.x = player.x + 30;
        player.companion.y = player.y;
        
        // Remove the potion
        player.inventory.splice(index, 1);
        room.message = `${player.username} summoned a Companion Wolf! (Lvl 1)`;
    } else {
        // If the item is in inventory and is not the potion, treat it as already used/passive or ignore.
        // Since only the potion is kept in inventory in the loot logic above, this is mostly for completeness.
        room.message = `${player.username}: Cannot use ${item.name} from inventory.`;
    }
}

function handleUpgradeCompanion(player, room) {
    if(!player.companion.active) return;
    
    player.companion.level++;
    room.message = `${player.username}'s Companion Upgraded! Level ${player.companion.level}. Damage increased!`;
}


function handleWolfAI(room) {
    const wolf = room.wolf;
    if (wolf.hp <= 0) return;

    // Target the closest living player
    let closestPlayer = null;
    let minDistance = Infinity;

    for (const id in room.players) {
        const p = room.players[id];
        if (p.alive) {
            const dist = distance(p, wolf);
            if (dist < minDistance) {
                minDistance = dist;
                closestPlayer = p;
            }
        }
    }

    if (!closestPlayer) return; // No targets left

    // Wolf Movement (Chase)
    const angle = Math.atan2(closestPlayer.y - wolf.y, closestPlayer.x - wolf.x);
    wolf.x += Math.cos(angle) * WOLF_SPEED;
    wolf.y += Math.sin(angle) * WOLF_SPEED;

    // Wolf Combat: Attack Closest Player
    if (minDistance < 40) {
        if (!wolf.lastAttackTime || Date.now() > wolf.lastAttackTime + 1000) {
            closestPlayer.hp -= 2; // Wolf always deals 2 damage
            room.message = `The Alpha Wolf attacks ${closestPlayer.username} for 2 damage!`;
            wolf.lastAttackTime = Date.now();
            
            if (closestPlayer.hp <= 0) {
                closestPlayer.alive = false;
                closestPlayer.dx = 0;
                closestPlayer.dy = 0;
                room.message = `${closestPlayer.username} has been defeated!`;
            }
        }
    }
    
    // Companion Combat
    for (const id in room.players) {
        const p = room.players[id];
        if (p.alive && p.companion.active) {
            const comp = p.companion;
            const compDist = distance(comp, wolf);
            
            if (compDist < 50) { 
                const companionDamage = comp.level * 2;
                if (!comp.attackTimer || Date.now() > comp.attackTimer + 1000) {
                    wolf.hp -= companionDamage;
                    room.message = `${p.username}'s Companion (Lvl ${comp.level}) attacked the Alpha Wolf for ${companionDamage} damage!`;
                    comp.attackTimer = Date.now();
                }
            }
        }
    }
}

function endGame(roomCode, win, reason) {
    const room = rooms[roomCode];
    if (room.status === 'over') return;
    
    room.status = 'over';
    room.endReason = reason;
    room.message = win ? "Game Over: VICTORY" : "Game Over: DEFEAT";
    
    // Stop the game loop
    if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
    }
}


// =======================================================
// SOCKET.IO CONNECTION HANDLING
// =======================================================

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // --- LOBBY EVENTS ---

    // 1. HOST GAME
    socket.on('hostGame', (data) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            playerIds: [], // Simple list of IDs
            gameStarted: false,
            status: 'lobby',
            chests: [],
            wolf: { x: -100, y: -100, hp: MAX_WOLF_HP, maxHp: MAX_WOLF_HP },
            timer: START_TIME_SECONDS,
            timerTickCount: 0, // NEW: Counter for 1 second updates
            interval: null,
            message: '',
        };
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.username = data.username || 'Host';

        const playerState = initPlayerState(socket.id, socket.data.username);
        rooms[roomCode].players[socket.id] = playerState;
        rooms[roomCode].playerIds.push(socket.id);

        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('lobbyUpdate', rooms[roomCode].playerIds.map(id => rooms[roomCode].players[id].username));
    });

    // 2. JOIN GAME
    socket.on('joinGame', (code, data) => {
        const room = rooms[code];
        if (!room) {
            return socket.emit('joinFailed', 'Room not found.');
        }
        if (room.gameStarted) {
            return socket.emit('joinFailed', 'Game already started.');
        }
        
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.username = data.username || 'Player';

        const playerState = initPlayerState(socket.id, socket.data.username);
        room.players[socket.id] = playerState;
        room.playerIds.push(socket.id);

        socket.emit('joinSuccess', code);
        io.to(code).emit('lobbyUpdate', room.playerIds.map(id => room.players[id].username));
    });

    // 3. START GAME (Host only)
    socket.on('startGame', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (!room || socket.id !== room.hostId || room.gameStarted) return;

        room.gameStarted = true;
        room.status = 'collection'; // Initial phase
        room.chests = spawnChests(); // Initialize chests

        // Start the continuous game loop
        room.interval = setInterval(() => gameLoop(roomCode), GAME_TICK);
        
        // 1. Tell clients to switch page
        io.to(roomCode).emit('gameStarted');
        
        // 2. FIX: Call gameLoop immediately to send the initial state to the new multiplay.html clients
        gameLoop(roomCode); 

        console.log(`Game started in room ${roomCode}`);
    });

    // --- GAMEPLAY EVENTS ---
    
    // Player movement/action input
    socket.on('playerAction', (action) => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        const player = room.players[socket.id];

        if (!room || !player || !player.alive || !room.gameStarted) return;
        
        if (action.type === 'move') {
            player.dx = action.dx;
            player.dy = action.dy;
        } else if (action.type === 'stopMove') {
            player.dx = 0;
            player.dy = 0;
        } else if (action.type === 'loot' || action.type === 'useItem' || action.type === 'upgradeCompanion') {
            // Queue single-trigger actions to be processed in the next game tick
            player.actionQueue.push(action);
        }
    });

    // --- DISCONNECTION ---
    socket.on('disconnect', () => {
        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];

        if (room) {
            // Remove the player from the room state
            delete room.players[socket.id];
            room.playerIds = room.playerIds.filter(id => id !== socket.id);
            
            if (room.gameStarted && room.status !== 'over') {
                // Force a final state update for this player's last position/death
                io.to(roomCode).emit('gameStateUpdate', {
                    status: room.status,
                    timer: room.timer,
                    players: room.players,
                    chests: room.chests,
                    wolf: room.wolf,
                    endReason: room.endReason,
                    message: `${socket.data.username} disconnected.`,
                });
            }

            // Notify remaining players
            io.to(roomCode).emit('lobbyUpdate', room.playerIds.map(id => room.players[id].username));

            // Check if the host disconnected
            if (socket.id === room.hostId) {
                console.log(`Host ${socket.id} disconnected from room ${roomCode}. Closing room.`);
                io.to(roomCode).emit('hostLeft', 'The host has disconnected. Returning to intro.');
                if (room.interval) clearInterval(room.interval);
                delete rooms[roomCode];
            } else if (room.playerIds.length === 0) {
                // Clean up empty rooms
                if (room.interval) clearInterval(room.interval);
                delete rooms[roomCode];
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

// 4. Start the Server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the game at http://localhost:${PORT}/gameintro.html`);
});