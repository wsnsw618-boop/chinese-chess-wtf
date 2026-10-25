import { Position } from '../game/board';
import { Color, Difficulty, TransformChoice } from '../game/types';
import { findBestMove, randomLegalMove, SearchRestriction } from './search';
import { chooseTransformations } from './selection';

export interface AIMoveResult {
  move: ReturnType<typeof findBestMove>['move'];
  score: number;
  depth: number;
  nodes: number;
}

const SETTINGS: Record<Difficulty, { maxDepth: number; timeMs: number; randomize: number }> = {
  easy: { maxDepth: 2, timeMs: 350, randomize: 90 },
  normal: { maxDepth: 5, timeMs: 1_400, randomize: 0 },
  hard: { maxDepth: 6, timeMs: 2_400, randomize: 0 },
};

export function findAIMove(
  pos: Position,
  difficulty: Difficulty,
  restriction?: SearchRestriction,
): AIMoveResult {
  const config = SETTINGS[difficulty];
  const result = findBestMove(pos, {
    maxDepth: config.maxDepth,
    timeMs: config.timeMs,
    randomize: config.randomize,
    restriction,
  });
  if (result.move) return result;
  const fallback = randomLegalMove(pos, restriction);
  return { move: fallback, score: 0, depth: 0, nodes: result.nodes };
}

export function findAISelection(
  pos: Position,
  color: Color,
  opponentChoices?: TransformChoice[],
  opponentColor?: Color,
): TransformChoice[] {
  return chooseTransformations(pos, {
    color,
    opponentChoices,
    opponentColor,
  });
}
