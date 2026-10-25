import { useEffect, useState } from "react";
import { register, unregister, isRegistered as isTauriShortcutRegistered, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Shortcut, defaultShortcuts } from "./shortcuts";
import { useSettings } from "./useSettings";
import { useFF7Context } from "./FF7Context";
import { GameModule } from "./types";

// Actions that operate on save states. These get unhooked while the game is
// in a module where loading/saving doesn't make sense (battle, menus, disc
// changes, etc.) so the keys are free to be used by the game itself.
const SAVE_STATE_ACTIONS = new Set([
  "Load State",
  "Save State",
  "Previous Save State",
  "Next Save State",
]);

const SAVE_STATE_DISABLED_MODULES = new Set<GameModule>([
  GameModule.Battle,
  GameModule.Menu,
  GameModule.ChangeDisc,
  GameModule.Quit,
  GameModule.Start,
  GameModule.BattleSwirl,
  GameModule.GameOver,
]);

function convertToTauriAccelerator(key: string): string {
  if (key.includes("+")) {
    return key;
  }
  
  const specialKeys: Record<string, string> = {
    "ARROWUP": "Up",
    "ARROWDOWN": "Down",
    "ARROWLEFT": "Left",
    "ARROWRIGHT": "Right",
    "ENTER": "Return",
    "ESCAPE": "Escape",
    "BACKSPACE": "Backspace",
    "DELETE": "Delete",
    "SPACE": "Space",
    "TAB": "Tab",
  };

  return specialKeys[key] || key;
}

