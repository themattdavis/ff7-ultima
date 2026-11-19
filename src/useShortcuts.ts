import { useEffect, useMemo, useRef } from "react";
import { atom, useAtom } from "jotai";
import { register, unregister, isRegistered as isTauriShortcutRegistered, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Shortcut, ShortcutContext, defaultShortcuts } from "./shortcuts";
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

// Shared state. useShortcuts() is called from several places (useFF7, the shortcuts modal, ...), so this
// state has to be shared between all of them. If each call kept its own copy, pausing from one place
// wouldn't reach the code that actually registers the keys, and "listening for a key" in the modal
// wouldn't stop the other copies from re-registering.
const listeningForAtom = atom<string | null>(null);
// Lets UI surfaces (e.g. a "name this save state" dialog) temporarily suspend all global shortcuts so
// typing into a text field doesn't trigger hotkeys like F5/F6, these are OS-level global shortcuts via
// the Tauri plugin, so they fire even while a text input has focus.
const shortcutsPausedAtom = atom(false);
const customShortcutsAtom = atom<Map<string, () => void>>(new Map());

const MODIFIER_PREFIXES = ["Ctrl+", "Alt+", "Shift+"];

const SPECIAL_KEYS: Record<string, string> = {
  "ARROWUP": "Up",
  "ARROWDOWN": "Down",
  "ARROWLEFT": "Left",
  "ARROWRIGHT": "Right",
  "ENTER": "Return",
  "ESCAPE": "Escape",
  "BACKSPACE": "Backspace",
  "DELETE": "Delete",
  "SPACE": "Space",
  " ": "Space",
  "TAB": "Tab",
  "+": "Plus",
};

// Converts a stored key ("F5", "Ctrl+ARROWUP", "Ctrl+Shift+A") to a Tauri accelerator. The key part is
// mapped even when modifiers are present, otherwise "Ctrl+ARROWUP" is not a valid accelerator.
function convertToTauriAccelerator(key: string): string {
  let rest = key;
  let modifiers = "";
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of MODIFIER_PREFIXES) {
      if (rest.startsWith(prefix) && rest.length > prefix.length) {
        modifiers += prefix;
        rest = rest.slice(prefix.length);
        stripped = true;
      }
    }
  }
  return modifiers + (SPECIAL_KEYS[rest.toUpperCase()] ?? rest);
}

// Reads and edits the shortcut bindings. Safe to call from any component: it only holds shared state and
// never touches the OS-level registrations (that is useShortcutRegistration's job).
export function useShortcuts() {
  const [listeningFor, setListeningFor] = useAtom(listeningForAtom);
  const [, setCustomShortcuts] = useAtom(customShortcutsAtom);
  const [, setShortcutsPaused] = useAtom(shortcutsPausedAtom);
  const { shortcuts: savedShortcuts, updateShortcuts } = useSettings();

  // A saved binding wins even when it is empty, so an unbound action stays unbound.
  const shortcuts: Shortcut[] = useMemo(
    () => defaultShortcuts.map(shortcut => ({
      ...shortcut,
      key: savedShortcuts && shortcut.action in savedShortcuts ? savedShortcuts[shortcut.action] : shortcut.key,
    })),
    [savedShortcuts],
  );

  const updateShortcut = async (action: string, newKey: string) => {
    const shortcut = shortcuts.find(s => s.action === action);
    if (!shortcut) return;

    // A key can only be bound to one action: whatever had it before is unbound.
    const updatedShortcuts = shortcuts.map(s => {
      if (s.action === action) return { ...s, key: newKey };
      if (newKey && s.key === newKey) return { ...s, key: "" };
      return s;
    });

    const shortcutMap = updatedShortcuts.reduce<Record<string, string>>((acc, s) => {
      acc[s.action] = s.key;
      return acc;
    }, {});
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
    setCustomShortcuts(prev => {
      const next = new Map(prev);
      next.delete(accelerator);
      return next;
    });
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

// Owns the OS-level registrations. Call this exactly once, from the main window's top level component
// (Home). Registering from more than one place makes the copies unregisterAll() each other's keys.
export function useShortcutRegistration() {
  const { shortcuts, listeningFor } = useShortcuts();
  const [customShortcuts] = useAtom(customShortcutsAtom);
  const [shortcutsPaused] = useAtom(shortcutsPausedAtom);
  const { connected, gameState } = useFF7Context();
  const currentModule = gameState.currentModule as GameModule;
  const { generalSettings, hackSettings, updateGeneralSettings, updateHackSettings } = useSettings();

  // Shortcut callbacks are registered once and would otherwise see stale settings,
  // so they read the latest values through this ref when a key is pressed.
  const contextRef = useRef<ShortcutContext>({ generalSettings, hackSettings, updateGeneralSettings, updateHackSettings });
  contextRef.current = { generalSettings, hackSettings, updateGeneralSettings, updateHackSettings };

  const shortcutsEnabled = generalSettings?.enableShortcuts ?? true;

  // Child windows (e.g. the stepgraph popup) load the same React app and also
  // run this hook. If they call unregisterAll() they silently wipe the main
  // window's global shortcuts. Guard every side-effect so only the main window
  // ever touches shortcut registration.
  const isMainWindow = getCurrentWindow().label === 'main';

  useEffect(() => {
    if (!isMainWindow) return;

    // Guard against the stale async loop continuing to register shortcuts after
    // this effect has been torn down and a new one has started.
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
                shortcut.callback((window as any).FF7, contextRef.current);
              } catch (e) {
                console.error(`Error calling ${shortcut.action}:`, e);
              }
            }
          });
        } catch (e) {
          console.error(`Failed to register shortcut ${shortcut.key}:`, e);
        }
      }

      // Custom shortcuts (e.g. the arrow keys while a mode is active) are registered here, after the
      // unregisterAll above, so a re-registration of the normal shortcuts can't silently drop them.
      for (const [accelerator, callback] of customShortcuts.entries()) {
        if (cancelled) break;
        try {
          if (await isTauriShortcutRegistered(accelerator)) {
            await unregister(accelerator);
          }
          await register(accelerator, (event) => {
            if (event.state === "Pressed") {
              callback();
            }
          });
        } catch (e) {
          console.error(`Failed to register custom shortcut ${accelerator}:`, e);
        }
      }
    };

    registerAllShortcuts();

    return () => {
      cancelled = true;
      unregisterAll().catch(e => console.error("Failed to unregister shortcuts on cleanup:", e));
    };
  }, [shortcuts, customShortcuts, listeningFor, connected, shortcutsEnabled, isMainWindow, currentModule, shortcutsPaused]);

  // Guarantee cleanup on window close / crash, the effect cleanup above only fires
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
}
