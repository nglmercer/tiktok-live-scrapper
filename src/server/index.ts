import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { serve } from "@hono/node-server";

import type { WebSocketMessage } from "../types";
import { ProtobufService } from "../services/protobufService";

const app = new Hono();

const { upgradeWebSocket } = createBunWebSocket();

const PORT = Number(process.env.PORT || 8080);

app.get("/", (c) => {
  return c.text(
    "TikTok LIVE WebSocket Server running - Connect via WebSocket to /ws",
  );
});

app.post("/translate", async (c) => {
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    const result = await ProtobufService.decode(body);

    if (result.success && result.data) {
      return c.json({
        success: true,
        decoded: result.data,
      });
    } else {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        400,
      );
    }
  } else if (contentType.includes("application/octet-stream")) {
    try {
      const binaryData = Buffer.from(await c.req.arrayBuffer());
      const result = await ProtobufService.decode({
        buffer: Array.from(binaryData),
      });

      if (result.success && result.data) {
        return c.json({
          success: true,
          decoded: result.data,
        });
      } else {
        return c.json(
          {
            success: false,
            error: result.error,
          },
          400,
        );
      }
    } catch (error) {
      return c.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error processing binary",
        },
        500,
      );
    }
  } else {
    return c.json(
      {
        success: false,
        error:
          "Unsupported content type. Use application/json with base64/buffer or application/octet-stream",
      },
      400,
    );
  }
});

app.post("/encode", async (c) => {
  const body = await c.req.json();
  const { protoName, data } = body;

  if (!protoName || !data) {
    return c.json(
      {
        success: false,
        error: 'Missing "protoName" and "data" in request body',
      },
      400,
    );
  }

  const result = await ProtobufService.encode(protoName, data);

  if (result.success && result.data) {
    return c.json({
      success: true,
      ...result.data,
    });
  } else {
    return c.json(
      {
        success: false,
        error: result.error,
      },
      500,
    );
  }
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    return {
      onMessage(event, ws) {
        try {
          let binaryData: Buffer;

          if (typeof event.data === "string") {
            try {
              const jsonData = JSON.parse(event.data);
              if (jsonData.action === "decode") {
                if (jsonData.base64) {
                  binaryData = Buffer.from(jsonData.base64, "base64");
                } else if (jsonData.buffer) {
                  binaryData = Buffer.from(new Uint8Array(jsonData.buffer));
                } else {
                  ws.send(
                    JSON.stringify({
                      error: 'Missing "base64" or "buffer" to decode',
                    }),
                  );
                  return;
                }

                ProtobufService.decode({ base64: jsonData.base64 }).then(
                  (result) => {
                    if (result.success) {
                      ws.send(
                        JSON.stringify({
                          action: "decoded",
                          success: true,
                          data: result.data,
                        }),
                      );
                    } else {
                      ws.send(
                        JSON.stringify({
                          action: "decoded",
                          success: false,
                          error: result.error,
                        }),
                      );
                    }
                  },
                );
              } else if (jsonData.action === "encode") {
                if (!jsonData.protoName || !jsonData.data) {
                  ws.send(
                    JSON.stringify({
                      error: 'Missing "protoName" and "data" to encode',
                    }),
                  );
                  return;
                }

                ProtobufService.encode(jsonData.protoName, jsonData.data).then(
                  (result) => {
                    if (result.success) {
                      ws.send(
                        JSON.stringify({
                          action: "encoded",
                          success: true,
                          ...result.data,
                        }),
                      );
                    } else {
                      ws.send(
                        JSON.stringify({
                          action: "encoded",
                          success: false,
                          error: result.error,
                        }),
                      );
                    }
                  },
                );
              }
            } catch (parseError) {
              binaryData = Buffer.from(event.data, "base64");

              ProtobufService.decode({ base64: event.data }).then((result) => {
                if (result.success) {
                  ws.send(
                    JSON.stringify({
                      action: "decoded",
                      success: true,
                      data: result.data,
                    }),
                  );
                } else {
                  ws.send(
                    JSON.stringify({
                      action: "decoded",
                      success: false,
                      error: result.error,
                    }),
                  );
                }
              });
            }
          } else if (
            event.data instanceof Buffer ||
            event.data instanceof ArrayBuffer
          ) {
            binaryData = Buffer.isBuffer(event.data)
              ? event.data
              : Buffer.from(event.data as ArrayBuffer);

            ProtobufService.decode({ buffer: Array.from(binaryData) }).then(
              (result) => {
                if (result.success) {
                  ws.send(
                    JSON.stringify({
                      action: "decoded",
                      success: true,
                      data: result.data,
                    }),
                  );
                } else {
                  ws.send(
                    JSON.stringify({
                      action: "decoded",
                      success: false,
                      error: result.error,
                    }),
                  );
                }
              },
            );
          }
        } catch (error) {
          console.error("Error processing WebSocket message:", error);
          ws.send(
            JSON.stringify({
              error: "Error processing message",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
          );
        }
      },
      onOpen(event, ws) {
        console.log("[Server] New client connected");
        ws.send(
          JSON.stringify({
            status: "connected",
            message: "Connected to protobuf translation service",
            actions: ["decode", "encode"],
          }),
        );
      },
      onClose() {
        console.log("[Server] Client disconnected");
      },
      onError(error) {
        console.error("[Server] WebSocket connection error:", error);
      },
    };
  }),
);

console.log(`Starting server on port ${PORT}...`);
console.log("Available endpoints:");
console.log(
  `  POST http://localhost:${PORT}/translate - Decode protobuf from buffer or base64`,
);
console.log(`  POST http://localhost:${PORT}/encode - Encode JSON to protobuf`);
console.log(
  `  WS ws://localhost:${PORT}/ws - Real-time translation via WebSocket`,
);

const hasBun = typeof (globalThis as any).Bun !== "undefined";

if (hasBun) {
  (globalThis as any).Bun.serve(
    {
      port: PORT,
      fetch(req: any, server: any) {
        const url = new URL(req.url);
        if (
          url.pathname === "/ws" &&
          req.headers.get("upgrade") === "websocket"
        ) {
          const success = server.upgrade(req, {
            data: {},
          });
          if (success) {
            return new Response(null, { status: 101 });
          }
        }
        return app.fetch(req);
      },
      websocket: {
        open(ws: any) {
          console.log("[Bun WS] Connection opened globally");
        },
        close(ws: any) {
          console.log("[Bun WS] Connection closed globally");
        },
        message(ws: any, message: any) {},
        error(ws: any, error: any) {
          console.error("[Bun WS] Global error:", error);
        },
      },
    },
    (serverInstance: any) => {
      console.log(
        `HTTP server listening on http://localhost:${serverInstance.port}`,
      );
      console.log(
        `WebSocket ready at ws://localhost:${serverInstance.port}/ws`,
      );
    },
  );
} else {
  serve(
    {
      port: PORT,
      fetch: app.fetch,
    },
    (info) => {
      console.log(`HTTP server listening on http://localhost:${info.port}`);
      console.log(`WebSocket ready at ws://localhost:${info.port}/ws`);
    },
  );
}

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM signal - Shutting down server...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT signal (Ctrl+C) - Shutting down server...");
  process.exit(0);
});
