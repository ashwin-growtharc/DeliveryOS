/**
 * Sends the login code via Resend's real HTTP API directly -- no SDK
 * dependency, just `fetch`, so this has zero extra package requirements
 * beyond what a plain Next.js project already has. `from` defaults to
 * Resend's own sandbox sender (`onboarding@resend.dev`), which sends for
 * real without needing a verified custom domain -- the right default for
 * an artifact meant to work the moment someone supplies just an API key.
 */
export interface SendCodeEmailResult {
  ok: boolean;
  message?: string;
}

export async function sendCodeEmail(
  email: string,
  code: string,
  apiKey: string,
  from = 'onboarding@resend.dev',
): Promise<SendCodeEmailResult> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: `Your sign-in code: ${code}`,
        html: `<p>Your sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 5 minutes.</p>`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, message: `Resend returned ${response.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach the email provider' };
  }
}
