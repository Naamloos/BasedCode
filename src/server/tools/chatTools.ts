import { z } from 'zod';
import type { Chat, Run } from '../../shared/types.js';
import type { Store } from '../storage/store.js';
import type { DefineTool, ToolContext, ToolServices, ToolDefinition } from './definitions.js';

/** Review sub-chats of a chat, newest last, with the reviewer's latest answer. */
export function secondOpinions(store: Store, chatId: string) {
  const runs = store.all('run');
  return store
    .all('chat')
    .filter((chat): chat is Chat & { reviewOf: NonNullable<Chat['reviewOf']> } =>
      Boolean(chat.reviewOf && chat.reviewOf.chatId === chatId && !chat.deletedAt),
    )
    .map((chat) => {
      const reviewed = runs.find((run) => run.id === chat.reviewOf.runId);
      const own = runs.filter((run: Run & { reverted?: boolean }) => run.chatId === chat.id && !run.reverted);
      const answer = store
        .all('message')
        .filter(
          (message) =>
            message.chatId === chat.id && message.role === 'assistant' && message.content.trim() && !message.metadata.reverted,
        )
        .at(-1);
      return {
        reviewId: chat.id,
        reviewer: own.at(-1)?.provider ?? 'unknown',
        status: own.at(-1)?.status ?? 'queued',
        reviewedPrompt: reviewed?.prompt.slice(0, 300) ?? '',
        review: answer?.content ?? '',
      };
    });
}

/** Tools about the chat itself, rather than the workspace. */
export function createChatTools(
  context: ToolContext,
  services: Pick<ToolServices, 'store' | 'events'>,
  definition: DefineTool,
): ToolDefinition[] {
  return [
    definition(
      'prompt_time_limit',
      'Set the user-requested deadline for this prompt, or omit deadline to check the current time and seconds remaining. The harness forcibly stops the prompt and its commands ONE MINUTE BEFORE the deadline, including during tools or approval waits. Applies only to this prompt; use only when the user requests a time limit, and never extend it without their instruction. A deadline less than a minute away stops work immediately.',
      {
        deadline: z.iso.datetime({ offset: true }).optional().describe('User deadline as ISO 8601 with Z or an explicit timezone offset; omit to check time remaining.'),
      },
      async ({ deadline }) => {
        if (!context.timeLimit) throw new Error('No active prompt timer is available.');
        return context.timeLimit.check(deadline);
      },
    ),
    definition(
      'set_chat_title',
      'Name this chat in the sidebar: 2 to 6 words saying what the conversation is about, in the language the user writes in, no quotes or trailing period. Call it once early in a new chat, and again only if the topic clearly changes. It fails when the user has named the chat themselves.',
      { title: z.string().trim().min(2).max(80).describe('The new chat title') },
      async ({ title }) => {
        const chat = services.store.get('chat', context.run.chatId);
        if (chat.titleSource === 'user')
          throw new Error('The user named this chat themselves; keep their title.');
        const clean = title.replace(/^["'`]+|["'`.]+$/g, '').trim();
        services.store.put('chat', { ...chat, title: clean, titleSource: 'agent' });
        services.events.publish('state');
        return { title: clean };
      },
    ),
    definition(
      'second_opinions',
      'Read the second-opinion reviews the user requested on prompts in this chat. Each is a read-only review written by another model (often from a different provider) of your work. Call it when the user refers to a review, or when the system note says reviews exist. Treat review findings as claims to verify against the code, not facts.',
      {
        reviewId: z.string().optional().describe('One review to read in full; omit to list all reviews with their text.'),
      },
      async ({ reviewId }) => {
        const reviews = secondOpinions(services.store, context.run.chatId);
        if (!reviewId) return reviews;
        const review = reviews.find((item) => item.reviewId === reviewId);
        if (!review) throw new Error('No review with that id in this chat.');
        return review;
      },
    ),
  ];
}
