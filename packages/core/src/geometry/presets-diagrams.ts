import {
  PathFn,
  Pt,
  n,
  open,
  av,
  poly,
  ep,
  arcSeg,
  seg,
  ellSeg,
  ell,
  shapedRect,
  wedgeTail,
  wedgeEdges,
  callout,
  waveEdge,
  bevelFrame,
  actionButton,
} from './path-kit';
import { BASIC_PRESETS } from './presets-basic';

/** 标注、流程图、动作按钮与符号 / 连接线 */
export const DIAGRAM_PRESETS: Record<string, PathFn> = {
  // 标注
  wedgeRectCallout: (w, h, a) => {
    const { x1, x2, y1, y2, top, right, bottom, left } = wedgeEdges(w, h, a);
    return poly([
      [0, 0],
      [x1, 0],
      top,
      [x2, 0],
      [w, 0],
      [w, y1],
      right,
      [w, y2],
      [w, h],
      [x2, h],
      bottom,
      [x1, h],
      [0, h],
      [0, y2],
      left,
      [0, y1],
    ]);
  },
  wedgeRoundRectCallout: (w, h, a) => {
    const { x1, x2, y1, y2, top, right, bottom, left } = wedgeEdges(w, h, a);
    const c = Math.min(w, h) * av(a, 'adj3', 16667);
    const arc = (x: number, y: number): string => `A ${n(c)} ${n(c)} 0 0 1 ${n(x)} ${n(y)}`;
    const line = (...pts: Pt[]): string => pts.map(([x, y]) => `L ${n(x)} ${n(y)}`).join(' ');
    return [
      `M 0 ${n(c)}`,
      arc(c, 0),
      line([x1, 0], top, [x2, 0], [w - c, 0]),
      arc(w, c),
      line([w, y1], right, [w, y2], [w, h - c]),
      arc(w - c, h),
      line([x2, h], bottom, [x1, h], [c, h]),
      arc(0, h - c),
      line([0, y2], left, [0, y1]),
      'Z',
    ].join(' ');
  },
  wedgeEllipseCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    const cx = w / 2,
      cy = h / 2;
    const deg = (Math.atan2(ty - cy, tx - cx) * 180) / Math.PI;
    const [p2x, p2y] = ep(cx, cy, w / 2, h / 2, deg + 8);
    return `M ${n(p2x)} ${n(p2y)} ${arcSeg(cx, cy, w / 2, h / 2, deg + 8, 344)} L ${n(tx)} ${n(ty)} Z`;
  },
  cloudCallout: (w, h, a) => {
    const [tx, ty] = wedgeTail(w, h, a);
    const cloud = (BASIC_PRESETS.cloud as PathFn)(w, h * 0.8, {}) as string;
    return cloud + ' ' + ell(w * 0.36, h * 0.88, w * 0.045, h * 0.045) + ' ' + ell(tx, ty, w * 0.025, h * 0.025);
  },
  borderCallout1: callout(1, false),
  borderCallout2: callout(2, false),
  borderCallout3: callout(3, false),
  callout1: callout(1, false),
  callout2: callout(2, false),
  callout3: callout(3, false),
  accentCallout1: callout(1, true),
  accentCallout2: callout(2, true),
  accentCallout3: callout(3, true),
  accentBorderCallout1: callout(1, true),
  accentBorderCallout2: callout(2, true),
  accentBorderCallout3: callout(3, true),

  // 流程图
  flowChartProcess: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]),
  flowChartAlternateProcess: (w, h) => {
    const r = Math.min(w, h) * 0.1667;
    return shapedRect(w, h, [r, r, r, r], ['r', 'r', 'r', 'r']);
  },
  flowChartDecision: (w, h) =>
    poly([
      [w / 2, 0],
      [w, h / 2],
      [w / 2, h],
      [0, h / 2],
    ]),
  flowChartInputOutput: (w, h) =>
    poly([
      [w * 0.2, 0],
      [w, 0],
      [w * 0.8, h],
      [0, h],
    ]),
  flowChartPredefinedProcess: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ])
    + ' '
    + seg([
      [w / 8, 0],
      [w / 8, h],
    ])
    + ' '
    + seg([
      [(w * 7) / 8, 0],
      [(w * 7) / 8, h],
    ]),
  flowChartInternalStorage: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ])
    + ' '
    + seg([
      [w / 8, 0],
      [w / 8, h],
    ])
    + ' '
    + seg([
      [0, h / 8],
      [w, h / 8],
    ]),
  flowChartDocument: (w, h) =>
    `M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h * 0.84)} C ${n(w * 0.75)} ${n(h * 1.06)} ${n(w * 0.25)} ${n(h * 0.62)} 0 ${n(h * 0.84)} Z`,
  flowChartMultidocument: (w, h) =>
    `M 0 ${n(h * 0.2)} L ${n(w * 0.9)} ${n(h * 0.2)} L ${n(w * 0.9)} ${n(h * 0.86)} `
    + `C ${n(w * 0.68)} ${n(h * 1.04)} ${n(w * 0.22)} ${n(h * 0.66)} 0 ${n(h * 0.86)} Z `
    + seg([
      [w * 0.05, h * 0.1],
      [w * 0.95, h * 0.1],
      [w * 0.95, h * 0.76],
    ])
    + ' '
    + seg([
      [w * 0.1, 0],
      [w, 0],
      [w, h * 0.66],
    ]),
  flowChartTerminator: (w, h) => {
    const r = Math.min(h / 2, w / 2);
    return `M ${n(r)} 0 L ${n(w - r)} 0 A ${n(r)} ${n(h / 2)} 0 0 1 ${n(w - r)} ${n(h)} L ${n(r)} ${n(h)} A ${n(r)} ${n(h / 2)} 0 0 1 ${n(r)} 0 Z`;
  },
  flowChartPreparation: (w, h) =>
    poly([
      [w * 0.2, 0],
      [w * 0.8, 0],
      [w, h / 2],
      [w * 0.8, h],
      [w * 0.2, h],
      [0, h / 2],
    ]),
  flowChartManualInput: (w, h) =>
    poly([
      [0, h * 0.2],
      [w, 0],
      [w, h],
      [0, h],
    ]),
  flowChartManualOperation: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w * 0.8, h],
      [w * 0.2, h],
    ]),
  flowChartConnector: (w, h) => ell(w / 2, h / 2, w / 2, h / 2),
  flowChartOffpageConnector: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w, h * 0.8],
      [w / 2, h],
      [0, h * 0.8],
    ]),
  flowChartPunchedCard: (w, h) =>
    poly([
      [w * 0.2, 0],
      [w, 0],
      [w, h],
      [0, h],
      [0, h * 0.2],
    ]),
  flowChartPunchedTape: (w, h) =>
    `M 0 ${n(h * 0.11)} ${waveEdge(h * 0.11, w, h * 0.11, false)} L ${n(w)} ${n(h * 0.89)} ${waveEdge(h * 0.89, w, h * 0.11, true)} Z`,
  flowChartSummingJunction: (w, h) => {
    const k = 0.1464;
    return (
      ell(w / 2, h / 2, w / 2, h / 2)
      + ' '
      + seg([
        [w * k, h * k],
        [w * (1 - k), h * (1 - k)],
      ])
      + ' '
      + seg([
        [w * (1 - k), h * k],
        [w * k, h * (1 - k)],
      ])
    );
  },
  flowChartOr: (w, h) =>
    ell(w / 2, h / 2, w / 2, h / 2)
    + ' '
    + seg([
      [w / 2, 0],
      [w / 2, h],
    ])
    + ' '
    + seg([
      [0, h / 2],
      [w, h / 2],
    ]),
  flowChartCollate: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w / 2, h / 2],
      [w, h],
      [0, h],
      [w / 2, h / 2],
    ]),
  flowChartSort: (w, h) =>
    poly([
      [w / 2, 0],
      [w, h / 2],
      [w / 2, h],
      [0, h / 2],
    ])
    + ' '
    + seg([
      [0, h / 2],
      [w, h / 2],
    ]),
  flowChartExtract: (w, h) =>
    poly([
      [w / 2, 0],
      [w, h],
      [0, h],
    ]),
  flowChartMerge: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w / 2, h],
    ]),
  flowChartOnlineStorage: (w, h) =>
    `M ${n(w * 0.16)} 0 L ${n(w)} 0 A ${n(w * 0.16)} ${n(h / 2)} 0 0 0 ${n(w)} ${n(h)} L ${n(w * 0.16)} ${n(h)} `
    + `A ${n(w * 0.16)} ${n(h / 2)} 0 0 1 ${n(w * 0.16)} 0 Z`,
  flowChartOfflineStorage: (w, h) =>
    poly([
      [0, 0],
      [w, 0],
      [w / 2, h],
    ])
    + ' '
    + seg([
      [w * 0.1, h * 0.2],
      [w * 0.9, h * 0.2],
    ]),
  flowChartMagneticTape: (w, h) =>
    ell(w / 2, h * 0.46, w / 2, h * 0.46)
    + ` M ${n(w * 0.5)} ${n(h * 0.92)} L ${n(w)} ${n(h * 0.92)} L ${n(w)} ${n(h)} L ${n(w * 0.5)} ${n(h)} Z`,
  flowChartMagneticDisk: (w, h) => (BASIC_PRESETS.can as PathFn)(w, h, { adj: 25000 }),
  flowChartMagneticDrum: (w, h) => {
    const rx = Math.min(w / 2, w * 0.125);
    return (
      `M ${n(rx)} 0 L ${n(w - rx)} 0 ${arcSeg(w - rx, h / 2, rx, h / 2, -90, 180)} L ${n(rx)} ${n(h)} `
      + `${arcSeg(rx, h / 2, rx, h / 2, 90, 180)} Z `
      + ellSeg(w - rx, h / 2, rx, h / 2)
    );
  },
  flowChartDisplay: (w, h) =>
    `M ${n(w * 0.16)} 0 L ${n(w * 0.84)} 0 A ${n(w * 0.16)} ${n(h / 2)} 0 0 1 ${n(w * 0.84)} ${n(h)} `
    + `L ${n(w * 0.16)} ${n(h)} L 0 ${n(h / 2)} Z`,
  flowChartDelay: (w, h) => `M 0 0 L ${n(w / 2)} 0 A ${n(w / 2)} ${n(h / 2)} 0 0 1 ${n(w / 2)} ${n(h)} L 0 ${n(h)} Z`,

  // 动作按钮
  actionButtonBlank: (w, h) => bevelFrame(w, h, Math.min(w, h) * 0.125),
  actionButtonHome: (w, h) =>
    actionButton(w, h, (s, cx, cy) =>
      poly([
        [cx, cy - s],
        [cx + s, cy],
        [cx + s * 0.6, cy],
        [cx + s * 0.6, cy + s],
        [cx - s * 0.6, cy + s],
        [cx - s * 0.6, cy],
        [cx - s, cy],
      ]),
    ),
  actionButtonForwardNext: (w, h) =>
    actionButton(w, h, (s, cx, cy) =>
      poly([
        [cx - s * 0.6, cy - s],
        [cx + s * 0.7, cy],
        [cx - s * 0.6, cy + s],
      ]),
    ),
  actionButtonBackPrevious: (w, h) =>
    actionButton(w, h, (s, cx, cy) =>
      poly([
        [cx + s * 0.6, cy - s],
        [cx - s * 0.7, cy],
        [cx + s * 0.6, cy + s],
      ]),
    ),
  actionButtonBeginning: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        poly([
          [cx + s * 0.7, cy - s],
          [cx - s * 0.3, cy],
          [cx + s * 0.7, cy + s],
        ])
        + ' '
        + poly([
          [cx - s * 0.7, cy - s],
          [cx - s * 0.45, cy - s],
          [cx - s * 0.45, cy + s],
          [cx - s * 0.7, cy + s],
        ]),
    ),
  actionButtonEnd: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        poly([
          [cx - s * 0.7, cy - s],
          [cx + s * 0.3, cy],
          [cx - s * 0.7, cy + s],
        ])
        + ' '
        + poly([
          [cx + s * 0.45, cy - s],
          [cx + s * 0.7, cy - s],
          [cx + s * 0.7, cy + s],
          [cx + s * 0.45, cy + s],
        ]),
    ),
  actionButtonInformation: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        ell(cx, cy, s, s)
        + ' '
        + ell(cx, cy - s * 0.45, s * 0.16, s * 0.16)
        + ' '
        + poly([
          [cx - s * 0.16, cy - s * 0.15],
          [cx + s * 0.16, cy - s * 0.15],
          [cx + s * 0.16, cy + s * 0.6],
          [cx - s * 0.16, cy + s * 0.6],
        ]),
    ),
  actionButtonReturn: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        `M ${n(cx - s * 0.6)} ${n(cy + s * 0.7)} L ${n(cx + s * 0.2)} ${n(cy + s * 0.7)} `
        + `A ${n(s * 0.5)} ${n(s * 0.5)} 0 0 0 ${n(cx + s * 0.2)} ${n(cy - s * 0.3)} L ${n(cx - s * 0.2)} ${n(cy - s * 0.3)} `
        + `M ${n(cx - s * 0.2)} ${n(cy - s * 0.6)} L ${n(cx - s * 0.6)} ${n(cy - s * 0.3)} L ${n(cx - s * 0.2)} ${n(cy)} Z`,
    ),
  actionButtonDocument: (w, h) =>
    actionButton(w, h, (s, cx, cy) =>
      poly([
        [cx - s * 0.55, cy - s * 0.8],
        [cx + s * 0.2, cy - s * 0.8],
        [cx + s * 0.55, cy - s * 0.45],
        [cx + s * 0.55, cy + s * 0.8],
        [cx - s * 0.55, cy + s * 0.8],
      ]),
    ),
  actionButtonSound: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        poly([
          [cx - s * 0.7, cy - s * 0.3],
          [cx - s * 0.3, cy - s * 0.3],
          [cx + s * 0.1, cy - s * 0.8],
          [cx + s * 0.1, cy + s * 0.8],
          [cx - s * 0.3, cy + s * 0.3],
          [cx - s * 0.7, cy + s * 0.3],
        ])
        + ' '
        + seg([
          [cx + s * 0.35, cy - s * 0.4],
          [cx + s * 0.75, cy - s * 0.6],
        ])
        + ' '
        + seg([
          [cx + s * 0.35, cy],
          [cx + s * 0.8, cy],
        ])
        + ' '
        + seg([
          [cx + s * 0.35, cy + s * 0.4],
          [cx + s * 0.75, cy + s * 0.6],
        ]),
    ),
  actionButtonMovie: (w, h) =>
    actionButton(w, h, (s, cx, cy) =>
      poly([
        [cx - s * 0.8, cy - s * 0.5],
        [cx + s * 0.35, cy - s * 0.5],
        [cx + s * 0.35, cy - s * 0.15],
        [cx + s * 0.8, cy - s * 0.45],
        [cx + s * 0.8, cy + s * 0.45],
        [cx + s * 0.35, cy + s * 0.15],
        [cx + s * 0.35, cy + s * 0.5],
        [cx - s * 0.8, cy + s * 0.5],
      ]),
    ),
  actionButtonHelp: (w, h) =>
    actionButton(
      w,
      h,
      (s, cx, cy) =>
        `M ${n(cx - s * 0.35)} ${n(cy - s * 0.3)} A ${n(s * 0.35)} ${n(s * 0.35)} 0 1 1 ${n(cx)} ${n(cy + s * 0.1)} L ${n(cx)} ${n(cy + s * 0.35)} `
        + ell(cx, cy + s * 0.68, s * 0.13, s * 0.13),
    ),

  // 符号 / 连接线
  chartX: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)} M ${n(w)} 0 L 0 ${n(h)}`),
  chartPlus: (w, h) => open(`M ${n(w / 2)} 0 L ${n(w / 2)} ${n(h)} M 0 ${n(h / 2)} L ${n(w)} ${n(h / 2)}`),
  chartStar: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)} M ${n(w)} 0 L 0 ${n(h)} M ${n(w / 2)} 0 L ${n(w / 2)} ${n(h)}`),
  line: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)}`),
  lineInv: (w, h) => open(`M 0 ${n(h)} L ${n(w)} 0`),
  straightConnector1: (w, h) => open(`M 0 0 L ${n(w)} ${n(h)}`),
  bentConnector2: (w, h) => open(`M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h)}`),
  bentConnector3: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    return open(`M 0 0 L ${n(x)} 0 L ${n(x)} ${n(h)} L ${n(w)} ${n(h)}`);
  },
  bentConnector4: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    const y = h * av(a, 'adj2', 50000);
    return open(`M 0 0 L ${n(x)} 0 L ${n(x)} ${n(y)} L ${n(w)} ${n(y)} L ${n(w)} ${n(h)}`);
  },
  bentConnector5: (w, h, a) => {
    const x1 = w * av(a, 'adj1', 50000);
    const y = h * av(a, 'adj2', 50000);
    const x2 = w * av(a, 'adj3', 50000);
    return open(`M 0 0 L ${n(x1)} 0 L ${n(x1)} ${n(y)} L ${n(x2)} ${n(y)} L ${n(x2)} ${n(h)} L ${n(w)} ${n(h)}`);
  },
  curvedConnector2: (w, h) => open(`M 0 0 Q ${n(w)} 0 ${n(w)} ${n(h)}`),
  curvedConnector3: (w, h, a) => {
    const x = w * av(a, 'adj1', 50000);
    return open(`M 0 0 C ${n(x)} 0 ${n(x)} ${n(h)} ${n(w)} ${n(h)}`);
  },
  curvedConnector4: (w, h) =>
    open(`M 0 0 C ${n(w * 0.5)} 0 ${n(w * 0.5)} ${n(h * 0.5)} ${n(w * 0.75)} ${n(h * 0.5)} S ${n(w)} ${n(h * 0.75)} ${n(w)} ${n(h)}`),
  curvedConnector5: (w, h) =>
    open(`M 0 0 C ${n(w * 0.4)} 0 ${n(w * 0.4)} ${n(h * 0.5)} ${n(w * 0.5)} ${n(h * 0.5)} S ${n(w * 0.6)} ${n(h)} ${n(w)} ${n(h)}`),
};
