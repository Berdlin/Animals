const socket = io();
let isHost = false;
let myId = null;

const getEl = (id) => document.getElementById(id);
const connectionScreen = getEl('connection-screen');
const lobbyScreen = getEl('lobby-screen');
const usernameInput = getEl('usernameInput');
const displayCode = getEl('displayCode');
const playerList = getEl('playerList');
const startButton = getEl('startButton');
const errorMessage = getEl('error-message');

function getUsername() {
    const name = usernameInput ? usernameInput.value.trim() : localStorage.getItem('gameUsername');
    if (!name) return 'Unnamed Hunter';
    localStorage.setItem('gameUsername', name);
    return name;
}

function displayError(msg) { errorMessage.textContent = msg; setTimeout(() => errorMessage.textContent = '', 5000); }

function hostGame() {
    const username = getUsername();
    socket.emit('hostGame', { username });
}

function joinGame() {
    const username = getUsername();
    const code = getEl('joinCode').value.trim();
    if (code.length !== 4) return displayError('Code must be 4 digits.');
    socket.emit('joinGame', code, { username });
}

function startGame() {
    if (isHost) socket.emit('startGame');
}

socket.on('connect', () => { myId = socket.id; });

socket.on('roomCreated', (code) => {
    isHost = true;
    localStorage.setItem('gameRoomCode', code);
    connectionScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
    displayCode.textContent = code;
    startButton.style.display = 'block';
});

socket.on('joinSuccess', (code) => {
    isHost = false;
    localStorage.setItem('gameRoomCode', code);
    connectionScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
    displayCode.textContent = code;
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

socket.on('gameStarted', () => { window.location.href = 'multiplay.html'; });
socket.on('hostLeft', (msg) => { alert(msg); window.location.href = 'gameintro.html'; });