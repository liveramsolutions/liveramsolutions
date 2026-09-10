// Generate a clean 5-digit ID to avoid long complex strings
const peerIdChars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const peerIdValues = new Uint32Array(8);
crypto.getRandomValues(peerIdValues);
const customId = Array.from(
  peerIdValues,
  (value) => peerIdChars[value % peerIdChars.length],
).join("");

const pairingCodeValues = new Uint32Array(1);
crypto.getRandomValues(pairingCodeValues);
const pairingCode = (100000 + (pairingCodeValues[0] % 900000)).toString();

const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFERED_AMOUNT = 1024 * 1024;
const ACK_INTERVAL = 16;
const TRANSFER_TIMEOUT = 30000;

// Initialise PeerJS using their public cloud infrastructure
const peer = new Peer(customId);
let conn = null;

let outgoingTransfer = null;
let incomingTransfer = null;

let authenticated = false;
let manualDisconnect = false;
let authChallenge = null;
let authTimeout = null;

async function createAuthResponse(challenge, code) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(code);
  const challengeData = encoder.encode(challenge);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, challengeData);

  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function generateAuthChallenge() {
  const values = new Uint32Array(8);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
}

function startAuthentication() {
  authenticated = false;
  authChallenge = generateAuthChallenge();

  document.getElementById("authStatus").innerText = "Authenticating device...";
  document.getElementById("authStatus").className = "auth-status";

  conn.send({
    type: "auth-challenge",
    challenge: authChallenge,
  });

  clearTimeout(authTimeout);

  authTimeout = setTimeout(() => {
    if (!authenticated) {
      failAuthentication("Authentication timed out.");
    }
  }, 10000);
}

function failAuthentication(message) {
  authenticated = false;
  authChallenge = null;
  clearTimeout(authTimeout);

  document.getElementById("authStatus").innerText = message;
  document.getElementById("authStatus").className = "auth-status failed";

  document.getElementById("log").innerText =
    "Authentication failed. Connection closed.";

  if (conn) {
    conn.close();
  }
}

function completeAuthentication() {
  authenticated = true;
  authChallenge = null;
  clearTimeout(authTimeout);

  document.getElementById("authStatus").innerText = "✓ Device authenticated";
  document.getElementById("authStatus").className = "auth-status authenticated";

  document.getElementById("setupSection").style.display = "none";
  document.getElementById("transferSection").style.display = "block";

  document.getElementById("log").innerText = "Secure connection established.";
}

const cancelTransferButton = document.getElementById("cancelTransferButton");

cancelTransferButton.addEventListener("click", cancelTransfer);

// Display assigned key when registration completes
peer.on("open", (id) => {
  document.getElementById("myIdDisplay").innerText = id;
  document.getElementById("pairingCodeDisplay").innerText = pairingCode;
  document.getElementById("log").innerText =
    "Ready. Share your Key or enter one above.";
});

// Catch incoming system connection requests
peer.on("connection", (incomingConn) => {
  conn = incomingConn;
  setupConnectionListeners();

  conn.on("open", () => {
    document.getElementById("log").innerText =
      "Connection received. Authenticating...";
    startAuthentication();
  });
});

// Trigger manual connection outward
function connectToPeer() {
  const targetId = document.getElementById("targetIdInput").value.trim();

  if (!targetId) return alert("Please type a valid Key");

  document.getElementById("log").innerText = "Attempting handshake...";

  conn = peer.connect(targetId, {
    reliable: true,
  });

  conn.on("open", () => {
    document.getElementById("log").innerText =
      "Connection established. Authenticating...";
    startAuthentication();
  });

  setupConnectionListeners();
}

