import { Modal } from "@/components/Modal";
import { version } from "../../../src-tauri/tauri.conf.json";

interface AboutModalProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function AboutModal({ isOpen, setIsOpen }: AboutModalProps) {
  return (
    <Modal
      open={isOpen}
      setIsOpen={setIsOpen}
      title="FF7 Ultima"
      size="sm"
      callback={() => {}}
    >
      <div className="space-y-2">
        <p>The Final Fantasy VII real-time game editor, trainer and hacking tool.</p>

        <div className="rounded-md border border-slate-700 bg-slate-800/40 p-3 space-y-1">
          <p className="font-semibold text-slate-100">
            Independent Fork
          </p>
          <p className="text-slate-300">
            Independently maintained by Matt.
          </p>
          <p className="text-slate-300">
            Version {version}
          </p>
          <p className="text-slate-400 text-sm">
            Based on the original FF7 Ultima project.
          </p>
          <p className="text-slate-400 text-sm">
            Unofficial community build. Not affiliated with the original developers.
          </p>
          <p>
            <a
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300"
              href="https://github.com/themattdavis/ff7-ultima"
            >
              Visit my fork on GitHub
            </a>
          </p>
        </div>

        <p>&copy; 2024-2025 Maciej Trebacz (mav) - Original project</p>
        <p>
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-200"
            href="https://github.com/maciej-trebacz/ff7-ultima"
          >
            Original source code on GitHub
          </a>
        </p>
        <p>
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-200"
            href="https://twitch.tv/m4v3k"
          >
            Watch the original developer code this app live on Twitch
          </a>
        </p>

        <br />
        <p><b>Additional Contributions:</b></p>
        <p>
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-200"
            href="https://github.com/AceZephyr/big-shoes"
          >
            Ace Zephyr
          </a>
          - Creator of Big Shoes, whose Stepgraph functionality has been incorporated into this version of FF7 Ultima. Many thanks for the original work and contribution to the FF7 speedrunning community.
        </p>
        <p><b>Acknowledgments:</b></p>
        <p>DLPB - author of Ochu app, list of battle formations</p>
        <p>Phantasm - testing and ideas</p>
        <p>petfriendamy - list of game moments</p>
        <p>picklejar76 - for the extracted scene.bin data</p>
        <p>myst6re, NFITC1 - authors of invaluable FF7 tools</p>
        <p>FF7 Wiki authors - savemap and other game data</p>
        <p>... and the whole Qhimm and FF7 community.</p>
      </div>
    </Modal>
  );
}