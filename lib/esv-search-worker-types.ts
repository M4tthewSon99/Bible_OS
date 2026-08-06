import type { SearchResult } from "./types";

export type EsvSearchWorkerRequest =
  | { type: "initialize"; requestId: number }
  | { type: "search"; requestId: number; query: string; limit: number }
  | { type: "cancel"; requestId: number };

export type EsvSearchWorkerResponse =
  | { type: "progress"; requestId: number; message: string; progress: number }
  | { type: "ready"; requestId: number; cached: boolean }
  | { type: "results"; requestId: number; results: SearchResult[]; elapsedMs: number }
  | { type: "error"; requestId: number; message: string };
