"use strict";

import { invoke } from "@tauri-apps/api/core";
import { DataType, readMemory, writeMemory, setMemoryProtection, readMemoryBuffer } from "./memory";
import { waitFor } from "./util";
import { useFF7Context } from "./FF7Context";
import { EnemyData, GameModule, RandomEncounters, WorldFieldTblItem, Destination, PartyMember, FieldLights } from "./types";
import { FF7Addresses } from "./ff7Addresses";
import { PositiveStatuses, statuses } from "./ff7Statuses";
import { battles } from "./ff7Battles";
import { useEffect, useRef } from "react";
import { OpcodeWriter } from "./opcodewriter";
import { useSettings } from "./useSettings";
import { SaveRegions, useSaveStates } from "./useSaveStates";
import { useShortcuts } from "./useShortcuts";
import { useBattleLog } from "./hooks/useBattleLog";
import { encodeText } from "./ff7/fftext";
import { applyDoubleInputFix } from "./doubleInputFix";

// Field IDs where the "Auto-skip FMV" hack must leave the movie playing.
// Manual skipping (skipFMV / shortcut) still works on these fields.
const AUTO_SKIP_FMV_EXCLUDED_FIELDS: number[] = [384];

const hex = (str: string) => str.split(" ").map((s) => parseInt(s, 16));
let messageTimeout: number | null = null;
let messageColorAddr: number = 0;
let functionCallerAddr: number = 0;

