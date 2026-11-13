import { computed, ref, watch, type Ref } from 'vue';
import type { AppState, Chat } from '../../shared/types';
import { rpc } from '../services/api';

export interface ModelChoice {
  providerId: string;
  model: string;
  effort?: string;
  note?: string;
}

interface ReviewActions {
  refresh: () => Promise<void>;
  selectFileTab: () => void;
  openReviewsPanel: () => void;
}

export function useChatReviews(state: Ref<AppState>, chatId: Ref<string>, actions: ReviewActions) {
  const { refresh, selectFileTab, openReviewsPanel } = actions;
  const chat = computed(() => state.value.chats.find((item) => item.id === chatId.value));

  /** Second-opinion sub-chats of the open chat, with their latest status. */
  const chatReviews = computed(() =>
    chat.value
      ? state.value.chats
          .filter((item) => item.reviewOf?.chatId === chat.value!.id)
          .map((review) => {
            const run = state.value.runs.filter((item) => item.chatId === review.id).at(-1);
            const answer = state.value.messages
              .filter((message) => message.chatId === review.id && message.role === 'assistant' && message.content.trim())
              .at(-1);
            const verdict = /Verdict:\s*([^\n]+)/i.exec(answer?.content ?? '')?.[1]?.trim();
            return { chat: review, run, verdict };
          })
      : [],
  );

  /** Second opinions open as their own center tabs, next to the chat, without leaving it. */
  const reviewTabs = ref<string[]>([]);
  const activeReview = ref('');
  watch(chatId, () => {
    reviewTabs.value = [];
    activeReview.value = '';
  });
  const openReviews = computed(() =>
    reviewTabs.value.flatMap((id) => chatReviews.value.filter((item) => item.chat.id === id)),
  );
  const shownReview = computed(() => openReviews.value.find((item) => item.chat.id === activeReview.value));
  function openReviewTab(review: Chat) {
    selectFileTab();
    if (!reviewTabs.value.includes(review.id)) reviewTabs.value.push(review.id);
    activeReview.value = review.id;
  }
  function closeReviewTab(id: string) {
    reviewTabs.value = reviewTabs.value.filter((item) => item !== id);
    if (activeReview.value === id) activeReview.value = '';
  }
  async function deleteReview(review: Chat) {
    await rpc('chat.delete', { chatId: review.id });
    closeReviewTab(review.id);
    await refresh();
  }
  async function startReview(runId: string, pick: ModelChoice) {
    const { note, ...choice } = pick;
    const review = await rpc<Chat>('review.start', { runId, ...choice, focus: note || undefined });
    await refresh();
    openReviewsPanel();
    openReviewTab(review);
  }

  async function askAboutReview(reviewId: string) {
    if (chat.value?.wrappedUpAt) return;
    if (!chat.value) return;
    await rpc('run.submit', {
      chatId: chat.value.id,
      prompt: `Read second opinion ${reviewId} with the second_opinions tool. Check each finding against the code, fix the ones that hold up, and tell me which ones you rejected and why.`,
    });
    await refresh();
  }

  return {
    chatReviews, activeReview, openReviews, shownReview,
    openReviewTab, closeReviewTab, deleteReview, startReview, askAboutReview,
  };
}
