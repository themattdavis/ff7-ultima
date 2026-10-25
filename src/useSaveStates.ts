import { useAtom } from "jotai";
import { Destination } from "./types";
import { useSettings, SaveStateBase, WorldSaveState, saveStateDisplayOrderAtom } from "./useSettings";
import { logger } from "./lib/logging";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

type RegionOffset = [number, number];

export const SaveRegions: RegionOffset[] = [
  [0xCBF5EC, 0xCC08E8],
  [0xCC08EC, 0xCC1670],
  [0xCFF180, 0xCFF3B0],
  [0xCFF464, 0xCFF48C],
  [0xCFF494, 0xCFF500],
  [0xCFF504, 0xCFF594],
  [0xCFF59C, 0xCFF738],
  [0xD000C4, 0xD011F4],
  [0xD8F4D8, 0xD8F678],
  [0xDB9580, 0xDBCAE0],
  [0x905E50, 0x905E54],
  [0xCBF588, 0xCBF589],
  [0xCC1F70, 0xCC2270],
];

for (let i = 0; i < 16; i++) {
  const start = 0xcc1678 + i * 0x88;
  const end = start + 0x80;
  SaveRegions.push([start, end]);
}

export type SaveState = SaveStateBase & {
  regions: number[][];
  regionOffsets?: RegionOffset[];
  savemap: number[];
  fieldId: number;
  fieldName: string;
  destination?: Destination;
};

export type SnowBoardSaveState = SaveStateBase & {
  globalObjData: number[];
  entitiesData: number[];
};

function generateId(): string {
  return crypto.randomUUID();
}

