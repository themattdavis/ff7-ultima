import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useFF7Context } from '@/FF7Context';
import { MESH_SIZE } from '../constants';

// Mirrors ff7_lib::ff7::types::world::WorldChunkVertex / WorldChunkSlot.
interface WorldChunkVertex {
  x: number;
  y: number;
  z: number;
}

interface WorldChunkSlot {
  vertex_data_start: number;
  vertex_data_end: number;
  chunk_x: number;
  chunk_z: number;
  unknown_e: number;
  unknown_f: number;
  triangle_data_ptr_unconfirmed: number;
  slot_buffer_base: number;
  vertices: WorldChunkVertex[];
}

// Mirrors ff7_lib::ff7::types::world::StoredTriangleSlot. Declared locally rather than imported
// from the app's shared WorldModel type, since we now read this directly off a frozen entity
// address (see readStoredTrianglesAt) rather than through gameState.worldCurrentModel at all.
interface StoredTriangleSlot {
  triangle_ptr: number;
  chunk_x: number;
  chunk_z: number;
}

interface WorldChunkDebugProps {
  visible: boolean;
}

interface TriangleClassification {
  color: string;
  label: string;
}

const POLL_INTERVAL_MS = 250;
const DEFAULT_CELL_SIZE = 14;
const MIN_CELL_SIZE = 10;
const MAX_CELL_SIZE = 32;
const CELL_SIZE_STEP = 4;
const GRID_GAP = 2;
const COLUMNS = 8;
const STORED_TRIANGLE_BORDER = '#00e5ff';
const MAX_VERTEX_INDEX = 0x7a; // 122 - matches the PSX script's out-of-range threshold exactly
// PSX script's script/ground-type flag bitmask marking the "useful" kind of degenerate triangle.
// Carried over unverified - this is PSX game data, not something derivable from memory layout, so
// treat the lime/orange split as an unconfirmed starting guess until tested against known cases.
const LIME_FLAG_MASK = 0x721b6f83;
// Same layout used by ff7_lib's read_stored_triangle_slots, replicated here via generic memory
// reads against a FROZEN entity address instead of "whatever's currently controlled" - see the
// lockedEntityRef/relock() comments below for why this distinction matters.
const STORED_TRIANGLE_SLOT_COUNT = 6;
const STORED_TRIANGLE_SLOTS_BASE = 0x60;
const STORED_TRIANGLE_SLOT_STRIDE = 0x8;

const sizeButtonStyle: CSSProperties = {
  pointerEvents: 'auto',
  background: '#333',
  color: '#fff',
  border: '1px solid #666',
  borderRadius: 4,
  width: 16,
  height: 16,
  lineHeight: '14px',
  fontSize: 11,
  cursor: 'pointer',
  padding: 0,
};

function isEmpty(slot: WorldChunkSlot): boolean {
  return slot.vertex_data_start === 0;
}

function colorForSlot(slot: WorldChunkSlot, playerChunkX: number | null, playerChunkZ: number | null): string {
  if (isEmpty(slot)) return '#333333';
  if (playerChunkX === null || playerChunkZ === null) return '#888888';
  if (slot.chunk_x === playerChunkX && slot.chunk_z === playerChunkZ) return '#3ecf5e';

  const dx = Math.abs(slot.chunk_x - playerChunkX);
  const dz = Math.abs(slot.chunk_z - playerChunkZ);
  if (dx <= 1 && dz <= 1) return '#eeeeee';
  if (dx <= 2 && dz <= 2) return '#e8d44d';
  return '#c0392b';
}

