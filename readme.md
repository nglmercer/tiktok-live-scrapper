# TikTok LIVE Protobuf Translation Service

A protobuf translation service that processes TikTok LIVE buffers or base64 data and returns translated data via HTTP or WebSocket.

## Features

- Decode TikTok LIVE protobuf messages
- Encode JSON objects to protobuf format
- RESTful API for data processing
- Real-time communication through WebSocket
- Support for different input formats (buffer, base64)

## Installation

```bash
# Install dependencies
bun install

# Start server in development mode
bun run dev

# Start server in production mode
bun run start
```

## Usage

### REST API

#### Decode protobuf message

Send a buffer or base64 data to decode it to JSON:

```bash
# Using base64
curl -X POST http://localhost:8080/translate \
  -H "Content-Type: application/json" \
  -d '{"base64": "ChQKBU1lc3NhZ2USBggBEAEYASCwAQM="}'

# Using buffer (array of bytes)
curl -X POST http://localhost:8080/translate \
  -H "Content-Type: application/json" \
  -d '{"buffer": [8, 132, 131, 248, 173, 1, 18, 4, 77, 101, 115, 115]}'

# Sending binary directly
curl -X POST http://localhost:8080/translate \
  -H "Content-Type: application/octet-stream" \
  --data-binary @/path/to/file.bin
```

#### Encode JSON object to protobuf

```bash
curl -X POST http://localhost:8080/encode \
  -H "Content-Type: application/json" \
  -d '{
    "protoName": "WebcastWebsocketMessage",
    "data": {
      "id": "12345",
      "type": "msg",
      "binary": "ZWplbXBsbw=="
    }
  }'
```

### WebSocket

Connect to the WebSocket endpoint for real-time processing:

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  // Decode a message from base64
  ws.send(JSON.stringify({
    action: 'decode',
    base64: 'ChQKBU1lc3NhZ2USBggBEAEYASCwAQM='
  }));
  
  // Encode a JSON object to protobuf
  ws.send(JSON.stringify({
    action: 'encode',
    protoName: 'WebcastWebsocketMessage',
    data: {
      id: '12345',
      type: 'msg'
    }
  }));
  
  // Send directly a base64 string without JSON format
  ws.send('ChQKBU1lc3NhZ2USBggBEAEYASCwAQM=');
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Response:', response);
};
```

## Examples

In the `examples/` folder you'll find complete examples:

- `http-client.js`: HTTP client with REST API usage examples
- `ws-client.js`: WebSocket client with real-time communication examples

## Endpoints

- `POST /translate`: Decode protobuf from buffer or base64
- `POST /encode`: Encode JSON to protobuf
- `GET /ws`: WebSocket for real-time processing

## Supported Message Types

The service supports the following TikTok message types:

- `WebcastControlMessage`
- `WebcastChatMessage`
- `WebcastGiftMessage`
- `WebcastLikeMessage`
- `WebcastMemberMessage`
- `WebcastSocialMessage`
- `WebcastRoomUserSeqMessage`
- `WebcastSubNotifyMessage`
- `WebcastEmoteChatMessage`

## Architecture

The service is structured as follows:

```
src/
├── server/
│   └── index.ts          # Main server with HTTP and WebSocket endpoints
├── services/
│   └── protobufService.ts# Encoding/decoding logic
├── utils/
│   ├── messageDecoder.ts # Protobuf processing utilities
│   └── tiktokSchema.proto# TikTok protobuf schema
└── types/
    └── index.ts          # TypeScript type definitions
```

## Dependencies

- `hono`: Lightweight web framework for the server
- `protobufjs`: Library for processing protobuf files
- `ws`: WebSocket implementation for Node.js
- `@hono/node-server`: Node.js server for Hono

## License

ISC