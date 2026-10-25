import React, { MutableRefObject, useMemo } from 'react';
import * as THREE from 'three';
import { DoubleSide, TextureLoader } from 'three';
import { useLoader } from '@react-three/fiber';
import { SCALE } from './constants';
import { useFF7Context } from '@/FF7Context';
import { MODEL_TEXTURES, createTextureMap, getModelTexture } from './modelTextures';

interface ModelOverlayProps {
  zoomRef: MutableRefObject<number>;
  visible?: boolean;
  showHitbox?: boolean;
  hitboxSize?: number;
  /** Distance of each cardinal collision probe from the entity, in RAW game units (same system as
   * model.x/y/z) - gets * SCALE internally. */
  collisionProbeDistance?: number;
}

const HITBOX_SIZE = 8; // local scaled units - small on purpose, this is for pinpointing a single triangle
const HITBOX_COLOR = '#ff2d55';
// Per the reference documentation: collision is checked at the entity's own position PLUS four
// axis-aligned probes exactly this far out (north/south/east/west) - not a continuous radius or
// disc in every direction. 200 is a starting guess for the distance; tune this prop if it doesn't
// line up against an actual wall collision.
const COLLISION_PROBE_DISTANCE_RAW = 200;
const COLLISION_COLOR = '#ffb020';

const ModelOverlay: React.FC<ModelOverlayProps> = ({
  zoomRef,
  visible = true,
  showHitbox = false,
  hitboxSize = HITBOX_SIZE,
  collisionProbeDistance = COLLISION_PROBE_DISTANCE_RAW,
}) => {
  const { connected, gameState } = useFF7Context();
  
  // Load all textures
  const textures = MODEL_TEXTURES.map(config => ({
    id: config.id,
    texture: useLoader(TextureLoader, config.texture)
  }));

  // Create texture map
  const textureMap = useMemo(() => 
    createTextureMap(Object.fromEntries(textures.map(({ id, texture }) => [id, texture]))),
    [textures]
  );

  if (!connected) return null;

  const offset = 10;
  let MIN_SIZE = 75;
  let MAX_SIZE = 1600;

  const additionalModels = []
  if (gameState.zolomCoords) {
    additionalModels.push({
      model_id: 40,
      x: gameState.zolomCoords[1] + 0x34000,
      y: 10,
      z: gameState.zolomCoords[0] + 0x20000,
    })
  }

  const models = [];
  if (gameState.worldMapType === 0) {
    models.push(...gameState.worldModels);
    models.push(...additionalModels);
  } else if (gameState.worldMapType === 2) {
    const submarine = gameState.worldModels.find(model => [13, 28].includes(model.model_id) && model.y < -2000);
    if (submarine) {
      models.push(submarine);
    }
    const emerald = gameState.worldModels.find(model => model.model_id === 30);
    if (emerald) {
      models.push(emerald);
    }
    MIN_SIZE = 250;
    MAX_SIZE = 750;
  } else if (gameState.worldMapType === 3) {
    models.push(...gameState.worldModels.filter(model => [0, 1, 2].includes(model.model_id)));
    MIN_SIZE = 150;
    MAX_SIZE = 600;
  }

  const underwaterOffset = gameState.worldMapType === 2;
  const positionedModels = underwaterOffset
    ? models.map(model => ({ ...model, x: model.x - 0x18000, z: model.z - 0x10000 }))
    : models;

  // Ground-truth marker for the current player model: the exact raw position * SCALE, with no
  // icon offset/quad sizing applied, so it can be compared against where the billboard pin lands.
  const currentModel = gameState.worldCurrentModel;
  const hitboxPos: [number, number, number] | null = currentModel
    ? [
        (underwaterOffset ? currentModel.x - 0x18000 : currentModel.x) * SCALE,
        (currentModel.y || 0) * SCALE,
        (underwaterOffset ? currentModel.z - 0x10000 : currentModel.z) * SCALE,
      ]
    : null;
  const groundLineGeometry = hitboxPos
    ? new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(hitboxPos[0], 0, hitboxPos[2]),
        new THREE.Vector3(hitboxPos[0], hitboxPos[1], hitboxPos[2]),
      ])
    : null;
  const probeDistanceLocal = collisionProbeDistance * SCALE;
  // The 4 cardinal probe offsets, axis-aligned in local (X, Z) space - not diagonal, matching the
  // actual checks the game performs. Which of these corresponds to true north/south/east/west
  // in-game isn't confirmed, so they're just X+/X-/Z+/Z- here rather than labeled by compass
  // direction.
  const cardinalOffsets: [number, number][] = [
    [probeDistanceLocal, 0],
    [-probeDistanceLocal, 0],
    [0, probeDistanceLocal],
    [0, -probeDistanceLocal],
  ];
  const cardinalLineGeometries = hitboxPos
    ? cardinalOffsets.map(
        ([dx, dz]) =>
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(hitboxPos[0], 0.4, hitboxPos[2]),
            new THREE.Vector3(hitboxPos[0] + dx, 0.4, hitboxPos[2] + dz),
          ])
      )
    : null;

  const quadSize = Math.min(MAX_SIZE, Math.max(MIN_SIZE, MAX_SIZE / zoomRef.current));

  // Filter out models that don't have textures
  const availableModelIds = MODEL_TEXTURES.map(config => config.id);
  const filteredModels = positionedModels.filter(model => availableModelIds.includes(model.model_id));

  return (
    <>
      {filteredModels.map((model, index) => (
        <mesh
          key={`${model.model_id}-${index}`}
          position={[model.x * SCALE, (model.y || 0) * SCALE + offset, model.z * SCALE]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={999}
          visible={visible}
        >
          <planeGeometry args={[quadSize, quadSize]} />
          <meshBasicMaterial
            map={getModelTexture(model.model_id, textureMap)}
            color="#fff"
            side={DoubleSide}
            transparent
            opacity={1.0}
            depthTest={false}
          />
        </mesh>
      ))}
      {showHitbox && hitboxPos && (
        <group>
          {/* True 3D position - a small wireframe cube, fixed size regardless of zoom */}
          <mesh position={hitboxPos} renderOrder={1000}>
            <boxGeometry args={[hitboxSize, hitboxSize, hitboxSize]} />
            <meshBasicMaterial color={HITBOX_COLOR} wireframe depthTest={false} />
          </mesh>
          {/* Vertical guide from ground level up to the actual Y, to spot height mismatches */}
          {groundLineGeometry && (
            <primitive
              object={new THREE.Line(groundLineGeometry)}
              renderOrder={1000}
            >
              <lineBasicMaterial
                color={HITBOX_COLOR}
                depthTest={false}
                transparent
                opacity={0.8}
              />
            </primitive>
          )}
          {/* The 4 axis-aligned collision probes (entity position + 200 units N/S/E/W per the
              reference documentation), drawn as a cross rather than a disc/ring - the game does
              NOT check collision in every direction, only these 4 discrete points plus center. */}
          {cardinalLineGeometries && (
            <group>
              {cardinalLineGeometries.map((geom, i) => (
                <primitive
                  key={i}
                  object={new THREE.Line(geom)}
                  renderOrder={999}
                >
                  <lineBasicMaterial
                    color={COLLISION_COLOR}
                    depthTest={false}
                    transparent
                    opacity={0.7}
                  />
                </primitive>
              ))}
            </group>
          )}
        </group>
      )}
    </>
  );
};

export default ModelOverlay; 