// Reads the 6 stored-triangle slots directly off a specific entity struct address, rather than
// through gameState.worldCurrentModel (which always reflects whatever's CURRENTLY controlled -
// e.g. a mounted chocobo, not necessarily Cloud). Mirrors the PSX debug script's CLOUD variable,
// which is captured once and read from repeatedly regardless of what PLAYER_POINTER's live value
// changes to afterward.
async function readStoredTrianglesAt(entityAddr: number): Promise<StoredTriangleSlot[]> {
  const slots: StoredTriangleSlot[] = [];
  for (let i = 0; i < STORED_TRIANGLE_SLOT_COUNT; i++) {
    const base = entityAddr + STORED_TRIANGLE_SLOTS_BASE + i * STORED_TRIANGLE_SLOT_STRIDE;
    const [ptr, cx, cz] = await Promise.all([
      invoke<number>('read_memory_int', { address: base }),
      invoke<number>('read_memory_short', { address: base + 4 }),
      invoke<number>('read_memory_short', { address: base + 6 }),
    ]);
    slots.push({ triangle_ptr: ptr, chunk_x: cx, chunk_z: cz });
  }
  return slots;
}

// Cached per-chunk data that survives the chunk being evicted from the live 32 slots - mirrors the
// PSX script's vlc_cache (vertices), extended to also remember the triangle-list boundary fields
// (vertex_data_start, unknown_e) so ownership can still be traced for an OLDER stale reference even
// after the physical memory has since been reassigned to yet another, different chunk.
interface CachedChunkData {
  vertices: WorldChunkVertex[];
  vertexDataStart: number;
  unknownE: number;
}

type TriangleOwner =
  | { kind: 'live'; index: number; chunkX: number; chunkZ: number; triNum: number }
  | { kind: 'historical'; chunkX: number; chunkZ: number; triNum: number };

// Finds which chunk's own triangle-list range [vertex_data_start - unknown_e*12, vertex_data_start)
// actually contains this address. unknown_e is now believed to be the chunk's real triangle count
// (the reference documentation's "num_triangles" header field) - confirmed against one live,
// known-correct case: unknown_e - true_tri_num = 1 exactly (i.e. the known triangle was the last
// one in a 0-indexed list of that length). Superseded an earlier version of this function that used
// slot_buffer_base (D) instead of unknown_e - that one produced a wrong tri_num (254 vs an actual
// 128) despite correctly identifying chunk ownership, since (D - vertex_data_start)/12 turned out to
// be a larger, padded/reserved capacity rather than the real triangle count.
//
// Checks currently-loaded slots FIRST (kind: 'live'). If none match, falls back to the persistent
// cache's known boundaries for any chunk we've previously seen loaded (kind: 'historical') - every
// distinct generation of a chunk's boundaries is kept (a chunk reloading elsewhere in memory does
// NOT discard the older generation), since a frozen/stale reference may point at an OLDER location
// than whatever that chunk's most recent reload produced. Without keeping full history, a chunk
// simply reloading somewhere else would silently invalidate tracing for a still-valid old reference.
function findTriangleOwner(
  triangleAddr: number,
  slots: WorldChunkSlot[],
  cache: Map<string, CachedChunkData[]>
): TriangleOwner | null {
  for (let j = 0; j < slots.length; j++) {
    const s = slots[j];
    if (isEmpty(s)) continue;
    const triangleCount = s.unknown_e;
    if (triangleCount <= 0) continue;
    const triangleListStart = s.vertex_data_start - triangleCount * 12;
    if (triangleAddr >= triangleListStart && triangleAddr < s.vertex_data_start) {
      const num = (triangleAddr - triangleListStart) / 12;
      if (Number.isInteger(num)) return { kind: 'live', index: j, chunkX: s.chunk_x, chunkZ: s.chunk_z, triNum: num };
    }
  }

  for (const [key, generations] of cache.entries()) {
    for (const cached of generations) {
      if (cached.unknownE <= 0) continue;
      const triangleListStart = cached.vertexDataStart - cached.unknownE * 12;
      if (triangleAddr >= triangleListStart && triangleAddr < cached.vertexDataStart) {
        const num = (triangleAddr - triangleListStart) / 12;
        if (Number.isInteger(num)) {
          const [cx, cz] = key.split(',').map(Number);
          return { kind: 'historical', chunkX: cx, chunkZ: cz, triNum: num };
        }
      }
    }
  }

  return null;
}

