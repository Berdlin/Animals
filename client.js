// client.js - FULL UPDATED CODE (Handles Lobby and Game)

// 1. INITIAL CONNECTION
const socket = io();
let isHost = false;

// Function to safely get a DOM element
const getEl = (id) => document.getElementById(id);

// DOM elements for lobby management (check if they exist before using)
const connectionScreen = getEl('connection-screen');
const lobbyScreen = getEl('lobby-screen');
const usernameInput = getEl('usernameInput');
const displayCode = getEl('displayCode');
const playerList = getEl('playerList');
const playerCount = getEl('playerCount');
const startButton = getEl('startButton');
const errorMessage = getEl('error-message');


// =======================================================
// UTILITY FUNCTIONS
// =======================================================

function getUsername() {
    // Try to get username from input, or fallback to stored value
    const name = usernameInput ? usernameInput.value.trim() : localStorage.getItem('gameUsername');
    if (!name || name === '') {
        return 'Unnamed Player';
    }
    // Store in localStorage for use across pages
    localStorage.setItem('gameUsername', name);
    return name;
}

// =======================================================
// LOBBY FUNCTIONS (User interaction)
// =======================================================

function hostGame() {
    const username = getUsername();
    if (username === 'Unnamed Player') {
        errorMessage.textContent = 'Please enter a username.';
        return;
    }
    socket.emit('hostGame', { username });
    isHost = true;
    if (errorMessage) errorMessage.textContent = 'Hosting...';
}

function joinGame() {
    const code = getEl('joinCode').value.trim();
    const username = getUsername();
    
    if (username === 'Unnamed Player') {
        errorMessage.textContent = 'Please enter a username.';
        return;
    }

    if (code.length !== 4) {
        errorMessage.textContent = 'Room code must be 4 digits.';
        return;
    }
    socket.emit('joinGame', code, { username });
    if (errorMessage) errorMessage.textContent = 'Joining...';
}

function startGame() {
    if (!isHost) {
        if (errorMessage) errorMessage.textContent = 'Only the host can start the game.';
        return;
    }
    socket.emit('startGame');
}


// =======================================================
// SOCKET.IO LOBBY HANDLERS
// =======================================================

// Host: Room created successfully
socket.on('roomCreated', (code) => {
    // Save state for game screen
    localStorage.setItem('gameRoomCode', code);
    localStorage.setItem('hostId', socket.id);

    if (connectionScreen) connectionScreen.style.display = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'block';
    if (displayCode) displayCode.textContent = code;
    if (startButton) startButton.style.display = 'inline-block';
    if (errorMessage) errorMessage.textContent = '';
});

// Joiner: Join attempt failed
socket.on('joinFailed', (message) => {
    if (errorMessage) errorMessage.textContent = message;
});

// Joiner: Joined successfully
socket.on('joinSuccess', (code) => {
    // Save state for game screen
    localStorage.setItem('gameRoomCode', code);
    
    if (connectionScreen) connectionScreen.style.display = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'block';
    if (displayCode) displayCode.textContent = code;
    // Hide start button for non-hosts, unless we update the hostId on client side
    // For now, assume hostId is only set on the host's machine.
    if (startButton) startButton.style.display = 'none';
    if (errorMessage) errorMessage.textContent = '';
});

// Host/Joiner: Player list updated
socket.on('lobbyUpdate', (players) => {
    if (playerList) {
        playerList.innerHTML = ''; // Clear current list
        players.forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            playerList.appendChild(li);
        });
    }
    if (playerCount) playerCount.textContent = players.length;
});

// Host/Joiner: Game started
socket.on('gameStarted', () => {
    // Redirect all clients to the game screen
    window.location.href = 'multiplay.html'; 
});

// Host/Joiner: Host left the game
socket.on('hostLeft', (message) => {
    alert(message);
    // Clear room data and return to intro
    localStorage.removeItem('gameRoomCode');
    localStorage.removeItem('hostId');
    window.location.href = 'gameintro.html';
});

// Clean up old placeholder code at the end of client.js, as game logic 
// will now be self-contained in multiplay.html's script block.