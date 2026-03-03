import "server-only";
import tls from "node:tls";

type SendSmtpTextEmailParams = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  ehloHost?: string;
  timeoutMs?: number;
};

type SmtpResponse = {
  code: number;
  message: string;
};

function normalizeLineEndings(text: string) {
  return text.replace(/\r?\n/g, "\r\n");
}

function dotStuff(text: string) {
  return normalizeLineEndings(text)
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function parseResponseCode(message: string) {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = line.match(/^(\d{3})[ -]/);
    if (match) return Number(match[1]);
  }
  return NaN;
}

function isResponseComplete(message: string) {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const lastLine = lines[lines.length - 1];
  return /^\d{3}\s/.test(lastLine);
}

function waitForSmtpResponse(socket: tls.TLSSocket, timeoutMs: number) {
  return new Promise<SmtpResponse>((resolve, reject) => {
    let message = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP response timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("SMTP socket closed before full response"));
    };

    const onData = (chunk: Buffer) => {
      message += chunk.toString("utf8");
      if (!isResponseComplete(message)) return;

      const code = parseResponseCode(message);
      cleanup();
      if (!Number.isFinite(code)) {
        reject(new Error(`Unable to parse SMTP response code: ${message.trim()}`));
        return;
      }
      resolve({ code, message: message.trim() });
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function sendSmtpCommand(
  socket: tls.TLSSocket,
  command: string | null,
  expectedCodes: number[],
  timeoutMs: number
) {
  if (command !== null) {
    socket.write(`${command}\r\n`);
  }
  const response = await waitForSmtpResponse(socket, timeoutMs);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(
      `SMTP command failed${command ? ` for "${command}"` : ""}: ${response.code} ${response.message}`
    );
  }
  return response;
}

function sanitizeAddress(value: string) {
  return value.replace(/[<>\r\n]/g, "").trim();
}

function buildHeaders(params: {
  from: string;
  to: string[];
  subject: string;
}) {
  const now = new Date().toUTCString();
  return [
    `From: ${sanitizeAddress(params.from)}`,
    `To: ${params.to.map((address) => sanitizeAddress(address)).join(", ")}`,
    `Subject: ${params.subject.replace(/\r?\n/g, " ").trim()}`,
    `Date: ${now}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].join("\r\n");
}

export async function sendSmtpTextEmail(params: SendSmtpTextEmailParams) {
  const timeoutMs = Math.max(3_000, params.timeoutMs ?? 15_000);
  const ehloHost = sanitizeAddress(params.ehloHost ?? "pulsek12.com") || "pulsek12.com";
  const from = sanitizeAddress(params.from);
  const to = params.to.map((address) => sanitizeAddress(address)).filter(Boolean);
  if (!from || to.length === 0) {
    throw new Error("SMTP email requires non-empty from/to addresses");
  }

  const socket = tls.connect({
    host: params.host,
    port: params.port,
    servername: params.host,
    minVersion: "TLSv1.2"
  });

  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error("SMTP socket timeout"));
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  try {
    await sendSmtpCommand(socket, null, [220], timeoutMs);
    await sendSmtpCommand(socket, `EHLO ${ehloHost}`, [250], timeoutMs);
    await sendSmtpCommand(socket, "AUTH LOGIN", [334], timeoutMs);
    await sendSmtpCommand(socket, Buffer.from(params.username, "utf8").toString("base64"), [334], timeoutMs);
    await sendSmtpCommand(socket, Buffer.from(params.password, "utf8").toString("base64"), [235], timeoutMs);
    await sendSmtpCommand(socket, `MAIL FROM:<${from}>`, [250], timeoutMs);
    for (const recipient of to) {
      await sendSmtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251], timeoutMs);
    }
    await sendSmtpCommand(socket, "DATA", [354], timeoutMs);

    const headers = buildHeaders({ from, to, subject: params.subject });
    const body = dotStuff(params.text.trim());
    socket.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    const dataAccepted = await waitForSmtpResponse(socket, timeoutMs);
    if (dataAccepted.code !== 250) {
      throw new Error(`SMTP DATA failed: ${dataAccepted.code} ${dataAccepted.message}`);
    }

    try {
      await sendSmtpCommand(socket, "QUIT", [221], timeoutMs);
    } catch {
      // Ignore QUIT failures once message has already been accepted.
    }
  } finally {
    socket.end();
    socket.destroy();
  }
}
