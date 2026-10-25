import { FF7 } from "./useFF7";

export interface Shortcut {
  key: string;
  action: string;
  callback: (ff7: FF7) => Promise<void>;
}

let saveStateIndex = -1;

export function setSaveStateIndex(index: number) {
  saveStateIndex = index;
}

async function navigateSaveState(ff7: FF7, direction: 1 | -1) {
  const order = ff7.saveStates.displayOrder;
  if (order.length === 0) return;

  const fieldStates = ff7.saveStates.fieldStates;
  const worldStates = ff7.saveStates.worldStates || [];

  const stateMap = new Map<string, { id: string; title?: string; category?: string }>();
  fieldStates.forEach(s => stateMap.set(s.id, s));
  worldStates.forEach(s => stateMap.set(s.id, s));

  const filter = ff7.saveStates.selectedCategoryFilter ?? 'all';

  const orderedIds = order.filter((id: string) => {
    const s = stateMap.get(id);
    if (!s) return false;
    if (filter === 'all') return true;
    if (filter === 'uncategorized') return !s.category || s.category.trim() === '';
    return s.category === filter;
  });
  if (orderedIds.length === 0) return;

  if (saveStateIndex === -1) {
    const lastId = ff7.saveStates.lastLoadedFieldStateId;
    const idx = lastId ? orderedIds.indexOf(lastId) : -1;
    saveStateIndex = idx !== -1 ? idx : 0;
  }

  saveStateIndex = Math.max(0, Math.min(orderedIds.length - 1, saveStateIndex + direction));
  const stateId = orderedIds[saveStateIndex];
  const state = stateMap.get(stateId);

  await ff7.loadState(stateId); // no-ops immediately if already loading
}

export const defaultShortcuts: Shortcut[] = [
  {
    key: "F1",
    action: "Skip FMV / Minigame",
    callback: async (ff7) => {
      await ff7.skipFMV(true);
    },
  },
  {
    key: "F2",
    action: "Escape battle immediately",
    callback: async (ff7) => {
      await ff7.endBattle(false);
    },
  },
  {
    key: "",
    action: "Win battle immediately",
    callback: async (ff7) => {
      await ff7.endBattle(true);
    },
  },
  {
    key: "",
    action: "Slow Speed (0.25x)",
    callback: async (ff7) => {
      await ff7.setSpeed(0.25);
    },
  },
  {
    key: "F3",
    action: "Normal Speed (1x)",
    callback: async (ff7) => {
      await ff7.setSpeed(1);
    },
  },
  {
    key: "F4",
    action: "Speed Up (5x)",
    callback: async (ff7) => {
      await ff7.setSpeed(5);
    },
  },
  {
    key: "F5",
    action: "Load State",
    callback: async (ff7) => {
      await ff7.loadState();
    },
  },
  {
    key: "F6",
    action: "Save State",
    callback: async (ff7) => {
      await ff7.saveState();
      // Point navigator to the end so next/prev starts from the new state
      saveStateIndex = ff7.saveStates.displayOrder.length - 1;
    },
  },
  {
    key: "",
    action: "Previous Save State",
    callback: async (ff7) => {
      await navigateSaveState(ff7, -1);
    },
  },
  {
    key: "",
    action: "Next Save State",
    callback: async (ff7) => {
      await navigateSaveState(ff7, 1);
    },
  },
  {
    key: "F7",
    action: "Full Heal and remove bad status effects",
    callback: async (ff7) => {
      await ff7.fullHeal();
    },
  },
  {
    key: "F8",
    action: "Toggle Limit Bar (full or empty)",
    callback: async (ff7) => {
      await ff7.toggleLimitBar();
    },
  },
  {
    key: "F9",
    action: "Game Over",
    callback: async (ff7) => {
      await ff7.gameOver();
    },
  },
  {
    key: "",
    action: "Toggle Skip Dialogues",
    callback: async (ff7) => {
      await ff7.toggleSkipDialogues();
    },
  },
  {
    key: "",
    action: "Toggle Walk Anywhere",
    callback: async (ff7) => {
      ff7.gameState.walkAnywhereEnabled
        ? await ff7.disableWalkAnywhere()
        : await ff7.enableWalkAnywhere();
    },
  },
  {
    key: "",
    action: "Toggle Manual Slots",
    callback: async (ff7) => {
      ff7.gameState.manualSlotsEnabled
        ? await ff7.disableManualSlots()
        : await ff7.enableManualSlots();
    },
  },
  {
    key: "",
    action: "Toggle Invincibility",
    callback: async (ff7) => {
      ff7.gameState.invincibilityEnabled
        ? await ff7.disableInvincibility()
        : await ff7.enableInvincibility();
    },
  },
  {
    key: "",
    action: "Toggle Instant ATB",
    callback: async (ff7) => {
      ff7.gameState.instantATBEnabled
        ? await ff7.disableInstantATB()
        : await ff7.enableInstantATB();
    },
  },
  {
    key: "",
    action: "Toggle Run by Default",
    callback: async (ff7) => {
      await ff7.toggleRunByDefault();
    },
  },
  {
    key: "",
    action: "Toggle Auto Sense",
    callback: async (ff7) => {
      await ff7.toggleAutoSense();
    },
  },
  {
    key: "F12",
    action: "Toggle Step Lock",
    callback: async (ff7) => {
      (window as any).__toggleStepLock?.();
    },
  },
];
