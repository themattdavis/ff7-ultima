import { FF7 } from "@/useFF7";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { AutoUpdateOption, HackSettings, useSettings } from "@/useSettings";

interface GeneralSettingsContentProps {
  ff7: FF7;
}

export function GeneralSettingsContent({ ff7 }: GeneralSettingsContentProps) {
  const autoUpdateOptions = {
    auto: "Auto install",
    notify: "Just notify",
    disabled: "Disabled"
  };

  const autoUpdateHelpText = {
    auto: "Updates will be automatically downloaded and installed when available",
    notify: "You will be notified when updates are available but they won't be installed automatically",
    disabled: "The app will never check for updates"
  };

  const { generalSettings, hackSettings, updateGeneralSettings, updateHackSettings } = useSettings();

  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateOption>(generalSettings?.autoUpdate || "notify");
  const [enableShortcuts, setEnableShortcuts] = useState<boolean>(generalSettings?.enableShortcuts ?? true);
  const [speedHackEnhancements, setSpeedHackEnhancements] = useState<boolean>(generalSettings?.speedHackEnhancements ?? true);
  const [rememberedHacks, setRememberedHacks] = useState(generalSettings?.rememberedHacks || {
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
    autoSkipFMV: true,
    disableGlacierTemp: true,
    disableWhirlwindBattles: true,
    saveAnywhere: true,
    doubleInputFix: true,
    skipCPR: true
  });

  // Sync state when generalSettings changes
  useEffect(() => {
    if (generalSettings) {
      setEnableShortcuts(generalSettings.enableShortcuts);
      setSpeedHackEnhancements(generalSettings.speedHackEnhancements);
      setRememberedHacks(generalSettings.rememberedHacks);
    }
  }, [generalSettings]);

  const getCurrentHackState = (hack: keyof typeof rememberedHacks) => {
    switch (hack) {
      case 'speed':
        return ff7.gameState.speed;
      case 'skipIntros':
        return ff7.introDisabled;
      case 'unfocusPatch':
        return ff7.gameState.unfocusPatchEnabled;
      case 'swirlSkip':
        return ff7.gameState.battleSwirlDisabled;
      case 'randomBattles':
        return ff7.gameState.randomEncounters;
      case 'expMultiplier':
        return ff7.gameState.expMultiplier;
      case 'gilMultiplier':
        return ff7.gameState.gilMultiplier;
      case 'apMultiplier':
        return ff7.gameState.apMultiplier;
      case 'invincibility':
        return ff7.gameState.invincibilityEnabled;
      case 'instantATB':
        return ff7.gameState.instantATBEnabled;
      case 'manualSlots':
        return ff7.gameState.manualSlotsEnabled;
      case 'skipDialogues':
        return ff7.gameState.fieldSkipDialoguesEnabled;
      case 'runByDefault':
        return ff7.gameState.fieldRunByDefaultEnabled;
      case 'autoSense':
        return ff7.gameState.autoSenseEnabled;
      default:
        return undefined;
    }
  };

  const hackCheckboxes: { key: keyof typeof rememberedHacks; label: string }[] = [
    { key: 'speed', label: 'Game Speed' },
    { key: 'skipIntros', label: 'Skip Intros' },
    { key: 'unfocusPatch', label: 'Unfocus Patch' },
    { key: 'swirlSkip', label: 'Swirl Skip' },
    { key: 'randomBattles', label: 'Random Battles' },
    { key: 'skipDialogues', label: 'Skip Dialogues' },
    { key: 'runByDefault', label: 'Run by Default' },
    { key: 'autoSkipFMV', label: 'Auto-skip FMV' },
    { key: 'disableGlacierTemp', label: 'No Glacier Freeze' },
    { key: 'disableWhirlwindBattles', label: 'No Maze Wind Battles' },
    { key: 'saveAnywhere', label: 'Save Anywhere' },
    { key: 'doubleInputFix', label: 'Double Input Fix' },
    { key: 'skipCPR', label: 'Skip CPR' },
    { key: 'expMultiplier', label: 'EXP Multiplier' },
    { key: 'gilMultiplier', label: 'Gil Multiplier' },
    { key: 'apMultiplier', label: 'AP Multiplier' },
    { key: 'invincibility', label: 'Invincibility' },
    { key: 'instantATB', label: 'Instant ATB' },
    { key: 'manualSlots', label: 'Manual Slots' },
    { key: 'autoSense', label: 'Auto Sense' },
  ];

  const generalSettingsHacks: (keyof typeof rememberedHacks)[] = [
    'autoSkipFMV', 'disableGlacierTemp', 'disableWhirlwindBattles', 'saveAnywhere', 'doubleInputFix', 'skipCPR'
  ];

  const toggleHack = (hack: keyof typeof rememberedHacks) => {
    const newState = {
      ...rememberedHacks,
      [hack]: !rememberedHacks[hack]
    };

    // Update general settings
    generalSettings && updateGeneralSettings({
      ...generalSettings,
      rememberedHacks: newState
    });

    // Hacks stored in the general settings need no hack-settings bookkeeping
    if (generalSettingsHacks.includes(hack)) {
      setRememberedHacks(newState);
      return;
    }

    // Handle hack settings
    const hackSetting = hack as keyof HackSettings;

    if (!newState[hack]) {
      // If we're disabling remembering, remove this hack from settings
      const { [hackSetting]: _, ...rest } = hackSettings || {};
      updateHackSettings(rest);
    } else {
      // If we're enabling remembering, save the current state
      updateHackSettings({
        ...hackSettings,
        [hackSetting]: getCurrentHackState(hack)
      });
    }

    setRememberedHacks(newState);
  };

  const handleAutoUpdateChange = (value: AutoUpdateOption) => {
    setAutoUpdate(value);
    generalSettings && updateGeneralSettings({
      ...generalSettings,
      autoUpdate: value
    });
  };

  const handleShortcutsChange = (value: boolean) => {
    setEnableShortcuts(value);
    generalSettings && updateGeneralSettings({
      ...generalSettings,
      enableShortcuts: value
    });
  };

  const handleSpeedHackEnhancementsChange = (value: boolean) => {
    setSpeedHackEnhancements(value);
    generalSettings && updateGeneralSettings({
      ...generalSettings,
      speedHackEnhancements: value
    });
  };

  return (
    <div className="space-y-6">
      {/* 
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Auto-Update</Label>
          <Select value={autoUpdate} onValueChange={handleAutoUpdateChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(autoUpdateOptions).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-slate-400">{autoUpdateHelpText[autoUpdate]}</p>
      </div>
      */}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Enable Keyboard Shortcuts</Label>
          <Switch checked={enableShortcuts} onCheckedChange={handleShortcutsChange} />
        </div>
        <p className="text-xs text-slate-400">To change the shortcut mapping switch to the Shortcuts tab above</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Speed Hack Enhancements</Label>
          <Switch checked={speedHackEnhancements} onCheckedChange={handleSpeedHackEnhancementsChange} />
        </div>
        <p className="text-xs text-slate-400">When speed hack is enabled this will also:</p>
        <ul className="text-xs text-slate-400 list-disc pl-5 space-y-1">
          <li>disable the temperature dropping in Great Glacier</li>
          <li>disable battles triggered by the wind in Whirlwind Maze</li>
        </ul>
      </div>

      <div className="space-y-2">
        <Label>Remember Hacks</Label>
        <p className="text-xs text-slate-400 mb-2">The selected hacks will be remembered after you close the app and across game sessions</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
          {hackCheckboxes.map(({ key, label }) => (
            <div key={key} className="flex items-center space-x-2">
              <Checkbox
                id={key}
                checked={rememberedHacks[key]}
                onCheckedChange={() => toggleHack(key)}
              />
              <label htmlFor={key} className="text-sm">{label}</label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 