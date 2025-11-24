const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:8080/ws");

ws.on("open", function open() {
  console.log("Connected to WebSocket server");

  setTimeout(() => {
    console.log("\nExample 1: Decode message from base64");
    ws.send(
      JSON.stringify({
        action: "decode",
        base64: "ChQKBU1lc3NhZ2USBggBEAEYASCwAQM=",
      }),
    );

    setTimeout(() => {
      console.log("\nExample 2: Encode JSON to protobuf");
      ws.send(
        JSON.stringify({
          action: "encode",
          protoName: "WebcastWebsocketMessage",
          data: {
            id: "12345",
            type: "msg",
            binary: Buffer.from("example").toString("base64"),
          },
        }),
      );
    }, 1000);

    setTimeout(() => {
      console.log("\nExample 3: Decode direct base64 (without JSON)");
      ws.send("ChQKBU1lc3NhZ2USBggBEAEYASCwAQM=");
    }, 2000);

    setTimeout(() => {
      ws.close();
    }, 4000);
  }, 500);
});

ws.on("message", function message(data) {
  try {
    const response = JSON.parse(data);
    console.log("Server response:", JSON.stringify(response, null, 2));
  } catch (error) {
    console.log("Server response:", data.toString());
  }
});

ws.on("close", function close() {
  console.log("\nConnection closed");
});

ws.on("error", function error(err) {
  console.error("WebSocket error:", err.message);
});

console.log("Starting WebSocket client...");
console.log("Make sure the server is running at http://localhost:8080");
