import { atom, useAtom } from 'jotai';
import { useEffect, useCallback, useRef } from 'react';
import { debounce } from 'lodash-es';
import { load, Store } from '@tauri-apps/plugin-store';
import { logger } from './lib/logging';
import { Destination } from './types';
import { RandomEncounters } from './types';

export type AutoUpdateOption = 'auto' | 'notify' | 'disabled';

export interface GeneralSettings {
  autoUpdate: AutoUpdateOption;
  enableShortcuts: boolean;
  hasSeenSettingsHint: boolean;
  lastDismissedUpdateVersion: string | null;
  speedHackEnhancements: boolean;
  disableGlacierTemp: boolean;
  disableWhirlwindBattles: boolean;
  autoSkipFMV: boolean;
  selectedCategoryFilter: string;
  lastLoadedStateId: string | null;
  doubleInputFix: boolean;
  skipCPR: boolean
  saveAnywhere: boolean;
  showBattle: boolean,
  showSaveStates: boolean;
  showStepgraph: boolean;
  stepLockEnabled: boolean;
  stepLockValues: { stepId: number; stepFraction: number; stepOffset: number; formationIndex: number; dangerValue: number } | null;
  rememberedHacks: {
    speed: boolean;
    skipIntros: boolean;
    unfocusPatch: boolean;
    swirlSkip: boolean;
    randomBattles: boolean;
    expMultiplier: boolean;
    gilMultiplier: boolean;
    apMultiplier: boolean;
    invincibility: boolean;
    instantATB: boolean;
    manualSlots: boolean;
    skipDialogues: boolean;
    runByDefault: boolean;
    autoSense: boolean;
  };
}

export interface HackSettings {
  speed?: string;
  skipIntros?: boolean;
  unfocusPatch?: boolean;
  swirlSkip?: boolean;
  randomBattles?: RandomEncounters;
  invincibility?: boolean;
  instantATB?: boolean;
  expMultiplier?: number;
  gilMultiplier?: number;
  apMultiplier?: number;
  manualSlots?: boolean;
  skipDialogues?: boolean;
  runByDefault?: boolean;
  autoSense?: boolean;
}

export interface SaveStates {
  fieldStates: SaveState[];
  snowboardStates: SnowBoardSaveState[];
  worldStates: WorldSaveState[];
  displayOrder?: string[];
}

export interface SaveStateBase {
  id: string;
  timestamp: number;
  title?: string;
  category?: string;
}

export type SaveState = SaveStateBase & {
  regions: number[][];
  regionOffsets?: [number, number][];
  savemap: number[];
  fieldId: number;
  fieldName: string;
  destination?: Destination;
};

export type SnowBoardSaveState = SaveStateBase & {
  globalObjData: number[];
  entitiesData: number[];
};

export type WorldSaveState = SaveStateBase & {
  savemap: number[];
  worldX: number;
  worldY: number;
  worldZ: number;
  worldDirection: number;
  worldMapType: number;
  modelCoords: { x: number; y: number; z: number; direction: number; model_id?: number }[];
};

const generalSettingsAtom = atom<GeneralSettings | null>(null);
const hackSettingsAtom = atom<HackSettings | null>(null);
const shortcutsAtom = atom<Record<string, string> | null>(null);
const saveStatesAtom = atom<SaveStates>({ fieldStates: [], snowboardStates: [], worldStates: [] });

// Shared display order atom — the single source of truth for save state row ordering.
// Lives outside React component state so shortcuts.ts can read it via ff7.saveStates.
export const saveStateDisplayOrderAtom = atom<string[]>([]);

let storeInstance: Store | null = null;
let initializationPromise: Promise<void> | null = null;

async function getOrInitializeStore(): Promise<Store> {
  if (storeInstance) {
    return storeInstance;
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        const store = await load('settings.json', { autoSave: false });
        storeInstance = store;
        logger.info('Settings store initialized successfully.');
      } catch (error) {
        logger.error('Failed to initialize settings store', { error });
        initializationPromise = null;
        throw error;
      }
    })();
  }
  await initializationPromise;
  if (!storeInstance) {
    throw new Error('Store initialization failed unexpectedly after waiting.');
  }
  return storeInstance;
}

