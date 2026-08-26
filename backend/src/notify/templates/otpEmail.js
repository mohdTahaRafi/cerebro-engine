// The plain-text body is part of the spec, not just copy — a reset email is
// phishing-shaped by nature and its wording is a security control (phase_5 §5.3).
export function OTP_TEXT({ code, expiresInMinutes }) {
  return `Your Cerebro password reset code is:

    ${code}

It expires in ${expiresInMinutes} minutes and can be used once.

If you didn't ask to reset your password, you can ignore this message.
Your password has not changed and no one can change it without this code.

Cerebro will never ask you for this code by email, chat, or phone.
`;
}

export function OTP_HTML({ code, expiresInMinutes }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
            <tr><td style="font-size:15px;color:#18181b;line-height:1.5;">
              Your Cerebro password reset code is:
            </td></tr>
            <tr><td style="padding:20px 0;">
              <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#18181b;text-align:center;background:#f4f4f5;border-radius:8px;padding:16px;">
                ${code}
              </div>
            </td></tr>
            <tr><td style="font-size:13px;color:#52525b;line-height:1.5;">
              It expires in ${expiresInMinutes} minutes and can be used once.
              <br /><br />
              If you didn't ask to reset your password, you can ignore this message. Your
              password has not changed and no one can change it without this code.
              <br /><br />
              Cerebro will never ask you for this code by email, chat, or phone.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
