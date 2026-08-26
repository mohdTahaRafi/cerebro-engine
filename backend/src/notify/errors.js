// Thrown by notify/email.js and notify/sms.js when their channel has no configuration
// to send with (`configured()` is false) — the caller (routes/password.js) always
// catches this itself; it must never reach an HTTP response as a raw 500, because
// "delivery not configured" is an operator problem, not a request the caller did wrong.
export class NotifyUnavailable extends Error {
  constructor(channel) {
    super(`Notify channel '${channel}' is not configured.`);
    this.name = 'NotifyUnavailable';
    this.channel = channel;
  }
}
