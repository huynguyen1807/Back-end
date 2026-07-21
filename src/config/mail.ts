import nodemailer, { type Transporter } from 'nodemailer';

type MailConfig = {
  from: {
    name: string;
    address: string;
  };
  transport: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
};

let transporter: Transporter | undefined;

const requireEnvironmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
};

const parseSmtpPort = () => {
  const value = requireEnvironmentValue('SMTP_PORT');
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }
  return port;
};

const parseBoolean = (name: string, fallback: boolean) => {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
};

export const getMailConfig = (): MailConfig => {
  const port = parseSmtpPort();

  return {
    from: {
      name: process.env.SMTP_FROM_NAME?.trim() || 'FreshFriends',
      address: requireEnvironmentValue('SMTP_FROM_EMAIL'),
    },
    transport: {
      host: requireEnvironmentValue('SMTP_HOST'),
      port,
      secure: parseBoolean('SMTP_SECURE', port === 465),
      user: requireEnvironmentValue('SMTP_USER'),
      pass: requireEnvironmentValue('SMTP_PASS'),
    },
  };
};

export const getMailTransporter = () => {
  if (transporter) return transporter;

  const { host, port, secure, user, pass } = getMailConfig().transport;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      minVersion: 'TLSv1.2',
    },
  });

  return transporter;
};

export const verifyMailConnection = async () => {
  await getMailTransporter().verify();
};
