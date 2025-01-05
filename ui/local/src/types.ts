import type { Position, FishSearch } from 'zerofish';
import type { CardData } from './handOfCards';
import type { Chess } from 'chessops';
import type { Filter, Filters, Point } from './filter';

export type { CardData, Filter, Filters, Point };

export interface Quirks {
  // tbd
}

export type SoundEvent =
  | 'greeting'
  | 'playerWin'
  | 'botWin'
  | 'playerCheck'
  | 'botCheck'
  | 'botCapture'
  | 'playerCapture'
  | 'playerMove'
  | 'botMove';

export type Sound = { key: string; chance: number; delay: Seconds; mix: number };

export type SoundEvents = { [key in SoundEvent]?: Sound[] };

export type ZeroSearch = { multipv: number; net: string; nodes?: number };

export type Book = { key: string; weight: number };

export type LocalSpeed = Exclude<Speed, 'correspondence'>;

export type Ratings = { [speed in LocalSpeed]?: number };

export interface BotInfo {
  readonly uid: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly ratings: Ratings;
  readonly image: string;
  readonly traceMove?: string;
  readonly books?: Book[];
  readonly sounds?: SoundEvents;
  readonly filters?: Filters;
  readonly zero?: ZeroSearch;
  readonly fish?: FishSearch;
  readonly quirks?: Quirks;
}

export interface MoveSource {
  move: (args: MoveArgs) => Promise<MoveResult>;
}

export interface MoveArgs {
  pos: Position;
  chess: Chess;
  avoid: Uci[];
  initial: Seconds | undefined;
  increment: Seconds | undefined;
  remaining: Seconds | undefined;
  thinkTime?: Seconds;
  cp?: number;
}

export type MoveResult = { uci: string; thinkTime: Seconds };

export interface LocalSetup {
  white?: string;
  black?: string;
  initialFen?: string;
  initial?: Seconds;
  increment?: Seconds;
  go?: boolean;
}

export interface LocalPlayOpts {
  pref: any;
  userId: string;
  username: string;
  setup?: LocalSetup;
  bots: BotInfo[];
  dev?: boolean;
}
