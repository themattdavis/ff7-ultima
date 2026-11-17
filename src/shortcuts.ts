import { FF7 } from "./useFF7";
import { GeneralSettings, HackSettings } from "./useSettings";
import { applyDoubleInputFix } from "./doubleInputFix";

// Live settings handed to every shortcut callback, so toggles triggered from a
// shortcut behave exactly like the ones in the settings UI (including honouring
// the "Remember Hacks" checkboxes).
export interface ShortcutContext {
  generalSettings: GeneralSettings | null;
  hackSettings: HackSettings | null;
  updateGeneralSettings: (settings: GeneralSettings) => void;
  updateHackSettings: (settings: HackSettings) => void;
}

export interface Shortcut {
  key: string;
  action: string;
  callback: (ff7: FF7, ctx: ShortcutContext) => Promise<void>;
}

type RememberableHack = keyof GeneralSettings["rememberedHacks"] & keyof HackSettings;

// Stores a hack's new value in the hack settings, but only if it is ticked in "Remember Hacks".
function remember(ctx: ShortcutContext, hack: RememberableHack, patch: Partial<HackSettings>) {
  if (ctx.generalSettings?.rememberedHacks[hack]) {
    ctx.updateHackSettings({ ...(ctx.hackSettings ?? {}), ...patch } as HackSettings);
  }
}

// Updates a hack that lives in the general settings (these have no hack-settings entry).
function setGeneral(ctx: ShortcutContext, patch: Partial<GeneralSettings>) {
  if (!ctx.generalSettings) return;
  ctx.updateGeneralSettings({ ...ctx.generalSettings, ...patch });
}

const MULTIPLIER_STEPS = [0, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 20];

function nextMultiplier(current: number): number {
  const idx = MULTIPLIER_STEPS.findIndex(v => Math.abs(v - current) < 1e-6);
  return MULTIPLIER_STEPS[(idx + 1) % MULTIPLIER_STEPS.length];
}

