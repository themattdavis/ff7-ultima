"use strict";

import { useEffect, useState } from "react";
import { FF7, useFF7 } from "./useFF7";
import { useFF7Context } from "./FF7Context";
import { Window } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator } from "./components/ui/sidebar";
import { StatusBar } from "./components/StatusBar";
import { Hacks } from "./Hacks";
import { Tabs } from "./types";
import { QuickActions } from "./QuickActions";
import { General } from "./modules/General";
import { Field } from "./modules/Field";
import { World } from "./modules/World";
import { Battle } from "./modules/Battle";
import { Party } from "./modules/Party";
import { Chocobos } from "./modules/Chocobos";
import { Variables } from "./modules/Variables";
import { SaveStatesModule } from "./modules/SaveStates";
import { Speedrun } from "./modules/Speedrun";
import { Stepgraph } from "./modules/Stepgraph";
import { BarChart2 } from "lucide-react";
import { useShortcuts } from './useShortcuts';
import { ChocoboHead } from "./components/icons/ChocoboHead";
import { BinaryGrid } from "./components/icons/BinaryGrid";
import { BusterSword } from "./components/icons/BusterSword";
import { CloudParty } from "./components/icons/CloudParty";
import { 
  Settings2, 
  Map as MapIcon, 
  Globe, 
  Save, 
  Timer,
  LucideIcon 
} from "lucide-react";

const TAB_TITLES: Record<Tabs, string> = {
  [Tabs.General]: "General",
  [Tabs.Field]: "Field",
  [Tabs.World]: "World",
  [Tabs.Battle]: "Battle",
  [Tabs.Party]: "Party",
  [Tabs.Chocobos]: "Chocobos",
  [Tabs.Variables]: "Variables",
  [Tabs.SaveStates]: "Save States",
  [Tabs.Speedrun]: "Speedrun",
  [Tabs.StepGraph]: "Step Graph",
};

const TAB_ICONS: Record<Tabs, LucideIcon> = {
  [Tabs.General]: Settings2,
  [Tabs.Field]: MapIcon,
  [Tabs.World]: Globe,
  [Tabs.Battle]: BusterSword,
  [Tabs.Party]: CloudParty,
  [Tabs.Chocobos]: ChocoboHead,
  [Tabs.Variables]: BinaryGrid,
  [Tabs.SaveStates]: Save,
  [Tabs.Speedrun]: Timer,
  [Tabs.StepGraph]: BarChart2,
};

function Home() {
  const [currentTab, setCurrentTab] = useState<Tabs>(Tabs.Speedrun);
  const [mapWindow, setMapWindow] = useState<Window | null>(null);
  const [mapWebview, setMapWebview] = useState<Webview | null>(null);
  const [stepgraphWindow, setStepgraphWindow] = useState<Window | null>(null);
  const [stepgraphWebview, setStepgraphWebview] = useState<Webview | null>(null);
  const { addresses } = useFF7Context();

  const isStandaloneStepgraph = new URLSearchParams(window.location.search).get('standalone') === 'stepgraph';

  const [pinned, setPinned] = useState(false);

  const togglePin = async () => {
    const newVal = !pinned;
    try {
      await Window.getCurrent().setAlwaysOnTop(newVal);
      setPinned(newVal);
    } catch (e) {
      console.error("setAlwaysOnTop failed:", e);
    }
  };

  if (!addresses) {
    return <></>
  }
  const ff7 = useFF7(addresses);

  // For debugging purposes
  ((window as unknown) as any).FF7 = ff7;

  if (!ff7.gameState) {
    return <></>
  }

  // Use the new shortcuts system
  useShortcuts();

  // Keep the map viewer data feed alive regardless of which tab is active
  useEffect(() => {
    if (mapWebview) {
      mapWebview.emit("ff7-data", ff7.gameState);
    }
  }, [mapWebview, ff7.gameState]);

  // Standalone mode: render only the Stepgraph (opened via "Open in Window")
  if (isStandaloneStepgraph) {
    return (
      <div className="w-full h-screen flex flex-col">
        <div className="flex justify-end px-2 pt-1 flex-shrink-0">
          <button
            onClick={togglePin}
            title={pinned ? "Unpin (always on top)" : "Pin (always on top)"}
            className={`text-xs px-2 py-0.5 rounded border ${pinned ? "bg-zinc-200 text-zinc-900 border-zinc-400" : "bg-transparent text-zinc-400 border-zinc-600 hover:text-zinc-200 hover:border-zinc-400"}`}
          >
            📌 {pinned ? "Pinned" : "Pin"}
          </button>
        </div>
        <div className="flex-1 min-h-0 p-2 pt-1">
          <Stepgraph ff7={ff7} />
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (currentTab) {
      case Tabs.General:
        return <General ff7={ff7} />;
      case Tabs.Field:
        return <Field ff7={ff7} />;
      case Tabs.World:
        return <World ff7={ff7} mapWindow={mapWindow} setMapWindow={setMapWindow} mapWebview={mapWebview} setMapWebview={setMapWebview} />;
      case Tabs.Battle:
        return <Battle ff7={ff7} />;
      case Tabs.Party:
        return <Party ff7={ff7} />;
      case Tabs.Chocobos:
        return <Chocobos ff7={ff7} />;
      case Tabs.Variables:
        return <Variables ff7={ff7} />;
      case Tabs.SaveStates:
        return <SaveStatesModule ff7={ff7} />;
      case Tabs.Speedrun:
        return <Speedrun ff7={ff7} stepgraphWindow={stepgraphWindow} setStepgraphWindow={setStepgraphWindow} stepgraphWebview={stepgraphWebview} setStepgraphWebview={setStepgraphWebview} />;
      case Tabs.StepGraph:
        return <Stepgraph ff7={ff7} />;
      default:
        return <General ff7={ff7} />;
    }
  };

  return (
    <SidebarProvider className="h-full">
      <div className="flex flex-col w-full text-sm">
        <div className="flex-auto flex min-h-10">
          <Sidebar collapsible="none" className="flex-shrink-0">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {Object.values(Tabs).map((tab) => {
                      const Icon = TAB_ICONS[tab];
                      return (
                        <SidebarMenuItem key={tab}>
                          <SidebarMenuButton isActive={currentTab === tab} onClick={() => setCurrentTab(tab)}>
                            <Icon />
                            <span>{TAB_TITLES[tab]}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarSeparator />
              <SidebarGroup className="-mt-3">
                <SidebarGroupLabel>Generic Hacks & Tweaks</SidebarGroupLabel>
                <SidebarGroupContent>
                  <Hacks ff7={ff7} tab={currentTab} />
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarSeparator />
            <SidebarFooter>
              <QuickActions ff7={ff7} />
            </SidebarFooter>
          </Sidebar>
          <div className="p-2 overflow-y-auto flex-auto">
            {currentTab !== Tabs.SaveStates && currentTab !== Tabs.Speedrun && (
              <h2 className="uppercase font-medium text-sm border-b border-zinc-600 pb-0 mb-2 tracking-wide text-zinc-900 dark:text-zinc-100">
                {TAB_TITLES[currentTab]}
              </h2>
            )}
            {renderTabContent()}
          </div>
        </div>
        <StatusBar ff7={ff7} />
      </div>
    </SidebarProvider>
  );
}

export default Home;
