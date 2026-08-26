import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { NotifyUnavailable } from './errors.js';
import { OTP_TEXT, OTP_HTML } from './templates/otpEmail.js';
import { SIGNUP_COLLISION_SUBJECT, SIGNUP_COLLISION_TEXT, SIGNUP_COLLISION_HTML } from './templates/signupCollision.js';

let transport = null;

export function configured() {
  return Boolean(config.mail.host && config.mail.from);
}

function getTransport() {
  if (!configured()) return null;
  transport ??= nodemailer.createTransport({
    host: config.mail.host, port: config.mail.port, secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    pool: true, maxConnections: 3,
    connectionTimeout: 8_000, socketTimeout: 8_000,   // bounded: the reset request awaits
                                                     //   only SMTP acceptance, and an
                                                     //   unbounded wait would hold the
                                                     //   request open behind a dead relay
  });
  return transport;
}

export async function sendOtp({ to, code, expiresInMinutes }) {
  const t = getTransport();
  if (!t) throw new NotifyUnavailable('email');
  await t.sendMail({
    from: config.mail.from, to,
    subject: `${code} is your Cerebro reset code`,   // the code in the subject line is
                                                     //   what makes it usable from a phone
                                                     //   notification without opening mail
    text: OTP_TEXT({ code, expiresInMinutes }),
    html: OTP_HTML({ code, expiresInMinutes }),
  });
}

// POST /api/auth/signup's collision branch (§7/§8) — sent instead of creating a second
// account when the address is already taken.
export async function sendSignupCollision({ to }) {
  const t = getTransport();
  if (!t) throw new NotifyUnavailable('email');
  const publicUrl = config.auth.publicUrl;
  await t.sendMail({
    from: config.mail.from, to,
    subject: SIGNUP_COLLISION_SUBJECT,
    text: SIGNUP_COLLISION_TEXT({ publicUrl }),
    html: SIGNUP_COLLISION_HTML({ publicUrl }),
  });
}
