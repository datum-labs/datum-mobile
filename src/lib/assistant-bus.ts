/**
 * Hands a picked conversation from the history screen back to the chat
 * screen that pushed it. Each chat screen registers under its own id (more
 * than one can be mounted: the Patch tab's and one pushed from a detail
 * screen), and the history screen gets that id as its `from` param.
 */
type OpenListener = (chatId: string) => void;
type RemovedListener = (chatId: string) => void;

const openListeners = new Map<string, OpenListener>();
const removedListeners = new Set<RemovedListener>();

export function onOpenChat(owner: string, listener: OpenListener): () => void {
  openListeners.set(owner, listener);
  return () => {
    if (openListeners.get(owner) === listener) openListeners.delete(owner);
  };
}

/** Asks the chat screen `owner` to open `chatId`. False when that screen is gone. */
export function requestOpenChat(owner: string, chatId: string): boolean {
  const listener = openListeners.get(owner);
  listener?.(chatId);
  return !!listener;
}

/** Every chat screen showing `chatId` starts over (it was deleted or archived). */
export function onChatRemoved(listener: RemovedListener): () => void {
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
}

export function announceChatRemoved(chatId: string): void {
  for (const listener of removedListeners) listener(chatId);
}