// Classifies one of the 6 stored-triangle slots, mirroring the PSX script's real_idx/sto_idx
// comparison and its red/yellow/orange/lime split - using our confirmed slot_buffer_base for the
// real-slot lookup, and the persistent vertex cache (vlcCache) for the degenerate-triangle check,
// same purpose as the PSX script's vlc_cache. Output format mirrors the script's own compact line:
// st%d (c%02d %02d-%02d) [%03d c%02d %02d-%02d] %08X - color alone carries the sub-classification
// (garbage/degenerate/lime/orange), same as the original tool, rather than spelling it out in text.
async function classifyStoredTriangle(
  t: StoredTriangleSlot,
  slots: WorldChunkSlot[],
  vlcCache: Map<string, CachedChunkData[]>,
  playerChunkX: number | null,
  playerChunkZ: number | null
): Promise<TriangleClassification | null> {
  if (t.triangle_ptr === 0) return null;

  const stoIdx = slots.findIndex(s => !isEmpty(s) && s.chunk_x === t.chunk_x && s.chunk_z === t.chunk_z);
  const stoLabel = stoIdx >= 0 ? `c${String(stoIdx).padStart(2, '0')}` : 'cXX';
  const hex = t.triangle_ptr.toString(16).padStart(8, '0').toUpperCase();

  const triOwner = findTriangleOwner(t.triangle_ptr, slots, vlcCache);
  if (triOwner === null) {
    return { color: '#888888', label: `st (${stoLabel} ${t.chunk_x}-${t.chunk_z}) [??? ?? ??-??] ${hex}` };
  }

  const triNum = String(triOwner.triNum).padStart(3, '0');
  const realLabel = triOwner.kind === 'live' ? `c${String(triOwner.index).padStart(2, '0')}` : 'h--';
  const line = `(${stoLabel} ${t.chunk_x}-${t.chunk_z}) [${triNum} ${realLabel} ${triOwner.chunkX}-${triOwner.chunkZ}] ${hex}`;

  if (triOwner.chunkX === t.chunk_x && triOwner.chunkZ === t.chunk_z) {
    const isCurrent = playerChunkX !== null && t.chunk_x === playerChunkX && t.chunk_z === playerChunkZ;
    return { color: isCurrent ? '#3ecf5e' : '#eeeeee', label: line };
  }

  // Mismatch: the memory this pointer references has been reused for a different chunk since this
  // triangle reference was cached. This is the mechanism these skip tricks rely on, so it's expected
  // to show up, not an error state - the question is which of the 4 sub-cases it is (color only).
  let indices: [number, number, number];
  try {
    const [v0, v1, v2] = await Promise.all([
      invoke<number>('read_memory_byte', { address: t.triangle_ptr }),
      invoke<number>('read_memory_byte', { address: t.triangle_ptr + 1 }),
      invoke<number>('read_memory_byte', { address: t.triangle_ptr + 2 }),
    ]);
    indices = [v0, v1, v2];
  } catch {
    return { color: '#ff2d55', label: line };
  }

  if (indices.some(v => v >= MAX_VERTEX_INDEX)) {
    // PSX script's "red" case - indices point outside the vertex list entirely, genuinely garbage.
    return { color: '#c0392b', label: line };
  }

  // Degenerate check uses the STALE (sto_x, sto_z) label to look up the cache, matching the PSX
  // script's get_vlc_cache(sto_x, sto_z) exactly - we want the vertex data for the chunk this
  // triangle was originally resolved against, not whatever's physically there now. Tries each kept
  // generation (newest first) for one whose vertex count actually covers these indices, since the
  // stale reference may have been resolved against an OLDER layout than the chunk's latest reload.
  const generations = vlcCache.get(`${t.chunk_x},${t.chunk_z}`) ?? [];
  let cachedVertices: WorldChunkVertex[] | undefined;
  for (let g = generations.length - 1; g >= 0; g--) {
    if (indices.every(i => i < generations[g].vertices.length)) {
      cachedVertices = generations[g].vertices;
      break;
    }
  }
  if (!cachedVertices) {
    return { color: '#ffcc00', label: line };
  }

  const [v0, v1, v2] = indices.map(i => cachedVertices[i]);
  const isDegenerate = v0.x === v1.x && v1.x === v2.x && v0.z === v1.z && v1.z === v2.z;
  if (!isDegenerate) {
    return { color: '#ffcc00', label: line };
  }

  try {
    const flag = await invoke<number>('read_memory_byte', { address: t.triangle_ptr + 3 });
    const bit = 1 << (flag & 0x1f);
    const isLime = (bit & LIME_FLAG_MASK) !== 0;
    return { color: isLime ? '#7ee06b' : '#e68a2e', label: line };
  } catch {
    return { color: '#e68a2e', label: line };
  }
}