export function useSettings() {
  const [generalSettings, setGeneralSettings] = useAtom(generalSettingsAtom);
  const [hackSettings, setHackSettings] = useAtom(hackSettingsAtom);
  const [shortcuts, setShortcuts] = useAtom(shortcutsAtom);
  const [saveStates, setSaveStates] = useAtom(saveStatesAtom);
  const loadAttemptedRef = useRef(false);

  useEffect(() => {
    if (loadAttemptedRef.current) {
      return;
    }
    loadAttemptedRef.current = true;

    const loadData = async () => {
      try {
        const store = await getOrInitializeStore();

        if (generalSettings !== null) {
          logger.debug('Settings seem already loaded. Skipping redundant load.');
          return;
        }

        logger.debug('Loading settings data into hook state...');

        let general = await store.get<GeneralSettings>('general');
        if (!general) {
          general = getDefaultGeneralSettings();
          await store.set('general', general);
          await store.save();
          logger.info('Initialized general settings in store.');
        } else {
          const defaultGeneral = getDefaultGeneralSettings();
          general = {
            ...defaultGeneral,
            ...general,
            rememberedHacks: { ...defaultGeneral.rememberedHacks, ...general.rememberedHacks },
          };
        }
        setGeneralSettings(general);

        let hacks = await store.get<HackSettings>('hacks');
        setHackSettings(hacks ?? null);

        let shortcutsData = await store.get<Record<string, string>>('shortcuts');
        setShortcuts(shortcutsData ?? null);

        let states = await store.get<SaveStates>('saveStates');
        if (!states) {
          states = { fieldStates: [], snowboardStates: [], worldStates: [] };
          await store.set('saveStates', states);
          await store.save();
          logger.info('Initialized save states in store.');
        }
        if (!states.worldStates) states.worldStates = [];
        setSaveStates(states);
        setSaveStates(states);

        logger.info('Settings loaded successfully into hook state.');

      } catch (error) {
        logger.error('Failed to load settings data in useSettings hook', { error });
      }
    };

    loadData();
  }, [generalSettings]);

  const saveGeneralSettings = useCallback(
    debounce(async (settings: GeneralSettings) => {
      try {
        const store = await getOrInitializeStore();
        await store.set('general', settings);
        await store.save();
        logger.info('Saved general settings', { settings });
      } catch (error) {
        logger.error('Failed to save general settings', { error });
      }
    }, 1000),
    []
  );

  const saveHackSettings = useCallback(
    debounce(async (settings: HackSettings) => {
      try {
        const store = await getOrInitializeStore();
        await store.set('hacks', settings);
        await store.save();
        logger.info('Saved hack settings', { settings });
      } catch (error) {
        logger.error('Failed to save hack settings', { error });
      }
    }, 1000),
    []
  );

  const saveShortcuts = useCallback(
    debounce(async (shortcutsData: Record<string, string>) => {
      try {
        const store = await getOrInitializeStore();
        await store.set('shortcuts', shortcutsData);
        await store.save();
        logger.info('Saved shortcuts', { count: Object.keys(shortcutsData).length });
      } catch (error) {
        logger.error('Failed to save shortcuts', { error });
      }
    }, 1000),
    []
  );

  const saveSaveStates = useCallback(
    debounce(async (states: SaveStates) => {
      try {
        const store = await getOrInitializeStore();
        const statesWithIds: SaveStates = {
          fieldStates: states.fieldStates.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
          snowboardStates: states.snowboardStates.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
          worldStates: states.worldStates.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
          displayOrder: states.displayOrder,
        };
        await store.set('saveStates', statesWithIds);
        await store.save();
        logger.info('Saved states to main store', {
          fieldStatesCount: statesWithIds.fieldStates.length,
          snowboardStatesCount: statesWithIds.snowboardStates.length,
          worldStatesCount: statesWithIds.worldStates.length,
        });
      } catch (error) {
        logger.error('Failed to save save states', { error });
      }
    }, 1000),
    []
  );

  const updateGeneralSettings = useCallback((newSettings: GeneralSettings) => {
    setGeneralSettings(currentSettings => {
      saveGeneralSettings(newSettings);
      return newSettings;
    });
  }, [saveGeneralSettings]);

  const updateHackSettings = useCallback((newSettings: HackSettings) => {
    setHackSettings(currentSettings => {
      saveHackSettings(newSettings);
      return newSettings;
    });
  }, [saveHackSettings]);

  const updateShortcuts = useCallback((newShortcuts: Record<string, string>) => {
    setShortcuts(currentShortcuts => {
      saveShortcuts(newShortcuts);
      return newShortcuts;
    });
  }, [saveShortcuts]);

  const updateSaveStates = useCallback((newSaveStates: SaveStates) => {
    setSaveStates(currentSaveStates => {
      const newStatesWithIds: SaveStates = {
        fieldStates: newSaveStates.fieldStates.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
        snowboardStates: newSaveStates.snowboardStates.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
        worldStates: (newSaveStates.worldStates || []).map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
        displayOrder: newSaveStates.displayOrder,
      };
      saveSaveStates(newStatesWithIds);
      return newStatesWithIds;
    });
  }, [saveSaveStates]);

  return {
    generalSettings,
    hackSettings,
    shortcuts,
    saveStates,
    updateGeneralSettings,
    updateHackSettings,
    updateShortcuts,
    updateSaveStates,
  };
}

function getDefaultGeneralSettings(): GeneralSettings {
  return {
    autoUpdate: 'auto',
    enableShortcuts: true,
    hasSeenSettingsHint: false,
    lastDismissedUpdateVersion: null,
    speedHackEnhancements: true,
    disableGlacierTemp: false,
    disableWhirlwindBattles: false,
    autoSkipFMV: false,
    selectedCategoryFilter: 'all',
    lastLoadedStateId: null,
    doubleInputFix: false,
    skipCPR: false,
    saveAnywhere: false,
    showBattle: false,
    showSaveStates: false,
    showStepgraph: false,
    stepLockEnabled: false,
    stepLockValues: null,
    rememberedHacks: {
      speed: true,
      skipIntros: true,
      unfocusPatch: true,
      swirlSkip: true,
      randomBattles: true,
      expMultiplier: true,
      gilMultiplier: true,
      apMultiplier: true,
      invincibility: true,
      instantATB: true,
      manualSlots: true,
      skipDialogues: true,
      runByDefault: true,
      autoSense: true,
    },
  };
}