function disconnectDevice() {
  manualDisconnect = true;

  authenticated = false;
  authChallenge = null;
  clearTimeout(authTimeout);

  outgoingTransfer = null;
  incomingTransfer = null;

  resetTransferUI();

  if (conn) {
    conn.close();
  }

  conn = null;

  document.getElementById("setupSection").style.display = "block";
  document.getElementById("transferSection").style.display = "none";
  document.getElementById("authStatus").innerText = "";
  document.getElementById("log").innerText = "Disconnected.";
}
// Process data pathways for file chunks/metadata
function setupConnectionListeners() {
  conn.on("data", async (data) => {
    try {
      if (!data || !data.type) return;

      if (data.type === "auth-challenge") {
        createAuthResponse(
          data.challenge,
          document.getElementById("pairingCodeInput").value.trim() ||
            pairingCode,
        ).then((response) => {
          if (conn && conn.open) {
            conn.send({
              type: "auth-response",
              challenge: data.challenge,
              response: response,
            });
          }
        });
        return;
      }

      if (data.type === "auth-response") {
        if (!authChallenge || data.challenge !== authChallenge) {
          failAuthentication("Invalid authentication response.");
          return;
        }

        createAuthResponse(
          authChallenge,
          document.getElementById("pairingCodeInput").value.trim() ||
            pairingCode,
        ).then((expectedResponse) => {
          if (data.response === expectedResponse) {
            completeAuthentication();
          } else {
            failAuthentication("Incorrect pairing code.");
          }
        });
        return;
      }

      if (!authenticated) return;

      if (data.type === "file-start") {
        handleFileStart(data);
        return;
      }

      if (data.type === "file-ready") {
        if (!outgoingTransfer || data.transferId !== outgoingTransfer.id)
          return;

        outgoingTransfer.lastActivity = Date.now();
        sendNextChunks();
        return;
      }

      if (data.type === "file-chunk") {
        await handleFileChunk(data);
        return;
      }

      if (data.type === "file-ack") {
        handleFileAck(data);
        return;
      }

      if (data.type === "file-complete") {
        await handleFileComplete(data);
        return;
      }

      if (data.type === "file-received") {
        handleFileReceived(data);
        return;
      }

      if (data.type === "file-error") {
        handleFileError(data);
        return;
      }

      if (data.type === "file-cancel") {
        handleFileCancel(data);
      }
    } catch (error) {
      document.getElementById("log").innerText =
        `Transfer error: ${error.message || "Unknown error"}`;

      if (conn && conn.open) {
        const transferId = incomingTransfer
          ? incomingTransfer.id
          : outgoingTransfer
            ? outgoingTransfer.id
            : null;

        if (transferId) {
          conn.send({
            type: "file-error",
            transferId: transferId,
            message: error.message || "Transfer error.",
          });
        }
      }

      outgoingTransfer = null;
      incomingTransfer = null;
      resetTransferUI();
    }
  });

  conn.on("close", () => {
    document.getElementById("log").innerText = "Connection lost. Resetting.";

    authenticated = false;
    authChallenge = null;
    clearTimeout(authTimeout);

    outgoingTransfer = null;
    incomingTransfer = null;

    resetTransferUI();

    if (!manualDisconnect) {
      setTimeout(() => location.reload(), 2000);
    }
  });

  conn.on("error", (error) => {
    document.getElementById("log").innerText =
      `Connection error: ${error.message || "Unknown error"}`;
    authenticated = false;
    authChallenge = null;
    clearTimeout(authTimeout);

    outgoingTransfer = null;
    incomingTransfer = null;

    resetTransferUI();
  });
}

function handleFileStart(data) {
  if (
    !Number.isInteger(data.totalChunks) ||
    data.totalChunks < 0 ||
    !Number.isFinite(data.size) ||
    data.size < 0
  ) {
    conn.send({
      type: "file-error",
      transferId: data.transferId,
      message: "Invalid file information.",
    });
    return;
  }

  if (incomingTransfer || outgoingTransfer) {
    conn.send({
      type: "file-error",
      transferId: data.transferId,
      message: "Another transfer is already in progress.",
    });
    return;
  }

  incomingTransfer = {
    id: data.transferId,
    name: data.name || "received-file",
    mimeType: data.mimeType || "application/octet-stream",
    size: data.size,
    totalChunks: data.totalChunks,
    chunkSize: data.chunkSize || CHUNK_SIZE,
    chunks: new Array(data.totalChunks),
    chunkHashes: new Array(data.totalChunks),
    receivedChunks: 0,
    receivedBytes: 0,
    lastActivity: Date.now(),
  };

  document.getElementById("progressBar").style.display = "block";
  document.getElementById("progressFill").style.width = "0%";
  cancelTransferButton.style.display = "block";

  updateProgressText(0);

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = `Receiving: ${incomingTransfer.name}`;
  }

  document.getElementById("downloadLink").style.display = "none";
  document.getElementById("log").innerText =
    `Receiving: ${incomingTransfer.name}...`;

  conn.send({
    type: "file-ready",
    transferId: incomingTransfer.id,
  });

  monitorIncomingTransferTimeout(incomingTransfer.id);
}