export function WorldChunkDebug({ visible }: WorldChunkDebugProps) {
  const { gameState } = useFF7Context();
  const [slots, setSlots] = useState<WorldChunkSlot[]>([]);
  const [storedTriangles, setStoredTriangles] = useState<StoredTriangleSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [classifications, setClassifications] = useState<Record<number, TriangleClassification | null>>({});
  const [lockedEntity, setLockedEntity] = useState<number | null>(null);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Persistent across polls and across a chunk being evicted from the live 32 slots - mirrors the
  // PSX script's vlc_cache, which is populated continuously and never cleared. Extended beyond just
  // vertices to also remember each chunk's triangle-list boundaries. Keeps every distinct generation
  // per coordinate (append-only) rather than overwriting - a chunk reloading elsewhere in memory
  // must not erase the boundaries that a still-valid OLDER stale reference actually points at.
  const vlcCacheRef = useRef<Map<string, CachedChunkData[]>>(new Map());
  // Frozen entity struct address to read stored_triangles from - mirrors the PSX script's CLOUD
  // variable (captured once, read repeatedly) as opposed to PLAYER (re-read every frame, follows
  // whatever's currently controlled - e.g. a mounted chocobo). Auto-locks to whatever's current the
  // first time this panel is shown; use the Relock button to intentionally re-target afterward,
  // same as the script's set_player().
  const lockedEntityRef = useRef<number | null>(null);

  const model = gameState.worldCurrentModel;
  const playerChunkX = model ? Math.floor(model.x / MESH_SIZE) : null;
  const playerChunkZ = model ? Math.floor(model.z / MESH_SIZE) : null;
  const playerChunkRef = useRef<{ x: number | null; z: number | null }>({ x: playerChunkX, z: playerChunkZ });
  playerChunkRef.current = { x: playerChunkX, z: playerChunkZ };

  const relock = async () => {
    try {
      const addr = await invoke<number>('get_world_current_entity_address');
      if (addr !== 0) {
        lockedEntityRef.current = addr;
        setLockedEntity(addr);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        if (lockedEntityRef.current === null) {
          await relock();
        }

        const result = await invoke<WorldChunkSlot[]>('read_world_chunk_slots');
        if (cancelled) return;
        setSlots(result);
        setError(null);

        for (const s of result) {
          if (!isEmpty(s) && s.vertices.length > 0) {
            const key = `${s.chunk_x},${s.chunk_z}`;
            const existing = vlcCacheRef.current.get(key) ?? [];
            // Only append a new generation if this boundary pair hasn't already been recorded for
            // this coordinate - avoids re-appending an identical entry every single poll tick for a
            // chunk that's just sitting there unchanged.
            const alreadyKnown = existing.some(
              g => g.vertexDataStart === s.vertex_data_start && g.unknownE === s.unknown_e
            );
            if (!alreadyKnown) {
              vlcCacheRef.current.set(key, [
                ...existing,
                { vertices: s.vertices, vertexDataStart: s.vertex_data_start, unknownE: s.unknown_e },
              ]);
            }
          }
        }

        let currentStored: StoredTriangleSlot[] = [];
        if (lockedEntityRef.current !== null) {
          currentStored = await readStoredTrianglesAt(lockedEntityRef.current);
        }
        if (cancelled) return;
        setStoredTriangles(currentStored);

        const { x: px, z: pz } = playerChunkRef.current;
        const entries = await Promise.all(
          currentStored.map((t, i) => classifyStoredTriangle(t, result, vlcCacheRef.current, px, pz).then(c => [i, c] as const))
        );
        if (!cancelled) {
          const next: Record<number, TriangleClassification | null> = {};
          entries.forEach(([i, c]) => {
            next[i] = c;
          });
          setClassifications(next);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // playerChunkX/Z are intentionally omitted - read via playerChunkRef instead, which is kept
    // fresh every render, so this effect only needs to restart on visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-4 bg-black/80 text-white p-3 rounded-lg font-mono text-[10px] z-50"
    >
      <div className="mb-1 opacity-70 flex items-center gap-2">
        <span style={{ pointerEvents: 'none' }}>
          World Chunk Slots{playerChunkX !== null ? ` (you: ${playerChunkX},${playerChunkZ})` : ''}
        </span>
        <button
          onClick={() => setCellSize(s => Math.max(MIN_CELL_SIZE, s - CELL_SIZE_STEP))}
          style={sizeButtonStyle}
          title="Shrink grid"
        >
          −
        </button>
        <button
          onClick={() => setCellSize(s => Math.min(MAX_CELL_SIZE, s + CELL_SIZE_STEP))}
          style={sizeButtonStyle}
          title="Enlarge grid"
        >
          +
        </button>
      </div>
      {error && <div className="text-red-400 mb-1" style={{ pointerEvents: 'none' }}>{error}</div>}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, ${cellSize}px)`,
          gap: GRID_GAP,
        }}
      >
        {slots.map((slot, i) => {
          const recordCount = (slot.vertex_data_end - slot.vertex_data_start) / 8;
          const storedMatches = isEmpty(slot)
            ? 0
            : storedTriangles.filter(t => t.chunk_x === slot.chunk_x && t.chunk_z === slot.chunk_z).length;
          const title = isEmpty(slot)
            ? `slot ${i}: empty`
            : `slot ${i}: chunk (${slot.chunk_x},${slot.chunk_z})\n` +
              `vertex/normal records: ${recordCount}\n` +
              `triangle count (unknown_e, hypothesized): ${slot.unknown_e}   unknown_f=${slot.unknown_f}\n` +
              `C (unconfirmed, likely triangle ptr): 0x${slot.triangle_data_ptr_unconfirmed.toString(16)}\n` +
              `slot buffer base: 0x${slot.slot_buffer_base.toString(16)}` +
              (storedMatches > 0 ? `\nreferenced by ${storedMatches}/6 stored triangle slot(s)` : '');
          return (
            <div
              key={i}
              title={title}
              style={{
                width: cellSize,
                height: cellSize,
                background: colorForSlot(slot, playerChunkX, playerChunkZ),
                border: storedMatches > 0 ? `2px solid ${STORED_TRIANGLE_BORDER}` : '2px solid transparent',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: Math.max(7, Math.round(cellSize * 0.5)),
                color: '#000',
                pointerEvents: 'auto',
              }}
            >
              {i}
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 flex items-center gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
        <span className="opacity-70">
          Stored Triangles (last 6 resolved) - watching entity{' '}
          {lockedEntity !== null ? `0x${lockedEntity.toString(16)}` : '(none yet)'}
        </span>
        <button
          onClick={relock}
          style={{
            pointerEvents: 'auto',
            background: '#333',
            color: '#fff',
            border: '1px solid #666',
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 9,
            cursor: 'pointer',
          }}
          title="Re-target to whatever entity is currently controlled - use this after mounting/dismounting a chocobo or vehicle if you want to switch which entity's stored triangles are shown"
        >
          Relock
        </button>
      </div>
      {storedTriangles.length > 0 && (
        <div style={{ pointerEvents: 'none' }}>
          {storedTriangles.map((t, i) => {
            if (t.triangle_ptr === 0) {
              return (
                <div key={i} style={{ color: '#666' }}>
                  st{i}: empty
                </div>
              );
            }
            const c = classifications[i];
            return (
              <div key={i} style={{ color: c?.color ?? '#888' }}>
                st{i} {c?.label ?? 'classifying...'}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
