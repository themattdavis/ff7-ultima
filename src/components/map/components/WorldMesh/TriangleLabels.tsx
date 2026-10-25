import { useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { TriangleWithVertices } from '../../types';
import { MESH_SIZE, SCALE } from '../../constants';

interface TriangleLabelsProps {
  triangleMap: TriangleWithVertices[] | null;
  visible: boolean;
  // Player/model position in the same local scaled space as transformedVertices (i.e. whatever you
  // already track for the "current model's position" readout, run through the same SCALE/offset
  // transform used to build transformedVertices). Null while there's no known position yet.
  playerPosition: [number, number, number] | null | undefined;
  // How far out (in local scaled units, same space as playerPosition) to keep showing labels.
  // Defaults to a couple of chunks' worth so you get useful context around the player without the
  // whole map lighting up.
  radius?: number;
}

interface ChunkInfo {
  indices: number[];
  cx: number; // chunk bbox center, local scaled units (same space as geometry positions)
  cz: number;
  cy: number; // average vertex height, just used to place the cull probe near the terrain
  halfDiag: number; // half the chunk's diagonal extent, for the distance-based chunk cull
}

// Chunks are MESH_SIZE (raw) wide; geometry positions (and therefore our local space) are already
// scaled by SCALE, so this is the chunk's width/depth in the same units as transformedVertices.
const CHUNK_SIZE = MESH_SIZE * SCALE;
const DEFAULT_RADIUS = CHUNK_SIZE * 1; // vicinity radius around the player, in local scaled units
const MIN_TRI_PX_AREA = 30; // a triangle must project to at least this many screen px^2 to get a label
const MAX_LABELS = 1200; // hard cap so a pathological view can't flood the DOM with Html nodes
const LABEL_Y_OFFSET = 1; // lift the label slightly above the triangle's highest vertex

interface Label {
  key: string;
  pos: [number, number, number];
  text: number;
}

// Renders the local (per-chunk) triangle index as a floating label, but only for triangles within
// `radius` of the player, and only ones large enough on screen to actually read. Two-level cull:
// first find which chunks are anywhere near the player at all (cheap, chunk count only), then walk
// triangles only inside those chunks (cheap, since only a handful of chunks ever qualify at once).
export function TriangleLabels({ triangleMap, visible, playerPosition, radius = DEFAULT_RADIUS }: TriangleLabelsProps) {
  // This group has no local transform of its own, so its matrixWorld exactly matches the mesh's -
  // it's rendered as a sibling of <mesh ref={meshRef}> inside the same rotated/offset group chain.
  const groupRef = useRef<THREE.Group>(null!);
  const { camera, size } = useThree();
  const [labels, setLabels] = useState<Label[]>([]);
  const lastKeyRef = useRef<string>('');

  const chunks = useMemo<ChunkInfo[]>(() => {
    if (!triangleMap) return [];
    const map = new Map<
      string,
      { indices: number[]; minX: number; maxX: number; minZ: number; maxZ: number; sumY: number; count: number }
    >();
    triangleMap.forEach((tri, i) => {
      const key = `${tri.meshOffsetX},${tri.meshOffsetZ}`;
      let g = map.get(key);
      if (!g) {
        g = { indices: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, sumY: 0, count: 0 };
        map.set(key, g);
      }
      g.indices.push(i);
      (['v0', 'v1', 'v2'] as const).forEach(vk => {
        const [x, y, z] = tri.transformedVertices[vk];
        if (x < g!.minX) g!.minX = x;
        if (x > g!.maxX) g!.maxX = x;
        if (z < g!.minZ) g!.minZ = z;
        if (z > g!.maxZ) g!.maxZ = z;
        g!.sumY += y;
        g!.count++;
      });
    });
    return Array.from(map.values()).map(g => {
      const halfW = (g.maxX - g.minX) / 2;
      const halfD = (g.maxZ - g.minZ) / 2;
      return {
        indices: g.indices,
        cx: (g.minX + g.maxX) / 2,
        cz: (g.minZ + g.maxZ) / 2,
        cy: g.count ? g.sumY / g.count : 0,
        halfDiag: Math.sqrt(halfW * halfW + halfD * halfD),
      };
    });
  }, [triangleMap]);

  useFrame(() => {
    if (!visible || !triangleMap || !groupRef.current || chunks.length === 0 || !playerPosition) {
      if (labels.length) setLabels([]);
      return;
    }

    // Orthographic camera that only ever pans/zooms (the mesh rotates, not the camera), so
    // world-units-per-screen-pixel is a single constant across the whole view. Recompute the label
    // set only when the player has actually moved (past a small deadzone), the zoom, or the canvas
    // size changed - not on every camera pan, since the vicinity no longer depends on the camera.
    const ortho = camera as THREE.OrthographicCamera;
    const zoom = ortho.zoom;
    const [px, , pz] = playerPosition;
    const key = `${px.toFixed(1)}|${pz.toFixed(1)}|${zoom.toFixed(3)}|${size.width}x${size.height}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const visibleWorldWidth = (ortho.right - ortho.left) / zoom;
    const pxPerUnit = size.width / visibleWorldWidth;

    // First-level cull: only chunks whose bounding circle overlaps the player's vicinity radius.
    const chunkCullDist = radius; // a chunk at or beyond this (center-to-player, minus its own half-diagonal) can't contain anything in range
    const candidateChunks = chunks.filter(c => {
      const dx = c.cx - px;
      const dz = c.cz - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist - c.halfDiag <= chunkCullDist;
    });

    // Triangle screen area = local (xz) area * pxPerUnit^2 exactly, since the projection here is a
    // similarity transform (pan + uniform zoom + a Y-axis rotation) - no per-vertex projection needed
    // just to decide whether a triangle is big enough to label.
    const minTriAreaLocal = MIN_TRI_PX_AREA / (pxPerUnit * pxPerUnit);
    const radiusSq = radius * radius;
    const next: Label[] = [];
    outer: for (const chunk of candidateChunks) {
      for (const idx of chunk.indices) {
        const tri = triangleMap[idx];
        const [x0, y0, z0] = tri.transformedVertices.v0;
        const [x1, y1, z1] = tri.transformedVertices.v1;
        const [x2, y2, z2] = tri.transformedVertices.v2;

        // Second-level cull: triangle centroid must actually be within the vicinity radius.
        const cx = (x0 + x1 + x2) / 3;
        const cz = (z0 + z1 + z2) / 3;
        const dx = cx - px;
        const dz = cz - pz;
        if (dx * dx + dz * dz > radiusSq) continue;

        const area = Math.abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2;
        if (area < minTriAreaLocal) continue;

        next.push({
          key: String(idx),
          pos: [cx, Math.max(y0, y1, y2) + LABEL_Y_OFFSET, cz],
          text: tri.index,
        });
        if (next.length >= MAX_LABELS) break outer;
      }
    }

    setLabels(next);
  });

  return (
    <group ref={groupRef}>
      {visible &&
        labels.map(l => (
          <Html key={l.key} position={l.pos} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                fontSize: 10,
                lineHeight: 1,
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                color: '#fff',
                textShadow: '0 0 2px #000, 0 0 3px #000, 0 0 3px #000',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              {l.text}
            </div>
          </Html>
        ))}
    </group>
  );
}
