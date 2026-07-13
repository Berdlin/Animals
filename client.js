// Use current domain for socket connection
const SERVER_URL = window.location.origin;

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"], // Support both for better compatibility
  upgrade: true
});
let isHost = false;
let myId = null;

const getEl = (id) => document.getElementById(id);
const connectionScreen = getEl('connection-screen');
const lobbyScreen = getEl('lobby-screen');
const usernameInput = getEl('usernameInput');
const roomNameInput = getEl('roomNameInput');
const displayCode = getEl('displayCode');
const roomNameDisplay = getEl('roomNameDisplay');
const playerList = getEl('playerList');
const startButton = getEl('startButton');
const errorMessage = getEl('error-message');
const usernameDisplay = getEl('username-display');

async function getUsername() {
    // Try to get authenticated username first
    try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        if (data.authenticated && data.username) {
            localStorage.setItem('gameUsername', data.username);
            return data.username;
        }
    } catch (error) {
        console.error('Session check error:', error);
    }
    
    // Fall back to input or localStorage
    const name = usernameInput ? usernameInput.value.trim() : localStorage.getItem('gameUsername');
    if (!name) return 'Unnamed Hunter';
    localStorage.setItem('gameUsername', name);
    return name;
}

function displayError(msg) { errorMessage.textContent = msg; setTimeout(() => errorMessage.textContent = '', 5000); }

async function hostGame() {
    const username = await getUsername();
    const roomName = roomNameInput ? roomNameInput.value.trim() : '';
    socket.emit('hostGame', { username, roomName });
}

async function joinGame() {
    const username = await getUsername();
    const code = getEl('joinCode').value.trim();
    if (code.length !== 4) return displayError('Code must be 4 digits.');
    socket.emit('joinGame', code, { username });
}

function leaveRoom() {
    localStorage.removeItem('gameRoomCode');
    window.location.href = 'index.html';
}

function startGame() {
    if (isHost) socket.emit('startGame');
}

socket.on('connect', () => { myId = socket.id; });

// Load username on page load
window.addEventListener('load', async () => {
    try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        if (data.authenticated && data.username) {
            usernameDisplay.textContent = `Playing as: ${data.username}`;
        }
    } catch (error) {
        console.error('Session check error:', error);
    }
});

socket.on('roomCreated', (data) => {
    console.log('Room created response:', data);
    isHost = true;
    if (data.room_code) {
        localStorage.setItem('gameRoomCode', data.room_code);
        console.log('Room code stored in localStorage:', data.room_code);
        connectionScreen.style.display = 'none';
        lobbyScreen.style.display = 'block';
        displayCode.textContent = data.room_code;
        if (data.room_name) {
            roomNameDisplay.textContent = `Room: ${data.room_name}`;
        }
        startButton.style.display = 'block';
    } else {
        console.error('No room_code in response:', data);
        displayError('Failed to create room - no code received');
    }
});

socket.on('joinSuccess', (data) => {
    isHost = false;
    localStorage.setItem('gameRoomCode', data.room_code);
    connectionScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
    displayCode.textContent = data.room_code;
    if (data.room_name) {
        roomNameDisplay.textContent = `Room: ${data.room_name}`;
    }
    startButton.style.display = 'none';
});

socket.on('joinFailed', (msg) => displayError(msg));

socket.on('lobbyUpdate', (players) => {
    playerList.innerHTML = '';
    players.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        playerList.appendChild(li);
    });
});

socket.on('gameStarted', () => { 
    console.log('Game started, redirecting to multiplayer');
    const roomCode = localStorage.getItem('gameRoomCode');
    console.log('Room code before redirect:', roomCode);
    if (!roomCode || roomCode === 'undefined') {
        console.error('Invalid room code, cannot start game');
        alert('Error: Invalid room code');
        return;
    }
    window.location.href = 'multiplay.html'; 
});
socket.on('hostLeft', (msg) => { 
    alert(msg); 
    localStorage.removeItem('gameRoomCode');
    window.location.href = 'index.html'; 
});