const SAVE_MENU_INDEX = 9;

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
    key: "",
    action: "Skip FMV / Minigame",
    callback: async (ff7) => {
      await ff7.skipFMV(true);
    },
  },
  {
    key: "",
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
  // ---- Speed presets ----
  {
    key: "",
    action: "Slow Speed (0.25x)",
    callback: async (ff7) => {
      await ff7.setSpeed(0.25);
    },
  },
  {
    key: "",
    action: "Slow Speed (0.5x)",
    callback: async (ff7) => {
      await ff7.setSpeed(0.5);
    },
  },
  {
    key: "",
    action: "Normal Speed (1x)",
    callback: async (ff7) => {
      await ff7.setSpeed(1);
    },
  },
  {
    key: "",
    action: "Fast Speed (2x)",
    callback: async (ff7) => {
      await ff7.setSpeed(2);
    },
  },
  {
    key: "",
    action: "Faster Speed (5x)",
    callback: async (ff7) => {
      await ff7.setSpeed(5);
    },
  },
  {
    key: "",
    action: "Fastest Speed (10x)",
    callback: async (ff7) => {
      await ff7.setSpeed(10);
    },
  },
  {
    key: "",
    action: "Max Speed (1000x)",
    callback: async (ff7) => {
      await ff7.setSpeed(1000);
    },
  },
  {
    key: "",
    action: "Save State",
    callback: async (ff7) => {
      await ff7.saveState();
      // Point navigator to the end so next/prev starts from the new state
      saveStateIndex = ff7.saveStates.displayOrder.length - 1;
    },
  },
  {
    key: "",
    action: "Load State",
    callback: async (ff7) => {
      await ff7.loadState();
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
  // ---- Random battles ----
  {
    key: "",
    action: "Random Battles: Off",
    callback: async (ff7, ctx) => {
      await ff7.disableBattles();
      remember(ctx, "randomBattles", { randomBattles: 0 });
    },
  },
  {
    key: "",
    action: "Random Battles: Normal",
    callback: async (ff7, ctx) => {
      await ff7.enableBattles();
      remember(ctx, "randomBattles", { randomBattles: 1 });
    },
  },
  {
    key: "",
    action: "Random Battles: Max",
    callback: async (ff7, ctx) => {
      await ff7.maxBattles();
      remember(ctx, "randomBattles", { randomBattles: 2 });
    },
  },
  {
    key: "",
    action: "Toggle Auto-skip FMV",
    callback: async (ff7, ctx) => {
      setGeneral(ctx, { autoSkipFMV: !(ctx.generalSettings?.autoSkipFMV ?? false) });
    },
  },
  {
    key: "",
    action: "Toggle Save Anywhere",
    callback: async (ff7, ctx) => {
      await ff7.toggleMenuLock(SAVE_MENU_INDEX);
      setGeneral(ctx, { saveAnywhere: !(ctx.generalSettings?.saveAnywhere ?? false) });
    },
  },
  {
    key: "",
    action: "Toggle Skip Dialogues",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.fieldSkipDialoguesEnabled;
      await ff7.toggleSkipDialogues();
      remember(ctx, "skipDialogues", { skipDialogues: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Walk Anywhere",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.walkAnywhereEnabled;
      newValue ? await ff7.enableWalkAnywhere() : await ff7.disableWalkAnywhere();
      remember(ctx, "walkAnywhere", { walkAnywhere: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Manual Slots",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.manualSlotsEnabled;
      newValue ? await ff7.enableManualSlots() : await ff7.disableManualSlots();
      remember(ctx, "manualSlots", { manualSlots: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Invincibility",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.invincibilityEnabled;
      newValue ? await ff7.enableInvincibility() : await ff7.disableInvincibility();
      remember(ctx, "invincibility", { invincibility: newValue });
    },
  },
  // ---- Toggles ----
  {
    key: "",
    action: "Toggle Skip Intros",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.introDisabled;
      newValue ? await ff7.enableSkipIntro() : await ff7.disableSkipIntro();
      remember(ctx, "skipIntros", { skipIntros: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Unfocus Patch",
    callback: async (ff7, ctx) => {
      if (ff7.gameState.isFFnx) return; // FFNx already has this feature
      const newValue = !ff7.gameState.unfocusPatchEnabled;
      newValue ? await ff7.patchWindowUnfocus() : await ff7.unpatchWindowUnfocus();
      remember(ctx, "unfocusPatch", { unfocusPatch: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Swirl Skip",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.battleSwirlDisabled;
      newValue ? await ff7.disableBattleSwirl() : await ff7.enableBattleSwirl();
      remember(ctx, "swirlSkip", { swirlSkip: newValue });
    },
  },
  {
    key: "",
    action: "Toggle No Glacier Freeze",
    callback: async (ff7, ctx) => {
      setGeneral(ctx, { disableGlacierTemp: !(ctx.generalSettings?.disableGlacierTemp ?? false) });
    },
  },
  {
    key: "",
    action: "Toggle No Maze Wind Battles",
    callback: async (ff7, ctx) => {
      setGeneral(ctx, { disableWhirlwindBattles: !(ctx.generalSettings?.disableWhirlwindBattles ?? false) });
    },
  },
  {
    key: "",
    action: "Toggle Double Input Fix",
    callback: async (ff7, ctx) => {
      const newValue = !(ctx.generalSettings?.doubleInputFix ?? false);
      const result = await applyDoubleInputFix(newValue);
      if (result === "skipped") return; // unexpected game code: nothing was written
      setGeneral(ctx, { doubleInputFix: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Skip CPR",
    callback: async (ff7, ctx) => {
      setGeneral(ctx, { skipCPR: !(ctx.generalSettings?.skipCPR ?? false) });
    },
  },
  {
    key: "",
    action: "Toggle Enable All Menus",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.menuAlwaysEnabled;
      newValue ? await ff7.enableMenuAlwaysEnabled() : await ff7.disableMenuAlwaysEnabled();
      remember(ctx, "menuAlwaysEnabled", { menuAlwaysEnabled: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Step Lock",
    callback: async (ff7) => {
      (window as any).__toggleStepLock?.();
    },
  },
  {
    key: "",
    action: "Toggle World Super Speed",
    callback: async (ff7, ctx) => {
      const newValue = ff7.gameState.worldSpeedMultiplier !== 12;
      await ff7.setWorldSpeedMultiplier(newValue ? 12 : 2);
      remember(ctx, "worldSuperSpeed", { worldSuperSpeed: newValue });
    },
  },
  {
    key: "",
    action: "Toggle World Zoom & Tilt",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.worldZoomTiltEnabled;
      await ff7.setWorldZoomTiltEnabled(newValue);
      remember(ctx, "worldZoomTilt", { worldZoomTilt: newValue });
    },
  },
  // ---- Multipliers (each press steps to the next value: 0, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 20, then back to 0) ----
  {
    key: "",
    action: "Cycle EXP Multiplier",
    callback: async (ff7, ctx) => {
      const value = nextMultiplier(ff7.gameState.expMultiplier);
      await ff7.setExpMultiplier(value);
      remember(ctx, "expMultiplier", { expMultiplier: value });
    },
  },
  {
    key: "",
    action: "Cycle Gil Multiplier",
    callback: async (ff7, ctx) => {
      const value = nextMultiplier(ff7.gameState.gilMultiplier);
      await ff7.setGilMultiplier(value);
      remember(ctx, "gilMultiplier", { gilMultiplier: value });
    },
  },
  {
    key: "",
    action: "Cycle AP Multiplier",
    callback: async (ff7, ctx) => {
      const value = nextMultiplier(ff7.gameState.apMultiplier);
      await ff7.setApMultiplier(value);
      remember(ctx, "apMultiplier", { apMultiplier: value });
    },
  },
  {
    key: "",
    action: "Toggle Instant ATB",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.instantATBEnabled;
      newValue ? await ff7.enableInstantATB() : await ff7.disableInstantATB();
      remember(ctx, "instantATB", { instantATB: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Run by Default",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.fieldRunByDefaultEnabled;
      await ff7.toggleRunByDefault();
      remember(ctx, "runByDefault", { runByDefault: newValue });
    },
  },
  {
    key: "",
    action: "Toggle Auto Sense",
    callback: async (ff7, ctx) => {
      const newValue = !ff7.gameState.autoSenseEnabled;
      await ff7.toggleAutoSense();
      remember(ctx, "autoSense", { autoSense: newValue });
    },
  },
  {
    key: "",
    action: "Full Heal and remove bad status effects",
    callback: async (ff7) => {
      await ff7.fullHeal();
    },
  },
  {
    key: "",
    action: "Toggle Limit Bar (full or empty)",
    callback: async (ff7) => {
      await ff7.toggleLimitBar();
    },
  },
  {
    key: "",
    action: "Game Over",
    callback: async (ff7) => {
      await ff7.gameOver();
    },
  },
];