export function useShortcuts() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(defaultShortcuts);
  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const [customShortcuts, setCustomShortcuts] = useState<Map<string, () => void>>(new Map());
  // Lets UI surfaces (e.g. a "name this save state" dialog) temporarily
  // suspend all global shortcuts so typing into a text field doesn't trigger
  // hotkeys like F5/F6 — these are OS-level global shortcuts via the Tauri
  // plugin, so they fire even while a text input has focus.
  const [shortcutsPaused, setShortcutsPaused] = useState(false);
  const { connected, gameState } = useFF7Context();
  const currentModule = gameState.currentModule as GameModule;
  const { generalSettings, shortcuts: savedShortcuts, updateShortcuts } = useSettings();

  const shortcutsEnabled = generalSettings?.enableShortcuts ?? true;

  // Child windows (e.g. the stepgraph popup) load the same React app and also
  // run this hook. If they call unregisterAll() they silently wipe the main
  // window's global shortcuts. Guard every side-effect so only the main window
  // ever touches shortcut registration.
  const isMainWindow = getCurrentWindow().label === 'main';

  useEffect(() => {
    if (savedShortcuts) {
      setShortcuts(defaultShortcuts.map(shortcut => ({
        ...shortcut,
        key: savedShortcuts[shortcut.action] || shortcut.key,
      })));
    }
  }, [savedShortcuts]);

  useEffect(() => {
    if (!isMainWindow) return;

    // Guard against the stale async loop continuing to register shortcuts after
    // this effect has been torn down and a new one has started. Without this,
    // the old loop can finish *after* the new unregisterAll() has already run,
    // leaving a partially-registered ghost set that the new loop then clobbers.
    let cancelled = false;

    const registerAllShortcuts = async () => {
      await unregisterAll();
      if (cancelled || !connected || listeningFor || !shortcutsEnabled || shortcutsPaused) return;
      
      for (const shortcut of shortcuts) {
        if (cancelled) break;
        if (!shortcut.key) continue;

        if (
          SAVE_STATE_ACTIONS.has(shortcut.action) &&
          SAVE_STATE_DISABLED_MODULES.has(currentModule)
        ) {
          console.debug(`skipping ${shortcut.action} (save state disabled in module ${currentModule})`);
          continue;
        }

        const accelerator = convertToTauriAccelerator(shortcut.key);
        
        try {
          console.debug(`registering ${accelerator} for ${shortcut.action}`);
          await register(accelerator, (event) => {
            if (event.state === "Pressed") {
              console.debug(`${shortcut.key} pressed, calling ${shortcut.action}`);
              try {
                shortcut.callback((window as any).FF7);
              } catch (e) {
                console.error(`Error calling ${shortcut.action}:`, e);
              }
            }
          });
        } catch (e) {
          console.error(`Failed to register shortcut ${shortcut.key}:`, e);
        }
      }
    };

    registerAllShortcuts();

    return () => {
      cancelled = true;
      unregisterAll().catch(e => console.error("Failed to unregister shortcuts on cleanup:", e));
    };
  }, [shortcuts, listeningFor, connected, shortcutsEnabled, isMainWindow, currentModule, shortcutsPaused]);

  // Guarantee cleanup on window close / crash — the effect cleanup above only fires
  // during normal React unmount, which doesn't happen on forced close or crash.
  useEffect(() => {
    if (!isMainWindow) return;

    const appWindow = getCurrentWindow();
    let unlistenFn: (() => void) | null = null;

    appWindow.onCloseRequested(async (event) => {
      event.preventDefault(); // hold the window open during cleanup
      await unregisterAll().catch(e => console.error("Failed to unregister shortcuts on close:", e));
      await appWindow.destroy(); // now actually close
    }).then(fn => { unlistenFn = fn; });

    return () => {
      unlistenFn?.();
    };
  }, [isMainWindow]);

  useEffect(() => {
    const registerCustomShortcuts = async () => {
      if (!isMainWindow || !connected) return;
      
      for (const [accelerator, callback] of customShortcuts.entries()) {
        try {
          if (await isTauriShortcutRegistered(accelerator)) {
            await unregister(accelerator);
          }
          await register(accelerator, (event) => {
            if (connected && event.state === "Pressed" && !shortcutsPaused) {
              callback();
            }
          });
        } catch (e) {
          console.error(`Failed to register custom shortcut ${accelerator}:`, e);
        }
      }
    };

    registerCustomShortcuts();

    return () => {
      customShortcuts.forEach(async (_, accelerator) => {
        try {
          if (await isTauriShortcutRegistered(accelerator)) {
            await unregister(accelerator);
          }
        } catch (e) {
          console.error(`Failed to unregister custom shortcut ${accelerator}:`, e);
        }
      });
    };
  }, [customShortcuts, connected]);

  const updateShortcut = async (action: string, newKey: string) => {
    const shortcut = shortcuts.find(s => s.action === action);
    if (!shortcut) return;

    const conflictingShortcut = shortcuts.find(s => s.key === newKey && s.action !== action);

    const updatedShortcuts = shortcuts.map(s => {
      if (s.action === action) {
        return { ...s, key: newKey };
      } else if (s === conflictingShortcut) {
        return { ...s, key: "" };
      }
      return s;
    });
    
    setShortcuts(updatedShortcuts);

    const shortcutMap = updatedShortcuts.reduce((acc, s) => ({
      ...acc,
      [s.action]: s.key,
    }), {});
    updateShortcuts(shortcutMap);
  };

  const startListening = async (action: string) => {
    await unregisterAll();
    setListeningFor(action);
  };

  const stopListening = () => {
    setListeningFor(null);
  };

  const registerCustomShortcut = async (key: string, callback: () => void) => {
    const accelerator = convertToTauriAccelerator(key);
    setCustomShortcuts(prev => {
      const next = new Map(prev);
      next.set(accelerator, callback);
      return next;
    });
  };

  const unregisterCustomShortcut = async (key: string) => {
    const accelerator = convertToTauriAccelerator(key);
    try {
      if (await isTauriShortcutRegistered(accelerator)) {
        await unregister(accelerator);
      }
      setCustomShortcuts(prev => {
        const next = new Map(prev);
        next.delete(accelerator);
        return next;
      });
    } catch (e) {
      console.error(`Failed to unregister custom shortcut ${accelerator}:`, e);
    }
  };

  return {
    shortcuts,
    listeningFor,
    startListening,
    stopListening,
    updateShortcut,
    registerCustomShortcut,
    unregisterCustomShortcut,
    pauseShortcuts: () => setShortcutsPaused(true),
    resumeShortcuts: () => setShortcutsPaused(false),
  };
}