const http = require("http");

function makeRequest(path, data, callback) {
  const postData = JSON.stringify(data);

  const options = {
    hostname: "localhost",
    port: 8080,
    path: path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const req = http.request(options, (res) => {
    let responseData = "";

    res.on("data", (chunk) => {
      responseData += chunk;
    });

    res.on("end", () => {
      try {
        const response = JSON.parse(responseData);
        callback(null, response);
      } catch (error) {
        callback(error, null);
      }
    });
  });

  req.on("error", (error) => {
    callback(error, null);
  });

  req.write(postData);
  req.end();
}

console.log("Example 1: Decode message from base64");
makeRequest(
  "/translate",
  {
    base64: "ChQKBU1lc3NhZ2USBggBEAEYASCwAQM=",
  },
  (error, response) => {
    if (error) {
      console.error("Error:", error.message);
    } else {
      console.log("Response:", JSON.stringify(response, null, 2));
    }

    console.log("\nExample 2: Encode JSON to protobuf");
    makeRequest(
      "/encode",
      {
        protoName: "WebcastWebsocketMessage",
        data: {
          id: "12345",
          type: "msg",
          binary: Buffer.from("example").toString("base64"),
        },
      },
      (error, response) => {
        if (error) {
          console.error("Error:", error.message);
        } else {
          console.log("Response:", JSON.stringify(response, null, 2));
        }

        console.log("\nExample 3: Decode message from buffer");
        makeRequest(
          "/translate",
          {
            buffer: [8, 132, 131, 248, 173, 1, 18, 4, 77, 101, 115, 115],
          },
          (error, response) => {
            if (error) {
              console.error("Error:", error.message);
            } else {
              console.log("Response:", JSON.stringify(response, null, 2));
            }

            console.log("\nExamples completed.");
          },
        );
      },
    );
  },
);
