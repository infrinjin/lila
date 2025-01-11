import type { OpeningBook, PolyglotResult, PgnProgress, PgnFilter } from './bits.polyglot';
import type { Board } from 'chessops';

export type {
  OpeningMove,
  OpeningBook,
  PgnProgress,
  PgnFilter,
  PolyglotOpts,
  PolyglotResult,
} from './bits.polyglot';

export async function makeBookFromPolyglot(init: {
  bytes: DataView;
  cover?: boolean | { boardSize: number };
}): Promise<PolyglotResult> {
  return site.asset.loadEsm<PolyglotResult>('bits.polyglot', { init });
}

export async function makeBookFromPgn(init: {
  pgn: Blob;
  ply: number;
  cover?: boolean | { boardSize: number };
  progress?: PgnProgress;
  filter?: PgnFilter;
}): Promise<PolyglotResult> {
  return site.asset.loadEsm<PolyglotResult>('bits.polyglot', { init });
}

export async function makeCover(init: {
  getMoves: OpeningBook;
  cover: boolean | { boardSize: number };
}): Promise<Blob> {
  return (await site.asset.loadEsm<PolyglotResult>('bits.polyglot', { init })).cover!;
}

export async function boardHasher(): Promise<(board: Board) => bigint> {
  return site.asset.loadEsm<(board: Board) => bigint>('bits.polyglot', { init: undefined });
}
