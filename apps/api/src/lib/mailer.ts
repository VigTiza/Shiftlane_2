import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Envío de correo. El motor multicanal de F14 reemplazará a este módulo simple. */
export interface Mailer {
  send: (message: MailMessage) => Promise<void>;
}

export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/** Sin servidor SMTP configurado: el correo solo se registra (útil en desarrollo). */
export function createLogMailer(log: FastifyBaseLogger): Mailer {
  return {
    send(message) {
      log.info(
        { to: message.to, subject: message.subject, text: message.text },
        'Correo (sin SMTP)',
      );
      return Promise.resolve();
    },
  };
}

/** Guarda los correos en memoria. Para pruebas. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
