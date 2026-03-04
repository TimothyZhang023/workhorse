import {
  createUser,
  createConversation,
  addMessage,
  deleteLastAssistantMessage,
  getMessages,
} from '../server/models/database.js';

describe('conversation helpers', () => {
  it('deletes only the latest assistant message', () => {
    const user = createUser(`user_${Date.now()}`, 'password123');
    const conv = createConversation(user.uid, 'test conv');

    addMessage(conv.id, user.uid, 'user', 'u1');
    addMessage(conv.id, user.uid, 'assistant', 'a1');
    addMessage(conv.id, user.uid, 'user', 'u2');
    addMessage(conv.id, user.uid, 'assistant', 'a2');

    const deleted = deleteLastAssistantMessage(conv.id, user.uid);
    expect(deleted).toBe(true);

    const messages = getMessages(conv.id, user.uid);
    expect(messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2']);
  });

  it('returns false when no assistant message exists', () => {
    const user = createUser(`user_${Date.now()}_2`, 'password123');
    const conv = createConversation(user.uid, 'test conv 2');

    addMessage(conv.id, user.uid, 'user', 'hello');
    const deleted = deleteLastAssistantMessage(conv.id, user.uid);

    expect(deleted).toBe(false);
    expect(getMessages(conv.id, user.uid)).toHaveLength(1);
  });
});
