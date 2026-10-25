import { findAIMove, findAISelection } from './engine';
import { AIRequest, AIResponse } from './protocol';
import { deserializePosition } from './serialization';

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<AIRequest>) => void) | null;
  postMessage: (message: AIResponse) => void;
};

ctx.onmessage = (event: MessageEvent<AIRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'move') {
      const pos = deserializePosition(request.position);
      const payload = findAIMove(pos, request.difficulty, request.restriction);
      ctx.postMessage({ type: 'move', id: request.id, payload });
      return;
    }
    if (request.type === 'select') {
      const pos = deserializePosition(request.position);
      const choices = findAISelection(
        pos,
        request.color,
        request.opponentChoices,
        request.opponentColor,
      );
      ctx.postMessage({ type: 'select', id: request.id, choices });
    }
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
