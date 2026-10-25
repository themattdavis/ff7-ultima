import Row from "@/components/Row";
import { EditPopover } from "@/components/EditPopover";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { WarpFieldModal } from "@/components/modals/WarpFieldModal";
import { EnemyInfoModal } from "@/components/modals/EnemyInfoModal";
import { SaveStates } from "@/components/SaveStates";
import { Stepgraph } from "./Stepgraph";
import { statuses } from "@/ff7Statuses";
import { BattleCharObj, EnemyData, GameModule } from "@/types";
import { FF7 } from "@/useFF7";
import { formatTime, formatStatus } from "@/util";
import { useSettings } from "@/useSettings";
import { useState, useEffect } from "react";
import { Window } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { readMemory, writeMemory, DataType } from "@/memory";
import { Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="uppercase font-medium text-sm border-b border-zinc-600 pb-0 mb-2 tracking-wide text-zinc-900 dark:text-zinc-100">
      {title}
    </h2>
  );
}

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralSection({ ff7 }: { ff7: FF7 }) {
  const state = ff7.gameState;
  const [editValue, setEditValue] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const openEditPopover = (title: string, value: string) => {
    setEditTitle(title);
    setEditValue(value);
    setPopoverOpen(true);
  };

  const submitValue = () => {
    if (editTitle === "IGT") {
      const segments = editValue.split(":");
      let totalSeconds = 0;
      if (segments.length === 3) {
        totalSeconds =
          parseInt(segments[0]) * 3600 +
          parseInt(segments[1]) * 60 +
          parseInt(segments[2]);
      } else if (segments.length === 2) {
        totalSeconds =
          parseInt(segments[0]) * 60 + parseInt(segments[1]);
      } else {
        totalSeconds = parseInt(segments[0]);
      }
      ff7.setInGameTime(totalSeconds);
    } else if (editTitle === "Gil") {
      ff7.setGil(parseInt(editValue));
    }
    setPopoverOpen(false);
  };

  return (
    <>
      <SectionHeader title="General" />
      <div className="grid grid-cols-2 gap-x-1">
        <Row
          label="IGT"
          className="!my-0"
          onRowClick={() =>
            openEditPopover("IGT", formatTime(state.inGameTime))
          }
        >
          <EditPopover
            open={popoverOpen && editTitle === "IGT"}
            onOpenChange={setPopoverOpen}
            value={editValue}
            onValueChange={setEditValue}
            onSubmit={submitValue}
          >
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer w-[72px] h-4 flex items-center justify-end"
                    onClick={() =>
                      openEditPopover("IGT", formatTime(state.inGameTime))
                    }
                  >
                    {formatTime(state.inGameTime)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Click to edit</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>
        </Row>

        <Row
          label="Gil"
          className="!my-0"
          onRowClick={() =>
            openEditPopover("Gil", state.gil.toString())
          }
        >
          <EditPopover
            open={popoverOpen && editTitle === "Gil"}
            onOpenChange={setPopoverOpen}
            value={editValue}
            onValueChange={setEditValue}
            onSubmit={submitValue}
          >
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer w-[72px] h-4 flex items-center justify-end"
                    onClick={() =>
                      openEditPopover("Gil", state.gil.toString())
                    }
                  >
                    {state.gil}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Click to edit</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>
        </Row>
      </div>
    </>
  );
}

// ─── Field: Field ID + Step Info ─────────────────────────────────────────────

function FieldSection({ ff7 }: { ff7: FF7 }) {
  const state = ff7.gameState;
  const { generalSettings, updateGeneralSettings } = useSettings();
  const [isWarpModalOpen, setIsWarpModalOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const stepLockEnabled = generalSettings?.stepLockEnabled ?? false;

  const toggleStepLock = () => {
    if (!generalSettings) return;
    if (!stepLockEnabled) {
      updateGeneralSettings({
        ...generalSettings,
        stepLockEnabled: true,
        stepLockValues: {
          stepId: state.stepId,
          stepFraction: state.stepFraction,
          stepOffset: state.stepOffset,
          formationIndex: state.formationIndex,
          dangerValue: state.dangerValue,
        },
      });
    } else {
      updateGeneralSettings({ ...generalSettings, stepLockEnabled: false });
    }
  };

  const ELEVATOR = {
    hitoListAdvance: 0x00CC14D9,
    list:            0x00CBF588,
    stone:           0x00905E50,
  };

  const WM = {
    rng:      0x00E2A138,
    danger:   0x00E3A888,
    fraction: 0x00E3A87C,
  };

  const [hitoListAdvance, setHitoListAdvance] = useState(0);
  const [list, setList] = useState(0);
  const [stone, setStone] = useState(0);
  const [wmRng, setWmRng] = useState(0);
  const [wmDanger, setWmDanger] = useState(0);
  const [wmFraction, setWmFraction] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        setHitoListAdvance(await readMemory(ELEVATOR.hitoListAdvance, DataType.Byte));
        setList(await readMemory(ELEVATOR.list, DataType.Short));
        setStone(await readMemory(ELEVATOR.stone, DataType.Short));
        setWmRng(await readMemory(WM.rng, DataType.Int));
        setWmDanger(await readMemory(WM.danger, DataType.Short));
        setWmFraction(await readMemory(WM.fraction, DataType.Byte));
      } catch {
        // A failed read (e.g. brief disconnect) must not kill the loop;
        // keep scheduling so values resume updating automatically.
      }
      if (!cancelled) setTimeout(poll, 30);
    };

    poll();
    return () => { cancelled = true; };
  }, []);

  const openEditPopover = (title: string, value: string) => {
    setEditTitle(title);
    setEditValue(value);
    setPopoverOpen(true);
  };

  const submitValue = () => {
    if (editTitle === "Step Offset") ff7.setFieldStepOffset(parseInt(editValue));
    else if (editTitle === "Step ID") ff7.setFieldStepId(parseInt(editValue));
    else if (editTitle === "Step Fraction") ff7.setFieldStepFraction(parseInt(editValue));
    else if (editTitle === "Danger Value") ff7.setFieldDangerValue(parseInt(editValue));
    else if (editTitle === "Formation Index") ff7.setFieldFormationIndex(parseInt(editValue));
    else if (editTitle === "Hito List Advance") writeMemory(ELEVATOR.hitoListAdvance, parseInt(editValue), DataType.Byte).then(() => setHitoListAdvance(parseInt(editValue)));
    else if (editTitle === "List") writeMemory(ELEVATOR.list, parseInt(editValue), DataType.Short).then(() => setList(parseInt(editValue)));
    else if (editTitle === "Stone") writeMemory(ELEVATOR.stone, parseInt(editValue), DataType.Short).then(() => setStone(parseInt(editValue)));
    else if (editTitle === "WM RNG") writeMemory(WM.rng, parseInt(editValue), DataType.Int).then(() => setWmRng(parseInt(editValue)));
    else if (editTitle === "WM Danger") writeMemory(WM.danger, parseInt(editValue), DataType.Short).then(() => setWmDanger(parseInt(editValue)));
    else if (editTitle === "WM Fraction") writeMemory(WM.fraction, parseInt(editValue), DataType.Byte).then(() => setWmFraction(parseInt(editValue)));
    setPopoverOpen(false);
  };

  const pillClass = (extra?: string) =>
  `bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary${stepLockEnabled ? " ring-1 ring-green-500" : ""}${extra ? " " + extra : ""}`;
  
  return (
    <>
      <div className="mb-2">
        <Row label="Field ID" onRowClick={() => setIsWarpModalOpen(true)}>
          <TooltipProvider>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="h-4">
                  <span className="cursor-pointer">
                    {state.fieldId}
                    {state.fieldId > 0 && (
                      <span className="text-zinc-400 ml-1">
                        ({state.fieldId > 63 ? state.fieldName : `wm${state.fieldId - 1}`})
                      </span>
                    )}
                  </span>
                  <Button size="xs" className="ml-2">Warp</Button>
                </div>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Click to warp to another field</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Row>

        <Row label={
          <span className="flex items-center gap-3">
            Steps
            <Lock
              className={`h-3 w-3 cursor-pointer transition-colors ${stepLockEnabled ? "text-green-500" : "text-zinc-500 hover:text-zinc-300"}`}
              onClick={toggleStepLock}
            />
          </span>
        }>
          {/* Step ID */}
          <EditPopover open={popoverOpen && editTitle === "Step ID"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className={pillClass()} onClick={() => openEditPopover("Step ID", state.stepId.toString())}>
                    <span className="text-xs text-zinc-500 mr-1">ID</span>{state.stepId}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Step ID</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* Step Fraction */}
          <EditPopover open={popoverOpen && editTitle === "Step Fraction"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className={pillClass("ml-1")} onClick={() => openEditPopover("Step Fraction", state.stepFraction.toString())}>
                    <span className="text-xs text-zinc-500 mr-1">Frac</span>{state.stepFraction}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Step Fraction</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* Step Offset */}
          <EditPopover open={popoverOpen && editTitle === "Step Offset"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className={pillClass("ml-1")} onClick={() => openEditPopover("Step Offset", state.stepOffset.toString())}>
                    <span className="text-xs text-zinc-500 mr-1">Off</span>{state.stepOffset}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Step Offset</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* Formation Index */}
          <EditPopover open={popoverOpen && editTitle === "Formation Index"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className={pillClass("ml-1")} onClick={() => openEditPopover("Formation Index", state.formationIndex.toString())}>
                    <span className="text-xs text-zinc-500 mr-1">Frm</span>{state.formationIndex}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Formation Index</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* Danger Value */}
          <EditPopover open={popoverOpen && editTitle === "Danger Value"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className={pillClass("ml-1")} onClick={() => openEditPopover("Danger Value", state.dangerValue.toString())}>
                    <span className="text-xs text-zinc-500 mr-1">Dng</span>{state.dangerValue}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Danger Value</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>
        </Row>

        <Row label="Elevator Manipulation">
          {/* Hito List Advance */}
          <EditPopover open={popoverOpen && editTitle === "Hito List Advance"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("Hito List Advance"); setEditValue(hitoListAdvance.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">Hito</span>{hitoListAdvance}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Hito List Advance</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* List */}
          <EditPopover open={popoverOpen && editTitle === "List"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="ml-1 bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("List"); setEditValue(list.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">List</span>{list}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit List</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* Stone */}
          <EditPopover open={popoverOpen && editTitle === "Stone"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="ml-1 bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("Stone"); setEditValue(stone.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">Stone</span>{stone}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit Stone</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>
        </Row>

        <Row label="World Map">
          {/* WM RNG */}
          <EditPopover open={popoverOpen && editTitle === "WM RNG"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("WM RNG"); setEditValue(wmRng.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">RNG</span>{wmRng}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit WM RNG</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* WM Fraction */}
          <EditPopover open={popoverOpen && editTitle === "WM Fraction"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="ml-1 bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("WM Fraction"); setEditValue(wmFraction.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">Frac</span>{wmFraction}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit WM Fraction</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>

          {/* WM Danger */}
          <EditPopover open={popoverOpen && editTitle === "WM Danger"} onOpenChange={setPopoverOpen} value={editValue} onValueChange={setEditValue} onSubmit={submitValue}>
            <TooltipProvider>
              <Tooltip delayDuration={250}>
                <TooltipTrigger asChild>
                  <span className="ml-1 bg-zinc-900 px-1 rounded-xl w-[64px] flex justify-between cursor-pointer hover:text-primary" onClick={() => { setEditTitle("WM Danger"); setEditValue(wmDanger.toString()); setPopoverOpen(true); }}>
                    <span className="text-xs text-zinc-500 mr-1">Dng</span>{wmDanger}
                  </span>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Click to edit WM Danger</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </EditPopover>
        </Row>
      </div>

      <WarpFieldModal
        isOpen={isWarpModalOpen}
        onClose={() => setIsWarpModalOpen(false)}
        onSubmit={(fieldId, destination) => {
          if (fieldId !== null) ff7.warpToFieldId(fieldId, destination);
          setIsWarpModalOpen(false);
        }}
        ff7={ff7}
      />
    </>
  );
}

// ─── Battle: Allies + Enemies ─────────────────────────────────────────────────

function BattleSection({ ff7 }: { ff7: FF7 }) {
  const state = ff7.gameState;
  const [editValue, setEditValue] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [currentAllyEditing, setCurrentAllyEditing] = useState<number | null>(null);
  const [editStatusModalOpen, setEditStatusModalOpen] = useState(false);
  const [isEnemyInfoModalOpen, setIsEnemyInfoModalOpen] = useState(false);
  const [enemyData, setEnemyData] = useState<EnemyData | null>(null);
  const [enemyName, setEnemyName] = useState<string>("");

  const enemies = (() => {
    const all = state.battleEnemies
      .filter(e => e.scene_id !== 255)
      .map(e => ({ ...e, name: e.name.trim() === "" ? "<Unnamed>" : e.name }))
      .sort((a, b) => a.scene_id - b.scene_id);
    return state.currentModule === GameModule.Battle ? all : all.slice(0, 1);
  })();

  const actors = currentAllyEditing !== null && currentAllyEditing > 3 ? state.battleEnemies : state.battleAllies;
  const actorIdx = currentAllyEditing !== null && currentAllyEditing > 3 ? currentAllyEditing - 4 : currentAllyEditing;

  const parseEnemyName = (enemy: BattleCharObj) => {
    const same = enemies.filter(e => e.name === enemy.name);
    return same.length === 1 ? enemy.name : enemy.name + " " + String.fromCharCode(65 + same.indexOf(enemy));
  };

  const openEditPopover = (title: string, value: string, allyIndex: number) => {
    setEditValue(value);
    setEditTitle(title);
    setCurrentAllyEditing(allyIndex);
    setPopoverOpen(true);
  };

  const submitValue = () => {
    if (currentAllyEditing !== null) {
      if (editTitle === "HP") ff7.setHP(parseInt(editValue), currentAllyEditing);
      else if (editTitle === "MP") ff7.setMP(parseInt(editValue), currentAllyEditing);
      else if (editTitle === "Max HP") ff7.setMaxHP(parseInt(editValue), currentAllyEditing);
      else if (editTitle === "Max MP") ff7.setMaxMP(parseInt(editValue), currentAllyEditing);
    }
    setPopoverOpen(false);
  };

  const killCharacter = (index: number) => {
    ff7.setStatus(statuses.Dead, index);
    ff7.setHP(0, index);
  };

  const showEnemyInfoModal = async (sceneId: number, name: string) => {
    const data = await ff7.readEnemyData(sceneId);
    setEnemyData(data);
    setEnemyName(name);
    setIsEnemyInfoModalOpen(true);
  };

  const StatCell = ({ char, index, field, label }: { char: BattleCharObj; index: number; field: "HP" | "MP" | "Max HP" | "Max MP"; label: keyof BattleCharObj }) => (
    <EditPopover
      open={popoverOpen && currentAllyEditing === index && editTitle === field}
      onOpenChange={setPopoverOpen}
      value={editValue}
      onValueChange={setEditValue}
      onSubmit={submitValue}
    >
      <TooltipProvider>
        <Tooltip delayDuration={250}>
          <TooltipTrigger asChild>
            <span className="cursor-pointer hover:bg-zinc-700 px-1" onClick={() => openEditPopover(field, (char[label] as number).toString(), index)}>
              {char[label] as number}
            </span>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">Click to edit {field.toLowerCase()}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </EditPopover>
  );

  return (
    <>
      <table className="w-full">
        <thead className="bg-zinc-800 text-xs text-left">
          <tr>
            <th className="p-2 pb-1 w-[130px]">Name</th>
            <th className="p-1 px-2 w-[100px]">HP</th>
            <th className="p-1 px-2 w-[66px]">MP</th>
            <th className="p-1">Status</th>
            <th className="px-1 w-7">&nbsp;</th>
          </tr>
        </thead>
        <tbody className={state.currentModule === GameModule.Battle ? "" : "!text-zinc-400"}>
          {enemies.map((char, index) => (
            <tr key={index} className="bg-zinc-800 text-xs group">
              <td className="p-1 pl-2 text-nowrap w-[130px] font-bold cursor-pointer group-last:pb-2 hover:bg-zinc-700" onClick={() => showEnemyInfoModal(char.scene_id, char.name)}>
                <TooltipProvider>
                  <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                      <div>{parseEnemyName(char)}</div>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Click to show info & stats</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="w-full h-0 relative top-[-10px]">
                  <progress className="progress w-full h-[2px] [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-bar]:bg-gray-700 [&::-webkit-progress-value]:bg-gray-200" value={(char.atb / 0xFFFF) * 100} max="100" />
                </div>
              </td>
              <td className="p-1 px-2 text-nowrap w-[100px]">
                <div className="flex gap-1">
                  <StatCell char={char} index={char.index} field="HP" label="hp" />
                  <span>/</span>
                  <StatCell char={char} index={char.index} field="Max HP" label="max_hp" />
                </div>
              </td>
              <td className="p-1 px-2 text-nowrap w-[66px]">
                <div className="flex gap-1">
                  <StatCell char={char} index={char.index} field="MP" label="mp" />
                  <span>/</span>
                  <StatCell char={char} index={char.index} field="Max MP" label="max_mp" />
                </div>
              </td>
              <td className="p-1 cursor-pointer whitespace-pre hover:bg-zinc-700" onClick={() => { setCurrentAllyEditing(index + 4); setEditStatusModalOpen(true); }}>
                {formatStatus(char.status, char.flags) || <span className="text-zinc-400">[None]</span>}
              </td>
              <td className="cursor-pointer">
                <TooltipProvider>
                  <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer" onClick={(e) => { killCharacter(char.index); e.stopPropagation(); }}>💀</span>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Kill enemy</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Status edit modal */}
      <Modal open={editStatusModalOpen} setIsOpen={setEditStatusModalOpen} title="Edit status effects" callback={() => setEditStatusModalOpen(false)}>
        <div className="grid grid-cols-4 gap-1">
          {Object.keys(statuses).map((status) => {
            if (currentAllyEditing === null) return null;
            const statusId = statuses[status as keyof typeof statuses];
            if ([statuses.DualDrain, statuses.Imprisoned].includes(statusId)) return null;
            const currentStatus = actorIdx !== null ? actors[actorIdx].status : 0;
            return (
              <div key={status} className="h-8 flex items-center justify-center">
                <Button size="sm" variant={(currentStatus & statusId) ? "default" : "outline"} className="w-full" onClick={() => ff7.toggleStatus(statusId, currentAllyEditing || 0)}>
                  {status}
                </Button>
              </div>
            );
          })}
        </div>
        <h3 className="font-bold text-lg mb-2 mt-3">Flags</h3>
        <div className="grid grid-cols-2 gap-1 mb-2">
          {['Physical Immunity', 'Magical Immunity'].map((flag, flagIdx) => {
            if (currentAllyEditing === null) return null;
            const currentFlags = actorIdx !== null ? actors[actorIdx].flags : 0;
            return (
              <div key={flag} className="h-8 flex items-center justify-center">
                <Button size="sm" variant={(currentFlags & (flagIdx + 1)) ? "default" : "outline"} className="w-full" onClick={() => ff7.toggleFlags(flagIdx + 1, currentAllyEditing || 0)}>
                  {flag}
                </Button>
              </div>
            );
          })}
        </div>
      </Modal>

      <EnemyInfoModal open={isEnemyInfoModalOpen} setIsOpen={setIsEnemyInfoModalOpen} enemyData={enemyData} enemyName={enemyName} />
    </>
  );
}

// ─── Main Speedrun component ──────────────────────────────────────────────────

export function Speedrun({ ff7, stepgraphWindow, setStepgraphWindow, setStepgraphWebview }: { ff7: FF7; stepgraphWindow: Window | null; setStepgraphWindow: (w: Window | null) => void; stepgraphWebview: Webview | null; setStepgraphWebview: (w: Webview | null) => void }) {
  const { generalSettings, updateGeneralSettings } = useSettings();

  const showSaveStates = generalSettings?.showSaveStates ?? true;
  const showStepgraph = generalSettings?.showStepgraph ?? true;
  const showBattle = generalSettings?.showBattle ?? true;

  const toggleSaveStates = () => {
    if (!generalSettings) return;

    updateGeneralSettings({
      ...generalSettings,
      showSaveStates: !showSaveStates,
    });
  };

  const toggleStepgraph = () => {
    if (!generalSettings) return;

    updateGeneralSettings({
      ...generalSettings,
      showStepgraph: !showStepgraph,
    });
  };

  const toggleBattle = () => {
    if (!generalSettings) return;

    updateGeneralSettings({
      ...generalSettings,
      showBattle: !showBattle,
    });
  };

  const handleOpenStepgraph = async () => {
    if (stepgraphWindow) {
      await stepgraphWindow.setFocus();
      return;
    }

    const appWindow = new Window('stepgraph', {
      parent: Window.getCurrent(),
      title: 'Ultima - Step Graph',
      theme: 'dark',
      resizable: true,
      visible: false,
      center: true,
      width: 820,
      height: 540,
      backgroundColor: '#111212',
    });

    appWindow.once('tauri://created', () => {
      const webview = new Webview(appWindow, 'stepgraph', {
        url: 'index.html?standalone=stepgraph',
        x: 0,
        y: 0,
        width: 820,
        height: 540,
        focus: true,
        backgroundColor: '#111212',
      });

      const resize = async () => {
        const size = await appWindow.innerSize();
        await webview.setSize(size);
      };

      webview.once('tauri://created', () => {
        resize();
        appWindow.show();
      });

      appWindow.listen('tauri://resize', resize);
      resize();

      setStepgraphWindow(appWindow);
      setStepgraphWebview(webview);

      appWindow.onCloseRequested(() => {
        setStepgraphWindow(null);
        setStepgraphWebview(null);
      });
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 pb-2">
        <GeneralSection ff7={ff7} />
        <div className="mt-2">
          <FieldSection ff7={ff7} />
        </div>
        <div className="mt-2 border-t border-zinc-600">
          {/* CLICKABLE HEADER */}
          <div
            className="flex items-center justify-between px-2 py-1 cursor-pointer select-none text-xs uppercase text-zinc-400 hover:text-zinc-200"
            onClick={toggleBattle}
          >
            <span><h2 className="uppercase font-medium text-sm tracking-wide text-zinc-900 dark:text-zinc-100">
              Battle
            </h2></span>
            <span className="text-[10px]">
              {showBattle ? "▼" : "▶"}
            </span>
          </div>

          {/* COLLAPSIBLE CONTENT */}
          <div
            className={`overflow-hidden transition-all duration-200 ${
              showBattle
                ? "max-h-[500px] opacity-100"
                : "max-h-0 opacity-0"
            }`}
          >
            <BattleSection ff7={ff7} />
          </div>
        </div>
        <div className="mt-2 border-t border-zinc-600">
          {/* CLICKABLE HEADER */}
          <div
            className="flex items-center justify-between px-2 py-1 cursor-pointer select-none text-xs uppercase text-zinc-400 hover:text-zinc-200"
            onClick={toggleStepgraph}
          >
            <span><h2 className="uppercase font-medium text-sm tracking-wide text-zinc-900 dark:text-zinc-100">
              Step Graph
            </h2></span>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="xs"
                onClick={(e) => { e.stopPropagation(); handleOpenStepgraph(); }}
              >
                {stepgraphWindow ? "Focus Window" : "Open in Window"}
              </Button>
              <span className="text-[10px]">
                {showStepgraph ? "▼" : "▶"}
              </span>
            </div>
          </div>

          {/* COLLAPSIBLE CONTENT */}
          <div
            className={`overflow-hidden transition-all duration-200 ${
              showStepgraph
                ? "max-h-[500px] opacity-100"
                : "max-h-0 opacity-0"
            }`}
          >
            <div className="h-[500px]">
              <Stepgraph ff7={ff7} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col border-t border-zinc-600">
        {/* CLICKABLE HEADER */}
        <div
          className="flex items-center justify-between px-2 py-1 cursor-pointer select-none text-xs uppercase text-zinc-400 hover:text-zinc-200"
          onClick={toggleSaveStates}
        >
          <span><h2 className="uppercase font-medium text-sm tracking-wide text-zinc-900 dark:text-zinc-100">
              Save States
            </h2></span>
          <span className="text-[10px]">
            {showSaveStates ? "▼" : "▶"}
          </span>
        </div>

        {/* COLLAPSIBLE CONTENT */}
        <div
          className={`transition-all duration-200 ${
            showSaveStates
              ? "flex-1 min-h-0 flex flex-col opacity-100"
              : "max-h-0 overflow-hidden opacity-0"
          }`}
        >
          <div className="flex-1 min-h-0 pt-1">
            <SaveStates ff7={ff7} />
          </div>
        </div>
      </div>
    </div>
  );
}