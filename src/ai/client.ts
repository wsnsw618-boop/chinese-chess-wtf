import AIWorker from './worker?worker&inline';
import { Position } from '../game/board';
import { Color, Difficulty, TransformChoice } from '../game/types';
import { findAIMove, findAISelection } from './engine';
import { AIMovePayload, AIRequest, AIResponse } from './protocol';
import { SearchRestriction } from './search';
import { serializePosition } from './serialization';

interface Pending {
  resolve: (value: AIResponse) => void;
  reject: (reason: Error) => void;
  timer: number;
}

export class AIClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor() {
    try {
      this.worker = new AIWorker();
      this.worker.onmessage = (event: MessageEvent<AIResponse>) => {
        const message = event.data;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        window.clearTimeout(pending.timer);
        if (message.type === 'error') {
          pending.reject(new Error(message.message));
        } else {
          pending.resolve(message);
        }
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || 'AI Worker 运行错误');
        for (const pending of this.pending.values()) {
          window.clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  get available(): boolean {
    return !!this.worker;
  }

  private request(
    payload:
      | Omit<Extract<AIRequest, { type: 'move' }>, 'id'>
      | Omit<Extract<AIRequest, { type: 'select' }>, 'id'>,
    timeoutMs: number,
  ): Promise<AIResponse> {
    if (!this.worker || this.disposed) {
      return Promise.reject(new Error('AI Worker 不可用'));
    }
    const id = this.nextId++;
    return new Promise<AIResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('AI 思考超时'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker?.postMessage({ ...payload, id });
    });
  }

  async requestMove(
    position: Position,
    difficulty: Difficulty,
    restriction?: SearchRestriction,
  ): Promise<AIMovePayload> {
    const serialized = serializePosition(position);
    try {
      const response = await this.request(
        { type: 'move', position: serialized, difficulty, restriction },
        12_000,
      );
      if (response.type !== 'move') throw new Error('AI 返回类型错误');
      return response.payload;
    } catch {
      // Fallback: run the same engine on the main thread with a short budget.
      return findAIMove(position, difficulty, restriction);
    }
  }

  async requestSelection(
    position: Position,
    color: Color,
    opponentChoices?: TransformChoice[],
    opponentColor?: Color,
  ): Promise<TransformChoice[]> {
    const serialized = serializePosition(position);
    try {
      const response = await this.request(
        {
          type: 'select',
          position: serialized,
          color,
          opponentChoices,
          opponentColor,
        },
        5_000,
      );
      if (response.type !== 'select') throw new Error('AI 返回类型错误');
      return response.choices;
    } catch {
      return findAISelection(position, color, opponentChoices, opponentColor);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('AI 已关闭'));
    }
    this.pending.clear();
  }
}
