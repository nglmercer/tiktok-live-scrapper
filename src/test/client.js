const eventsContainer = document.getElementById('events');
const usernameInput = document.getElementById('usernameInput');
const subscribeButton = document.getElementById('subscribeButton');

const socket = new WebSocket('ws://localhost:8080');

socket.onopen = () => {
    console.log('Connected to the server!');
    addEventLog('Server Connection: OPEN');
};

socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Received:', message);
    
    let logText = `<b>Event: ${message.event}</b>`;
    if (message.data?.uniqueId) {
        logText += ` | User: ${message.data.uniqueId}`;
    }
    if (message.data?.comment) {
        logText += ` | Chat: ${message.data.comment}`;
    }
     if (message.data?.gift?.gift_id) {
        logText += ` | Gift: ${message.data.gift.gift_id} (x${message.data.repeat_count})`;
    }
    
    addEventLog(logText);
};

socket.onclose = () => {
    console.log('Disconnected from the server.');
    addEventLog('Server Connection: CLOSED');
};

socket.onerror = (error) => {
    console.error('WebSocket Error:', error);
    addEventLog('Server Connection: ERROR');
};

subscribeButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            action: 'subscribe',
            username: username
        }));
        addEventLog(`Subscribed to: ${username}`);
        usernameInput.value = '';
    }
});

function addEventLog(text) {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event';
    eventDiv.innerHTML = text;
    eventsContainer.prepend(eventDiv);
}