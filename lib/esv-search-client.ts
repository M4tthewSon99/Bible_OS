import type { EsvSearchWorkerRequest, EsvSearchWorkerResponse } from "./esv-search-worker-types";
import type { SearchResult } from "./types";

interface PendingRequest {
  resolve: (value: SearchResult[]) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (message: string, progress: number) => void;
}

class EsvSearchClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  search(
    query: string,
    limit: number,
    signal?: AbortSignal,
    onProgress?: (message: string, progress: number) => void,
  ): Promise<SearchResult[]> {
    const worker = this.getWorker();
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.post({ type: "cancel", requestId });
        this.pending.delete(requestId);
        reject(new DOMException("Search cancelled", "AbortError"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, {
        resolve: (results) => {
          signal?.removeEventListener("abort", abort);
          resolve(results);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
        onProgress,
      });
      worker.postMessage({ type: "search", requestId, query, limit } satisfies EsvSearchWorkerRequest);
    });
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach(({ reject }) => reject(new Error("ESV search closed.")));
    this.pending.clear();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../workers/esv-search.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", () => {
      this.pending.forEach(({ reject }) => reject(new Error("The local ESV search worker stopped.")));
      this.pending.clear();
    });
    return this.worker;
  }

  private post(message: EsvSearchWorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private readonly onMessage = (event: MessageEvent<EsvSearchWorkerResponse>): void => {
    const message = event.data;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress?.(message.message, message.progress);
      return;
    }
    if (message.type === "ready") return;
    this.pending.delete(message.requestId);
    if (message.type === "results") pending.resolve(message.results);
    else pending.reject(new Error(message.message));
  };
}

export const esvSearchClient = new EsvSearchClient();
