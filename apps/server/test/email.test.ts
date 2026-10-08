import net from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createEmailSender } from "../src/email.js";

async function withSmtp(
  rejectRecipient: boolean,
  run: (config: AppConfig, commands: string[], messages: string[]) => Promise<void>,
) {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 loopback.example.test ESMTP\r\n");
    let buffer = "";
    let body = "";
    let readingBody = false;
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (readingBody) {
          if (line !== ".") {
            body += `${line}\r\n`;
            continue;
          }
          readingBody = false;
          messages.push(body);
          body = "";
          socket.write("250 accepted\r\n");
          continue;
        }
        commands.push(line);
        if (line.startsWith("EHLO")) {
          socket.write("250-loopback.example.test\r\n250 AUTH PLAIN\r\n");
        } else if (line.startsWith("AUTH PLAIN")) {
          socket.write("235 authenticated\r\n");
        } else if (line.startsWith("RCPT") && rejectRecipient) {
          socket.write("550 recipient rejected\r\n");
        } else if (line === "DATA") {
          readingBody = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") {
          socket.end("221 closing\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const config: AppConfig = {
    port: 0,
    nodeEnv: "test",
    publicOrigin: "https://example.test",
    seedDemo: false,
    devAuthBypass: false,
    githubAllowedLogin: "fixture",
    sessionSecret: "synthetic-test-only",
    uploadDir: "unused",
    runtimeStatusDir: "unused",
    rateLimitEnabled: true,
    smtp: {
      host: "127.0.0.1",
      port: (server.address() as net.AddressInfo).port,
      secure: false,
      from: "Nytt <sender@example.test>",
      user: "fixture",
      password: "synthetic-test-only",
    },
  };
  try {
    await run(config, commands, messages);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("SMTP dependency contract", () => {
  it("authenticates and sends a plain email through the configured transport", async () => {
    await withSmtp(false, async (config, commands, messages) => {
      await createEmailSender(config).send({
        to: "recipient@example.test",
        subject: "Fixture login",
        text: "Synthetic login link: https://example.test/login/fixture",
      });
      expect(commands.some((line) => line.startsWith("AUTH PLAIN"))).toBe(true);
      expect(commands).toContain("MAIL FROM:<sender@example.test>");
      expect(commands).toContain("RCPT TO:<recipient@example.test>");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Subject: Fixture login");
      expect(messages[0]).toContain("https://example.test/login/fixture");
    });
  });

  it("propagates recipient rejection without claiming successful email delivery", async () => {
    await withSmtp(true, async (config, _commands, messages) => {
      await expect(
        createEmailSender(config).send({
          to: "rejected@example.test",
          subject: "Fixture rejection",
          text: "Synthetic test only",
        }),
      ).rejects.toMatchObject({ responseCode: 550 });
      expect(messages).toHaveLength(0);
    });
  });
});
