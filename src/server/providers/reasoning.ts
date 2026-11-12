/** Preserve local providers' reasoning fields before the OpenAI parser drops them. */
export const reasoningFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  )
    return response;
  let pending = '';
  const line = (source: string): string => {
    if (!source.startsWith('data:')) return source;
    const data = source.slice(5).trim();
    if (!data || data === '[DONE]') return source;
    let event: {
      choices?: {
        delta?: { reasoning_content?: unknown; reasoning?: unknown; content?: unknown };
      }[];
    };
    try {
      event = JSON.parse(data);
    } catch {
      return source;
    }
    if (!Array.isArray(event?.choices)) return source;
    for (const choice of event.choices) {
      const delta = choice?.delta;
      if (!delta) continue;
      const reasoning =
        typeof delta.reasoning_content === 'string' ? delta.reasoning_content : delta.reasoning;
      if (typeof reasoning !== 'string' || !reasoning) continue;
      delta.content = `<think>${reasoning}</think>${typeof delta.content === 'string' ? delta.content : ''}`;
    }
    return `data: ${JSON.stringify(event)}`;
  };
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) {
            controller.enqueue(line(pending.slice(0, end).replace(/\r$/, '')) + '\n');
            pending = pending.slice(end + 1);
          }
        },
        flush(controller) {
          if (pending) controller.enqueue(line(pending));
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
};

/**
 * Asks a local model not to reason. Servers differ in which switch they read: Ollama and LM Studio take
 * `reasoning_effort: "none"` (Ollama also `think: false`), and llama.cpp-style servers take `enable_thinking` through
 * the chat template. Unknown fields are ignored by those servers; a strict OpenAI-compatible endpoint only gets the
 * standard `reasoning_effort`.
 */
export function withoutReasoning(kind: string): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body === 'string' && init.method?.toUpperCase() === 'POST') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (Array.isArray(body.messages)) {
          body.reasoning_effort = 'none';
          if (kind !== 'openai') {
            body.think = false;
            body.chat_template_kwargs = { enable_thinking: false };
          }
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        /* Not JSON: send as is. */
      }
    }
    return reasoningFetch(input, init);
  };
}
