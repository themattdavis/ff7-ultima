import { useRef, useState, useEffect, useCallback } from "react";
import { FF7 } from "@/useFF7";
import { readMemory, DataType } from "@/memory";
import { GameModule } from "@/types";
import {
  StepPos,
  encounterThreshold,
  stepAdd,
  stepDistance,
  computeNextEncounterData,
  OFFSET_TABLE,
  INVERSE_OFFSET_TABLE,
} from "@/stepgraph";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 132;
const DEFAULT_TOP_DANGER = 6000;
const DEFAULT_LEFT_OFFSET = 4; // how many steps right of left-edge the current position sits
const MAX_WIDTH = 500;
const MIN_WIDTH = 10;
const MAX_TOP_DANGER = 40000;
const MIN_TOP_DANGER = 500;

// PC memory addresses (matching Big Shoes' watch window)
const ADDR_LURE_RATE    = 0xDBCAD9; // u8
const ADDR_PREEMPT_RATE = 0xDBCADB; // u8

// DDM (Danger Divisor Multiplier) per field ID.
// Column 1 = field ID, column 2 = DDM. Falls back to 512 for unmapped fields.
const FIELD_DDM: Record<number, number> = {
  0: 512, 65: 512, 66: 512, 67: 512, 68: 576, 69: 512,
  70: 576, 71: 512, 72: 576, 73: 512, 74: 512, 75: 512,
  76: 512, 77: 512, 78: 600, 79: 512, 80: 512, 81: 768,
  82: 768, 83: 768, 84: 768, 85: 768, 86: 512, 87: 512,
  88: 512, 89: 512, 90: 512, 91: 512, 93: 512, 94: 512,
  95: 512, 96: 512, 97: 512, 98: 512, 99: 512, 100: 512,
  101: 512, 103: 512, 104: 512, 105: 512, 106: 512, 109: 512,
  110: 512, 111: 512, 112: 512, 115: 700, 116: 512, 117: 1024,
  118: 512, 119: 512, 120: 512, 121: 512, 122: 512, 123: 512,
  124: 512, 125: 512, 126: 512, 127: 512, 128: 512, 129: 512,
  130: 512, 131: 512, 132: 512, 133: 512, 134: 512, 135: 512,
  136: 512, 137: 512, 138: 512, 139: 512, 140: 512, 141: 512,
  142: 512, 143: 5120, 144: 512, 145: 512, 146: 650, 147: 650,
  148: 512, 149: 512, 150: 512, 151: 512, 152: 512, 153: 600,
  154: 512, 155: 512, 156: 512, 157: 512, 158: 512, 159: 512,
  160: 768, 161: 512, 162: 512, 163: 512, 164: 512, 165: 512,
  166: 512, 167: 512, 168: 512, 169: 512, 170: 512, 171: 512,
  172: 512, 173: 512, 174: 512, 175: 512, 176: 512, 177: 512,
  178: 512, 179: 512, 180: 512, 181: 512, 182: 512, 183: 512,
  184: 512, 185: 512, 186: 512, 187: 512, 188: 512, 189: 600,
  190: 512, 191: 512, 192: 512, 193: 512, 194: 512, 195: 512,
  196: 480, 197: 512, 198: 512, 199: 512, 200: 512, 201: 512,
  202: 512, 203: 512, 204: 480, 205: 512, 206: 512, 207: 512,
  208: 512, 209: 512, 210: 512, 211: 512, 212: 512, 213: 512,
  214: 512, 216: 512, 218: 512, 219: 512, 220: 512, 222: 512,
  223: 512, 224: 512, 225: 512, 226: 512, 227: 512, 228: 512,
  229: 512, 230: 512, 231: 512, 232: 512, 233: 512, 234: 512,
  235: 512, 236: 512, 237: 512, 238: 512, 239: 512, 240: 512,
  241: 512, 242: 512, 243: 512, 244: 512, 245: 512, 246: 512,
  247: 512, 248: 512, 249: 512, 250: 512, 251: 512, 252: 512,
  253: 512, 254: 512, 255: 512, 256: 512, 257: 512, 258: 512,
  259: 512, 260: 512, 261: 512, 262: 512, 263: 512, 264: 512,
  266: 512, 267: 512, 268: 512, 269: 512, 270: 512, 271: 512,
  272: 512, 273: 512, 274: 512, 275: 512, 276: 512, 277: 512,
  278: 512, 279: 512, 280: 576, 281: 512, 282: 512, 283: 512,
  284: 512, 285: 512, 286: 512, 287: 512, 288: 512, 289: 512,
  290: 512, 291: 512, 292: 512, 293: 512, 294: 512, 295: 512,
  296: 512, 297: 512, 298: 512, 299: 512, 300: 512, 301: 512,
  302: 512, 303: 512, 304: 512, 305: 512, 306: 512, 307: 2048,
  308: 2048, 309: 512, 310: 512, 311: 512, 312: 512, 313: 512,
  314: 512, 315: 768, 316: 512, 317: 512, 318: 512, 319: 512,
  320: 768, 321: 512, 322: 512, 323: 512, 324: 512, 325: 512,
  326: 512, 327: 512, 328: 512, 329: 512, 330: 512, 331: 512,
  332: 512, 333: 512, 334: 512, 335: 512, 336: 512, 337: 512,
  338: 512, 339: 512, 340: 512, 341: 512, 342: 512, 343: 512,
  344: 512, 345: 512, 347: 2048, 348: 512, 349: 512, 350: 512,
  351: 512, 352: 512, 353: 512, 354: 512, 355: 512, 356: 512,
  358: 512, 359: 512, 360: 600, 361: 512, 362: 512, 363: 512,
  364: 512, 365: 512, 366: 512, 367: 512, 368: 512, 369: 512,
  370: 700, 371: 512, 372: 512, 373: 512, 374: 512, 375: 512,
  376: 512, 377: 512, 378: 512, 379: 512, 380: 512, 381: 512,
  382: 512, 383: 700, 384: 512, 385: 1024, 386: 512, 387: 512,
  388: 512, 389: 512, 390: 512, 391: 512, 392: 512, 393: 512,
  394: 512, 395: 512, 396: 512, 397: 512, 398: 512, 399: 512,
  400: 2048, 401: 512, 402: 700, 404: 512, 405: 512, 406: 512,
  407: 512, 408: 512, 409: 512, 411: 512, 412: 512, 413: 512,
  414: 512, 415: 512, 416: 1024, 417: 512, 418: 512, 419: 512,
  420: 512, 421: 512, 422: 512, 423: 512, 424: 512, 425: 512,
  426: 512, 427: 512, 428: 512, 429: 512, 430: 512, 431: 512,
  432: 512, 433: 512, 434: 512, 435: 512, 436: 512, 437: 512,
  438: 512, 439: 512, 440: 512, 441: 640, 442: 640, 443: 512,
  444: 512, 445: 512, 446: 512, 447: 512, 448: 512, 449: 512,
  450: 512, 451: 512, 452: 512, 453: 512, 454: 512, 455: 512,
  456: 512, 457: 512, 458: 512, 459: 512, 460: 512, 461: 1024,
  462: 512, 463: 512, 464: 512, 465: 512, 466: 720, 467: 1024,
  468: 512, 469: 512, 470: 512, 471: 512, 472: 512, 473: 512,
  474: 512, 475: 400, 476: 512, 477: 600, 478: 512, 479: 512,
  480: 512, 481: 1024, 482: 512, 483: 512, 484: 512, 485: 700,
  486: 512, 487: 512, 488: 512, 489: 768, 490: 768, 491: 512,
  492: 512, 493: 512, 494: 512, 495: 512, 496: 512, 497: 512,
  498: 512, 499: 512, 500: 512, 501: 512, 502: 512, 503: 512,
  504: 512, 505: 512, 506: 512, 507: 512, 508: 512, 509: 512,
  510: 512, 511: 512, 512: 512, 513: 512, 514: 512, 515: 512,
  516: 512, 517: 512, 518: 512, 519: 512, 520: 512, 521: 512,
  522: 512, 523: 512, 524: 512, 525: 512, 526: 512, 527: 512,
  528: 512, 529: 512, 530: 512, 531: 512, 532: 512, 533: 512,
  534: 512, 535: 512, 536: 512, 537: 512, 538: 512, 539: 512,
  540: 512, 541: 512, 542: 4096, 543: 4096, 544: 512, 545: 512,
  546: 400, 547: 512, 548: 400, 549: 512, 550: 512, 551: 512,
  552: 512, 553: 512, 554: 512, 555: 512, 556: 512, 557: 512,
  558: 512, 559: 512, 560: 512, 561: 512, 562: 512, 563: 512,
  564: 512, 565: 448, 566: 512, 567: 512, 568: 512, 569: 512,
  570: 512, 572: 512, 573: 512, 574: 512, 575: 512, 576: 512,
  577: 512, 578: 512, 579: 512, 580: 512, 581: 512, 582: 512,
  583: 512, 584: 512, 585: 512, 586: 512, 587: 512, 588: 512,
  589: 512, 590: 512, 591: 512, 592: 512, 593: 512, 594: 512,
  595: 512, 596: 512, 597: 512, 598: 512, 599: 512, 600: 512,
  601: 512, 602: 512, 603: 512, 604: 700, 605: 512, 606: 512,
  607: 512, 608: 512, 609: 512, 610: 512, 611: 512, 612: 512,
  613: 512, 614: 512, 615: 512, 616: 512, 617: 512, 618: 512,
  619: 512, 620: 512, 621: 512, 622: 512, 623: 512, 624: 512,
  625: 512, 626: 512, 627: 512, 628: 512, 629: 512, 630: 512,
  631: 512, 632: 512, 633: 512, 634: 512, 635: 512, 636: 512,
  637: 512, 638: 512, 639: 512, 640: 512, 641: 512, 642: 768,
  643: 768, 644: 512, 645: 512, 646: 512, 647: 512, 648: 1024,
  649: 512, 650: 512, 651: 512, 652: 512, 653: 512, 654: 512,
  655: 512, 656: 512, 657: 512, 658: 512, 659: 512, 660: 512,
  661: 512, 662: 512, 663: 512, 664: 512, 665: 512, 666: 512,
  667: 512, 668: 512, 669: 512, 670: 512, 671: 512, 672: 512,
  673: 512, 674: 512, 675: 512, 676: 512, 677: 512, 678: 512,
  679: 512, 680: 512, 681: 512, 682: 512, 683: 512, 684: 512,
  686: 512, 687: 512, 688: 512, 689: 512, 690: 512, 691: 512,
  692: 512, 693: 512, 694: 512, 695: 512, 696: 512, 697: 512,
  698: 512, 699: 512, 700: 512, 701: 512, 702: 512, 703: 512,
  704: 512, 705: 512, 706: 576, 707: 512, 708: 512, 709: 512,
  710: 512, 711: 512, 712: 512, 713: 512, 714: 512, 715: 512,
  716: 1024, 717: 512, 718: 512, 719: 512, 720: 512, 721: 512,
  722: 512, 723: 512, 724: 512, 725: 2048, 726: 2048, 727: 2048,
  728: 512, 729: 512, 730: 512, 731: 1024, 732: 512, 733: 512,
  734: 512, 735: 512, 736: 512, 737: 512, 738: 512, 739: 512,
  740: 512, 741: 512, 742: 512, 744: 512, 745: 512, 746: 512,
  747: 512, 748: 512, 749: 512, 750: 512, 751: 512, 752: 512,
  753: 512, 754: 512, 755: 512, 756: 512, 757: 512, 758: 512,
  759: 512, 760: 512, 761: 512, 762: 512, 763: 512, 764: 512,
  765: 512, 766: 512, 767: 512, 768: 512, 771: 512, 772: 512,
  773: 512, 774: 512, 775: 400, 777: 512, 778: 512, 779: 512,
  780: 512, 781: 512, 782: 512, 783: 512, 784: 512, 785: 512,
  786: 512,
};