async function handleFileChunk(data) {
  if (!incomingTransfer || data.transferId !== incomingTransfer.id) return;

  incomingTransfer.lastActivity = Date.now();

  if (
    !Number.isInteger(data.index) ||
    data.index < 0 ||
    data.index >= incomingTransfer.totalChunks
  ) {
    conn.send({
      type: "file-error",
      transferId: incomingTransfer.id,
      message: "Invalid chunk index.",
    });
    return;
  }

  if (incomingTransfer.chunks[data.index]) {
    conn.send({
      type: "file-ack",
      transferId: incomingTransfer.id,
      index: data.index,
    });
    return;
  }

  const chunk = normalizeChunk(data.data);

  if (!chunk) {
    conn.send({
      type: "file-error",
      transferId: incomingTransfer.id,
      message: "Invalid chunk data.",
    });
    return;
  }

  const expectedSize = getExpectedChunkSize(
    data.index,
    incomingTransfer.totalChunks,
    incomingTransfer.size,
    incomingTransfer.chunkSize,
  );

  if (chunk.byteLength !== expectedSize) {
    conn.send({
      type: "file-error",
      transferId: incomingTransfer.id,
      message: "Invalid chunk size.",
    });
    return;
  }

  incomingTransfer.chunks[data.index] = chunk;
  incomingTransfer.receivedChunks++;
  incomingTransfer.receivedBytes += chunk.byteLength;

  const percentage =
    incomingTransfer.size > 0
      ? Math.min(
          100,
          (incomingTransfer.receivedBytes / incomingTransfer.size) * 100,
        )
      : 100;

  document.getElementById("progressFill").style.width = `${percentage}%`;
  updateProgressText(percentage);

  if (
    incomingTransfer.receivedChunks % ACK_INTERVAL === 0 ||
    incomingTransfer.receivedChunks === incomingTransfer.totalChunks
  ) {
    conn.send({
      type: "file-ack",
      transferId: incomingTransfer.id,
      index: data.index,
    });
  }
}

function handleFileAck(data) {
  if (!outgoingTransfer || data.transferId !== outgoingTransfer.id) return;

  if (Number.isInteger(data.index)) {
    outgoingTransfer.lastAck = Math.max(outgoingTransfer.lastAck, data.index);
  }

  outgoingTransfer.lastActivity = Date.now();

  sendNextChunks();
}

