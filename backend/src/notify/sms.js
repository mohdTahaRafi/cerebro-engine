import twilioLib from 'twilio';
import { config } from '../config/index.js';
import { NotifyUnavailable } from './errors.js';

// Mirrors email.js's interface (configured() / sendOtp()) so routes/password.js can
// dispatch on `channel` without branching on which transport it is.
let client = null;

export function configured() {
  return Boolean(config.sms.accountSid && config.sms.authToken && config.sms.from);
}

function getClient() {
  if (!configured()) return null;
  client ??= twilioLib(config.sms.accountSid, config.sms.authToken);
  return client;
}

export async function sendOtp({ to, code, expiresInMinutes }) {
  const c = getClient();
  if (!c) throw new NotifyUnavailable('sms');
  // Twilio's SDK has no built-in socket timeout — bounded the same way the mail
  // transport is (§5.3's 8s), so a stalled Twilio API call cannot hold the forgot-
  // password request open indefinitely either.
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Twilio request timed out')), 8_000);
  });
  await Promise.race([
    c.messages.create({
      to,
      from: config.sms.from,
      body: `${code} is your Cerebro reset code. It expires in ${expiresInMinutes} minutes and can be used once.`,
    }),
    timeout,
  ]);
}
