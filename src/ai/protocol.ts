import { Color, Difficulty, Move, TransformChoice } from '../game/types';
import { SearchRestriction } from './search';
import { SerializedPosition } from './serialization';

export interface AIMovePayload {
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
}

export type AIRequest =
  | {
      type: 'move';
      id: number;
      position: SerializedPosition;
      difficulty: Difficulty;
      restriction?: SearchRestriction;
    }
  | {
      type: 'select';
      id: number;
      position: SerializedPosition;
      color: Color;
      opponentChoices?: TransformChoice[];
      opponentColor?: Color;
    };

export type AIResponse =
  | { type: 'move'; id: number; payload: AIMovePayload }
  | { type: 'select'; id: number; choices: TransformChoice[] }
  | { type: 'error'; id: number; message: string };
