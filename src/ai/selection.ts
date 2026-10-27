import { Position, piecesOf } from '../game/board';
import {
  generateAllLegalMoves,
  hasAnyLegalMove,
  isInCheck,
} from '../game/moves';
import {
  Color,
  PieceType,
  TransformChoice,
  makePiece,
  opposite,
  typeOf,
} from '../game/types';
import { evaluate } from './evaluate';

export interface SelectionOptions {
  color: Color;
  /** Choices already made by the other player, when the AI selects second. */
  opponentChoices?: TransformChoice[];
  opponentColor?: Color;
}

function applyChoices(
  pos: Position,
  color: Color,
  choices: TransformChoice[],
): void {
  for (const choice of choices) {
    const piece = pos.board[choice.square];
    if (!piece || Math.sign(piece) !== color) continue;
    if (typeOf(piece) === PieceType.King) continue;
    pos.board[choice.square] = makePiece(color, choice.target);
  }
}

function choiceKey(choices: TransformChoice[]): string {
  return choices
    .map((c) => `${c.square}:${c.target}`)
    .sort()
    .join('|');
}

/**
 * Heuristic duel transformation choice. It evaluates the resulting position
 * statically, with extra weight on king safety, mate and the value of keeping
 * a king ability anchor.
 */
export function chooseTransformations(
  pos: Position,
  options: SelectionOptions,
): TransformChoice[] {
  const { color } = options;
  const candidates = piecesOf(pos, color).filter(
    ({ piece }) => typeOf(piece) !== PieceType.King,
  );
  if (!candidates.length) return [];

  const singleChoices: TransformChoice[] = [];
  for (const { sq, piece } of candidates) {
    const current = typeOf(piece);
    if (current !== PieceType.Tiger) {
      singleChoices.push({ square: sq, target: PieceType.Tiger });
    }
    if (current !== PieceType.Dragon) {
      singleChoices.push({ square: sq, target: PieceType.Dragon });
    }
  }

  const combos: TransformChoice[][] = [[]];
  for (const choice of singleChoices) combos.push([choice]);
  for (let i = 0; i < singleChoices.length; i++) {
    for (let j = i + 1; j < singleChoices.length; j++) {
      if (singleChoices[i].square === singleChoices[j].square) continue;
      combos.push([singleChoices[i], singleChoices[j]]);
    }
  }

  let best: TransformChoice[] = [];
  let bestScore = -Infinity;

  for (const combo of combos) {
    const test = pos.clone();
    if (options.opponentChoices && options.opponentColor) {
      applyChoices(test, options.opponentColor, options.opponentChoices);
    }
    applyChoices(test, color, combo);

    let score = color === 1 ? evaluate(test) : -evaluate(test);
    const opponent = opposite(color);

    // The first selector's transformation may not leave the side that is not
    // to move in check; such a choice is rejected by the engine.
    if (test.turn === color && isInCheck(test, opponent)) {
      score -= 2_000_000;
    } else if (test.turn === opponent && isInCheck(test, opponent)) {
      score += 300;
    }

    // Being in check while the opponent is to move is an illegal/odd state.
    if (test.turn === opponent && isInCheck(test, color)) {
      score -= 1_500_000;
    }

    // If the side to move is mated, the other side wins immediately.
    if (isInCheck(test, test.turn) && !hasAnyLegalMove(test, test.turn)) {
      score += test.turn === color ? -2_000_000 : 2_000_000;
    }

    // Avoid leaving our own king in check when the opponent is about to move.
    if (test.turn !== color && isInCheck(test, color)) {
      score -= 1_500;
    }

    // Preserve at least one king anchor if possible.
    const anchor = piecesOf(test, color).find(
      ({ piece }) => typeOf(piece) === PieceType.Advisor,
    );
    if (anchor) {
      score += color === -1 ? 35 : 18;
    }

    // Small deterministic tie-break, favoring transforming lower-value pieces.
    for (const choice of combo) {
      const before = typeOf(pos.board[choice.square]);
      if (
        before === PieceType.Pawn ||
        before === PieceType.Advisor ||
        before === PieceType.Wolf
      ) {
        score += 6;
      }
      if (before === PieceType.Elephant) score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      best = combo;
    }
  }

  // Never return duplicate choices or an invalid no-op.
  const seen = new Set<number>();
  return best.filter((choice) => {
    if (seen.has(choice.square)) return false;
    seen.add(choice.square);
    return true;
  });
}

export function bestOfChoices(
  pos: Position,
  color: Color,
  choices: TransformChoice[],
): number {
  const test = pos.clone();
  applyChoices(test, color, choices);
  return color === 1 ? evaluate(test) : -evaluate(test);
}

export function describeChoices(choices: TransformChoice[]): string {
  if (!choices.length) return '不变身';
  return choices
    .map((c) => `${c.square}:${c.target === PieceType.Tiger ? '虎' : '龙'}`)
    .join(',');
}

export { choiceKey, applyChoices, opposite };