// Canvas layout
const L_PAD = 50;
const R_PAD = 8;
const T_PAD = 8;
const B_PAD = 22;

// Colours (matching Big Shoes palette)
const C = {
  bg:                 "#000000",
  bgGrid:             "#101010",
  gridline:           "rgba(255,255,255,0.08)",
  gridlinePreemptive: "#800080",
  threshold:          "#008080",
  thresholdPreempt:   "#c400c4",
  walkProjection:     "#40ff40",
  runProjection:      "#4040ff",
  battleMark:         "#ff4040",
  currentPos:         "#ff0000",
  axis:               "rgba(255,255,255,0.4)",
  label:              "#cccccc",
  labelFaint:         "#777777",
};

// ─── Settings ────────────────────────────────────────────────────────────────

interface ViewSettings {
  thresholds:       boolean;
  preemptGridlines: boolean;
  preemptThresholds: boolean;
  walkProjection:   boolean;
  runProjection:    boolean;
  encounterMarks:   boolean;
  currentPosition:  boolean;
  underwalkLabels:  boolean;
  offsetLabels:     boolean;
}

const DEFAULT_SETTINGS: ViewSettings = {
  thresholds:        true,
  preemptGridlines:  true,
  preemptThresholds: true,
  walkProjection:    true,
  runProjection:     true,
  encounterMarks:    true,
  currentPosition:   true,
  underwalkLabels:   true,
  offsetLabels:      true,
};

