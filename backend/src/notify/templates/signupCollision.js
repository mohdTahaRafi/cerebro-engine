// Sent instead of a second account when POST /api/auth/signup is called with an address
// that already has one (phase_5 §7/§8) — the HTTP response is byte-identical to a real
// signup either way, so this mail is the only signal the account's real owner gets.
export const SIGNUP_COLLISION_SUBJECT = 'Someone tried to sign up with your Cerebro address';

export function SIGNUP_COLLISION_TEXT({ publicUrl }) {
  return `Someone just tried to create a new Cerebro account using this email address.

You already have an account with us. If this was you, there's nothing to do — just
sign in with your existing password, or reset it if you've forgotten it:

    Sign in: ${publicUrl}/login
    Reset your password: ${publicUrl}/forgot-password

If this wasn't you, no account was created and your existing account is unaffected.
`;
}

export function SIGNUP_COLLISION_HTML({ publicUrl }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
            <tr><td style="font-size:15px;color:#18181b;line-height:1.5;">
              Someone just tried to create a new Cerebro account using this email address.
            </td></tr>
            <tr><td style="padding:16px 0;font-size:14px;color:#52525b;line-height:1.6;">
              You already have an account with us. If this was you, there's nothing to
              do — just sign in with your existing password, or reset it if you've
              forgotten it.
            </td></tr>
            <tr><td style="padding:8px 0;">
              <a href="${publicUrl}/login" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;">Sign in</a>
              &nbsp;
              <a href="${publicUrl}/forgot-password" style="display:inline-block;color:#18181b;text-decoration:underline;font-size:14px;">Reset your password</a>
            </td></tr>
            <tr><td style="padding-top:20px;font-size:13px;color:#71717a;line-height:1.5;">
              If this wasn't you, no account was created and your existing account is
              unaffected.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
