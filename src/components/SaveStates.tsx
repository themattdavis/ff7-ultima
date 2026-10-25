import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditPopover } from "@/components/EditPopover";
import { CategoryPopover } from "@/components/CategoryPopover";
import { SaveState } from "@/useSaveStates";
import { setSaveStateIndex } from "@/shortcuts";
import { WorldSaveState } from "@/useSettings";
import { FF7 } from "@/useFF7";
import { useSettings } from "@/useSettings";
import { useState, useRef, useMemo, useEffect } from "react";
import { DndContext, DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from '@tauri-apps/plugin-opener';

interface SaveStatesProps {
  ff7: FF7;
}

const WORLD_MAP_NAMES: Record<number, string> = {
  0: "World Map",
  1: "Icicle Area",
  2: "Inside Crater",
  3: "Underwater",
};

function isWorldState(state: SaveState | WorldSaveState): state is WorldSaveState {
  return 'worldX' in state;
}

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
}

// ─── Field state row ──────────────────────────────────────────────────────────

interface FieldRowProps {
  state: SaveState;
  onLoad: () => void;
  onTitleChange: (title: string) => void;
  titleEditOpen: boolean;
  titleEditValue: string;
  onTitleEditOpenChange: (open: boolean) => void;
  onTitleEditValueChange: (value: string) => void;
  onCategoryChange: (category: string) => void;
  categoryEditOpen: boolean;
  categoryEditValue: string;
  onCategoryEditOpenChange: (open: boolean) => void;
  onCategoryEditValueChange: (value: string) => void;
  existingCategories: string[];
  isSelected: boolean;
  onSelectChange: (checked: boolean, event?: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

function FieldRow({
  state, onLoad, onTitleChange, titleEditOpen, titleEditValue,
  onTitleEditOpenChange, onTitleEditValueChange, onCategoryChange,
  categoryEditOpen, categoryEditValue, onCategoryEditOpenChange,
  onCategoryEditValueChange, existingCategories, isSelected, onSelectChange,
  onContextMenu,
}: FieldRowProps) {
  const wasShiftClick = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: state.id });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, cursor: 'move' }}
      className="bg-zinc-800/50 text-xs hover:bg-zinc-800"
      onContextMenu={(event) => { event.preventDefault(); onContextMenu(event); }}
      {...attributes} {...listeners}
    >
      <td className="p-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => {
            if (!wasShiftClick.current) onSelectChange(checked as boolean);
            wasShiftClick.current = false;
          }}
          onClick={(event) => {
            event.stopPropagation();
            wasShiftClick.current = event.shiftKey;
            onSelectChange(!isSelected, event);
          }}
        />
      </td>
      <td className="p-1 w-40">
        <EditPopover open={titleEditOpen} onOpenChange={onTitleEditOpenChange} value={titleEditValue} onValueChange={onTitleEditValueChange} onSubmit={() => onTitleChange(titleEditValue)}>
          <div className="cursor-pointer">
            {state.title ? <span>{state.title}</span> : <span className="text-zinc-400">{formatTimestamp(state.timestamp)}</span>}
          </div>
        </EditPopover>
      </td>
      <td className="p-1 w-32">
        <CategoryPopover open={categoryEditOpen} onOpenChange={onCategoryEditOpenChange} value={categoryEditValue} onValueChange={onCategoryEditValueChange} onSubmit={onCategoryChange} existingCategories={existingCategories}>
          <div className="cursor-pointer">
            {state.category ? <span>{state.category}</span> : <span className="text-zinc-400">Uncategorized</span>}
          </div>
        </CategoryPopover>
      </td>
      <td className="p-1">
        {state.fieldId}
        <span className="text-zinc-400 ml-1">({state.fieldName})</span>
      </td>
      <td className="p-1 text-right">
        <Button size="xs" variant="secondary" onClick={onLoad}>Load</Button>
      </td>
    </tr>
  );
}

// ─── World state row ──────────────────────────────────────────────────────────

