/// <reference lib="webworker" />

import MiniSearch from "minisearch";
import { readEsvSearchCache, writeEsvSearchCache } from "../lib/esv-search-cache";
import {
  ESV_SEARCH_CACHE_KEY,
  ESV_SOURCE_SHA256,
  ESV_SOURCE_URL,
  corpusToSearchDocuments,
  esvSearchOptions,
  searchEsvIndex,
  type EsvCorpus,
  type EsvSearchDocument,
} from "../lib/esv-search";
import type { EsvSearchWorkerRequest, EsvSearchWorkerResponse } from "../lib/esv-search-worker-types";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();
let searchIndex: MiniSearch<EsvSearchDocument> | null = null;
let initializing: Promise<{ index: MiniSearch<EsvSearchDocument>; cached: boolean }> | null = null;

function send(message: EsvSearchWorkerResponse): void {
  workerScope.postMessage(message);
}

async function readCachedIndex(): Promise<string | null> {
  try {
    return await readEsvSearchCache(ESV_SEARCH_CACHE_KEY);
  } catch {
    return null;
  }
}

async function writeCachedIndex(serialized: string): Promise<void> {
  try {
    await writeEsvSearchCache(ESV_SEARCH_CACHE_KEY, serialized);
  } catch {
    // Search remains available in memory when browser storage is unavailable.
  }
}

async function sha256(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initialize(requestId: number): Promise<{ index: MiniSearch<EsvSearchDocument>; cached: boolean }> {
  if (searchIndex) return { index: searchIndex, cached: true };
  if (initializing) return initializing;
  initializing = (async () => {
    send({ type: "progress", requestId, message: "Preparing ESV search", progress: 0.05 });
    const cached = await readCachedIndex();
    if (cached) {
      try {
        send({ type: "progress", requestId, message: "Opening saved ESV index", progress: 0.25 });
        searchIndex = await MiniSearch.loadJSONAsync<EsvSearchDocument>(cached, esvSearchOptions());
        return { index: searchIndex, cached: true };
      } catch {
        // Rebuild an invalid or incompatible cache entry below.
      }
    }

    send({ type: "progress", requestId, message: "Downloading the hosted ESV copy", progress: 0.12 });
    const response = await fetch(ESV_SOURCE_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`The hosted ESV copy returned HTTP ${response.status}.`);
    const buffer = await response.arrayBuffer();
    send({ type: "progress", requestId, message: "Verifying the ESV snapshot", progress: 0.3 });
    const checksum = await sha256(buffer);
    if (checksum !== ESV_SOURCE_SHA256) throw new Error("The hosted ESV snapshot failed its integrity check.");

    send({ type: "progress", requestId, message: "Reading ESV verses", progress: 0.42 });
    const corpus = JSON.parse(new TextDecoder().decode(buffer)) as EsvCorpus;
    const documents = corpusToSearchDocuments(corpus);
    const index = new MiniSearch<EsvSearchDocument>(esvSearchOptions());
    send({ type: "progress", requestId, message: "Building the local ESV index", progress: 0.55 });
    await index.addAllAsync(documents, { chunkSize: 750 });
    searchIndex = index;
    send({ type: "progress", requestId, message: "Saving the local ESV index", progress: 0.9 });
    await writeCachedIndex(JSON.stringify(index));
    return { index, cached: false };
  })();
  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

workerScope.addEventListener("message", (event: MessageEvent<EsvSearchWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.requestId);
    return;
  }
  void (async () => {
    try {
      const ready = await initialize(request.requestId);
      if (cancelled.delete(request.requestId)) return;
      send({ type: "ready", requestId: request.requestId, cached: ready.cached });
      if (request.type === "initialize") return;
      const output = searchEsvIndex(ready.index, request.query, request.limit);
      if (cancelled.delete(request.requestId)) return;
      send({ type: "results", requestId: request.requestId, ...output });
    } catch (error) {
      if (cancelled.delete(request.requestId)) return;
      send({
        type: "error",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : "Local ESV search failed.",
      });
    }
  })();
});