export function useSaveStates() {
  const { saveStates, updateSaveStates, generalSettings, updateGeneralSettings } = useSettings();
  const [displayOrder, setDisplayOrderAtom] = useAtom(saveStateDisplayOrderAtom);

  // Restore persisted order from the store the first time it's available
  // (atom starts empty; saveStates.displayOrder is loaded from disk)
  const setDisplayOrder = (updater: string[] | ((prev: string[]) => string[])) => {
    setDisplayOrderAtom(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Persist alongside save states (debounced via updateSaveStates)
      updateSaveStates({ ...saveStates, displayOrder: next });
      return next;
    });
  };

  // On first load, if the atom is empty but the store has a saved order, restore it
  if (displayOrder.length === 0 && saveStates.displayOrder?.length) {
    setDisplayOrderAtom(saveStates.displayOrder);
  }

  const lastLoadedFieldStateId = generalSettings?.lastLoadedStateId ?? null;

  const setLastLoadedStateId = (id: string | null) => {
    if (generalSettings) {
      updateGeneralSettings({ ...generalSettings, lastLoadedStateId: id });
    }
  };

  // ── Field states ────────────────────────────────────────────────────────────

  const pushFieldState = (state: Omit<SaveState, "timestamp" | "regionOffsets" | "id">) => {
    const id = generateId();
    const newState = {
      ...state,
      id,
      timestamp: Date.now(),
      regionOffsets: SaveRegions,
    };
    updateSaveStates({
      ...saveStates,
      fieldStates: [...saveStates.fieldStates, newState],
    });
    setLastLoadedStateId(null);
    logger.info('Created new field state', { id, fieldId: state.fieldId, fieldName: state.fieldName });
  };

  // Replaces an existing field state's captured data in place, keeping its
  // id, timestamp, title, and category untouched.
  const overwriteFieldState = (id: string, state: Omit<SaveState, "timestamp" | "regionOffsets" | "id" | "title" | "category">) => {
    const exists = saveStates.fieldStates.some(s => s.id === id);
    if (!exists) return;
    updateSaveStates({
      ...saveStates,
      fieldStates: saveStates.fieldStates.map(s =>
        s.id === id ? { ...s, ...state, regionOffsets: SaveRegions } : s
      ),
    });
    logger.info('Overwrote field state', { id, fieldId: state.fieldId, fieldName: state.fieldName });
  };

  const getLatestFieldState = () => {
    if (saveStates.fieldStates.length === 0) return null;
    if (lastLoadedFieldStateId) {
      const state = saveStates.fieldStates.find(s => s.id === lastLoadedFieldStateId);
      if (state) return state;
    }
    return saveStates.fieldStates[saveStates.fieldStates.length - 1];
  };

  const getFieldState = (index: number) => {
    if (index < 0 || index >= saveStates.fieldStates.length) return null;
    setLastLoadedStateId(null);
    return saveStates.fieldStates[index];
  };

  const getFieldStateById = (id: string) => {
    const state = saveStates.fieldStates.find(s => s.id === id);
    if (!state) return null;
    setLastLoadedStateId(id);
    return state;
  };

  const removeFieldState = (id: string) => {
    updateSaveStates({ ...saveStates, fieldStates: saveStates.fieldStates.filter(s => s.id !== id) });
    if (lastLoadedFieldStateId === id) setLastLoadedStateId(null);
    logger.info('Removed field state', { id });
  };

  const removeFieldStates = (ids: string[]) => {
    updateSaveStates({ ...saveStates, fieldStates: saveStates.fieldStates.filter(s => !ids.includes(s.id)) });
    if (lastLoadedFieldStateId && ids.includes(lastLoadedFieldStateId)) setLastLoadedStateId(null);
    logger.info('Removed field states', { count: ids.length });
  };

  const clearFieldStates = () => {
    updateSaveStates({ ...saveStates, fieldStates: [] });
    setLastLoadedStateId(null);
  };

  const updateFieldStateTitle = (id: string, title: string) => {
    updateSaveStates({
      ...saveStates,
      fieldStates: saveStates.fieldStates.map(s => s.id === id ? { ...s, title } : s),
    });
  };

  const updateFieldStateCategory = (id: string, category: string) => {
    updateSaveStates({
      ...saveStates,
      fieldStates: saveStates.fieldStates.map(s => s.id === id ? { ...s, category } : s),
    });
  };

  const updateFieldStateCategoriesBulk = (ids: string[], category: string) => {
    const idSet = new Set(ids);
    updateSaveStates({
      ...saveStates,
      fieldStates: saveStates.fieldStates.map(s => idSet.has(s.id) ? { ...s, category } : s),
    });
  };

  const reorderFieldStates = (fromId: string, toId: string) => {
    const fromIndex = saveStates.fieldStates.findIndex(s => s.id === fromId);
    const toIndex = saveStates.fieldStates.findIndex(s => s.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...saveStates.fieldStates];
    const [removed] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, removed);
    updateSaveStates({ ...saveStates, fieldStates: next });
  };

  // ── Snowboard states ────────────────────────────────────────────────────────

  const pushSnowboardState = (state: Omit<SnowBoardSaveState, "timestamp" | "id">) => {
    const id = generateId();
    updateSaveStates({
      ...saveStates,
      snowboardStates: [...saveStates.snowboardStates, { ...state, id, timestamp: Date.now() }],
    });
  };

  // Replaces an existing snowboard state's captured data in place, keeping
  // its id, timestamp, and title untouched.
  const overwriteSnowboardState = (id: string, state: Omit<SnowBoardSaveState, "timestamp" | "id" | "title">) => {
    const exists = saveStates.snowboardStates.some(s => s.id === id);
    if (!exists) return;
    updateSaveStates({
      ...saveStates,
      snowboardStates: saveStates.snowboardStates.map(s =>
        s.id === id ? { ...s, ...state } : s
      ),
    });
    logger.info('Overwrote snowboard state', { id });
  };

  const getLatestSnowboardState = () => {
    if (saveStates.snowboardStates.length === 0) return null;
    return saveStates.snowboardStates[saveStates.snowboardStates.length - 1];
  };

  const getSnowboardState = (index: number) => {
    if (index < 0 || index >= saveStates.snowboardStates.length) return null;
    return saveStates.snowboardStates[index];
  };

  const getSnowboardStateById = (id: string): SnowBoardSaveState | null => {
    return saveStates.snowboardStates.find(s => s.id === id) ?? null;
  };

  const removeSnowboardState = (id: string) => {
    updateSaveStates({ ...saveStates, snowboardStates: saveStates.snowboardStates.filter(s => s.id !== id) });
  };

  const clearSnowboardStates = () => {
    updateSaveStates({ ...saveStates, snowboardStates: [] });
  };

  const updateSnowboardStateTitle = (id: string, title: string) => {
    updateSaveStates({
      ...saveStates,
      snowboardStates: saveStates.snowboardStates.map(s => s.id === id ? { ...s, title } : s),
    });
  };

  // ── World states ────────────────────────────────────────────────────────────

  const worldStates = saveStates.worldStates || [];

  const pushWorldState = (state: Omit<WorldSaveState, "timestamp" | "id">) => {
    const id = generateId();
    updateSaveStates({
      ...saveStates,
      worldStates: [...worldStates, { ...state, id, timestamp: Date.now() }],
    });
    setLastLoadedStateId(null);
    logger.info('Created new world state', { id });
  };

  // Replaces an existing world state's captured data in place, keeping its
  // id, timestamp, title, and category untouched.
  const overwriteWorldState = (id: string, state: Omit<WorldSaveState, "timestamp" | "id" | "title" | "category">) => {
    const exists = worldStates.some(s => s.id === id);
    if (!exists) return;
    updateSaveStates({
      ...saveStates,
      worldStates: worldStates.map(s =>
        s.id === id ? { ...s, ...state } : s
      ),
    });
    logger.info('Overwrote world state', { id });
  };

  const getLatestWorldState = () => {
    if (worldStates.length === 0) return null;
    if (lastLoadedFieldStateId) {
      const state = worldStates.find(s => s.id === lastLoadedFieldStateId);
      if (state) return state;
    }
    return worldStates[worldStates.length - 1];
  };

  const getWorldStateById = (id: string) => {
    const state = worldStates.find(s => s.id === id);
    if (!state) return null;
    setLastLoadedStateId(id);
    return state;
  };

  const removeWorldState = (id: string) => {
    updateSaveStates({ ...saveStates, worldStates: worldStates.filter(s => s.id !== id) });
    if (lastLoadedFieldStateId === id) setLastLoadedStateId(null);
  };

  const removeStates = (fieldIds: string[], worldIds: string[]) => {
    const fieldIdSet = new Set(fieldIds);
    const worldIdSet = new Set(worldIds);
    updateSaveStates({
      ...saveStates,
      fieldStates: saveStates.fieldStates.filter(s => !fieldIdSet.has(s.id)),
      worldStates: worldStates.filter(s => !worldIdSet.has(s.id)),
    });
    if (lastLoadedFieldStateId && (fieldIdSet.has(lastLoadedFieldStateId) || worldIdSet.has(lastLoadedFieldStateId))) {
      setLastLoadedStateId(null);
    }
  };

  const clearWorldStates = () => {
    updateSaveStates({ ...saveStates, worldStates: [] });
  };

  const updateWorldStateTitle = (id: string, title: string) => {
    updateSaveStates({
      ...saveStates,
      worldStates: worldStates.map(s => s.id === id ? { ...s, title } : s),
    });
  };

  const updateWorldStateCategory = (id: string, category: string) => {
    updateSaveStates({
      ...saveStates,
      worldStates: worldStates.map(s => s.id === id ? { ...s, category } : s),
    });
  };

  const updateWorldStateCategoriesBulk = (ids: string[], category: string) => {
    const idSet = new Set(ids);
    updateSaveStates({
      ...saveStates,
      worldStates: worldStates.map(s => idSet.has(s.id) ? { ...s, category } : s),
    });
  };

  // ── General ─────────────────────────────────────────────────────────────────

  const clearAllStates = () => {
    updateSaveStates({ fieldStates: [], snowboardStates: [], worldStates: [] });
    setLastLoadedStateId(null);
  };

  const exportStates = () => {
    const encodedFieldStates = saveStates.fieldStates.map(state => ({
      ...state,
      regionOffsets: state.regionOffsets || SaveRegions,
      regions: state.regions.map(region => btoa(String.fromCharCode.apply(null, region))),
      savemap: btoa(String.fromCharCode.apply(null, state.savemap)),
    }));

    const encodedSnowboardStates = saveStates.snowboardStates.map(state => ({
      ...state,
      globalObjData: btoa(String.fromCharCode.apply(null, state.globalObjData)),
      entitiesData: btoa(String.fromCharCode.apply(null, state.entitiesData)),
    }));

    const encodedWorldStates = worldStates.map(state => ({
      ...state,
      savemap: btoa(String.fromCharCode.apply(null, state.savemap)),
    }));

    return { fieldStates: encodedFieldStates, snowboardStates: encodedSnowboardStates, worldStates: encodedWorldStates, displayOrder };
  };

  const importStates = (data: { fieldStates: any[]; snowboardStates: any[]; worldStates?: any[]; displayOrder?: string[] }, replace = false) => {
    const baseFieldStates    = replace ? [] : saveStates.fieldStates;
    const baseSnowboardStates = replace ? [] : saveStates.snowboardStates;
    const baseWorldStates    = replace ? [] : worldStates;

    const existingFieldIds = new Set(baseFieldStates.map((s: SaveState) => s.id));
    const newFieldStates = data.fieldStates
      .filter(s => !s.id || !existingFieldIds.has(s.id))
      .map(s => ({
        ...s,
        id: s.id || generateId(),
        regionOffsets: s.regionOffsets || SaveRegions,
        regions: s.regions.map((b64: string) => Array.from(atob(b64), c => c.charCodeAt(0))),
        savemap: Array.from(atob(s.savemap), c => c.charCodeAt(0)),
      }));

    const existingSnowboardIds = new Set(baseSnowboardStates.map((s: SnowBoardSaveState) => s.id));
    const newSnowboardStates = (data.snowboardStates || [])
      .filter(s => !s.id || !existingSnowboardIds.has(s.id))
      .map(s => ({
        ...s,
        id: s.id || generateId(),
        globalObjData: Array.from(atob(s.globalObjData), c => c.charCodeAt(0)),
        entitiesData: Array.from(atob(s.entitiesData), c => c.charCodeAt(0)),
      }));

    const existingWorldIds = new Set(baseWorldStates.map((s: WorldSaveState) => s.id));
    const newWorldStates = (data.worldStates || [])
      .filter(s => !s.id || !existingWorldIds.has(s.id))
      .map(s => ({
        ...s,
        id: s.id || generateId(),
        savemap: Array.from(atob(s.savemap), c => c.charCodeAt(0)),
      }));

    let newDisplayOrder: string[] | undefined;
    if (data.displayOrder?.length) {
      const newIdSet = new Set([
        ...newFieldStates.map(s => s.id),
        ...newWorldStates.map(s => s.id),
      ]);
      const kept = replace ? [] : displayOrder.filter(id => !newIdSet.has(id));
      const importedNewIds = data.displayOrder.filter((id: string) => newIdSet.has(id));
      const importedSet = new Set(importedNewIds);
      const remainder = [...newFieldStates, ...newWorldStates]
        .map(s => s.id)
        .filter(id => !importedSet.has(id));
      newDisplayOrder = [...kept, ...importedNewIds, ...remainder];
      setDisplayOrderAtom(newDisplayOrder);
    } else if (replace) {
      // No display order in the file — build one from the imported states
      newDisplayOrder = [
        ...newFieldStates.map(s => s.id),
        ...newWorldStates.map(s => s.id),
      ];
      setDisplayOrderAtom(newDisplayOrder);
    }

    updateSaveStates({
      fieldStates: [...baseFieldStates, ...newFieldStates],
      snowboardStates: [...baseSnowboardStates, ...newSnowboardStates],
      worldStates: [...baseWorldStates, ...newWorldStates],
      displayOrder: newDisplayOrder,
    });
  };

  return {
    fieldStates: saveStates.fieldStates,
    snowboardStates: saveStates.snowboardStates,
    worldStates,
    displayOrder,
    setDisplayOrder,
    selectedCategoryFilter: generalSettings?.selectedCategoryFilter ?? 'all',
    lastLoadedFieldStateId,
    pushFieldState,
    pushSnowboardState,
    pushWorldState,
    overwriteFieldState,
    overwriteSnowboardState,
    overwriteWorldState,
    getLatestFieldState,
    getLatestSnowboardState,
    getLatestWorldState,
    getFieldState,
    getFieldStateById,
    getSnowboardState,
    getSnowboardStateById,
    getWorldStateById,
    removeFieldState,
    removeFieldStates,
    removeSnowboardState,
    removeWorldState,
    removeStates,
    clearFieldStates,
    clearSnowboardStates,
    clearWorldStates,
    clearAllStates,
    updateFieldStateTitle,
    updateFieldStateCategory,
    updateFieldStateCategoriesBulk,
    updateSnowboardStateTitle,
    updateWorldStateTitle,
    updateWorldStateCategory,
    updateWorldStateCategoriesBulk,
    reorderFieldStates,
    exportStates,
    importStates,
  };
}