async function handleFileComplete(data) {
  if (!incomingTransfer || data.transferId !== incomingTransfer.id) return;

  incomingTransfer.lastActivity = Date.now();

  if (incomingTransfer.receivedChunks !== incomingTransfer.totalChunks) {
    conn.send({
      type: "file-error",
      transferId: incomingTransfer.id,
      message: "File transfer incomplete.",
    });

    document.getElementById("log").innerText =
      "Transfer failed: file incomplete.";
    incomingTransfer = null;
    resetTransferUI();
    return;
  }

  document.getElementById("log").innerText =
    `Verifying: ${incomingTransfer.name}...`;

  for (let i = 0; i < incomingTransfer.totalChunks; i++) {
    if (!incomingTransfer.chunks[i]) {
      conn.send({
        type: "file-error",
        transferId: incomingTransfer.id,
        message: "A file chunk is missing.",
      });

      document.getElementById("log").innerText =
        "Transfer failed: missing chunk.";
      incomingTransfer = null;
      resetTransferUI();
      return;
    }
  }

  const blob = new Blob(incomingTransfer.chunks, {
    type: incomingTransfer.mimeType,
  });

  if (blob.size !== incomingTransfer.size) {
    conn.send({
      type: "file-error",
      transferId: incomingTransfer.id,
      message: "File size verification failed.",
    });

    document.getElementById("log").innerText =
      "Transfer failed: file size mismatch.";
    incomingTransfer = null;
    resetTransferUI();
    return;
  }

  if (data.hashes && Array.isArray(data.hashes)) {
    for (let i = 0; i < incomingTransfer.totalChunks; i++) {
      const chunkHash = await calculateHash(incomingTransfer.chunks[i]);

      if (chunkHash !== data.hashes[i]) {
        conn.send({
          type: "file-error",
          transferId: incomingTransfer.id,
          message: `Integrity check failed on chunk ${i + 1}.`,
        });

        document.getElementById("log").innerText =
          "Transfer failed: integrity check failed.";
        incomingTransfer = null;
        resetTransferUI();
        return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const dlBtn = document.getElementById("downloadLink");

  dlBtn.href = url;
  dlBtn.download = incomingTransfer.name;
  dlBtn.style.display = "block";
  dlBtn.innerText = `Save: ${incomingTransfer.name}`;

  document.getElementById("progressFill").style.width = "100%";
  updateProgressText(100);

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = `Received: ${incomingTransfer.name}`;
  }

  document.getElementById("log").innerText = "Transfer Complete!";

  conn.send({
    type: "file-received",
    transferId: incomingTransfer.id,
  });

  setTimeout(() => {
    document.getElementById("progressBar").style.display = "none";
  }, 1000);

  cancelTransferButton.style.display = "none";

  incomingTransfer = null;
}

function handleFileReceived(data) {
  if (!outgoingTransfer || data.transferId !== outgoingTransfer.id) return;

  outgoingTransfer.completed = true;
  outgoingTransfer.lastActivity = Date.now();

  document.getElementById("progressFill").style.width = "100%";
  updateProgressText(100);

  document.getElementById("log").innerText = "Transfer Complete!";

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = `Sent: ${outgoingTransfer.file.name}`;
  }

  setTimeout(() => {
    document.getElementById("progressBar").style.display = "none";
  }, 1000);

  cancelTransferButton.style.display = "none";

  outgoingTransfer = null;

  const fileInput = document.getElementById("fileInput");

  if (fileInput) {
    fileInput.value = "";
  }
}

function handleFileError(data) {
  document.getElementById("log").innerText =
    `Transfer failed: ${data.message || "Unknown error."}`;

  outgoingTransfer = null;
  incomingTransfer = null;

  resetTransferUI();
}

function handleFileCancel(data) {
  if (outgoingTransfer && data.transferId === outgoingTransfer.id) {
    outgoingTransfer = null;
  }

  if (incomingTransfer && data.transferId === incomingTransfer.id) {
    incomingTransfer = null;
  }

  document.getElementById("log").innerText =
    "Transfer cancelled by the other peer.";

  resetTransferUI();
}

async function sendFile() {
  if (!authenticated) return;
  const fileInput = document.getElementById("fileInput");

  if (!fileInput.files.length || !conn || !conn.open) {
    return;
  }

  if (outgoingTransfer || incomingTransfer) {
    document.getElementById("log").innerText =
      "A transfer is already in progress.";
    return;
  }

  const file = fileInput.files[0];

  if (!file) return;

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  const transferId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  document.getElementById("log").innerText = `Preparing: ${file.name}...`;

  const hashes = [];

  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = await file.slice(start, end).arrayBuffer();

    hashes.push(await calculateHash(chunk));
  }

  outgoingTransfer = {
    id: transferId,
    file: file,
    totalChunks: totalChunks,
    nextChunk: 0,
    lastAck: -1,
    hashes: hashes,
    lastActivity: Date.now(),
    completionSent: false,
    completed: false,
  };

  document.getElementById("progressBar").style.display = "block";
  document.getElementById("progressFill").style.width = "0%";
  cancelTransferButton.style.display = "block";

  updateProgressText(0);

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = `Sending: ${file.name}`;
  }

  document.getElementById("downloadLink").style.display = "none";

  conn.send({
    type: "file-start",
    transferId: transferId,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    totalChunks: totalChunks,
    chunkSize: CHUNK_SIZE,
  });

  monitorOutgoingTransferTimeout(transferId);
}

function cancelTransfer() {
  const transferId = outgoingTransfer
    ? outgoingTransfer.id
    : incomingTransfer
      ? incomingTransfer.id
      : null;

  if (!transferId) {
    cancelTransferButton.style.display = "none";
    return;
  }

  if (conn && conn.open) {
    conn.send({
      type: "file-cancel",
      transferId: transferId,
    });
  }

  outgoingTransfer = null;
  incomingTransfer = null;

  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("progressBar").style.display = "none";

  updateProgressText(0);

  cancelTransferButton.style.display = "none";

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = "";
  }

  document.getElementById("log").innerText = "Transfer cancelled.";

  const fileInput = document.getElementById("fileInput");

  if (fileInput) {
    fileInput.value = "";
  }
}

