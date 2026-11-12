import type { NotificationSettings } from '../../shared/types.js';

export interface Notice {
  title: string;
  body: string;
  /** high for approvals that block a run; default for finished prompts. */
  priority: 'high' | 'default';
  tags: string[];
}

/**
 * Sends a push notification to the URL the user configured: an ntfy topic (plain-text body, title and priority in
 * headers) or a JSON webhook. Only short summaries leave the machine; never file contents, and never the remote
 * access link, which carries its access code.
 */
export async function sendNotice(settings: NotificationSettings, notice: Notice): Promise<void> {
  const url = new URL(settings.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Notification URL must be HTTP(S).');
  const body = notice.body.slice(0, 1000);
  const title = notice.title.slice(0, 200);
  const postJson = (payload: unknown) =>
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  let response: Response;
  switch (settings.format) {
    case 'ntfy':
      response = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          // Header values must be ASCII; ntfy accepts RFC 2047 encoded titles for anything else.
          Title: `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`,
          Priority: notice.priority === 'high' ? 'high' : 'default',
          Tags: notice.tags.join(','),
        },
        signal: AbortSignal.timeout(10_000),
      });
      break;
    case 'discord':
      // Discord webhook: https://discord.com/api/webhooks/<id>/<token>. Mentions disabled so a summary can't ping anyone.
      response = await postJson({
        username: 'BasedCode',
        embeds: [{ title, description: body, color: notice.priority === 'high' ? 0xe5534b : 0x3b82f6 }],
        allowed_mentions: { parse: [] },
      });
      break;
    case 'slack':
      // Slack incoming webhook: https://hooks.slack.com/services/...
      response = await postJson({ text: `*${title}*\n${body}` });
      break;
    case 'telegram':
      // https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
      response = await postJson({
        chat_id: url.searchParams.get('chat_id') ?? undefined,
        text: `${title}\n\n${body}`,
        disable_notification: notice.priority !== 'high',
      });
      break;
    case 'gotify':
      // https://gotify.example.com/message?token=<app token>
      response = await postJson({ title, message: body, priority: notice.priority === 'high' ? 8 : 5 });
      break;
    default:
      response = await postJson({ ...notice, body, source: 'BasedCode' });
  }
  if (!response.ok) throw new Error(`Notification failed: HTTP ${response.status}`);
}