interface WorldRowProps {
  state: WorldSaveState;
  onLoad: () => void;
  onDelete: () => void;
  onTitleChange: (title: string) => void;
  titleEditOpen: boolean;
  titleEditValue: string;
  onTitleEditOpenChange: (open: boolean) => void;
  onTitleEditValueChange: (value: string) => void;
  onCategoryChange: (category: string) => void;
  categoryEditOpen: boolean;
  categoryEditValue: string;
  onCategoryEditOpenChange: (open: boolean) => void;
  onCategoryEditValueChange: (value: string) => void;
  existingCategories: string[];
  isSelected: boolean;
  onSelectChange: (checked: boolean, event?: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

function WorldRow({
  state, onLoad, onDelete, onTitleChange, titleEditOpen, titleEditValue,
  onTitleEditOpenChange, onTitleEditValueChange, onCategoryChange,
  categoryEditOpen, categoryEditValue, onCategoryEditOpenChange,
  onCategoryEditValueChange, existingCategories, isSelected, onSelectChange,
  onContextMenu,
}: WorldRowProps) {
  const wasShiftClick = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: state.id });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, cursor: 'move' }}
      className="bg-zinc-800/50 text-xs hover:bg-zinc-800"
      onContextMenu={(event) => { event.preventDefault(); onContextMenu(event); }}
      {...attributes} {...listeners}
    >
      <td className="p-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => {
            if (!wasShiftClick.current) onSelectChange(checked as boolean);
            wasShiftClick.current = false;
          }}
          onClick={(event) => {
            event.stopPropagation();
            wasShiftClick.current = event.shiftKey;
            onSelectChange(!isSelected, event);
          }}
        />
      </td>
      <td className="p-1 w-40">
        <EditPopover open={titleEditOpen} onOpenChange={onTitleEditOpenChange} value={titleEditValue} onValueChange={onTitleEditValueChange} onSubmit={() => onTitleChange(titleEditValue)}>
          <div className="cursor-pointer">
            {state.title ? <span>{state.title}</span> : <span className="text-zinc-400">{formatTimestamp(state.timestamp)}</span>}
          </div>
        </EditPopover>
      </td>
      <td className="p-1 w-32">
        <CategoryPopover open={categoryEditOpen} onOpenChange={onCategoryEditOpenChange} value={categoryEditValue} onValueChange={onCategoryEditValueChange} onSubmit={onCategoryChange} existingCategories={existingCategories}>
          <div className="cursor-pointer">
            {state.category ? <span>{state.category}</span> : <span className="text-zinc-400">Uncategorized</span>}
          </div>
        </CategoryPopover>
      </td>
      <td className="p-1 text-zinc-400">
        🌍 {WORLD_MAP_NAMES[state.worldMapType] ?? "World Map"}
      </td>
      <td className="p-1 text-right space-x-1">
        <Button size="xs" variant="secondary" onClick={onLoad}>Load</Button>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SaveStates({ ff7 }: SaveStatesProps) {
  const { generalSettings, updateGeneralSettings } = useSettings();

  const [titleEditOpen, setTitleEditOpen] = useState(false);
  const [titleEditStateId, setTitleEditStateId] = useState<string | null>(null);
  const [titleEditValue, setTitleEditValue] = useState("");

  const [categoryEditOpen, setCategoryEditOpen] = useState(false);
  const [categoryEditStateId, setCategoryEditStateId] = useState<string | null>(null);
  const [categoryEditValue, setCategoryEditValue] = useState("");

  const [worldTitleEditOpen, setWorldTitleEditOpen] = useState(false);
  const [worldTitleEditStateId, setWorldTitleEditStateId] = useState<string | null>(null);
  const [worldTitleEditValue, setWorldTitleEditValue] = useState("");

  const [worldCategoryEditOpen, setWorldCategoryEditOpen] = useState(false);
  const [worldCategoryEditStateId, setWorldCategoryEditStateId] = useState<string | null>(null);
  const [worldCategoryEditValue, setWorldCategoryEditValue] = useState("");

  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; state: SaveState | WorldSaveState } | null>(null);

  const [newStateOpen, setNewStateOpen] = useState(false);
  const [newStateTitle, setNewStateTitle] = useState("");
  const [newStateCategory, setNewStateCategory] = useState("");

  const handleNewStateOpenChange = (open: boolean) => {
    setNewStateOpen(open);
    if (open) {
      setNewStateTitle("");
      setNewStateCategory("");
      ff7.pauseShortcuts();
    } else {
      ff7.resumeShortcuts();
    }
  };

  const handleCreateState = () => {
    ff7.saveState(newStateTitle.trim() || undefined, newStateCategory.trim() || undefined);
    handleNewStateOpenChange(false);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const handleOverwriteState = async (state: SaveState | WorldSaveState) => {
    setContextMenu(null);
    if (!ff7.connected) return;
    if (isWorldState(state)) {
      await ff7.overwriteWorldState(state.id);
    } else {
      await ff7.overwriteFieldState(state.id);
    }
  };

  const handleDeleteState = (state: SaveState | WorldSaveState) => {
    setContextMenu(null);
    if (isWorldState(state)) {
      ff7.saveStates.removeWorldState(state.id);
    } else {
      ff7.saveStates.removeFieldState(state.id);
    }
  };

  // displayOrder and setDisplayOrder come from the shared jotai atom via ff7.saveStates.
  // This means shortcuts.ts reads the same order, so navigation always respects drag reordering.
  const displayOrder = ff7.saveStates.displayOrder;
  const setDisplayOrder = ff7.saveStates.setDisplayOrder;

  const selectedCategoryFilter = generalSettings?.selectedCategoryFilter || "all";

  const handleCategoryFilterChange = (value: string) => {
    if (generalSettings) updateGeneralSettings({ ...generalSettings, selectedCategoryFilter: value });
    setSaveStateIndex(-1);
  };

  const getExistingCategories = (): string[] =>
    [...allFieldStates, ...allWorldStates]
      .map(s => s.category)
      .filter((c): c is string => Boolean(c && c.trim()))
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .sort();

  const allFieldStates = ff7.saveStates.fieldStates;
  const allWorldStates: WorldSaveState[] = ff7.saveStates.worldStates || [];

  const filteredFieldStates = useMemo(() => {
    if (selectedCategoryFilter === "all") return ff7.saveStates.fieldStates;
    if (selectedCategoryFilter === "uncategorized") return ff7.saveStates.fieldStates.filter(s => !s.category || s.category.trim() === "");
    return ff7.saveStates.fieldStates.filter(s => s.category === selectedCategoryFilter);
  }, [ff7.saveStates.fieldStates, selectedCategoryFilter]);

  const worldStates: WorldSaveState[] = useMemo(() => {
    if (selectedCategoryFilter === "all") return allWorldStates;
    if (selectedCategoryFilter === "uncategorized") return allWorldStates.filter(s => !s.category || s.category.trim() === "");
    return allWorldStates.filter(s => s.category === selectedCategoryFilter);
  }, [allWorldStates, selectedCategoryFilter]);

  // Stable string keys — only change when IDs are actually added/removed, not on polling re-renders
  const fieldIdKey = allFieldStates.map(s => s.id).join(',');
  const worldIdKey = allWorldStates.map(s => s.id).join(',');

  useEffect(() => {
    const allCurrent = [...allFieldStates, ...allWorldStates]
      .sort((a, b) => a.timestamp - b.timestamp);
    const currentIdSet = new Set(allCurrent.map(s => s.id));

    setDisplayOrder((prev: string[]) => {
      const kept = prev.filter((id: string) => currentIdSet.has(id));
      const keptSet = new Set(kept);
      const newIds = allCurrent.map(s => s.id).filter(id => !keptSet.has(id));
      if (kept.length === prev.length && newIds.length === 0) return prev;
      return [...kept, ...newIds];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldIdKey, worldIdKey]);

  // Flat lookup for rendering
  const stateMap = useMemo(() => {
    const map = new Map<string, SaveState | WorldSaveState>();
    filteredFieldStates.forEach(s => map.set(s.id, s));
    worldStates.forEach(s => map.set(s.id, s));
    return map;
  }, [filteredFieldStates, worldStates]);

  const allStates = useMemo(
    () => displayOrder.map((id: string) => stateMap.get(id)).filter((s): s is SaveState | WorldSaveState => s !== undefined),
    [displayOrder, stateMap]
  );

  const handleSelectAll = (checked: boolean) => {
    setSelectedStates(checked ? new Set(allStates.map((s: SaveState | WorldSaveState) => s.id)) : new Set());
    setLastSelectedIndex(null);
  };

  const handleSelectState = (stateId: string, checked: boolean, event?: React.MouseEvent) => {
    const newSelected = new Set(selectedStates);
    const currentIndex = allStates.findIndex((s: SaveState | WorldSaveState) => s.id === stateId);

    if (event?.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, currentIndex);
      const end = Math.max(lastSelectedIndex, currentIndex);
      const isTargetSelected = selectedStates.has(allStates[currentIndex].id);
      for (let i = start; i <= end; i++) {
        isTargetSelected ? newSelected.delete(allStates[i].id) : newSelected.add(allStates[i].id);
      }
    } else {
      checked ? newSelected.add(stateId) : newSelected.delete(stateId);
    }

    setSelectedStates(newSelected);
    setLastSelectedIndex(currentIndex);
  };

  const handleBulkDelete = async () => {
    const confirmed = await confirm(`Are you sure you want to delete ${selectedStates.size} save state(s)?`, {
      title: 'Delete Save States', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel',
    });
    if (confirmed) {
      const fieldIds = Array.from(selectedStates).filter(id => ff7.saveStates.fieldStates.some(s => s.id === id));
      const worldIds = Array.from(selectedStates).filter(id => worldStates.some(s => s.id === id));
      ff7.saveStates.removeStates(fieldIds, worldIds);
      setSelectedStates(new Set());
    }
  };

  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

  const handleBulkChangeCategory = (category: string) => {
    const trimmed = category.trim();
    const fieldIds = Array.from(selectedStates).filter(id => ff7.saveStates.fieldStates.some(s => s.id === id));
    const worldIds = Array.from(selectedStates).filter(id => allWorldStates.some(s => s.id === id));
    if (fieldIds.length > 0) ff7.saveStates.updateFieldStateCategoriesBulk(fieldIds, trimmed);
    if (worldIds.length > 0) ff7.saveStates.updateWorldStateCategoriesBulk(worldIds, trimmed);
    setSelectedStates(new Set());
    setBulkCategoryOpen(false);
    setBulkCategoryValue("");
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setDisplayOrder((prev: string[]) => {
      const oldIndex = prev.indexOf(active.id.toString());
      const newIndex = prev.indexOf(over.id.toString());
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleExportStates = async () => {
    try {
      const selected = await save({
        filters: [{ name: "Ultima FF7 State Files", extensions: ["ff7states"] }],
        defaultPath: `${new Date().toISOString().split('T')[0]}`,
      });
      if (!selected) return;
      const exportData = ff7.saveStates.exportStates();
      await writeFile(selected, new TextEncoder().encode(JSON.stringify(exportData, null, 2)));
      await revealItemInDir(selected);
    } catch (error) {
      alert("Error exporting states: " + error);
    }
  };

  const handleExportSelectedStates = async () => {
    try {
      const selected = await save({
        filters: [{ name: "Ultima FF7 State Files", extensions: ["ff7states"] }],
        defaultPath: `${new Date().toISOString().split('T')[0]}-selected`,
      });
      if (!selected) return;
      const exportData = ff7.saveStates.exportStates();
      const filteredExport = {
        fieldStates: exportData.fieldStates.filter((s: any) => selectedStates.has(s.id)),
        snowboardStates: exportData.snowboardStates.filter((s: any) => selectedStates.has(s.id)),
        worldStates: exportData.worldStates.filter((s: any) => selectedStates.has(s.id)),
        displayOrder: exportData.displayOrder?.filter((id: string) => selectedStates.has(id)),
      };
      await writeFile(selected, new TextEncoder().encode(JSON.stringify(filteredExport, null, 2)));
      await revealItemInDir(selected);
    } catch (error) {
      alert("Error exporting selected states: " + error);
    }
  };

  const handleImportStates = async () => {
    try {
      const selected = await open({
        filters: [{ name: "Ultima FF7 State Files", extensions: ["ff7states"] }],
        multiple: false,
      });
      if (!selected || typeof selected !== "string") return;
      const json = new TextDecoder().decode(await readFile(selected));
      const parsed = JSON.parse(json);

      const hasExisting = allFieldStates.length > 0 || allWorldStates.length > 0;
      let replace = false;
      if (hasExisting) {
        replace = await confirm(
          "Replace your current save states with the imported ones, or merge them in?",
          { title: "Import Save States", okLabel: "Replace", cancelLabel: "Merge" }
        );
      }

      ff7.saveStates.importStates(parsed, replace);
    } catch (error) {
      alert("Error importing states: " + JSON.stringify(error));
    }
  };

  const isEmpty = allStates.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            
            <Select value={selectedCategoryFilter} onValueChange={handleCategoryFilterChange}>
              <SelectTrigger className="w-auto h-6 text-xs">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="uncategorized">Uncategorized</SelectItem>
                {getExistingCategories().map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2">
            {selectedStates.size > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="xs">Bulk Actions ({selectedStates.size})</Button>
                </PopoverTrigger>
                <PopoverContent className="w-48">
                  <div className="flex flex-col space-y-1">
                    <Button variant="ghost" size="sm" className="justify-start" onClick={handleBulkDelete}>Delete Selected</Button>
                    <Button variant="ghost" size="sm" className="justify-start" onClick={handleExportSelectedStates}>Export Selected</Button>
                    <Popover open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="justify-start">Change Category</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" side="right" align="start">
                        <div className="flex flex-col space-y-2">
                          <p className="text-xs text-zinc-400 font-medium">Select or type a category</p>
                          {getExistingCategories().length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {getExistingCategories().map(cat => (
                                <button
                                  key={cat}
                                  className="text-xs px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                                  onClick={() => handleBulkChangeCategory(cat)}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-1">
                            <input
                              className="flex-1 text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-100 outline-none focus:border-zinc-400"
                              placeholder="New category..."
                              value={bulkCategoryValue}
                              onChange={e => setBulkCategoryValue(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && bulkCategoryValue.trim()) handleBulkChangeCategory(bulkCategoryValue); }}
                              autoFocus
                            />
                            <Button size="xs" onClick={() => handleBulkChangeCategory(bulkCategoryValue)} disabled={!bulkCategoryValue.trim()}>
                              Apply
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="link" size="xs" onClick={handleImportStates}>Import states</Button>
            <Button variant="link" size="xs" onClick={handleExportStates}>Export states</Button>
            <Popover open={newStateOpen} onOpenChange={handleNewStateOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  disabled={!ff7.connected}
                  className="cursor-pointer"
                  size="xs"
                >
                  New State
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="end">
                <div className="flex flex-col space-y-2">
                  <div>
                    <label className="text-xs text-zinc-400 font-medium">Title (optional)</label>
                    <input
                      className="w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-100 outline-none focus:border-zinc-400 mt-1"
                      placeholder="e.g. Before Midgar boss"
                      value={newStateTitle}
                      onChange={e => setNewStateTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleCreateState(); }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 font-medium">Category (optional)</label>
                    <input
                      className="w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-100 outline-none focus:border-zinc-400 mt-1"
                      placeholder="e.g. Boss prep"
                      value={newStateCategory}
                      onChange={e => setNewStateCategory(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleCreateState(); }}
                    />
                    {getExistingCategories().length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {getExistingCategories().map(cat => (
                          <button
                            key={cat}
                            type="button"
                            className="text-xs px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                            onClick={() => setNewStateCategory(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end space-x-1 pt-1">
                    <Button size="xs" variant="ghost" onClick={() => handleNewStateOpenChange(false)}>Cancel</Button>
                    <Button size="xs" onClick={handleCreateState}>Create</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="border-b border-zinc-600 -mt-1" />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden mt-1">
        {isEmpty ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-xs text-zinc-400 text-center">
              {ff7.saveStates.fieldStates.length === 0 && worldStates.length === 0
                ? "No save states found"
                : `No save states found for category "${selectedCategoryFilter === "uncategorized" ? "Uncategorized" : selectedCategoryFilter}"`
              }
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-zinc-800 text-xs text-left sticky top-0">
              <tr>
                <th className="p-1">
                  <Checkbox
                    checked={allStates.length > 0 && selectedStates.size === allStates.length}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                <th className="p-1">Title</th>
                <th className="p-1">Category</th>
                <th className="p-1">Location</th>
                <th className="p-1 text-right">&nbsp;</th>
              </tr>
            </thead>
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <tbody>
                <SortableContext items={displayOrder} strategy={verticalListSortingStrategy}>
                  {allStates.map((state: SaveState | WorldSaveState) => {
                    if (isWorldState(state)) {
                      return (
                        <WorldRow
                          key={state.id}
                          state={state}
                          onLoad={() => {
                            const idx = allStates.findIndex((s: SaveState | WorldSaveState) => s.id === state.id);
                            if (idx !== -1) setSaveStateIndex(idx);
                            ff7.loadState(state.id);
                          }}
                          onDelete={async () => {
                            const confirmed = await confirm("Delete this world map save state?", {
                              title: 'Delete Save State', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel',
                            });
                            if (confirmed) ff7.saveStates.removeWorldState(state.id);
                          }}
                          onTitleChange={(title) => {
                            ff7.saveStates.updateWorldStateTitle(state.id, title);
                            setWorldTitleEditOpen(false);
                          }}
                          titleEditOpen={worldTitleEditOpen && worldTitleEditStateId === state.id}
                          titleEditValue={worldTitleEditValue}
                          onTitleEditOpenChange={(open) => {
                            setWorldTitleEditOpen(open);
                            if (open) {
                              setWorldTitleEditStateId(state.id);
                              setWorldTitleEditValue(state.title || "");
                            }
                          }}
                          onTitleEditValueChange={setWorldTitleEditValue}
                          onCategoryChange={(category) => {
                            ff7.saveStates.updateWorldStateCategory(state.id, category);
                            setWorldCategoryEditOpen(false);
                          }}
                          categoryEditOpen={worldCategoryEditOpen && worldCategoryEditStateId === state.id}
                          categoryEditValue={worldCategoryEditValue}
                          onCategoryEditOpenChange={(open) => {
                            setWorldCategoryEditOpen(open);
                            if (open) {
                              setWorldCategoryEditStateId(state.id);
                              setWorldCategoryEditValue(state.category || "");
                            }
                          }}
                          onCategoryEditValueChange={setWorldCategoryEditValue}
                          existingCategories={getExistingCategories()}
                          isSelected={selectedStates.has(state.id)}
                          onSelectChange={(checked, event) => handleSelectState(state.id, checked as boolean, event)}
                          onContextMenu={(event) => setContextMenu({ x: event.clientX, y: event.clientY, state })}
                        />
                      );
                    }

                    return (
                      <FieldRow
                        key={state.id}
                        state={state}
                        onLoad={() => {
                          const idx = allStates.findIndex((s: SaveState | WorldSaveState) => s.id === state.id);
                          if (idx !== -1) setSaveStateIndex(idx);
                          ff7.loadState(state.id);
                        }}
                        onTitleChange={(title) => {
                          ff7.saveStates.updateFieldStateTitle(state.id, title);
                          setTitleEditOpen(false);
                        }}
                        titleEditOpen={titleEditOpen && titleEditStateId === state.id}
                        titleEditValue={titleEditValue}
                        onTitleEditOpenChange={(open) => {
                          setTitleEditOpen(open);
                          if (open) {
                            setTitleEditStateId(state.id);
                            setTitleEditValue(state.title || "");
                          }
                        }}
                        onTitleEditValueChange={setTitleEditValue}
                        onCategoryChange={(category) => {
                          ff7.saveStates.updateFieldStateCategory(state.id, category);
                          setCategoryEditOpen(false);
                        }}
                        categoryEditOpen={categoryEditOpen && categoryEditStateId === state.id}
                        categoryEditValue={categoryEditValue}
                        onCategoryEditOpenChange={(open) => {
                          setCategoryEditOpen(open);
                          if (open) {
                            setCategoryEditStateId(state.id);
                            setCategoryEditValue(state.category || "");
                          }
                        }}
                        onCategoryEditValueChange={setCategoryEditValue}
                        existingCategories={getExistingCategories()}
                        isSelected={selectedStates.has(state.id)}
                        onSelectChange={(checked, event) => handleSelectState(state.id, checked as boolean, event)}
                        onContextMenu={(event) => setContextMenu({ x: event.clientX, y: event.clientY, state })}
                      />
                    );
                  })}
                </SortableContext>
              </tbody>
            </DndContext>
          </table>
        )}
      </div>

      <div className="flex-shrink-0 pt-2">
        <div className="text-xs text-zinc-400 text-center">Click on title or category to edit • Drag rows to reorder • Right-click for more options</div>
      </div>

      {contextMenu && (
        <div
          className="fixed bg-zinc-800 border border-zinc-600 rounded shadow-lg py-1 text-xs min-w-44 z-50"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            disabled={!ff7.connected}
            title={!ff7.connected ? "Connect to the game first" : undefined}
            onClick={() => handleOverwriteState(contextMenu.state)}
          >
            Overwrite with current state
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400"
            onClick={() => handleDeleteState(contextMenu.state)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