export function useFF7(addresses: FF7Addresses) {
  const { connected, gameState, gameData, hacks, setHacks } = useFF7Context();
  const saveStates = useSaveStates();
  const initialized = useRef(false);
  const isLoadingStateRef = useRef(false);
  const { registerCustomShortcut, unregisterCustomShortcut, pauseShortcuts, resumeShortcuts } = useShortcuts();
  const { generalSettings, hackSettings, updateGeneralSettings } = useSettings();

  const codeCaveAddresses = {
    invincibility: addresses.code_cave,
    skipDialogues: addresses.code_cave + 0x20,
    customCodePreFlip: addresses.code_cave + 0x60,
  }

  useEffect(() => {
    async function writeCustomGameCode() {
      const check = await readMemory(codeCaveAddresses.customCodePreFlip, DataType.Byte);
      const alreadyWritten = check === 0x5E;

      await writeMemory(addresses.data_cave, 0xFFFF, DataType.Short);
      let writer = new OpcodeWriter(codeCaveAddresses.customCodePreFlip);

      // Self-modifying trampoline to ensure the custom functions are called only once
      writer.writeHex("5E 58 83 C0 07 8B DE 29 C3 C6 03 5D C6 43 01 C3 56 C3");

      const customCodePreFlipJmpAddr = writer.offset;
      writer.writeStart();

      const dummyCallAddr = writer.offset;
      writer.writeCall(0x0); // Dummy call for the custom draw text notification function
      writer.writeCall(0x0); // Dummy call for the custom function caller

      // Call the original GfxFlip function
      writer.writeHex("8B 45 08 50"); // mov eax, [ebp+8], push eax
      writer.writeCall(0x66059C); 
      writer.writeHex("83 C4 04"); // add esp, 4
      writer.writeReturn();

      // Custom draw text notification function
      const drawTextAddr = writer.offset;
      writer.writeStart();

      // If there's no text to draw, skip the rest of the code
      writer.writeHex("A0") // Load the text pointer
      writer.writeInt32(addresses.data_cave) // Load the text pointer
      writer.writeHex("3C FF 74 00") // If the text pointer is FF, skip the rest of the code
      const jmpAddr = writer.offset - 1

      // Draw notification text
      messageColorAddr = writer.offset + 6;
      writer.writeCall(0x6F5B03, [16, 16, 0x7C0CC4, 4, 0x3727C5AC]); // MenuDrawText(x, y, textPtr, color, z)

      writer.writeHex("8B 45 08 50 8B 0D 0C 10 DC 00 51"); // mov eax, [ebp+8], push eax, mov ecx, [0xDC0C10], push ecx
      writer.writeCall(0x66E641); // GraphicsDrawObj
      writer.writeHex("83 C4 08 8B 45 08 50 8B 0D 10 10 DC 00 51"); // add esp, 8, mov eax, [ebp+8], push eax, mov ecx, [0xDC1010], push ecx
      writer.writeCall(0x66E641); // GraphicsDrawObj
      writer.writeHex("83 C4 08"); // add esp, 8

      writer.writeReturn();

      // Calculate the jump offset
      const jmpOffset = writer.offset - jmpAddr - 3      

      // Stub for the function caller
      writer.writeStart();
      functionCallerAddr = writer.offset;
      writer.writeReturn();

      // At this point we've already written all the global variables, so we can return if the code is already written
      if (alreadyWritten) {
        return;
      }

      // Write the custom code to the code cave
      await writeMemory(codeCaveAddresses.customCodePreFlip, writer.opcodes, DataType.Buffer);

      // Write the jump offset for the custom draw text notification function
      await writeMemory(jmpAddr, jmpOffset, DataType.Byte);

      // Replace dummy calls with the actual function addresses
      writer = new OpcodeWriter(dummyCallAddr);
      writer.writeCall(drawTextAddr);
      writer.writeCall(functionCallerAddr - 3); // offset to the start of the function caller
      await writeMemory(dummyCallAddr, writer.opcodes, DataType.Buffer);

      // Call our custom function instead of the original GfxFlip
      writer = new OpcodeWriter(addresses.main_gfx_flip_call);
      writer.writeCall(customCodePreFlipJmpAddr);
      await writeMemory(addresses.main_gfx_flip_call, writer.opcodes, DataType.Buffer);

      setMemoryProtection(codeCaveAddresses.customCodePreFlip, 0x7F);
    }

    async function applyHackSettings() {
      if (hackSettings && generalSettings) {
        const { rememberedHacks } = generalSettings;
        if (rememberedHacks.speed && hackSettings.speed && hackSettings.speed !== gameState.speed) await ff7.setSpeed(parseFloat(hackSettings.speed));
        if (rememberedHacks.skipIntros && hackSettings.skipIntros !== undefined) hackSettings.skipIntros ? ff7.enableSkipIntro() : ff7.disableSkipIntro();
        if (rememberedHacks.unfocusPatch && hackSettings.unfocusPatch !== undefined && hackSettings.unfocusPatch !== gameState.unfocusPatchEnabled) hackSettings.unfocusPatch ? ff7.patchWindowUnfocus() : ff7.unpatchWindowUnfocus();
        if (rememberedHacks.swirlSkip && hackSettings.swirlSkip !== undefined && hackSettings.swirlSkip !== gameState.battleSwirlDisabled) hackSettings.swirlSkip ? ff7.disableBattleSwirl() : ff7.enableBattleSwirl();
        if (rememberedHacks.randomBattles && hackSettings.randomBattles !== undefined && hackSettings.randomBattles !== gameState.randomEncounters) {
          if (hackSettings.randomBattles === RandomEncounters.Off) {
            ff7.disableBattles();
          } else if (hackSettings.randomBattles === RandomEncounters.Normal) {
            ff7.enableBattles();
          } else if (hackSettings.randomBattles === RandomEncounters.Max) {
            ff7.maxBattles();
          }
        }
        if (rememberedHacks.expMultiplier && hackSettings.expMultiplier !== undefined) {
          ff7.setExpMultiplier(hackSettings.expMultiplier);
        }
        if (rememberedHacks.gilMultiplier && hackSettings.gilMultiplier !== undefined) {
          ff7.setGilMultiplier(hackSettings.gilMultiplier);
        }
        if (rememberedHacks.apMultiplier && hackSettings.apMultiplier !== undefined && hackSettings.apMultiplier !== gameState.apMultiplier) {
          ff7.setApMultiplier(hackSettings.apMultiplier);
        }
        if (rememberedHacks.invincibility && hackSettings.invincibility !== undefined && hackSettings.invincibility !== gameState.invincibilityEnabled) {
          hackSettings.invincibility ? ff7.enableInvincibility() : ff7.disableInvincibility();
        }
        if (rememberedHacks.instantATB && hackSettings.instantATB !== undefined && hackSettings.instantATB !== gameState.instantATBEnabled) {
          hackSettings.instantATB ? ff7.enableInstantATB() : ff7.disableInstantATB();
        }
        if (rememberedHacks.manualSlots && hackSettings.manualSlots !== undefined && hackSettings.manualSlots !== gameState.manualSlotsEnabled) {
          hackSettings.manualSlots ? ff7.enableManualSlots() : ff7.disableManualSlots();
        }
        if (rememberedHacks.skipDialogues && hackSettings.skipDialogues !== undefined && hackSettings.skipDialogues !== gameState.fieldSkipDialoguesEnabled) {
          await ff7.toggleSkipDialogues();
        }
        if (rememberedHacks.runByDefault && hackSettings.runByDefault !== undefined && hackSettings.runByDefault !== gameState.fieldRunByDefaultEnabled) {
          await ff7.toggleRunByDefault();
        }
        if (rememberedHacks.autoSense && hackSettings.autoSense !== undefined && hackSettings.autoSense !== gameState.autoSenseEnabled) {
          await ff7.toggleAutoSense();
        }
        if (rememberedHacks.walkAnywhere && hackSettings.walkAnywhere !== undefined && hackSettings.walkAnywhere !== gameState.walkAnywhereEnabled) {
          hackSettings.walkAnywhere ? await ff7.enableWalkAnywhere() : await ff7.disableWalkAnywhere();
        }
        if (rememberedHacks.worldSuperSpeed && hackSettings.worldSuperSpeed !== undefined) {
          await ff7.setWorldSpeedMultiplier(hackSettings.worldSuperSpeed ? 12 : 2);
        }
        if (rememberedHacks.worldZoomTilt && hackSettings.worldZoomTilt !== undefined && hackSettings.worldZoomTilt !== gameState.worldZoomTiltEnabled) {
          await ff7.setWorldZoomTiltEnabled(hackSettings.worldZoomTilt);
        }
        if (rememberedHacks.menuAlwaysEnabled && hackSettings.menuAlwaysEnabled !== undefined && hackSettings.menuAlwaysEnabled !== gameState.menuAlwaysEnabled) {
          hackSettings.menuAlwaysEnabled ? await ff7.enableMenuAlwaysEnabled() : await ff7.disableMenuAlwaysEnabled();
        }
        if (generalSettings?.stepLockEnabled && generalSettings?.stepLockValues) {
          const { stepId, stepFraction, stepOffset, formationIndex, dangerValue } = generalSettings.stepLockValues;
          await writeMemory(addresses.step_id, stepId, DataType.Int);
          await writeMemory(addresses.step_fraction, stepFraction, DataType.Int);
          await writeMemory(addresses.step_offset, stepOffset, DataType.Byte);
          await writeMemory(addresses.formation_idx, formationIndex, DataType.Byte);
          await writeMemory(addresses.danger_value, dangerValue, DataType.Short);
        }
      }
    }

    if (connected && !initialized.current) {
      initialized.current = true;
      writeCustomGameCode();
      applyHackSettings();
    } else if (!connected) {
      initialized.current = false;
    }
  }, [connected, hackSettings]);

  // Only act when the fix is switched on. When it's off we leave the exe alone
  // (the old code wrote "vanilla" bytes over the code on every connect, which
  // clobbers patches made by FFNx-based drivers and crashes the game).
  useEffect(() => {
    if (!connected || !generalSettings) return;
    applyDoubleInputFix(!!generalSettings.doubleInputFix).catch((e) =>
      console.warn("Double Input Fix failed", e)
    );
  }, [connected, generalSettings?.doubleInputFix]);

  type FnCall = { address: number; params?: number[] };

  const callGameFns = async (fns: FnCall[]) => {
    const startOffset = functionCallerAddr;
    const writer = new OpcodeWriter(startOffset);

    // Call the requested functions
    fns.forEach((fn) => {
      writer.writeCall(fn.address, fn.params);
    });

    // Write the result
    // writer.writeMovEax(fnCallerResultAddr);

    // Call the overwrite function to make sure we call only once
    const length = writer.offset - startOffset;
    writer.writeCall(codeCaveAddresses.customCodePreFlip, [length], true);

    writer.writeReturn();
    await writeMemory(startOffset, writer.opcodes, DataType.Buffer);
  };

  const callGameFn = async (address: number, params?: number[]) => {
    await callGameFns([{ address, params }]);
    // return await readMemory(fnCallerResultAddr, DataType.Int);
  };

  // ── World-map savestate helpers ────────────────────────────────────────────
  // Addresses come from the PC decomp of ff7.exe; the world-map data/code
  // addresses there match the ones in ff7-lib/addresses.rs.
  const WORLD_FN_SAVE_STATE_TO_SAVEMAP = 0x00766ecb; // World_SaveStateToSavemap
  const WORLD_CAMERA_ROTATION_Y = 0x00dfc474; // g_WorldCameraRotationY
  const WORLD_CAMERA_FRONT = 0x00dfc484; // g_WorldCameraFront
  const WORLD_MAP_INITIALIZED = 0x00de69e0; // g_WorldMapInitialized
  const SAVEMAP_WORLD_CAMERA_STATE = 0xf9c; // gSavemap.worldCameraState (u16)
  // Field the world state load bounces through. It only has to be a real field
  // (id > 64: ids 1-64 are world map entries). Field 65 has no music, so nothing
  // audible plays during the bounce.
  const WORLD_BOUNCE_FIELD_ID = 65;
  const WORLD_ACTOR_SIZE = 0xc0;
  const WORLD_ACTOR_COUNT = 16;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // callGameFns() only queues the call; the game runs it at its next frame
  // flip and the one-shot trampoline then overwrites the stub with `pop ebp; ret`
  // (0x5D 0xC3). Wait for that so we know the call has really happened.
  const waitForGameFnCall = async (timeoutMs = 600) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if ((await readMemory(functionCallerAddr, DataType.Byte)) === 0x5d) return true;
      await sleep(20);
    }
    return false;
  };

  // The game only copies the live world state into the savemap when the world
  // map is left or the menu opens (World_SaveStateToSavemap). Anything saved in
  // between (player model/vehicle, map variant, camera, terrain currents, the
  // six vehicle slots, the checksum) is stale, so ask the game to refresh it.
  // That function also snaps the camera to the front in camera mode 0, so the
  // live camera is put back afterwards and the real yaw is kept in the
  // returned value.
  const syncWorldSavemap = async () => {
    if (!functionCallerAddr) return { ran: false, rotationY: 0 };
    const rotationY = await readMemory(WORLD_CAMERA_ROTATION_Y, DataType.Int);
    const front = await readMemory(WORLD_CAMERA_FRONT, DataType.Int);
    await callGameFn(WORLD_FN_SAVE_STATE_TO_SAVEMAP);
    const ran = await waitForGameFnCall();
    if (!ran) {
      // Never leave the call queued: it would run at some later frame, possibly
      // in another module, and corrupt the savemap. Put the empty stub back.
      await writeMemory(functionCallerAddr, [0x5d, 0xc3], DataType.Buffer);
    }
    await writeMemory(WORLD_CAMERA_ROTATION_Y, rotationY, DataType.Int);
    await writeMemory(WORLD_CAMERA_FRONT, front, DataType.Int);
    return { ran, rotationY };
  };

  type LiveWorldModel = { index: number; model_id: number; x: number; y: number; z: number; direction: number };

  // Fresh read of the 16 world actor records (never the React snapshot, which
  // goes stale across a world re-init). A record is live when its render
  // object (+0xB8) is set, the same test ff7-lib uses.
  const readLiveWorldModels = async (): Promise<LiveWorldModel[]> => {
    const raw = await readMemoryBuffer(addresses.world_models, WORLD_ACTOR_SIZE * WORLD_ACTOR_COUNT);
    const view = new DataView(new Uint8Array(raw).buffer);
    const models: LiveWorldModel[] = [];
    for (let i = 0; i < WORLD_ACTOR_COUNT; i++) {
      const o = i * WORLD_ACTOR_SIZE;
      if (view.getUint32(o + 0xb8, true) === 0) continue;
      models.push({
        index: i,
        model_id: view.getUint8(o + 0x50),
        x: view.getUint32(o + 0x0c, true),
        y: view.getInt32(o + 0x10, true),
        z: view.getUint32(o + 0x14, true),
        direction: view.getInt16(o + 0x40, true),
      });
    }
    return models;
  };

  // Place a world actor the way the game's own WorldEntity_RestoreFromVehicleSlot
  // does: pos AND altPos (the previous position the game reverts to and packs
  // into the vehicle slots) get the position, and facing, heading and direction
  // all get the direction. `direction` is a 16-bit field: it must be written as
  // a short, a 32-bit write also clobbers groundY at +0x42.
  const placeWorldActor = async (
    base: number,
    p: { x: number; y: number; z: number; direction: number }
  ) => {
    const vec = new DataView(new ArrayBuffer(12));
    vec.setInt32(0, p.x | 0, true);
    vec.setInt32(4, p.y | 0, true);
    vec.setInt32(8, p.z | 0, true);
    const bytes = Array.from(new Uint8Array(vec.buffer));
    const direction = p.direction & 0xffff;
    await writeMemory(base + 0x0c, bytes, DataType.Buffer); // pos
    await writeMemory(base + 0x1c, bytes, DataType.Buffer); // altPos
    await writeMemory(base + 0x3c, direction, DataType.Short); // heading
    await writeMemory(base + 0x3e, 0, DataType.Short); // headingOffset
    await writeMemory(base + 0x40, direction, DataType.Short); // direction
    await writeMemory(base + 0x4c, direction, DataType.Short); // facing
  };

  // The world map is fully loaded once g_WorldMapInitialized is set (it is
  // cleared whenever the map is left). Before that the player pointer is
  // null or stale and the init code would overwrite anything we write.
  const waitForWorldReady = async (timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const mod = await readMemory(addresses.current_module, DataType.Byte);
      if (
        mod === GameModule.World &&
        (await readMemory(WORLD_MAP_INITIALIZED, DataType.Int)) !== 0 &&
        (await readMemory(addresses.world_current_obj_ptr, DataType.Int)) !== 0
      ) {
        return true;
      }
      await sleep(50);
    }
    return false;
  };

  // Undo a "leave the world map" request that did not go through. Order matters:
  // back to normal play (state 1) first, then drop the request flag. In fade-out
  // state 2 with no request the game opens the menu.
  const cancelWorldLeave = async () => {
    if ((await readMemory(addresses.current_module, DataType.Byte)) === GameModule.World) {
      await writeMemory(addresses.world_mode, 1, DataType.Byte);
    }
    await writeMemory(addresses.world_mode + 0xC, 0, DataType.Byte);
  };

  type StepValues = {
    stepId: number;
    stepFraction: number;
    stepOffset: number;
    formationIndex: number;
    dangerValue: number;
  };

  // Step ID, fraction, offset, formation index and danger value. Same memory
  // and data types as the field state / step lock code uses.
  const readStepValues = async (): Promise<StepValues> => ({
    stepId: await readMemory(addresses.step_id, DataType.Int),
    stepFraction: await readMemory(addresses.step_fraction, DataType.Int),
    stepOffset: await readMemory(addresses.step_offset, DataType.Byte),
    formationIndex: await readMemory(addresses.formation_idx, DataType.Byte),
    dangerValue: await readMemory(addresses.danger_value, DataType.Short),
  });

  const writeStepValues = async (v: StepValues) => {
    await writeMemory(addresses.step_id, v.stepId, DataType.Int);
    await writeMemory(addresses.step_fraction, v.stepFraction, DataType.Int);
    await writeMemory(addresses.step_offset, v.stepOffset, DataType.Byte);
    await writeMemory(addresses.formation_idx, v.formationIndex, DataType.Byte);
    await writeMemory(addresses.danger_value, v.dangerValue, DataType.Short);
  };

  // Snapshot of everything a world state needs.
  const captureWorldState = async () => {
    const { ran, rotationY } = await syncWorldSavemap();
    if (!ran) {
      console.warn("saveWorldState: the game did not run World_SaveStateToSavemap, the world part of the savemap may be stale");
    }
    const savemap = Array.from((await readMemoryBuffer(addresses.savemap, 0x10f4)) as ArrayLike<number>);
    if (ran) {
      // Keep the real camera yaw (the game's save function resets it in camera mode 0).
      const camera = savemap[SAVEMAP_WORLD_CAMERA_STATE] | (savemap[SAVEMAP_WORLD_CAMERA_STATE + 1] << 8);
      const patched = (camera & 0xf000) | (rotationY & 0x0fff);
      savemap[SAVEMAP_WORLD_CAMERA_STATE] = patched & 0xff;
      savemap[SAVEMAP_WORLD_CAMERA_STATE + 1] = (patched >> 8) & 0xff;
    }

    const playerPtr = await readMemory(addresses.world_current_obj_ptr, DataType.Int);
    let worldX = 0, worldY = 0, worldZ = 0, worldDirection = 0;
    if (playerPtr) {
      worldX = await readMemory(playerPtr + 0x0c, DataType.Int);
      worldY = await readMemory(playerPtr + 0x10, DataType.SignedInt);
      worldZ = await readMemory(playerPtr + 0x14, DataType.Int);
      worldDirection = await readMemory(playerPtr + 0x40, DataType.SignedShort);
    }

    const modelCoords = (await readLiveWorldModels()).map((m) => ({
      model_id: m.model_id,
      x: m.x,
      y: m.y,
      z: m.z,
      direction: m.direction,
    }));

    return {
      savemap,
      worldX,
      worldY,
      worldZ,
      worldDirection,
      worldMapType: gameState.worldMapType,
      modelCoords,
      stepValues: await readStepValues(),
    };
  };

  const getFieldObjPtr = async () => {
    const fieldObjPtr = await readMemory(addresses.field_obj_ptr, DataType.Int);
    if (fieldObjPtr === 0) {
      return 0;
    }
    return fieldObjPtr;
  };

  const getGfxFlipPtr = async () => {
    if (!gameState.gameObjPtr) {
      return 0;
    }

    const gfxFunctionPtrs = await readMemory(gameState.gameObjPtr + 0x934, DataType.Int);
    return readMemory(gfxFunctionPtrs + 0x4, DataType.Int);
  };

  const toggleBitmaskValue = (bitmask: number, index: number) => {
    if (index === -1) {
      bitmask = bitmask & 1 ? 0 : 0xffff;
    } else if (bitmask & (1 << index)) {
      bitmask &= ~(1 << index);
    } else {
      bitmask |= 1 << index;
    }    
    return bitmask;
  }

  if (hacks.skipIntro && gameState.currentModule === GameModule.Intro) {
    setTimeout(async () => {
      await writeMemory(addresses.intro_skip, 0x01, DataType.Byte);
    }, 0);
  }

  // Auto-skip FMVs: poll movie_is_playing each cycle and call skipFMV if active
  if ((generalSettings?.autoSkipFMV ?? false) && gameState.currentModule === GameModule.Field && !AUTO_SKIP_FMV_EXCLUDED_FIELDS.includes(gameState.fieldId)) {
    setTimeout(async () => {
      const isMoviePlaying = await readMemory(addresses.movie_is_playing, DataType.Byte);
      if (isMoviePlaying) {
        await applyFieldFMVSkip();
      }
    }, 0);
  }


  // Fixes for softlocks during skip field dialogues
  if (gameState.fieldSkipDialoguesEnabled) {
    // President Shinra talk in Reactor 5
    if (gameState.gameMoment === 128 && [0, 2].includes(gameState.fieldTmpVars[9])) {
      setTimeout(async () => {
        await writeMemory(addresses.field_script_temp_vars + 9, 1, DataType.Byte);
      }, 0);
    }
    // Turks scene in the Mythril Mines
    if (gameState.fieldId === 349 && gameState.gameMoment === 387 && gameState.fieldTmpVars[10] === 0) {
      setTimeout(async () => {
        const fieldFileSection1Ptr = await readMemory(addresses.field_file_section1_ptr, DataType.Int);
        await writeMemory(fieldFileSection1Ptr + 0xAF9, 2, DataType.Byte);
        await writeMemory(addresses.field_script_temp_vars + 10, 1, DataType.Byte);
      }, 0);
    }
    // Cloud wakes up in Gongaga 
    if (gameState.fieldId === 518 && gameState.gameMoment === 638 && gameState.fieldTmpVars[13] === 0) {
      setTimeout(async () => {
        const fieldFileSection1Ptr = await readMemory(addresses.field_file_section1_ptr, DataType.Int);
        await writeMemory(fieldFileSection1Ptr + 0xC5A, 2, DataType.Byte);
        await writeMemory(addresses.field_script_temp_vars + 13, 1, DataType.Byte);
      }, 0);
    }
    // Tifa execution scene - press room
    if (gameState.fieldId === 401 && gameState.gameMoment === 1003 && gameState.fieldTmpVars[11] === 0) {
      setTimeout(async () => {
        const fieldFileSection1Ptr = await readMemory(addresses.field_file_section1_ptr, DataType.Int);
        await writeMemory(fieldFileSection1Ptr + 0x6FE, 2, DataType.Byte);
        await writeMemory(addresses.field_script_temp_vars + 11, 1, DataType.Byte);
      }, 0);
    }
    // Shinra rocket launch scene
    if (gameState.fieldId === 567 && gameState.gameMoment === 1308 && gameState.fieldTmpVars[26] === 0) {
      setTimeout(async () => {
        const fieldFileSection1Ptr = await readMemory(addresses.field_file_section1_ptr, DataType.Int);
        await writeMemory(fieldFileSection1Ptr + 0x11EB, 2, DataType.Byte);
        await writeMemory(fieldFileSection1Ptr + 0x1E41, 2, DataType.Byte);
        await writeMemory(fieldFileSection1Ptr + 0x1EED, 2, DataType.Byte);
        await writeMemory(addresses.field_script_temp_vars + 26, 1, DataType.Byte);
      }, 0);
    }
    // Shinra rocket escape pod scene
    if (gameState.fieldId === 569 && gameState.gameMoment === 1314 && gameState.fieldTmpVars[11] === 0) {
      setTimeout(async () => {
        const fieldFileSection1Ptr = await readMemory(addresses.field_file_section1_ptr, DataType.Int);
        await writeMemory(fieldFileSection1Ptr + 0x91B, 2, DataType.Byte);
        await writeMemory(addresses.field_script_temp_vars + 11, 1, DataType.Byte);
      }, 0);
    }
  }

  const speedHackEnhancementsOn = generalSettings?.speedHackEnhancements ?? true;

  // When speed hack is enabled disable temperature dropping on the Great Glacier climbing sections
  const snowFields = [689, 692, 694];
  const glacierTempDisabled = (speedHackEnhancementsOn && parseFloat(gameState.speed) > 1) || (generalSettings?.disableGlacierTemp ?? false);
  if (glacierTempDisabled && snowFields.includes(gameState.fieldId)) {
    // First screen (gaia_1) stores temperature in temp var 9, other screens use temp var 8
    if (gameState.fieldId === 689 && gameState.fieldTmpVars[9] < 37) {
      setTimeout(async () => {
        await writeMemory(addresses.field_script_temp_vars + 9, 37, DataType.Byte);
      }, 0);
    } else if (gameState.fieldTmpVars[8] < 37) {
      setTimeout(async () => {
        await writeMemory(addresses.field_script_temp_vars + 8, 37, DataType.Byte);
      }, 0);
    }
  }

  // Disable the lines that trigger battles in the Whirlwind Maze fields
  const whirlwindMazeFields = [709, 710, 711];
  const whirlwindBattlesDisabled = (speedHackEnhancementsOn && parseFloat(gameState.speed) > 1) || (generalSettings?.disableWhirlwindBattles ?? false);
  if (whirlwindBattlesDisabled && whirlwindMazeFields.includes(gameState.fieldId) && gameState.fieldLines[0].enabled === 1) {
    setTimeout(async () => {
      await writeMemory(addresses.field_line_objs + 0xc, 0, DataType.Byte);
      await writeMemory(addresses.field_line_objs + 0x18 + 0xc, 0, DataType.Byte);
    }, 0);
  }
  // Re-enable the lines when speed hack is disabled
  else if (!whirlwindBattlesDisabled && whirlwindMazeFields.includes(gameState.fieldId) && gameState.fieldLines[0].enabled === 0) {
    setTimeout(async () => {
      await writeMemory(addresses.field_line_objs + 0xc, 1, DataType.Byte);
      await writeMemory(addresses.field_line_objs + 0x18 + 0xc, 1, DataType.Byte);
    }, 0);
  }

  // Re-enforce save anywhere if the game resets the menu lock
  if ((generalSettings?.saveAnywhere ?? false) && Boolean(gameState.menuLocks & (1 << 9))) {
    setTimeout(async () => {
      await writeMemory(addresses.menu_locks, gameState.menuLocks & ~(1 << 9), DataType.Short);
    }, 0);
  }

  // Re-enforce step lock each tick
  if (generalSettings?.stepLockEnabled && generalSettings?.stepLockValues && gameState.currentModule === GameModule.Field) {
    const { stepId, stepFraction, stepOffset, formationIndex, dangerValue } = generalSettings.stepLockValues;
    setTimeout(async () => {
      if (gameState.stepId !== stepId) await writeMemory(addresses.step_id, stepId, DataType.Int);
      if (gameState.stepFraction !== stepFraction) await writeMemory(addresses.step_fraction, stepFraction, DataType.Int);
      if (gameState.stepOffset !== stepOffset) await writeMemory(addresses.step_offset, stepOffset, DataType.Byte);
      if (gameState.formationIndex !== formationIndex) await writeMemory(addresses.formation_idx, formationIndex, DataType.Byte);
      if (gameState.dangerValue !== dangerValue) await writeMemory(addresses.danger_value, dangerValue, DataType.Short);
    }, 0);
  }

  // Assign on every render so the closure always has fresh generalSettings/gameState.
  // A useEffect would delete it during cleanup (whenever step values change), causing
  // F12 to silently no-op via optional chaining in that brief window.
  (window as any).__toggleStepLock = () => {
    if (!generalSettings) return;
    if (!generalSettings.stepLockEnabled) {
      updateGeneralSettings({
        ...generalSettings,
        stepLockEnabled: true,
        stepLockValues: {
          stepId: gameState.stepId,
          stepFraction: gameState.stepFraction,
          stepOffset: gameState.stepOffset,
          formationIndex: gameState.formationIndex,
          dangerValue: gameState.dangerValue,
        },
      });
    } else {
      updateGeneralSettings({ ...generalSettings, stepLockEnabled: false });
    }
  };

  useEffect(() => {
    const registerManualSlotsShortcuts = async () => {
      const adjustSlotOffset = async (delta: number) => {
        // Battle arena has different slot offset addresses
        const currentSlotIdx = await readMemory(gameState.slotsActive === 3 ? 0xdc3860 : 0xdc3c24, DataType.Byte);
        const slotOffsetsAddr = gameState.slotsActive === 3 ? 0xdc3c30 : 0xdc3c00;

        // Tifa slots are smaller than the other slots
        const slotMultiplier = gameState.slotsActive === 2 ? 4 : 8;

        // Different slot counts for different slot sets
        const slotsCount = gameState.slotsActive === 2 ? 12 : gameState.slotsActive === 1 ? 16 : 8;

        const slotOffset = await readMemory(slotOffsetsAddr + currentSlotIdx * 2, DataType.Short);
        let newOffset = (Math.floor(slotOffset / slotMultiplier) + delta) * slotMultiplier;
        if (newOffset < 0) newOffset = (slotsCount - 1) * slotMultiplier;
        await writeMemory(slotOffsetsAddr + currentSlotIdx * 2, newOffset, DataType.Short);
      }

      if (gameState.manualSlotsEnabled && gameState.slotsActive > 0) {
        try {
          await registerCustomShortcut("Up", async () => {
            await adjustSlotOffset(1);
          });
          await registerCustomShortcut("Down", async () => {
            await adjustSlotOffset(-1);
          });
          await registerCustomShortcut("Left", async () => {
            await adjustSlotOffset(-1);
          });
          await registerCustomShortcut("Right", async () => {
            await adjustSlotOffset(1);
          });

          console.debug('Registered manual slots shortcuts');
        } catch (e) {
          console.error("Failed to register manual slots shortcuts:", e);
        }
      } else {
        try {
          await unregisterCustomShortcut("Up");
          await unregisterCustomShortcut("Down"); 
          await unregisterCustomShortcut("Left");
          await unregisterCustomShortcut("Right");

          console.debug('Unregistered manual slots shortcuts');
        } catch (e) {
          console.error("Failed to unregister manual slots shortcuts:", e);
        }
      }
    };

    registerManualSlotsShortcuts();
  }, [gameState.manualSlotsEnabled, gameState.slotsActive]);

  const { addLogItem, clearLogs } = useBattleLog();
  useEffect(() => {
    const priority = gameState.battleQueue[0];
    const queuePosition = gameState.battleQueue[1];

    if (gameState.currentModule === GameModule.Battle) {
      // Skip the initial state of the battle queue
      if (gameState.battleQueue.every(byte => byte === 0)) {
        clearLogs();
        return;
      }

      addLogItem({
        attacker: gameState.battleQueue[2],
        targetMask: gameState.battleQueue[6] + gameState.battleQueue[7] * 256,
        commandId: gameState.battleQueue[3],
        parameter: gameState.battleQueue[4] + gameState.battleQueue[5] * 256,
        queuePosition,
        priority,
      });
    }
  }, [gameState.battleQueue, gameState.currentModule, addLogItem]);


  // Standalone helper: write the movie_skip byte and apply all field-specific
  // softlock fixes. Used by both skipFMV() and the auto-skip polling block.
  const applyFieldFMVSkip = async () => {
    await writeMemory(addresses.movie_skip, 0x01, DataType.Byte);

    if (gameState.fieldId === 116) {
      const fieldObjPtr = await getFieldObjPtr();
      await writeMemory(fieldObjPtr + 0x4c, 0x01, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x4e, 0xff, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x50, 0xff, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x0a, 0x0a, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x0c, 0x23, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x1d, 0x4, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x1f, 0x0, DataType.Byte);
      await callGameFn(0x742055, [2]);
    }

    if (gameState.fieldId === 399) {
      await writeMemory(addresses.field_script_temp_vars + 9, 1, DataType.Byte);
    } else if (gameState.fieldId === 496) {
      await writeMemory(addresses.field_script_temp_vars + 8, 180, DataType.Byte);
    } else if (gameState.fieldId === 543 && gameState.gameMoment === 469) {
      await writeMemory(addresses.game_moment, 493, DataType.Short);
      // warpToFieldId is on the ff7 object — replicate inline to avoid forward ref
      await writeMemory(addresses.field_global_obj + 2, 541, DataType.Short);
      await writeMemory(addresses.field_global_obj + 1, 1, DataType.Byte);
    } else if (gameState.fieldId === 489 && gameState.gameMoment >= 592 && gameState.gameMoment <= 595) {
      await writeMemory(addresses.game_moment, 595, DataType.Short);
      await writeMemory(addresses.field_global_obj + 2, 488, DataType.Short);
      await writeMemory(addresses.field_global_obj + 1, 1, DataType.Byte);
    } else if (gameState.fieldId === 731) {
      const fieldObjPtr = await getFieldObjPtr();
      await writeMemory(fieldObjPtr + 0x4c, 0x01, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x4e, 0xff, DataType.Byte);
      await writeMemory(fieldObjPtr + 0x50, 0xff, DataType.Byte);
    }
  };

  const ff7 = {
    connected,
    gameState,
    hacks,
    setHacks,
    addresses,
    saveStates,
    callGameFn,
    callGameFns,
    pauseShortcuts,
    resumeShortcuts,
    showGameMessage:  async (text: string, duration: number, color: number = 0x04) => {
      const encodedText = encodeText(text);
      await writeMemory(messageColorAddr, color, DataType.Byte);
      await writeMemory(addresses.data_cave, Array.from(encodedText), DataType.Buffer);

      // Clear any existing timeout
      if (messageTimeout) {
        clearTimeout(messageTimeout);
        messageTimeout = null;
      }
      
      // Set new timeout
      messageTimeout = setTimeout(async () => {
        await writeMemory(addresses.data_cave, 0xFFFF, DataType.Short);
        messageTimeout = null;
      }, duration);
    },
    setSpeed: async (speed: number) => {
      const ffnxCheck = await readMemory(addresses.ffnx_check, DataType.Byte);
      if (ffnxCheck === 0xE9) {
        const baseAddress = await readMemory(addresses.ffnx_check + 1, DataType.Int) + addresses.ffnx_check + 5;
        const code = await readMemoryBuffer(baseAddress, 256);
        const opcodes = [0xF2, 0x0F, 0x10, 0x05];

        const fps30index = code.findIndex((byte, i) =>
          opcodes.every((opcode, j) => code[i + j] === opcode)
        );
        if (fps30index === -1) {
          return false;
        }
        
        const fps15index = code.slice(fps30index + 1).findIndex((byte, i) =>
          opcodes.every((opcode, j) => code.slice(fps30index + 1)[i + j] === opcode)
        ) + fps30index + 1;
        if (fps15index - fps30index - 1 === -1) {
          return false;
        }

        const addrFps30 = await readMemory(baseAddress + fps30index + 4, DataType.Int);
        const addrFps15 = await readMemory(baseAddress + fps15index + 4, DataType.Int);

        await setMemoryProtection(addrFps15, 16);

        // Field & World
        await writeMemory(addrFps30, 30 * speed, DataType.Float);

        // Battle
        await writeMemory(addrFps15, 15 * speed, DataType.Float);
        return true;
      }

      const setFps = async (address: number, defaultFps: number) => {
        await writeMemory(address, 10000000 / (defaultFps * speed), DataType.Float);
      };

      // Set FPS for each module
      await setFps(addresses.field_fps, 30);
      await setFps(addresses.battle_fps, 15);
      await setFps(addresses.world_fps, 30);

      // Remove FPS init code for each module so it doesn't get reset on module init
      await writeMemory(0x60e434, hex("90 90 90 90 90 90"), DataType.Buffer);
      await writeMemory(0x74bd02, hex("90 90 90 90 90 90"), DataType.Buffer);
      await writeMemory(0x41b6d8, hex("90 90 90 90 90 90"), DataType.Buffer);

      return true;
    },
    toggleMenuAccess: async () => {
      await writeMemory(addresses.field_menu_access_enabled, gameState.fieldMenuAccessEnabled ? 0 : 1, DataType.Byte);
    },
    toggleMovement: async () => {
      await writeMemory(addresses.field_movement_disabled, gameState.fieldMovementDisabled ? 0 : 1, DataType.Byte);
    },
    toggleSkipDialogues: async () => {
      if (!gameState.fieldSkipDialoguesEnabled) {
        // Write the function that checks whether the window is non-closable and only skips the closable ones
        const code = hex("8B 45 08 25 FF 00 00 00 69 C0 30 00 00 00 53 8B D8 0F BF 93 E4 F5 CF 00 66 85 D2 75 19 0F BF 8B E6 F5 CF 00 83 E1 01 85 C9 75 0B B8 01 00 00 00 5B E9 84 51 21 00 5B C3");
        await writeMemory(codeCaveAddresses.skipDialogues, code, DataType.Buffer);
        const writer = new OpcodeWriter(codeCaveAddresses.skipDialogues + code.length);
        writer.writeJmp(addresses.field_skip_dialogues + 0x30D);
        await writeMemory(codeCaveAddresses.skipDialogues + code.length, writer.opcodes, DataType.Buffer);

        // Call the new function
        const writer2 = new OpcodeWriter(addresses.field_skip_dialogues);
        writer2.writeCall(codeCaveAddresses.skipDialogues);
        await writeMemory(addresses.field_skip_dialogues, writer2.opcodes, DataType.Buffer);
        await writeMemory(addresses.field_skip_dialogues + 5, hex("90 90 90 90 90 90"), DataType.Buffer);
      } else {
        // Restore the original code
        await writeMemory(addresses.field_skip_dialogues, hex("8b 45 08 25 ff 00 00 00 6b c0 30"), DataType.Buffer);
      }
      return gameState.fieldSkipDialoguesEnabled;
    },
    enableAllMenus: async () => {
      await writeMemory(addresses.menu_visibility, 0xffff, DataType.Short);
      await writeMemory(addresses.menu_locks, 0, DataType.Short);
    },
    enableAllPartyMembers: async () => {
      await writeMemory(addresses.party_visibility_mask, 0x7ff, DataType.Short);
      await writeMemory(addresses.party_locking_mask, 0, DataType.Short);
    },
    disableBattles: async () => {
      // Field
      await writeMemory(addresses.field_battle_disable, hex("e9 e0 02 00 00 90"), DataType.Buffer);

      // World
      await writeMemory(addresses.world_battle_disable, 0, DataType.Byte);
    },
    enableBattles: async () => {
      // Field
      await writeMemory(addresses.field_battle_disable, hex("0f 83 df 02 00 00"), DataType.Buffer);

      // World
      await writeMemory(addresses.world_battle_enable, 0x0a, DataType.Byte);
      await writeMemory(addresses.world_battle_disable, 0x01, DataType.Byte);
    },
    maxBattles: async () => {
      await writeMemory(addresses.field_battle_disable, hex("90 90 90 90 90 90"), DataType.Buffer);

      // World
      await writeMemory(addresses.world_battle_enable, 0x0f, DataType.Byte);
      await writeMemory(addresses.world_battle_disable, 0x10, DataType.Byte);
    },
    endBattle: async (win: boolean) => {
      if (gameState.currentModule === GameModule.Battle) {
        const checkForBattleEnd = async () => {
          try {
            const battleMode = await readMemory(addresses.battle_mode, DataType.Byte);
            if (battleMode > 5) {
              if (!win) {
                await writeMemory(addresses.battle_end_check, 0x08, DataType.Byte);
              } else {
                for (let i = 4; i < 10; i++) {
                  await writeMemory(addresses.battle_char_base + i * 104, statuses.Dead, DataType.Int);
                }
                await writeMemory(addresses.battle_mode, 0x10, DataType.Byte);
                await writeMemory(addresses.battle_end_check, 0x20, DataType.Byte);
              }
            } else if (!connected || gameState.currentModule !== GameModule.Battle) {
              return;
            } else {
              setTimeout(checkForBattleEnd, 100);
            }
          } catch (e) {
            console.warn("Could not end battle", e);
          }
        };
        setTimeout(checkForBattleEnd, 100);
      }
    },
    patchWindowUnfocus: async () => {
      if (!gameState.gameObjPtr) {
        return;
      }

      const ffnxCheck = await readMemory(addresses.ffnx_check, DataType.Byte);
      if (ffnxCheck === 0xE9) {
        return;
      }

      // Add Global Focus flag to sound buffer initialization so we don't lose sound while unfocused
      await writeMemory(addresses.sound_buffer_focus, 0x80, DataType.Byte);

      // Check if window already was unfocused (tick function pointer is out of program memory)
      console.log("patchWindowUnfocus", gameState.gameObjPtr);
      await waitFor(async () => {
        const tickFunctionPtr = await readMemory(gameState.gameObjPtr + 0xa00, DataType.Int);
        return tickFunctionPtr <= 0xffffff;
      });

      // Find the function responsible for halting the game when unfocused
      const gfxFlipPtr = await getGfxFlipPtr();

      // Add a RET instruction at the beginning of this function
      await writeMemory(gfxFlipPtr + 0x260, 0xc3, DataType.Byte);

      // Add the Global Focus flag for music, this is initialized inside the AF3DN library
      await writeMemory(gfxFlipPtr + 0x8BDD, 0x80, DataType.Byte);
    },
    unpatchWindowUnfocus: async () => {
      if (!gameState.gameObjPtr) {
        return;
      }

      const ffnxCheck = await readMemory(addresses.ffnx_check, DataType.Byte);
      if (ffnxCheck === 0xE9) {
        return;
      }

      // Find the function responsible for halting the game when unfocused
      const gfxFlipPtr = await getGfxFlipPtr();

      // Remove the RET instruction at the beginning of this function
      await writeMemory(gfxFlipPtr + 0x260, 0x51, DataType.Byte);

      // Remove the global focus flags
      await writeMemory(addresses.sound_buffer_focus, 0, DataType.Byte);
      await writeMemory(gfxFlipPtr + 0x8BDD, 0, DataType.Byte);
    },
    async skipFMV(win?: boolean) {
      if (gameState.currentModule === GameModule.Field) {
        const isMoviePlaying = await readMemory(addresses.movie_is_playing, DataType.Byte);
        if (isMoviePlaying === 0) {
          return;
        }
        await applyFieldFMVSkip();
      } else if ([GameModule.SnowBoard, GameModule.Snowboard2].includes(gameState.currentModule)) {
        await writeMemory(0xdd7cac, 0, DataType.Byte);
      } else if (gameState.currentModule === GameModule.Highway) {
        await writeMemory(0xd85974, 0, DataType.Byte);
      } else if (gameState.currentModule === GameModule.Submarine) {
        if (win) {
          console.log("Win submarine minigame");
          await writeMemory(0xe74768, 1, DataType.Byte);
        }
        await writeMemory(0x980dac, 0, DataType.Byte);
      } else if (gameState.currentModule === GameModule.Condor) {
        await writeMemory(0xcbc80c, 5, DataType.Byte);
      } else if (gameState.currentModule === GameModule.Chocobo) {
        await writeMemory(addresses.savemap + 0x0DBD, 0, DataType.Byte); // 1st place
        await writeMemory(0xe3bad0, 1, DataType.Byte);
      } else if (gameState.currentModule === GameModule.Jet) {
        await writeMemory(0xc3f774, 1, DataType.Byte);
      }
    },
    startBattle: async (battleId: number, musicId: number) => {
      if (isNaN(battleId)) {
        return;
      }

      switch (gameState.currentModule) {
        case GameModule.Field:
          const fieldObjPtr = await getFieldObjPtr();

          await writeMemory(fieldObjPtr + 1, 2, DataType.Byte); // Battle game module
          await writeMemory(fieldObjPtr + 2, battleId, DataType.Short);
          await writeMemory(fieldObjPtr + 38, 0, DataType.Short);
          await writeMemory(addresses.battle_module_field, 1, DataType.Byte);

          if (musicId) {
            await writeMemory(fieldObjPtr + 68, musicId - 1, DataType.Byte);
          }

          // Wait for the battle to start
          await waitFor(async () => {
            return (await readMemory(addresses.current_module, DataType.Byte)) === GameModule.Battle;
          });

          // Reset the game module variable
          await writeMemory(fieldObjPtr + 1, 0, DataType.Byte);
          break;
        case GameModule.World:
          await writeMemory(addresses.battle_id_world, battleId, DataType.Int);
          await writeMemory(addresses.world_battle_flag1, 0, DataType.Int);
          await writeMemory(addresses.world_battle_flag2, 0, DataType.Int);
          await writeMemory(addresses.world_battle_flag3, 1, DataType.Int);
          await writeMemory(addresses.world_battle_flag4, 3, DataType.Int);

          if (battles[battleId].indexOf("Chocobo") > -1) {
            const chocoboRating = await invoke("get_chocobo_rating_for_scene", { sceneId: battleId }) as number;
            await writeMemory(addresses.battle_chocobo_rating, chocoboRating, DataType.Byte);
          }

          break;
        default:
          return;
      }
    },
    disableBattleSwirl: async () => {
      await writeMemory(addresses.battle_swirl_disable1, 0x00, DataType.Byte);
      await writeMemory(addresses.battle_swirl_disable2, 0x00, DataType.Byte);
    },
    enableBattleSwirl: async () => {
      const check = await readMemory(addresses.battle_swirl_disable2, DataType.Byte);
      if (check === 0x00) {
        await writeMemory(addresses.battle_swirl_disable1, 0x2e, DataType.Byte);
        await writeMemory(addresses.battle_swirl_disable2, 0x4e, DataType.Byte);
      }
    },
    enableInstantATB: async () => {
      await writeMemory(addresses.instant_atb_set, hex("c7 45 fc ff ff 00 00 90 90 90"), DataType.Buffer); // mov [ebp-04],0000FFFF and 3 nops
      const charObjLength = 68;
      for (let i = 0; i < 3; i++) {
        await writeMemory(addresses.battle_atb_base + i * charObjLength, 0xffff, DataType.Short);
      }
    },
    disableInstantATB: async () => {
      await writeMemory(addresses.instant_atb_set, hex("66 8b 0d 00 ad 9a 00 99 f7 f9"), DataType.Buffer);
    },
    enableManualSlots: async () => {
      await writeMemory(addresses.cait_manual_slots, 0, DataType.Byte);
      await writeMemory(addresses.tifa_manual_slots, 0x9090, DataType.Short);
      await writeMemory(addresses.tifa_manual_slots + 0xBE, 0xEB, DataType.Byte);
      await writeMemory(addresses.arena_manual_slots, 0xEB, DataType.Byte);
    },
    disableManualSlots: async () => {
      await writeMemory(addresses.cait_manual_slots, 3, DataType.Byte);
      await writeMemory(addresses.tifa_manual_slots, 0x4774, DataType.Short);
      await writeMemory(addresses.tifa_manual_slots + 0xBE, 0x7D, DataType.Byte);
      await writeMemory(addresses.arena_manual_slots, 0x7D, DataType.Byte);
    },
    enableWalkAnywhere: async () => {
      await writeMemory(0x74ced3, hex("e9 20 03 00 00"), DataType.Buffer);
      await writeMemory(0x766705, hex("b8 00 00 00 00"), DataType.Buffer);
    },
    disableWalkAnywhere: async () => {
      await writeMemory(0x74ced3, hex("25 e0 00 00 00"), DataType.Buffer);
      await writeMemory(0x766705, hex("e8 2c ba ff ff"), DataType.Buffer);
    },
    enableSkipIntro: async () => {
      setHacks({ ...hacks, skipIntro: true });
    },
    disableSkipIntro: async () => {
      setHacks({ ...hacks, skipIntro: false });
    },
    introDisabled: hacks.skipIntro,
    togglePartyMemberLocking: async (index: number) => {
      let bitmask = gameState.partyLockingBitmask;
      bitmask = toggleBitmaskValue(bitmask, index);
      await writeMemory(addresses.party_locking_mask, bitmask, DataType.Short);
    },
    partyMemberLocked: (index: number) => {
      let bitmask = gameState.partyLockingBitmask;
      return Boolean(bitmask & (1 << index));
    },
    togglePartyMemberVisibility: async (index: number) => {
      let bitmask = gameState.partyVisibilityBitmask;
      bitmask = toggleBitmaskValue(bitmask, index);
      await writeMemory(addresses.party_visibility_mask, bitmask, DataType.Short);
    },
    partyMemberVisible: (index: number) => {
      let bitmask = gameState.partyVisibilityBitmask;
      return Boolean(bitmask & (1 << index));
    },
    toggleMenuVisibility: async (index: number) => {
      let menuVisibility = gameState.menuVisibility;
      menuVisibility = toggleBitmaskValue(menuVisibility, index);
      await writeMemory(addresses.menu_visibility, menuVisibility, DataType.Short);
    },
    menuVisibilityEnabled: (index: number) => {
      let menuVisibility = gameState.menuVisibility;
      return Boolean(menuVisibility & (1 << index));
    },
    toggleMenuLock: async (index: number) => {
      let menuLocks = gameState.menuLocks;
      menuLocks = toggleBitmaskValue(menuLocks, index);
      await writeMemory(addresses.menu_locks, menuLocks, DataType.Short);
    },
    menuLockEnabled: (index: number) => {
      let menuLocks = gameState.menuLocks;
      return Boolean(menuLocks & (1 << index));
    },
    enableMenuAlwaysEnabled: async () => {
      const code = hex("c7 05 30 11 dc 00 00 00 00 00 c7 05 1c 11 dc 00 ff ff 00 00 eb 5f");
      await writeMemory(addresses.menu_always_enabled, code, DataType.Buffer);
    },
    disableMenuAlwaysEnabled: async () => {
      const code = hex("66 0f b6 05 f8 08 dc 00 66 a3 1c 11 dc 00 33 c9 8a 0d f9 08 dc 00");
      await writeMemory(addresses.menu_always_enabled, code, DataType.Buffer);
    },
    setGameMoment: async (gameMoment: number) => {
      await writeMemory(addresses.game_moment, gameMoment, DataType.Short);
    },
    setGP: async (gp: number) => {
      await writeMemory(addresses.gp, gp, DataType.Short);
    },
    setDisc: async (disc: number) => {
      await writeMemory(addresses.disc_id, disc, DataType.Byte);
    },
    setGil: async (gil: number) => {
      await writeMemory(addresses.gil, gil, DataType.Int);
    },
    setBattleCount: async (battleCount: number) => {
      await writeMemory(addresses.battle_count, battleCount, DataType.Short);
    },
    setBattleEscapeCount: async (battleEscapeCount: number) => {
      await writeMemory(addresses.battle_escape_count, battleEscapeCount, DataType.Short);
    },
    setInGameTime: async (inGameTime: number) => {
      await writeMemory(addresses.in_game_time, inGameTime, DataType.Int);
    },
    setLovePoints: async (characterIndex: number, lovePoints: number) => {
      await writeMemory(addresses.love_points + characterIndex, lovePoints, DataType.Byte);
    },
    setBattlePoints: async (battlePoints: number) => {
      await writeMemory(addresses.battle_points, battlePoints, DataType.Short);
    },
    setHP: async (hp: number, index: number) => {
      if (gameState.currentModule !== GameModule.Battle) {
        await writeMemory(addresses.character_records + index * 0x84 + 0x2c, hp, DataType.Short);
      } else {
        await writeMemory(addresses.battle_char_base + index * 104 + 0x2c, hp, DataType.Int);
      }
    },
    setMP: async (mp: number, index: number) => {
      if (gameState.currentModule !== GameModule.Battle) {
        await writeMemory(addresses.character_records + index * 0x84 + 0x28, mp, DataType.Short);
      } else {
        await writeMemory(addresses.battle_char_base + index * 104 + 0x28, mp, DataType.Short);
      }
    },
    setMaxHP: async (hp: number, index: number) => {
      if (gameState.currentModule !== GameModule.Battle) {
        await writeMemory(addresses.character_records + index * 0x84 + 0x30, hp, DataType.Short);
      } else {
        if (index < 3) {
          await writeMemory(addresses.party_objects + index * 0x440 + 0x12, hp, DataType.Int);
        }
        await writeMemory(addresses.battle_char_base + index * 104 + 0x30, hp, DataType.Int);
      }
    },
    setMaxMP: async (mp: number, index: number) => {
      if (gameState.currentModule !== GameModule.Battle) {
        await writeMemory(addresses.character_records + index * 0x84 + 0x2a, mp, DataType.Short);
      } else {
        if (index < 3) {
          await writeMemory(addresses.party_objects + index * 0x440 + 0x16, mp, DataType.Short);
        }
        await writeMemory(addresses.battle_char_base + index * 104 + 0x2a, mp, DataType.Short);
      }
    },
    setStatus: async (status: number, index: number) => {
      if (gameState.currentModule !== GameModule.Battle) {
        await writeMemory(addresses.character_records + index * 0x84, status, DataType.Byte);
      } else {
        await writeMemory(addresses.battle_char_base + index * 104, status, DataType.Int);
      }
    },
    enableInvincibility: async () => {
      // Function to write state flags for all allies
      const code = hex("E8 C4 37 1B 00 53 BB DC B0 9A 00 C6 43 05 07 C6 43 6D 07 C6 83 D5 00 00 00 07 5B C3");
      await writeMemory(codeCaveAddresses.invincibility, code, DataType.Buffer);

      const writer = new OpcodeWriter(addresses.battle_init_chars_call);
      writer.writeCall(codeCaveAddresses.invincibility);
      await writeMemory(addresses.battle_init_chars_call, writer.opcodes, DataType.Buffer);

      // Set state flags for all allies immediately
      let flags = 0;
      for (let i = 0; i < 3; i++) {
        flags = await readMemory(addresses.battle_char_base + i * 104 + 5, DataType.Byte);
        flags |= 0x07;
        await writeMemory(addresses.battle_char_base + i * 104 + 5, flags, DataType.Byte);
      }
    },
    disableInvincibility: async () => {
      await writeMemory(addresses.battle_init_chars_call + 1, 0x19774e, DataType.Int);

      // Set state flags for all allies immediately
      let flags = 0;
      for (let i = 0; i < 3; i++) {
        flags = await readMemory(addresses.battle_char_base + i * 104 + 5, DataType.Byte);
        flags &= 0xf8;
        await writeMemory(addresses.battle_char_base + i * 104 + 5, flags, DataType.Byte);
      }
    },
    toggleStatus: async (status: number, index: number) => {
      // Add Dual Drain because these two should be used together
      if (status === statuses.Dual) {
        status |= 0x8000000;
      }

      let statusFlags = await readMemory(addresses.battle_char_base + index * 104, DataType.Int);
      statusFlags ^= status;
      await writeMemory(addresses.battle_char_base + index * 104, statusFlags, DataType.Int);
    },
    toggleFlags: async (flags: number, index: number) => {
      let statusFlags = await readMemory(addresses.battle_char_base + index * 104 + 5, DataType.Byte);
      statusFlags ^= flags;
      await writeMemory(addresses.battle_char_base + index * 104 + 5, statusFlags, DataType.Byte);
    },
    readEnemyData: async (enemyId: number) => {
      return await invoke("read_enemy_data", { id: enemyId }) as EnemyData;
    },
    setExpMultiplier: async (multiplier: number) => {
      if (multiplier === 0 || multiplier >= 1) {
        const value = multiplier.toString(16);
        await writeMemory(addresses.battle_exp_calc, hex(`8b 88 38 B1 9A 00 6B C9 ${value} 01 0D C0 E2 99 00 90 90 90`), DataType.Buffer);
      } else if (multiplier > 0 && multiplier < 1) {
        const num = multiplier === 0.25 ? 2 : 1;
        const value = num.toString(16);
        await writeMemory(addresses.battle_exp_calc, hex(`8b 88 38 B1 9A 00 C1 E9 ${value} 01 0D C0 E2 99 00 90 90 90`), DataType.Buffer);
      }
    },
    setGilMultiplier: async (multiplier: number) => {
      if (multiplier === 0 || multiplier >= 1) {
        const value = multiplier.toString(16);
        await writeMemory(addresses.battle_exp_calc + 0x1B, hex(`8b 82 34 B1 9A 00 6B C0 ${value} 01 05 C8 E2 99 00 90`), DataType.Buffer);
      } else if (multiplier > 0 && multiplier < 1) {
        const num = multiplier === 0.25 ? 2 : 1;
        const value = num.toString(16);
        await writeMemory(addresses.battle_exp_calc + 0x1B, hex(`8b 82 34 B1 9A 00 C1 E8 ${value} 01 05 C8 E2 99 00 90`), DataType.Buffer);
      }
    },
    setApMultiplier: async (multiplier: number) => {
      if (multiplier === 0 || multiplier >= 1) {
        const value = multiplier.toString(16);
        await writeMemory(addresses.battle_ap_calc, hex(`6B D2 ${value} 01 15 C4 E2 99 00 90 90 90`), DataType.Buffer);
      } else if (multiplier > 0 && multiplier < 1) {
        const num = multiplier === 0.25 ? 2 : 1;
        const value = num.toString(16);
        await writeMemory(addresses.battle_ap_calc, hex(`C1 EA ${value} 01 15 C4 E2 99 00 90 90 90`), DataType.Buffer);
      }
    },
    gameOver: async () => {
      if (gameState.currentModule === GameModule.Battle) {
        for (let i = 0; i < 3; i++) {
          await writeMemory(addresses.battle_char_base + i * 104, statuses.Dead, DataType.Int);
        }
      } else if (gameState.currentModule === GameModule.Field) {
        await writeMemory(0xcc0d89, 26, DataType.Byte);
      } else if (gameState.currentModule === GameModule.World) {
        // Enter field module first and then issue a game over
        await writeMemory(0xCBF9DC, 1, DataType.Byte);
        await writeMemory(0xE045E4, 2, DataType.Byte);
        await writeMemory(0xE3A884, 0, DataType.Byte);
        await writeMemory(0xE3A894, 0x1700, DataType.Short);
        await writeMemory(0xCC0D8A, 0x64, DataType.Short);
        await writeMemory(0xE2A120, 0x10, DataType.Byte);
        await writeMemory(0xE045F0, 1, DataType.Byte);
        await writeMemory(0x969950, 0, DataType.Byte);
        await writeMemory(0xCC0D89, 26, DataType.Byte);
      }
    },
    setCurrentEntityWorldmapCoordinates: async (x: number, z: number) => {
      const currentObjPtr = await readMemory(addresses.world_current_obj_ptr, DataType.Int);
      await writeMemory(currentObjPtr + 0xC, x, DataType.Int);
      await writeMemory(currentObjPtr + 0x14, z, DataType.Int);
    },
    setWorldmapModelCoordinates: async (index: number, x: number, y: number, z: number, direction: number) => {
      const base = addresses.world_models;
      const length = 192;

      await writeMemory(base + index * length + 0xC, x, DataType.Int);
      await writeMemory(base + index * length + 0x10, y, DataType.Int);
      await writeMemory(base + index * length + 0x14, z, DataType.Int);
      await writeMemory(base + index * length + 0x40, direction, DataType.Int);
    },
    setFieldModelCoordinates: async (index: number, x: number, y: number, z: number, direction: number, triangle?: number) => {
      const base = addresses.field_models_coords;
      const length = 0x88;

      await writeMemory(base + index * length, x << 12, DataType.SignedInt);
      await writeMemory(base + index * length + 4, y << 12, DataType.SignedInt);
      await writeMemory(base + index * length + 8, z << 12, DataType.SignedInt);
      await writeMemory(base + index * length + 44, direction, DataType.Byte);
      
      if (triangle !== undefined && triangle >= 0) {
        await writeMemory(addresses.field_models_objs + index * 0x88 + 0x78, triangle, DataType.Short);
      }
    },
    setFieldModelCollision: async (index: number, collision: boolean) => {
      await writeMemory(addresses.field_models_objs + index * 0x88 + 0x5f, collision ? 0 : 1, DataType.Byte);
    },
    setFieldModelInteraction: async (index: number, interaction: boolean) => {
      await writeMemory(addresses.field_models_objs + index * 0x88 + 0x61, interaction ? 0 : 1, DataType.Byte);
    },
    setFieldModelVisible: async (index: number, visible: boolean) => {
      await writeMemory(addresses.field_models_objs + index * 0x88 + 0x62, visible ? 1 : 0, DataType.Byte);
    },
    setFieldModelLights: async (index: number, lights: FieldLights) => {
      await invoke("write_field_lights", { lights, modelIndex: index });
    },
    async saveFieldState(title?: string, category?: string) {
      const memory = await readMemoryBuffer(addresses.savemap, 0x10F4)
      
      const regions = [];
      for (const region of SaveRegions) {
        const start = await readMemoryBuffer(region[0], region[1] - region[0]);
        regions.push(start);
      }

      const fieldModel = gameState.fieldModels[gameState.fieldCurrentModelId];
      const destination = {
        x: fieldModel.x,
        y: fieldModel.y,
        z: fieldModel.z,
        direction: fieldModel.direction,
        triangle: fieldModel.triangle
      }

      saveStates.pushFieldState({
        savemap: memory,
        regions,
        fieldId: gameState.fieldId,
        fieldName: gameState.fieldName,
        destination,
        title,
        category
      });
    },
    async overwriteFieldState(stateId: string) {
      const memory = await readMemoryBuffer(addresses.savemap, 0x10F4)

      const regions = [];
      for (const region of SaveRegions) {
        const start = await readMemoryBuffer(region[0], region[1] - region[0]);
        regions.push(start);
      }

      const fieldModel = gameState.fieldModels[gameState.fieldCurrentModelId];
      const destination = {
        x: fieldModel.x,
        y: fieldModel.y,
        z: fieldModel.z,
        direction: fieldModel.direction,
        triangle: fieldModel.triangle
      }

      saveStates.overwriteFieldState(stateId, {
        savemap: memory,
        regions,
        fieldId: gameState.fieldId,
        fieldName: gameState.fieldName,
        destination,
      });
    },
    async loadFieldState(stateId?: string) {
      const state = stateId !== undefined ? saveStates.getFieldStateById(stateId) : saveStates.getLatestFieldState();
      if (!state) return;

      // Field states can only be loaded from the field or the world map. In any
      // other module (menu, battle, ...) the warp cannot happen and writing the
      // savemap and field memory would corrupt the running game. Use a fresh
      // read, not the React snapshot.
      const liveModule = await readMemory(addresses.current_module, DataType.Byte);
      if (liveModule !== GameModule.Field && liveModule !== GameModule.World) {
        console.warn("loadFieldState: not in the field or on the world map, load skipped", liveModule);
        return;
      }

      // Restore the savemap
      await writeMemory(addresses.savemap, state.savemap, DataType.Buffer);

      if (state.fieldId !== gameState.fieldId || liveModule === GameModule.World) {
        console.debug("Field ID mismatch - warping to new field", state.fieldId, state.destination);
        await this.warpToFieldId(state.fieldId, state.destination);

        console.debug("Waiting for field id to match");
        const maxWait = 10000; // e.g., 10 seconds
        const startTime = Date.now();
        await waitFor(async () => {
          const fieldId = await readMemory(addresses.field_id, DataType.Short);
          if (Date.now() - startTime > maxWait) {
            console.error("Timeout waiting for field ID match");
            return true;
          }
          return fieldId === state.fieldId;
        });
        // Only carry on if the warp really completed. Otherwise the field memory
        // below would be written into a game that is still on the world map
        // (or in a menu).
        const arrived =
          (await readMemory(addresses.current_module, DataType.Byte)) === GameModule.Field &&
          (await readMemory(addresses.field_id, DataType.Short)) === state.fieldId;
        if (!arrived) {
          console.warn("loadFieldState: the warp did not complete, load cancelled");
          if (liveModule === GameModule.World) await cancelWorldLeave();
          return;
        }
        console.debug("Field id matched");
      }

      // NOP the tick function
      // const tickFunctionAddr = gameState.gameObjPtr + 0xa00;
      // const tickFunctionPtr = await readMemory(tickFunctionAddr, DataType.Int);
      // await writeMemory(tickFunctionAddr, 0x72237a, DataType.Int);

      // Use regionOffsets from the save state if available, otherwise fall back to SaveRegions
      const regionOffsets = state.regionOffsets || SaveRegions;

      // Delay is intentional — wait for the field to finish initialising before writing regions.
      // Must be awaited so the isLoadingStateRef lock in loadState covers these writes.
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        for (let i = 0; i < state.regions.length; i++) {
          const length = regionOffsets[i][1] - regionOffsets[i][0];
          const start = regionOffsets[i][0];
          await writeMemory(start, state.regions[i].slice(0, length), DataType.Buffer);
        }

        // Reset the field model pointers
        for (let i = 0; i < 16; i++) {
          const addr = 0xcc1670 + i * 0x88;
          await writeMemory(addr, 0, DataType.Int);
          await writeMemory(addr + 4, 0, DataType.Int);
        }
      } catch (e) {
        console.warn("loadFieldState: error writing regions", e);
      }

      // Restore the tick function
      // await writeMemory(tickFunctionAddr, tickFunctionPtr, DataType.Int);
    },

    async saveSnowBoardState(title?: string) {
      const globalObjData = await readMemoryBuffer(0xdd83b8, 0x2be0);
      const entitiesData = await readMemoryBuffer(0xddaf98, 0x90 * 0x20);
      saveStates.pushSnowboardState({
        globalObjData,
        entitiesData,
        title
      });
    },
    async overwriteSnowBoardState(stateId: string) {
      const globalObjData = await readMemoryBuffer(0xdd83b8, 0x2be0);
      const entitiesData = await readMemoryBuffer(0xddaf98, 0x90 * 0x20);
      saveStates.overwriteSnowboardState(stateId, {
        globalObjData,
        entitiesData,
      });
    },
    async loadSnowBoardState(stateId?: string) {
      const state = stateId !== undefined ? saveStates.getSnowboardStateById(stateId) : saveStates.getLatestSnowboardState();
      if (!state) return;
      
      await writeMemory(0xdd83b8, state.globalObjData, DataType.Buffer);
      await writeMemory(0xdd83b8 + 0x64, 0, DataType.Int);
      await writeMemory(0xddaf98, state.entitiesData, DataType.Buffer);
    },
    async saveWorldState(title?: string, category?: string) {
      const captured = await captureWorldState();
      saveStates.pushWorldState({ ...captured, title, category });
    },
    async overwriteWorldState(stateId: string) {
      const captured = await captureWorldState();
      saveStates.overwriteWorldState(stateId, captured);
    },
    async loadWorldState(stateId?: string) {
      const state = stateId !== undefined
        ? saveStates.getWorldStateById(stateId)
        : saveStates.getLatestWorldState();
      if (!state) return;

      // The savemap in the state was refreshed by the game itself when it was
      // captured (see captureWorldState), including the six packed vehicle
      // slots at +0xF5C. Write it back unmodified.
      const writeNewSavemap = async () => {
        await writeMemory(addresses.savemap, state.savemap, DataType.Buffer);
      };

      // Put every model back at its exact saved position. Always matches against
      // a fresh read of the live actor records, never the React snapshot.
      const restoreModels = async () => {
        if (!state.modelCoords || state.modelCoords.length === 0) return;
        const live = await readLiveWorldModels();
        const hasModelIds = state.modelCoords[0].model_id !== undefined;
        if (hasModelIds) {
          // Different world scripts put different models in different slots, so
          // match by model id, not by index.
          const slotByModelId = new Map<number, number>();
          for (const liveModel of live) slotByModelId.set(liveModel.model_id, liveModel.index);
          for (const m of state.modelCoords) {
            if (m.model_id === undefined) continue;
            const slotIndex = slotByModelId.get(m.model_id);
            if (slotIndex === undefined) continue;
            await placeWorldActor(addresses.world_models + slotIndex * WORLD_ACTOR_SIZE, m);
          }
        } else {
          // Legacy states saved without model ids: raw index restore.
          for (let i = 0; i < state.modelCoords.length && i < WORLD_ACTOR_COUNT; i++) {
            await placeWorldActor(addresses.world_models + i * WORLD_ACTOR_SIZE, state.modelCoords[i]);
          }
        }
      };

      const restorePlayer = async () => {
        const playerPtr = await readMemory(addresses.world_current_obj_ptr, DataType.Int);
        if (!playerPtr) {
          console.warn("loadWorldState: no player actor, skipping position restore");
          return;
        }
        await placeWorldActor(playerPtr, {
          x: state.worldX,
          y: state.worldY,
          z: state.worldZ,
          // Older states stored a 32-bit read here (direction in the low half,
          // groundY in the high half): keep only the signed 16-bit direction.
          direction: (state.worldDirection << 16) >> 16,
        });
      };

      // The step values are restored last: the field the bounce goes through and
      // the world map load can both reset them. States saved before step values
      // were captured simply skip this.
      const restoreStepValues = async () => {
        if (state.stepValues) await writeStepValues(state.stepValues);
      };
      const finishRestore = async () => {
        await restorePlayer();
        await restoreStepValues();
      };

      if (gameState.currentModule === GameModule.World) {
        try {
          // The world map can only rebuild its actors (which vehicles exist,
          // who is the player and what they ride, the map variant) during its
          // own load, so always force a full reload by bouncing through a real
          // field. An in-place restore can only move actors that already exist.
          //
          // Field to bounce through. addresses.field_id cannot be used: while the
          // world map runs it holds the wm* entry id (1-64), not a loadable field.
          // Only the id matters, we warp straight out again.
          const bounceFieldId = WORLD_BOUNCE_FIELD_ID;

          {
            // ── world → real field → world ────────────────────────────────
            // The savemap must NOT be written before the world is left: on
            // exit the game packs the live actors into savemap+0xF5C
            // (World_SaveStateToSavemap) and would overwrite our slots.
            //
            // Step 1: leave the world with the OLD savemap. Fade=33 first so no
            // world frame shows after the load.
            await writeMemory(addresses.field_global_obj + 0x4e, 33, DataType.Byte);
            await writeMemory(addresses.field_global_obj + 2, bounceFieldId, DataType.Short);
            await writeMemory(addresses.world_battle_flag3, 0, DataType.Byte);
            // World map state 2 means "fade out", and once the fade is idle the
            // game opens the MENU unless the "leave to a field" request
            // (world_mode + 0xC) is already set. So set the request BEFORE
            // switching to state 2; the other order opens the menu whenever a
            // frame runs between the two writes.
            await writeMemory(addresses.world_mode + 0xC, 1, DataType.Byte);
            await writeMemory(addresses.world_mode, 2, DataType.Byte);

            const t1 = Date.now();
            await waitFor(async () => {
              if (Date.now() - t1 > 10000) return true;
              const mod = await readMemory(addresses.current_module, DataType.Byte);
              const fid = await readMemory(addresses.field_id, DataType.Short);
              return mod === GameModule.Field && fid === bounceFieldId;
            });

            // Only continue if we really are in the bounce field. Writing the new
            // savemap into a world map (or menu) that is still running would
            // corrupt it, so back out and leave the game as it was.
            const inBounceField =
              (await readMemory(addresses.current_module, DataType.Byte)) === GameModule.Field &&
              (await readMemory(addresses.field_id, DataType.Short)) === bounceFieldId;
            if (!inBounceField) {
              console.warn("loadWorldState: the world map did not leave to the bounce field, load cancelled");
              await cancelWorldLeave();
              return;
            }

            // Step 2: safely in the field, write the NEW savemap.
            await writeNewSavemap();

            // Step 3: field → world, same pattern as warpToFieldId. Do NOT
            // write fade_type here, it persists across modules and blocks the
            // world entry script.
            const worldEntryId = state.worldMapType + 1;
            await writeMemory(addresses.field_global_obj + 2, worldEntryId, DataType.Short);
            await writeMemory(addresses.field_global_obj + 1, 1, DataType.Byte);
            setTimeout(async () => {
              await writeMemory(addresses.field_global_obj + 0x4e, 33, DataType.Byte);
            }, 75);

            // Wait for the world to finish LOADING, not just for the module
            // switch: before the load completes the player pointer is null or
            // stale and the load itself would overwrite our writes.
            await waitForWorldReady();
            await restoreModels();
            await finishRestore();
          }
        } catch (e) {
          console.warn("loadWorldState: error restoring world state", e);
        }
      } else if (gameState.currentModule === GameModule.Field) {
        try {
          await writeNewSavemap();
          await this.warpToFieldId(state.worldMapType + 1);

          const t = Date.now();
          await waitFor(async () => {
            if (Date.now() - t > 10000) return true;
            return (await readMemory(addresses.current_module, DataType.Byte)) === GameModule.World;
          });

          if (!(await waitForWorldReady())) {
            console.warn("loadWorldState: world map did not finish loading, skipping position restore");
            return;
          }
          await restoreModels();
          await finishRestore();
        } catch (e) {
          console.warn("loadWorldState: error during field-to-world transition", e);
        }
      }
    },
    async saveState(title?: string, category?: string) {
      if (isLoadingStateRef.current) return;
      if (gameState.currentModule === GameModule.Field) {
        await this.saveFieldState(title, category);
      } else if (gameState.currentModule === GameModule.World) {
        await this.saveWorldState(title, category);
      } else if (gameState.currentModule === GameModule.Snowboard2) {
        await this.saveSnowBoardState(title);
      }
    },
    async loadState(stateId?: string) {
      if (isLoadingStateRef.current) return;
      isLoadingStateRef.current = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const load = async () => {
          if (stateId !== undefined) {
            if (saveStates.getFieldStateById(stateId)) {
              await this.loadFieldState(stateId);
            } else if (saveStates.getWorldStateById(stateId)) {
              await this.loadWorldState(stateId);
            } else if (saveStates.getSnowboardStateById(stateId)) {
              await this.loadSnowBoardState(stateId);
            }
          } else {
            if (gameState.currentModule === GameModule.World) {
              await this.loadWorldState();
            } else if (gameState.currentModule === GameModule.Field) {
              await this.loadFieldState();
            } else if (gameState.currentModule === GameModule.Snowboard2) {
              await this.loadSnowBoardState();
            }
          }
        };
        // A load that hangs (a wait that never finishes) must not keep the
        // lock held, or saving and loading stay dead until Ultima is restarted.
        await Promise.race([
          load(),
          new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timed out after 60s")), 60000);
          }),
        ]);
      } catch (e) {
        console.error("loadState: unexpected error, state load aborted", e);
      } finally {
        if (timer) clearTimeout(timer);
        isLoadingStateRef.current = false;
      }
    },
    async warpToFieldId(id: number, destination?: Destination) {
      await writeMemory(addresses.field_global_obj + 2, id, DataType.Short);

      if (destination) {
        await writeMemory(addresses.field_global_obj + 4, destination.x, DataType.SignedShort);
        await writeMemory(addresses.field_global_obj + 6, destination.y, DataType.SignedShort);
        await writeMemory(addresses.field_global_obj + 0x22, destination.triangle, DataType.Short);
        if (destination.direction) {
          await writeMemory(addresses.field_global_obj + 0x24, destination.direction, DataType.Short);
        }
      }

      if (gameState.currentModule === GameModule.Field) {
        await writeMemory(addresses.field_global_obj + 1, 1, DataType.Byte);
      } else if (gameState.currentModule === GameModule.World) {
        await writeMemory(addresses.world_battle_flag3, 0, DataType.Byte);
        // Set the "leave to a field" request before entering fade-out state 2,
        // otherwise the game opens the menu when a frame runs in between.
        await writeMemory(addresses.world_mode + 0xC, 1, DataType.Byte);
        await writeMemory(addresses.world_mode, 2, DataType.Byte);
      }

      // Fade out immediately
      setTimeout(async () => {
        await writeMemory(addresses.field_global_obj + 0x4e, 33, DataType.Byte);
      }, 75);

      // Reset all sound channel volumes to cancel looping sounds
      setTimeout(async () => {
        const fns = Array(4).fill(0).map((_, i) => ({
          address: addresses.sound_command_fn, 
          params: [40 + i, 0, 0, 0, 0, 0]
        }));
        await callGameFns(fns);
      }, 100);

    },
    async setWorldZoomTiltEnabled(enabled: boolean) {
      await writeMemory(addresses.world_zoom_tilt_enabled, enabled ? 0x01 : 0x00, DataType.Byte);
    },
    async setWorldZoom(zoom: number) {
      await writeMemory(addresses.world_zoom, zoom, DataType.Short);
    },
    async setWorldTilt(tilt: number) {
      await writeMemory(addresses.world_tilt, tilt, DataType.Short);
    },
    async setWorldSpeedMultiplier(multiplier: number) {
      await writeMemory(addresses.world_speed_multiplier, multiplier, DataType.Byte);
    },
    async setPartyMemberSlot(slot: number, id: number) {
      await writeMemory(addresses.party_member_ids + slot, id, DataType.Byte);
      await callGameFns([
        {address: 0x6cd13a, params: []},
        {address: 0x6c545b, params: [slot]},
        // Menu_RefreshPartyLimitTables: rebuilds g_MenuPartyStats[*].limitAttacks/limitRecords from the current
        // party. The game does this itself whenever the party changes (PHS screen, field script party ops via
        // g_PartyStatsDirty). Without it the slot keeps the PREVIOUS member's limit list, Kernel_MarkUsableLimits
        // finds none of the new member's limits "usable", and choosing Limit in battle soft-locks the menu.
        {address: 0x6cbd1e, params: []},
        {address: 0x5cb2cc, params: [slot]},
        {address: 0x5cb127, params: []},
      ]);

      // Copy the global party list into the field party list to avoid desyncs
      const party = await readMemoryBuffer(addresses.party_member_ids, 3);
      await writeMemory(addresses.party_member_ids + 0x7B5, party, DataType.Buffer);
    },
    async getItemNames() {
      return invoke("read_item_names");
    },
    async getMateriaNames() {
      return invoke("read_materia_names");
    },
    async getKeyItemNames() {
      return invoke("read_key_item_names");
    },
    async getCommandNames() {
      return invoke("read_command_names");
    },
    async getAttackNames() {
      return invoke("read_attack_names");
    },
    async addItem(id: number, quantity: number) {
      if (quantity === 0) return;

      if (quantity < 0) {
        // The game's add-item function can't subtract (a negative quantity just corrupts the
        // 7-bit quantity field), so removal edits the inventory directly.
        const toRemove = -quantity;
        const EMPTY_RECORD = 0xffff;
        const INVENTORY_SLOTS = 0x140;
        const inventoryAddr = addresses.savemap + 0x4fc;

        // Field inventory in the savemap: 16-bit records, item id in the low 9 bits and
        // quantity in the high 7. Remaining records are kept packed, empty ones are 0xFFFF.
        const raw = await readMemoryBuffer(inventoryAddr, INVENTORY_SLOTS * 2);
        const records: number[] = [];
        for (let i = 0; i < INVENTORY_SLOTS; i++) records.push(raw[i * 2] | (raw[i * 2 + 1] << 8));

        const slot = records.findIndex(r => r !== EMPTY_RECORD && (r & 0x1ff) === id);
        if (slot !== -1) {
          const remaining = (records[slot] >> 9) - toRemove;
          if (remaining > 0) {
            records[slot] = id | (remaining << 9);
          } else {
            records.splice(slot, 1); // used up: drop the record and shift the rest up
            records.push(EMPTY_RECORD);
          }
          const out: number[] = [];
          for (const r of records) out.push(r & 0xff, (r >> 8) & 0xff);
          await writeMemory(inventoryAddr, out, DataType.Buffer);
        }

        if (gameState.currentModule === GameModule.Battle) {
          // The battle inventory is a separate copy that overwrites the savemap when the battle
          // ends, so it has to be reduced as well or the removal would be undone.
          const items = await readMemoryBuffer(addresses.battle_party_items, 0x140 * 6);
          for (let i = 0; i < 0x140; i++) {
            const battleItemId = items[i * 6] + items[i * 6 + 1] * 256;
            if (battleItemId !== id) continue;
            const remaining = items[i * 6 + 2] - toRemove;
            if (remaining > 0) {
              await writeMemory(addresses.battle_party_items + i * 6 + 2, remaining, DataType.Byte);
            } else {
              await writeMemory(addresses.battle_party_items + i * 6, 0xffff, DataType.Short);
              await writeMemory(addresses.battle_party_items + i * 6 + 2, 0, DataType.Byte);
            }
            break;
          }
        }
        return;
      }

      const itemId = id | quantity << 9;
      await callGameFn(addresses.party_add_item_fn, [itemId]);
      if (gameState.currentModule === GameModule.Battle) {
        // Add the item to the battle inventory
        const items = await readMemoryBuffer(addresses.battle_party_items, 0x140 * 6);
        let found = false;
        let emptySlot = -1;
        for (let i = 0; i < 0x140; i++) {
          const itemId = items[i * 6] + items[i * 6 + 1] * 256;
          let itemQuantity = items[i * 6 + 2];
          if (itemId === id) {
            itemQuantity = Math.min(itemQuantity + quantity, 99);
            await writeMemory(addresses.battle_party_items + i * 6 + 2, itemQuantity, DataType.Byte);
            found = true;
            break;
          }
          else if (itemId === 0xffff && emptySlot === -1) {
            emptySlot = i;
          }
        }
        if (!found) {
          // Add the item to the end of the inventory
          if (emptySlot !== -1) {
            await writeMemory(addresses.battle_party_items + emptySlot * 6, id, DataType.Short);
            await writeMemory(addresses.battle_party_items + emptySlot * 6 + 2, quantity, DataType.Byte);
            const targetMask = gameData.itemData[id].target_flags;
            const restrictionMask = gameData.itemData[id].restriction_mask & 0xb;
            await writeMemory(addresses.battle_party_items + emptySlot * 6 + 3, targetMask, DataType.Byte);
            await writeMemory(addresses.battle_party_items + emptySlot * 6 + 4, restrictionMask, DataType.Byte);
            await writeMemory(addresses.battle_party_items + emptySlot * 6 + 5, 0, DataType.Byte);

            const itemsCountAddr = addresses.battle_party_items - 0x244;
            const itemsCount = await readMemory(itemsCountAddr, DataType.Byte);
            if ((emptySlot + 1) / 2 > itemsCount) {
              console.log("Increasing items count", itemsCount, emptySlot, itemsCountAddr);
              await writeMemory(itemsCountAddr, itemsCount + 1, DataType.Byte);
            }
          }
        }
      }
    },
    async addMateria(id: number, ap: number) {
      const materiaId = (id | ap << 8) >>> 0; // Convert to unsigned
      await callGameFn(addresses.party_add_materia_fn, [materiaId]);
    },
    async addMaxItems() {
      const itemCount = 0x140; // Total number of items (0x13F + 1)
      const bytesPerItem = 2;
      const buffer = new ArrayBuffer(itemCount * bytesPerItem);
      const view = new DataView(buffer);

      // Fill buffer with item records
      let itemIndex = 0;
      let skipped = 0;
      for (let i = 0; i < itemCount; i++) {
        if (gameData.itemNames[i] === "") {
          skipped++;
          continue;
        }

        // Item ID in first 9 bits, quantity (99) in remaining 7 bits
        const itemRecord = i | (99 << 9);
        view.setUint16(itemIndex * bytesPerItem, itemRecord, true); // true for little-endian
        itemIndex++;
      }

      let trimmedBuffer = buffer;
      // Trim buffer to exclude skipped items
      if (skipped > 0) {
        trimmedBuffer = buffer.slice(0, (itemCount - skipped) * bytesPerItem);
      }

      await writeMemory(addresses.savemap + 0x4fc, Array.from(new Uint8Array(trimmedBuffer)), DataType.Buffer);
    },
    async addMaxMateria() {
      const materiaCount = 0x5F;
      const bytesPerMateria = 4;
      const buffer = new ArrayBuffer(materiaCount * bytesPerMateria);
      const view = new DataView(buffer);

      // Fill buffer with materia records
      let materiaIndex = 0;
      let skipped = 0;
      for (let i = 0; i < materiaCount; i++) {
        if (gameData.materiaNames[i] === "") {
          skipped++;
          continue;
        }

        // Materia ID in first 8 bits, AP is in the last 24 bits
        const materiaRecord = i | (0xFFFFFF << 8);  
        view.setUint32(materiaIndex * bytesPerMateria, materiaRecord, true);
        materiaIndex++;
      }

      let trimmedBuffer = buffer;
      // Trim buffer to exclude skipped materia
      if (skipped > 0) {
        trimmedBuffer = buffer.slice(0, (materiaCount - skipped) * bytesPerMateria);
      }

      const address = addresses.savemap + 0x77c + 0x320 - ((materiaCount - skipped) * bytesPerMateria);
      await writeMemory(address, Array.from(new Uint8Array(trimmedBuffer)), DataType.Buffer);
    },
    async setKeyItems(keyItemIds: number[]) {
      const bytes = new Array(8).fill(0);
      
      // Set bits for each key item
      for (const id of keyItemIds) {
        const byteIndex = Math.floor(id / 8);
        const bitIndex = id % 8;
        bytes[byteIndex] |= (1 << bitIndex);
      }
      
      await writeMemory(addresses.key_items, bytes, DataType.Buffer);

      // Reload the key items in memory if the menu is currently open
      await callGameFn(addresses.menu_load_key_items_fn, []);
    },
    async fullHeal() {
      if (gameState.currentModule === GameModule.Battle) {
        for (let charIdx = 0; charIdx < 3; charIdx++) {
          const maxHp = ff7.gameState.battleAllies[charIdx].max_hp;
          const maxMp = ff7.gameState.battleAllies[charIdx].max_mp;
          const status = ff7.gameState.battleAllies[charIdx].status;
          await ff7.setHP(maxHp, charIdx);
          await ff7.setMP(maxMp, charIdx);
          await ff7.setStatus(status & PositiveStatuses, charIdx);
        }
        await ff7.callGameFn(0x745606, [64, 263, 0, 0, 0]);
      } else {
        // Call PartyFullHealClearStatus() and then play the cure sound
        await ff7.callGameFns([{
          address: 0x61f6b0,
          params: [],
        }, {
          address: 0x745606,
          params: [64, 263, 0, 0, 0],
        }]);
      }
    },
    async toggleLimitBar() {
      if (ff7.gameState.currentModule !== GameModule.Battle) {
        const slot1Id = ff7.gameState.partyMemberIds[0];
        let limit = ff7.gameState.partyMembers[slot1Id].limit;
        if (limit !== 0xFF) limit = 0xFF; else limit = 0;
        for (let i = 0; i < 3; i++) {
          const idx = gameState.partyMemberIds[i];
          if (idx === 0xFF) continue;
          await writeMemory(addresses.character_records + idx * 0x84 + 0xf, limit, DataType.Byte);
        }
      } else {
        // The game keeps the limit gauge in several places (see decomp: Battle_TickAtbAndGauges,
        // Battle_SetLimitReady, Battle_LoadPartyActorsFromEquipment):
        //   partyStats[i].limitGauge     (0x9a8db8 + i*0x34 + 0x8)  0xFF = full
        //   partyStats[i].loadLimitGauge (+0xA)                     the goal the HUD gauge climbs towards
        //   g_MenuPartyStats[i].limitGauge (0xdba498 + i*0x440 + 0x1a)  HUD gauge, value << 8
        //   readyActorMask / actors[i].limitFlags                  set by Battle_SetLimitReady (0x4375ce)
        // Only the Limit command shown in the menu depends on the last one, so writing just the first
        // leaves the gauge "full" in memory while the game still thinks the limit is not ready.
        const MENU_PARTY_STATS = 0xdba498;
        const MENU_PARTY_STATS_SIZE = 0x440;
        const BATTLE_SET_LIMIT_READY = 0x4375ce;
        const slots: number[] = [];
        for (let i = 0; i < 3; i++) {
          if (gameState.partyMemberIds[i] === 0xFF) continue;
          // limitLevelIndex (+0x5) is 0xFF for a member with no limit break; Battle_SetLimitReady ignores them too
          const levelIndex = await readMemory(addresses.battle_char_array + i * 0x34 + 0x5, DataType.Byte);
          if (levelIndex === 0xFF) continue;
          slots.push(i);
        }
        const allFull = slots.length > 0 && slots.every((i) => gameState.battleAllies[i].limit === 0xFF);
        if (!allFull) {
          for (const i of slots) {
            await writeMemory(addresses.battle_char_array + i * 0x34 + 0x8, 0xFF, DataType.Short);
            await writeMemory(addresses.battle_char_array + i * 0x34 + 0xA, 0xFF, DataType.Short);
            await writeMemory(MENU_PARTY_STATS + i * MENU_PARTY_STATS_SIZE + 0x1a, 0xFF00, DataType.Short);
          }
          await ff7.callGameFns(slots.map(i => ({ address: BATTLE_SET_LIMIT_READY, params: [i] })));
        } else {
          await ff7.callGameFns([0, 1, 2].map(i => ({
            address: 0x434df3,
            params: [i]
          })));
        }
      }
    },
    async getWorldFieldTblData() {
      await callGameFn(addresses.world_load_data_fn, [addresses.str_field_tbl, 0x600, addresses.world_field_tbl_data, 0])
      await waitFor(async () => {
        const data = await readMemory(addresses.world_field_tbl_data, DataType.Int);
        return data !== 0;
      });
      return await invoke("read_world_field_tbl_data") as WorldFieldTblItem[];
    },
    async getVariables(bank: number) {
      return await invoke("read_variables_bank", { bank }) as number[];
    },
    async setVariable(bank: number, address: number, value: number) {
      return await invoke("write_variable_8bit", { bank, address, value });
    },
    async setVariable16(bank: number, address: number, value: number) {
      return await invoke("write_variable_16bit", { bank, address, value });
    },
    async setFieldStepId(value: number) {
      await writeMemory(addresses.step_id, value, DataType.Int);
    },
    async setFieldStepFraction(value: number) {
      await writeMemory(addresses.step_fraction, value, DataType.Int);
    },
    async setFieldDangerValue(value: number) {
      await writeMemory(addresses.danger_value, value, DataType.Short);
    },
    async setFieldStepOffset(value: number) {
      await writeMemory(addresses.step_offset, value, DataType.Byte);
    },
    async setFieldFormationIndex(value: number) {
      await writeMemory(addresses.formation_idx, value, DataType.Byte);
    },
    async setFieldAltEncountersEnabled(enabled: boolean) {
      await writeMemory(addresses.field_alt_encounters_enabled, enabled ? 1 : 0, DataType.Byte);
    },
    async updatePartyMember(id: number, field: keyof PartyMember, value: number | string) {
      if (field === "name") {
        const name = Array.from(encodeText(value as string));
        await writeMemory(addresses.character_records + id * 0x84 + 0x10, name, DataType.Buffer);
      } else {
        const fieldMetadata: Record<keyof PartyMember, { offset: number; dataType: DataType }> = {
          id: { offset: 0x00, dataType: DataType.Byte },
          level: { offset: 0x01, dataType: DataType.Byte },
          strength: { offset: 0x02, dataType: DataType.Byte },
          vitality: { offset: 0x03, dataType: DataType.Byte },
          magic: { offset: 0x04, dataType: DataType.Byte },
          spirit: { offset: 0x05, dataType: DataType.Byte },
          dexterity: { offset: 0x06, dataType: DataType.Byte },
          luck: { offset: 0x07, dataType: DataType.Byte },
          strength_bonus: { offset: 0x08, dataType: DataType.Byte },
          vitality_bonus: { offset: 0x09, dataType: DataType.Byte },
          magic_bonus: { offset: 0x0A, dataType: DataType.Byte },
          spirit_bonus: { offset: 0x0B, dataType: DataType.Byte },
          dexterity_bonus: { offset: 0x0C, dataType: DataType.Byte },
          luck_bonus: { offset: 0x0D, dataType: DataType.Byte },
          limit_level: { offset: 0x0E, dataType: DataType.Byte },
          limit: { offset: 0x0F, dataType: DataType.Byte },
          name: { offset: 0x10, dataType: DataType.Buffer },
          weapon: { offset: 0x1C, dataType: DataType.Byte },
          armor: { offset: 0x1D, dataType: DataType.Byte },
          accessory: { offset: 0x1E, dataType: DataType.Byte },
          status: { offset: 0x1F, dataType: DataType.Byte },
          order: { offset: 0x20, dataType: DataType.Byte },
          limit_skills: { offset: 0x22, dataType: DataType.Short },
          kills: { offset: 0x24, dataType: DataType.Short },
          limit_1_1_uses: { offset: 0x26, dataType: DataType.Short },
          limit_2_1_uses: { offset: 0x28, dataType: DataType.Short },
          limit_3_1_uses: { offset: 0x2A, dataType: DataType.Short },
          hp: { offset: 0x2C, dataType: DataType.Short },
          base_hp: { offset: 0x2E, dataType: DataType.Short },
          mp: { offset: 0x30, dataType: DataType.Short },
          base_mp: { offset: 0x32, dataType: DataType.Short },
          max_hp: { offset: 0x38, dataType: DataType.Short },
          max_mp: { offset: 0x3A, dataType: DataType.Short },
          exp: { offset: 0x3C, dataType: DataType.Int },
          weapon_materia: { offset: 0x40, dataType: DataType.Buffer },
          armor_materia: { offset: 0x60, dataType: DataType.Buffer },
          exp_to_next_level: { offset: 0x80, dataType: DataType.Int }
        };

        const { offset, dataType } = fieldMetadata[field];
        await writeMemory(addresses.character_records + id * 0x84 + offset, value as number, dataType);
      }

      // Recalc the stats
      await callGameFn(0x61f739, []);
    },
    toggleAutoSense: async () => {
      const newValue = gameState.autoSenseEnabled ? 0xBD : 0x00;
      await writeMemory(addresses.auto_sense_check, newValue, DataType.Byte);
    },
    toggleRunByDefault: async () => {
      const newValue = gameState.fieldRunByDefaultEnabled ? 0x74 : 0x75;
      await writeMemory(addresses.field_run_by_default_1, newValue, DataType.Byte);
      await writeMemory(addresses.field_run_by_default_2, newValue, DataType.Byte);
    },
  };

  return ff7;
}

export type FF7 = ReturnType<typeof useFF7>;