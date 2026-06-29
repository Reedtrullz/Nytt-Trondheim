import nodemailer from "nodemailer";
import type { AppConfig, EmailSender } from "./config.js";

export function createEmailSender(config: AppConfig): EmailSender {
  if (!config.smtp) {
    return {
      async send(message) {
        console.info(
          JSON.stringify({
            level: "info",
            component: "email",
            mode: "console",
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
        );
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth:
      config.smtp.user && config.smtp.password
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
  });

  return {
    async send(message) {
      await transport.sendMail({
        from: config.smtp?.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