async function sendNextChunks() {
  if (!outgoingTransfer || !conn || !conn.open) return;

  const transfer = outgoingTransfer;

  if (transfer.completed) return;

  const maximumUnacknowledged = Math.max(1, ACK_INTERVAL);

  while (
    transfer.nextChunk < transfer.totalChunks &&
    transfer.nextChunk <= transfer.lastAck + maximumUnacknowledged
  ) {
    if (!outgoingTransfer || outgoingTransfer.id !== transfer.id) {
      return;
    }

    if (Date.now() - transfer.lastActivity > TRANSFER_TIMEOUT) {
      failOutgoingTransfer(transfer.id, "Transfer timed out.");
      return;
    }

    const dataChannel = conn.dataChannel;

    if (
      dataChannel &&
      typeof dataChannel.bufferedAmount === "number" &&
      dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT
    ) {
      await waitForBuffer(dataChannel);
    }

    if (!outgoingTransfer || outgoingTransfer.id !== transfer.id) {
      return;
    }

    const start = transfer.nextChunk * CHUNK_SIZE;

    const end = Math.min(start + CHUNK_SIZE, transfer.file.size);

    const chunk = await transfer.file.slice(start, end).arrayBuffer();

    conn.send({
      type: "file-chunk",
      transferId: transfer.id,
      index: transfer.nextChunk,
      data: chunk,
    });

    transfer.nextChunk++;
    transfer.lastActivity = Date.now();

    const sentBytes = Math.min(
      transfer.nextChunk * CHUNK_SIZE,
      transfer.file.size,
    );

    const percentage =
      transfer.file.size > 0
        ? Math.min(100, (sentBytes / transfer.file.size) * 100)
        : 100;

    document.getElementById("progressFill").style.width = `${percentage}%`;

    updateProgressText(percentage);
  }

  if (
    transfer.nextChunk >= transfer.totalChunks &&
    transfer.lastAck >= transfer.totalChunks - 1 &&
    !transfer.completionSent
  ) {
    transfer.completionSent = true;
    transfer.lastActivity = Date.now();

    conn.send({
      type: "file-complete",
      transferId: transfer.id,
      hashes: transfer.hashes,
    });

    document.getElementById("log").innerText = "Finalising transfer...";
  }
}

function waitForBuffer(dataChannel) {
  return new Promise((resolve) => {
    const checkBuffer = () => {
      if (
        !dataChannel ||
        typeof dataChannel.bufferedAmount !== "number" ||
        dataChannel.bufferedAmount <= MAX_BUFFERED_AMOUNT
      ) {
        resolve();
        return;
      }

      setTimeout(checkBuffer, 50);
    };

    checkBuffer();
  });
}

function monitorOutgoingTransferTimeout(transferId) {
  setTimeout(() => {
    if (!outgoingTransfer || outgoingTransfer.id !== transferId) {
      return;
    }

    if (Date.now() - outgoingTransfer.lastActivity > TRANSFER_TIMEOUT) {
      failOutgoingTransfer(transferId, "Transfer timed out.");

      return;
    }

    monitorOutgoingTransferTimeout(transferId);
  }, 5000);
}

function monitorIncomingTransferTimeout(transferId) {
  setTimeout(() => {
    if (!incomingTransfer || incomingTransfer.id !== transferId) {
      return;
    }

    if (Date.now() - incomingTransfer.lastActivity > TRANSFER_TIMEOUT) {
      if (conn && conn.open) {
        conn.send({
          type: "file-error",
          transferId: transferId,
          message: "Transfer timed out.",
        });
      }

      document.getElementById("log").innerText = "Transfer timed out.";

      incomingTransfer = null;
      resetTransferUI();

      return;
    }

    monitorIncomingTransferTimeout(transferId);
  }, 5000);
}

function failOutgoingTransfer(transferId, message) {
  if (conn && conn.open) {
    conn.send({
      type: "file-error",
      transferId: transferId,
      message: message,
    });
  }

  document.getElementById("log").innerText = `Transfer failed: ${message}`;

  outgoingTransfer = null;

  resetTransferUI();
}

function normalizeChunk(data) {
  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
  }

  if (data instanceof Blob) {
    return data.arrayBuffer();
  }

  return null;
}

function getExpectedChunkSize(index, totalChunks, fileSize, chunkSize) {
  if (totalChunks === 0) {
    return 0;
  }

  if (index === totalChunks - 1) {
    return fileSize - (totalChunks - 1) * chunkSize;
  }

  return chunkSize;
}

async function calculateHash(data) {
  const buffer =
    data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer();

  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function updateProgressText(percentage) {
  const progressText = document.getElementById("progressText");

  if (progressText) {
    progressText.innerText = `${Math.round(percentage)}%`;
  }
}

function resetTransferUI() {
  document.getElementById("progressFill").style.width = "0%";

  document.getElementById("progressBar").style.display = "none";

  cancelTransferButton.style.display = "none";

  updateProgressText(0);

  const transferStatus = document.getElementById("transferStatus");

  if (transferStatus) {
    transferStatus.innerText = "";
  }

  document.getElementById("downloadLink").style.display = "none";

  const fileInput = document.getElementById("fileInput");

  if (fileInput) {
    fileInput.value = "";
  }
}