const VIEW_LABELS: { key: keyof ViewSettings; label: string }[] = [
  { key: "thresholds",        label: "Encounter Thresholds" },
  { key: "preemptGridlines",  label: "Preemptive Gridlines" },
  { key: "preemptThresholds", label: "Preemptive Thresholds" },
  { key: "walkProjection",    label: "Walk Projection" },
  { key: "runProjection",     label: "Run Projection" },
  { key: "encounterMarks",    label: "Encounter Marks" },
  { key: "currentPosition",   label: "Current Position" },
  { key: "underwalkLabels",   label: "Underwalk Labels" },
  { key: "offsetLabels",      label: "Offset Labels" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function Stepgraph({ ff7 }: { ff7: FF7 }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Graph view state
  const [topDanger,   setTopDanger]   = useState(DEFAULT_TOP_DANGER);
  const [width,       setWidth]       = useState(DEFAULT_WIDTH);
  const [leftOffset,  setLeftOffset]  = useState(DEFAULT_LEFT_OFFSET);
  const [canvasDims,  setCanvasDims]  = useState({ w: 0, h: 0 });

  // Extra values we read directly from memory (not in gameState)
  const [lureRate,    setLureRate]    = useState(16);
  const [preemptRate, setPreemptRate] = useState(16);

  // UI
  const [viewSettings,     setViewSettings]     = useState<ViewSettings>(DEFAULT_SETTINGS);
  const [showViewMenu,     setShowViewMenu]      = useState(false);

  const state = ff7.gameState;

  // DDM derived from field ID via lookup table; falls back to 512 for unknown fields
  const ddm = FIELD_DDM[state.fieldId] ?? 512;

  // ── Extra memory polling ────────────────────────────────────────────────────

  useEffect(() => {
    if (!ff7.connected) return;

    const poll = async () => {
      try {
        const [lr, pr] = await Promise.all([
          readMemory(ADDR_LURE_RATE,    DataType.Byte),
          readMemory(ADDR_PREEMPT_RATE, DataType.Byte),
        ]);
        setLureRate(lr > 0 ? lr : 16);
        setPreemptRate(pr > 0 ? pr : 16);
      } catch {
        // not connected yet — keep defaults
      }
    };

    poll();
    const id = setInterval(poll, 200);
    return () => clearInterval(id);
  }, [ff7.connected]);

  // ── Canvas resize ───────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.floor(e.contentRect.height);
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width  = w;
          canvas.height = h;
        }
        setCanvasDims({ w, h });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Non-passive wheel handler ───────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir    = e.deltaY > 0 ? 1 : -1;
      const fast   = e.shiftKey;

      if (e.ctrlKey) {
        // Y zoom (top danger)
        setTopDanger(prev => {
          const step = fast ? 5000 : 500;
          return Math.max(MIN_TOP_DANGER, Math.min(MAX_TOP_DANGER, prev + dir * step));
        });
      } else if (e.altKey) {
        // X zoom (steps shown)
        setWidth(prev => {
          const step = fast ? 20 : 2;
          return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, prev + dir * step));
        });
      } else {
        // Pan left/right
        const step = fast ? 40 : 4;
        setLeftOffset(prev => prev + dir * step);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Canvas drawing ──────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasDims.w === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvasDims.w;
    const H = canvasDims.h;
    const plotW = W - L_PAD - R_PAD;
    const plotH = H - T_PAD - B_PAD;
    if (plotW <= 0 || plotH <= 0) return;

    // Coordinate helpers
    const cx = (steps: number)  => L_PAD + (steps / width) * plotW;
    const cy = (danger: number) => T_PAD + plotH * (1 - Math.max(0, Math.min(topDanger, danger)) / topDanger);

    // Current step position derived from gameState
    const currentPos: StepPos = { stepId: state.stepId, offset: state.stepOffset };
    const leftEdgePos = stepAdd(currentPos, -leftOffset);

    // ── Clear ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Y-axis gridlines ───────────────────────────────────────────────────────
    ctx.strokeStyle = C.gridline;
    ctx.lineWidth   = 0.5;
    const gridDangerStep = topDanger / 8;
    for (let d = 0; d <= topDanger; d += gridDangerStep) {
      const y = cy(d);
      ctx.beginPath();
      ctx.moveTo(L_PAD, y);
      ctx.lineTo(W - R_PAD, y);
      ctx.stroke();
    }

    // ── Preemptive gridlines ───────────────────────────────────────────────────
    if (viewSettings.preemptGridlines) {
      ctx.strokeStyle = C.gridlinePreemptive;
      ctx.lineWidth   = 0.5;
      for (let x = 0; x < width; x++) {
        const [, isPreempt] = encounterThreshold(stepAdd(leftEdgePos, x), lureRate, preemptRate);
        if (isPreempt) {
          const px = cx(x);
          ctx.beginPath();
          ctx.moveTo(px, T_PAD);
          ctx.lineTo(px, T_PAD + plotH);
          ctx.stroke();
        }
      }
    }

    // ── Encounter threshold lines ──────────────────────────────────────────────
    if (viewSettings.thresholds) {
      for (let x = 0; x < width; x++) {
        const pos = stepAdd(leftEdgePos, x);
        const [threshold, isPreempt] = encounterThreshold(pos, lureRate, preemptRate);
        if (threshold < topDanger) {
          const px = cx(x);
          ctx.strokeStyle =
            isPreempt && viewSettings.preemptThresholds
              ? C.thresholdPreempt
              : C.threshold;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, T_PAD);         // top of plot (high danger)
          ctx.lineTo(px, cy(threshold)); // down to threshold level
          ctx.stroke();
        }
      }
    }

    // ── Projection lines ───────────────────────────────────────────────────────
    if (ff7.connected && state.currentModule === GameModule.Field) {
      // Try to get table rate from fieldEncounters (serialised by the Rust backend)
      const fe = state.fieldEncounters as any;
      const tableKey = state.fieldAltEncountersEnabled ? "table2" : "table1";
            // Try every serialization name the Rust backend might use for the
      // encounter-table-level divisor (different from per-encounter probability weights).
      // Fall back to 256 which is correct for the vast majority of FF7 fields.
      const tableData = fe?.[tableKey];
      const tableRate: number =
        tableData?.encounter_rate   ??   // most likely Rust field name
        tableData?.table_rate       ??
        tableData?.divisor          ??
        tableData?.rate_divisor     ??
        256;  // correct default — gives dipsRun=16, dipsWalk=4 with DDM=512

      // Log once so you can verify the actual structure in DevTools console
      if (tableData && !('encounter_rate' in tableData)) {
        console.log('[Stepgraph] fieldEncounters structure sample:', tableData);
      }

      if (ddm > 0 && tableRate > 0) {
        const dipsRun  = Math.floor((8 * ddm) / tableRate);
        const dipsWalk = Math.floor((2 * ddm) / tableRate);


        const lines = computeNextEncounterData(
          currentPos, leftEdgePos, state.dangerValue,
          dipsRun, dipsWalk, lureRate, preemptRate,
        );

        for (const line of lines) {
          const isWalk = line.walkingSteps === -1;
          if (isWalk  && !viewSettings.walkProjection) continue;
          if (!isWalk && !viewSettings.runProjection)  continue;

          ctx.strokeStyle = isWalk ? C.walkProjection : C.runProjection;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(cx(line.startX), cy(line.startDanger));
          ctx.lineTo(cx(line.endX),   cy(line.endDanger));
          ctx.stroke();

          if (!isWalk && viewSettings.encounterMarks) {
            ctx.fillStyle = C.battleMark;
            ctx.beginPath();
            ctx.arc(cx(line.endX), cy(line.endDanger), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Underwalk labels — show the gap (# walk steps) between consecutive run encounter points
        if (viewSettings.underwalkLabels) {
          const runLines = lines.filter(l => l.walkingSteps >= 0);
          ctx.fillStyle  = C.label;
          ctx.font       = "16px monospace";
          ctx.textAlign  = "left";
          for (let i = 0; i < runLines.length - 1; i++) {
            const gap = runLines[i + 1].walkingSteps - runLines[i].walkingSteps;
            ctx.fillText(
              String(gap),
              cx(runLines[i].endX) + 3,
              cy(runLines[i].endDanger) - 2,
            );
          }
        }
      }
    }

    // ── Current position dot ───────────────────────────────────────────────────
    if (viewSettings.currentPosition && ff7.connected) {
      ctx.fillStyle = C.currentPos;
      ctx.beginPath();
      ctx.arc(cx(leftOffset), cy(state.dangerValue), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Offset labels  (show offset value every 128 steps like Big Shoes) ──────
    if (viewSettings.offsetLabels) {
      ctx.fillStyle = C.labelFaint;
      ctx.font      = "10px monospace";
      ctx.textAlign = "center";

      // Offset cycles: +13 mod 256 every 128 steps
      let currentOffset = leftEdgePos.offset;
      // Align to nearest 128-step boundary from the start
      const stepIdMod = leftEdgePos.stepId;
      const firstLabel = (128 - (stepIdMod / 2) % 128) % 128;

      for (let x = firstLabel; x < width; x += 128) {
        const steps = x - firstLabel;
        const offsetIdx =
          (((INVERSE_OFFSET_TABLE[currentOffset] + Math.floor(steps * 2 / 256)) % 256) + 256) % 256;
        const off = OFFSET_TABLE[offsetIdx];
        ctx.fillText(String(off), cx(x), T_PAD + plotH - 2);
      }
    }

    // ── X axis: step ID labels ─────────────────────────────────────────────────
    ctx.fillStyle = C.label;
    ctx.font      = "12px monospace";
    ctx.textAlign = "center";
    const labelEvery = Math.max(4, Math.floor(width / 80) * 4);
    const startX = (4 - (leftEdgePos.stepId / 2) % 4) % 4; // align to even step_id boundaries
    for (let x = startX; x < width; x += labelEvery) {
      const pos = stepAdd(leftEdgePos, x);
      ctx.fillText(String(pos.stepId), cx(x), H - 4);
    }

    // ── Y axis: danger labels ──────────────────────────────────────────────────
    ctx.textAlign = "right";
    for (let d = 0; d <= topDanger; d += gridDangerStep) {
      ctx.fillText(String(Math.round(d)), L_PAD - 4, cy(d) + 4);
    }

    // ── Axis lines ─────────────────────────────────────────────────────────────
    ctx.strokeStyle = C.axis;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(L_PAD, T_PAD);
    ctx.lineTo(L_PAD, T_PAD + plotH);
    ctx.lineTo(L_PAD + plotW, T_PAD + plotH);
    ctx.stroke();

  }, [
    canvasDims, state.stepId, state.stepOffset, state.dangerValue,
    state.fieldEncounters, state.fieldAltEncountersEnabled, state.currentModule,
    ff7.connected, lureRate, preemptRate, ddm,
    topDanger, width, leftOffset, viewSettings,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const goToCurrentPosition = useCallback(() => setLeftOffset(DEFAULT_LEFT_OFFSET), []);
  const resetZoom            = useCallback(() => {
    setTopDanger(DEFAULT_TOP_DANGER);
    setWidth(DEFAULT_WIDTH);
  }, []);

  const toggleSetting = useCallback((key: keyof ViewSettings) => {
    setViewSettings(s => ({ ...s, [key]: !s[key] }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  const inField = ff7.connected && state.currentModule === GameModule.Field;

  return (
    <div className="flex flex-col h-full select-none">

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 border-b border-zinc-700">
        <span>
          
        </span>

        {/* Live readouts */}
        <div className="flex gap-3 text-xs text-zinc-400 mr-auto">
          <span>
            Step&nbsp;<span className="text-zinc-200 tabular-nums">{state.stepId}</span>
          </span>
          <span>
            Offset&nbsp;<span className="text-zinc-200 tabular-nums">{state.stepOffset}</span>
          </span>
          <span>
            Danger&nbsp;<span className="text-zinc-200 tabular-nums">{state.dangerValue}</span>
          </span>
          <span>
            Lure&nbsp;<span className="text-zinc-200 tabular-nums">{lureRate}</span>
          </span>
          <span>
            Preempt&nbsp;<span className="text-zinc-200 tabular-nums">{preemptRate}</span>
          </span>
          <span>
            DDM&nbsp;<span className="text-zinc-200 tabular-nums">{ddm}</span>
          </span>
          {!inField && (
            <span className="text-zinc-500 italic">
              
            </span>
          )}
        </div>

        {/* Controls */}
        <button
          onClick={goToCurrentPosition}
          className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs"
          title="Centre the graph on the current step position"
        >
          Go to Position
        </button>
        <button
          onClick={resetZoom}
          className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs"
          title="Reset zoom and Y scale to defaults"
        >
          Reset Zoom
        </button>

        {/* View menu */}
        <div className="relative">
          <button
            onClick={() => setShowViewMenu(v => !v)}
            className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs"
          >
            View ▾
          </button>
          {showViewMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-zinc-800 border border-zinc-600 rounded shadow-lg p-2">
              {VIEW_LABELS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 px-1 py-0.5 hover:bg-zinc-700 rounded cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={viewSettings[key]}
                    onChange={() => toggleSetting(key)}
                    className="w-3 h-3 accent-teal-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 cursor-crosshair"
        onClick={() => setShowViewMenu(false)}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* ── Footer hint ── */}
      <div className="flex-shrink-0 text-xs text-zinc-600 px-3 py-0.5 text-center border-t border-zinc-800">
        Scroll: pan left/right &nbsp;•&nbsp; Ctrl+scroll: zoom Y &nbsp;•&nbsp; Alt+scroll: zoom X &nbsp;•&nbsp; +Shift: 10×
      </div>
    </div>
  );
}
