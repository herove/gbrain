import type { BrainEngine } from './engine.ts';
import { DEFAULT_EMBEDDING_MODEL } from './ai/defaults.ts';

export interface ChunkEmbeddingCandidate {
  chunk_index: number;
  chunk_text: string;
  chunk_source: string;
  embedding: Float32Array;
}

async function resolveEmbeddingModelForWrite(engine: BrainEngine): Promise<string> {
  try {
    const gateway = await import('./ai/gateway.ts'); // engine-dynamic-import-ok
    return gateway.getEmbeddingModel();
  } catch {
    try {
      return (await engine.getConfig('embedding_model')) || DEFAULT_EMBEDDING_MODEL;
    } catch {
      return DEFAULT_EMBEDDING_MODEL;
    }
  }
}

/**
 * Atomically attach embeddings only to the exact stale chunk identities that
 * produced them. A concurrent import/re-chunk either changes the text/source,
 * deletes the row, or fills the embedding first; every such row is skipped
 * instead of being overwritten by an API response computed from an old read.
 */
export async function applyChunkEmbeddingsIfUnchanged(
  engine: BrainEngine,
  slug: string,
  sourceId: string,
  candidates: ChunkEmbeddingCandidate[],
): Promise<Set<number>> {
  if (candidates.length === 0) return new Set();

  const params: unknown[] = [];
  const values: string[] = [];
  let param = 1;
  for (const candidate of candidates) {
    values.push(
      `($${param++}::integer, $${param++}::text, $${param++}::text, $${param++}::vector)`,
    );
    params.push(
      candidate.chunk_index,
      candidate.chunk_text,
      candidate.chunk_source,
      `[${Array.from(candidate.embedding).join(',')}]`,
    );
  }
  const slugParam = param++;
  const sourceParam = param++;
  const modelParam = param++;
  params.push(slug, sourceId, await resolveEmbeddingModelForWrite(engine));

  const rows = await engine.executeRaw<{ chunk_index: number | string }>(
    `WITH candidates (chunk_index, chunk_text, chunk_source, embedding) AS (
       VALUES ${values.join(', ')}
     )
     UPDATE content_chunks AS cc
        SET embedding = candidates.embedding,
            model = $${modelParam},
            embedded_at = now()
       FROM pages AS p, candidates
      WHERE cc.page_id = p.id
        AND p.slug = $${slugParam}
        AND p.source_id = $${sourceParam}
        AND cc.chunk_index = candidates.chunk_index
        AND cc.chunk_text = candidates.chunk_text
        AND cc.chunk_source::text = candidates.chunk_source
        AND cc.embedding IS NULL
      RETURNING cc.chunk_index`,
    params,
  );
  return new Set(rows.map((row) => Number(row.chunk_index)));
}

/** Post-CAS guard for provenance/mode stamps that claim a full-page embed. */
export async function isPageFullyEmbeddedAtSnapshot(
  engine: BrainEngine,
  slug: string,
  sourceId: string,
  expectedChunkCount: number,
  expectedContentHash?: string | null,
): Promise<boolean> {
  const rows = await engine.executeRaw<{
    total_chunks: number | string;
    stale_chunks: number | string;
  }>(
    `SELECT COUNT(cc.id) AS total_chunks,
            COUNT(cc.id) FILTER (WHERE cc.embedding IS NULL) AS stale_chunks
       FROM pages AS p
       LEFT JOIN content_chunks AS cc ON cc.page_id = p.id
      WHERE p.slug = $1
        AND p.source_id = $2
        AND ($3::text IS NULL OR p.content_hash = $3)
      GROUP BY p.id`,
    [slug, sourceId, expectedContentHash ?? null],
  );
  return rows.length === 1
    && Number(rows[0].total_chunks) === expectedChunkCount
    && Number(rows[0].stale_chunks) === 0;
}
