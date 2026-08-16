// Sends session save snapshots via the Gmail API, authenticated as the developer's
// own Gmail account through a stored OAuth refresh token.
//
// Why this instead of Cloudflare's send_email binding: that binding can only reach
// addresses already verified in this Cloudflare account, and sending to an arbitrary
// address requires Cloudflare Email Sending, which needs a Workers Paid plan plus
// onboarding a domain with SPF/DKIM. The Gmail API needs none of that - it works on
// any Workers plan over plain HTTPS, using an account you already control. If the
// sending address should read as an alias (e.g. tyler@sorensencreative.com) rather
// than the raw Gmail address, that alias must first be added and verified under
// Gmail Settings -> Accounts and Import -> Send mail as, which itself requires
// Cloudflare Email Routing forwarding that address to this Gmail account so Gmail's
// verification email can be received.
//
// Required Worker secrets (wrangler secret put <NAME>):
//   GMAIL_CLIENT_ID       OAuth 2.0 client ID
//   GMAIL_CLIENT_SECRET   OAuth 2.0 client secret
//   GMAIL_REFRESH_TOKEN   refresh token for the sending account, scoped to
//                         https://www.googleapis.com/auth/gmail.send
//   GMAIL_SENDER          the From address (must be the account's own address or a
//                         verified "send mail as" alias on it)

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function emailConfigured(env) {
    return !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER);
}

async function getAccessToken(env) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.GMAIL_CLIENT_ID,
            client_secret: env.GMAIL_CLIENT_SECRET,
            refresh_token: env.GMAIL_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    });
    if (!res.ok) {
        // Surface Google's actual reason (invalid_client, invalid_grant, etc.) instead
        // of just the HTTP status - that's the difference between "wrong client secret"
        // and "this token was revoked" and previously got discarded entirely.
        let detail = '';
        try {
            const body = await res.json();
            detail = body.error_description || body.error || '';
        } catch { /* non-JSON error body */ }
        // Secret VALUES never appear here - only whether each is present and how long
        // it is, which is enough to catch truncation/corruption without exposing them.
        const shape = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']
            .map(k => `${k}:${env[k] ? env[k].length : 'unset'}`).join(' ');
        throw new Error(`Gmail token refresh failed (${res.status})${detail ? `: ${detail}` : ''}. [${shape}] If this OAuth app is still in "Testing" publish status, its refresh token expires after 7 days - switch it to "Production".`);
    }
    const data = await res.json();
    return data.access_token;
}

function uint8ToBase64(bytes) {
    // Chunked to avoid blowing the call stack on String.fromCharCode(...bytes) for
    // a large attachment.
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function toBase64Url(bytes) {
    return uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wrapBase64Lines(b64) {
    return b64.replace(/(.{76})/g, '$1\r\n');
}

function buildRawMessage({ from, to, subject, text, filename, jsonText }) {
    const boundary = 'ppmp_' + crypto.randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const attachmentB64 = wrapBase64Lines(uint8ToBase64(enc.encode(jsonText)));

    const raw =
        `From: ${from}\r\n` +
        `To: ${to}\r\n` +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
        `${text}\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json; name="${filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
        `${attachmentB64}\r\n\r\n` +
        `--${boundary}--`;

    return toBase64Url(enc.encode(raw));
}

export async function sendSaveEmail(env, { to, code, snapshot }) {
    if (!emailConfigured(env)) {
        throw new Error('Email sending is not configured on this server yet.');
    }

    const accessToken = await getAccessToken(env);
    const jsonText = JSON.stringify(snapshot, null, 2);
    const filename = `pp-session-${code}-${new Date().toISOString().slice(0, 10)}.json`;

    const raw = buildRawMessage({
        from: `Prosperity & Pathfinders <${env.GMAIL_SENDER}>`,
        to,
        subject: `Session ${code} save file`,
        text: `Attached is a snapshot of session ${code}, turn ${snapshot.turn}, as of ${new Date().toLocaleString()}.\n\n` +
            `This is a point-in-time export for backup or reference - the live game keeps running normally.`,
        filename,
        jsonText
    });

    const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gmail send failed (${res.status}): ${body.slice(0, 200)}`);
    }
}
