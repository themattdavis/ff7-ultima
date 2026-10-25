import Row from "./components/Row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { useAlert } from "./hooks/useAlert";
import { RandomEncounters, Tabs } from "./types";
import { FF7 } from "./useFF7";
import { useEffect } from "react";
import { useSettings } from "./useSettings";
import { writeMemory, DataType } from "./memory";

export function Hacks(props: { ff7: FF7, tab: Tabs }) {
  const ff7 = props.ff7;
  const { showAlert, AlertComponent } = useAlert();
  const { generalSettings, hackSettings, updateHackSettings, updateGeneralSettings } = useSettings();

  const setSpeed = async (speed: string) => {
    const check = await ff7.setSpeed(parseFloat(speed));
    if (!check) {
      showAlert("Not supported", "This version of FFNx is not supported for setting speed. Use the built-in speedhack instead.");
    } else if (generalSettings?.rememberedHacks.speed) {
      updateHackSettings({ ...hackSettings, speed });
    }
  };

  const setRandomBattles = async (randomEncounters: RandomEncounters) => {
    if (randomEncounters === RandomEncounters.Off) {
      ff7.disableBattles();
    } else if (randomEncounters === RandomEncounters.Normal) {
      ff7.enableBattles();
    } else if (randomEncounters === RandomEncounters.Max) {
      ff7.maxBattles();
    }
    if (generalSettings?.rememberedHacks.randomBattles) {
      updateHackSettings({ ...hackSettings, randomBattles: randomEncounters });
    }
  };

  const toggleSkipIntros = () => {
    const newValue = !ff7.introDisabled;
    newValue ? ff7.enableSkipIntro() : ff7.disableSkipIntro();
    if (generalSettings?.rememberedHacks.skipIntros) {
      updateHackSettings({ ...hackSettings, skipIntros: newValue });
    }
  };

  const toggleUnfocusPatch = () => {
    if (ff7.gameState.isFFnx) return;
    const newValue = !ff7.gameState.unfocusPatchEnabled;
    newValue ? ff7.patchWindowUnfocus() : ff7.unpatchWindowUnfocus();
    if (generalSettings?.rememberedHacks.unfocusPatch) {
      updateHackSettings({ ...hackSettings, unfocusPatch: newValue });
    }
  };

  const toggleSwirlSkip = () => {
    const newValue = !ff7.gameState.battleSwirlDisabled;
    newValue ? ff7.disableBattleSwirl() : ff7.enableBattleSwirl();
    if (generalSettings?.rememberedHacks.swirlSkip) {
      updateHackSettings({ ...hackSettings, swirlSkip: newValue });
    }
  };

  const toggleSkipDialogues = () => {
    ff7.toggleSkipDialogues();
    if (generalSettings?.rememberedHacks.skipDialogues) {
      updateHackSettings({ ...hackSettings, skipDialogues: !ff7.gameState.fieldSkipDialoguesEnabled });
    }
  };

  const toggleAutoSkipFMV = () => {
    const newValue = !(generalSettings?.autoSkipFMV ?? false);
    updateGeneralSettings({ ...generalSettings!, autoSkipFMV: newValue });
  };

  const toggleGlacierTemp = () => {
    const newValue = !(generalSettings?.disableGlacierTemp ?? false);
    updateGeneralSettings({ ...generalSettings!, disableGlacierTemp: newValue });
  };

  const toggleWhirlwindBattles = () => {
    const newValue = !(generalSettings?.disableWhirlwindBattles ?? false);
    updateGeneralSettings({ ...generalSettings!, disableWhirlwindBattles: newValue });
  };

  const SAVE_MENU_INDEX = 9;
  const saveAnywhere = generalSettings?.saveAnywhere ?? false;

  const toggleSaveAnywhere = () => {
    const newValue = !saveAnywhere;
    ff7.toggleMenuLock(SAVE_MENU_INDEX);
    updateGeneralSettings({ ...generalSettings!, saveAnywhere: newValue });
  };

  // ...
  <Row label="Save anywhere">
    <Switch checked={saveAnywhere} onClick={toggleSaveAnywhere} />
  </Row>

  // Add the toggle function alongside the others:
  const toggleDoubleInputFix = async () => {
    const newValue = !(generalSettings?.doubleInputFix ?? false);
    if (newValue) {
      await writeMemory(0x0041B09C, 0x87343D83, DataType.Int);
      await writeMemory(0x0041B0A9, 0xFFFAC6E8, DataType.Int);
    } else {
      await writeMemory(0x0041B09C, 0x85E43D83, DataType.Int);
      await writeMemory(0x0041B0A9, 0xFFFAB9E8, DataType.Int);
    }
    updateGeneralSettings({ ...generalSettings!, doubleInputFix: newValue });
  };

  const skipCPR = generalSettings?.skipCPR ?? false;

  const toggleSkipCPR = () => {
    updateGeneralSettings({ ...generalSettings!, skipCPR: !skipCPR });
  };

  const toggleShortcuts = () => {
    const newValue = !(generalSettings?.enableShortcuts ?? true);
    updateGeneralSettings({ ...generalSettings!, enableShortcuts: newValue });
  };

  // When Skip CPR is enabled and the player enters field 434, write the trigger byte.
  useEffect(() => {
    if (skipCPR && ff7.gameState.fieldId === 434) {
      writeMemory(0x00CC14E8, 41, DataType.Byte);
    }
  }, [skipCPR, ff7.gameState.fieldId]);

  return ( 
    <>
      <Row label="Speed">
        <Select value={ff7.gameState.speed || "1"} onValueChange={setSpeed}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.25">Slowest (1/4x)</SelectItem>
            <SelectItem value="0.5">Slow (1/2x)</SelectItem>
            <SelectItem value="1">Normal (1x)</SelectItem>
            <SelectItem value="2">Fast (2x)</SelectItem>
            <SelectItem value="5">Fastest (5x)</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Skip intros">
        <Switch checked={ff7.introDisabled} onClick={toggleSkipIntros} />
      </Row>

      <div className={ff7.gameState.isFFnx ? "opacity-50" : ""} title={ff7.gameState.isFFnx ? "FFNx already has this feature" : ""}>
        <Row label="Unfocus patch">
          <Switch checked={ff7.gameState.unfocusPatchEnabled} onClick={toggleUnfocusPatch} />
        </Row>
      </div>
      
      <Row label="Swirl skip">
        <Switch checked={ff7.gameState.battleSwirlDisabled} onClick={toggleSwirlSkip} />
      </Row>

      <Row label="Random battles">
        <Select value={'' + ff7.gameState.randomEncounters} onValueChange={v => setRandomBattles(parseInt(v) as RandomEncounters)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={'' + RandomEncounters.Off}>Off</SelectItem>
            <SelectItem value={'' + RandomEncounters.Normal}>Normal</SelectItem>
            <SelectItem value={'' + RandomEncounters.Max}>Max</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Skip dialogues">
        <Switch checked={ff7.gameState.fieldSkipDialoguesEnabled} onClick={toggleSkipDialogues} />
      </Row>

      <Row label="Auto-skip FMV">
        <Switch checked={generalSettings?.autoSkipFMV ?? false} onClick={toggleAutoSkipFMV} />
      </Row>

      <Row label="No glacier freeze">
        <Switch checked={generalSettings?.disableGlacierTemp ?? false} onClick={toggleGlacierTemp} />
      </Row>

      <Row label="No maze wind battles">
        <Switch checked={generalSettings?.disableWhirlwindBattles ?? false} onClick={toggleWhirlwindBattles} />
      </Row>

      <Row label="Save anywhere">
        <Switch checked={saveAnywhere} onClick={toggleSaveAnywhere} />
      </Row>

      <Row label="Double Input Fix">
        <Switch checked={generalSettings?.doubleInputFix ?? false} onClick={toggleDoubleInputFix} />
      </Row>

      <Row label="Skip CPR">
        <Switch checked={skipCPR} onClick={toggleSkipCPR} />
      </Row>

      <Row label="Enable shortcuts">
        <Switch checked={generalSettings?.enableShortcuts ?? true} onClick={toggleShortcuts} />
      </Row>

      <AlertComponent />
    </>
  )
}