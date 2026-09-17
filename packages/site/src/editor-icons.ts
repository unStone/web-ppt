import {
  AudioLines, ChevronDown, ChevronLeft, ChevronRight, Circle, Cloud, Copy, Diamond, Eye,
  FileOutput, FilePlus2, FolderOpen, FolderOutput, GripVertical, Hexagon, ImagePlus, Images,
  Lock, MessageSquareText, MonitorCog, MoveRight, Paintbrush, PaintBucket, PanelTopOpen, Pencil,
  Play, Plus, Redo2, RefreshCw, Replace, Save, Scan, Search, Shapes, ShieldCheck,
  SlidersHorizontal, Square, SquareRoundCorner, Star, Table2, Triangle, TriangleAlert, Type,
  Undo2, Unlock, X, ZoomIn, ZoomOut, createElement,
  type IconNode,
} from 'lucide';

const editorIcons: Record<string, IconNode> = {
  'audio-lines': AudioLines,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  circle: Circle,
  cloud: Cloud,
  copy: Copy,
  diamond: Diamond,
  eye: Eye,
  // 隐藏态复用 Lucide Eye，由对象按钮补一条斜线，避免为单一状态增加整枚图标节点。
  'eye-off': Eye,
  'file-output': FileOutput,
  'file-plus-2': FilePlus2,
  'folder-open': FolderOpen,
  'folder-output': FolderOutput,
  'grip-vertical': GripVertical,
  hexagon: Hexagon,
  'image-plus': ImagePlus,
  images: Images,
  lock: Lock,
  'message-square-text': MessageSquareText,
  'monitor-cog': MonitorCog,
  'move-right': MoveRight,
  paintbrush: Paintbrush,
  'paint-bucket': PaintBucket,
  'panel-top-open': PanelTopOpen,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  'redo-2': Redo2,
  'refresh-cw': RefreshCw,
  replace: Replace,
  save: Save,
  scan: Scan,
  search: Search,
  shapes: Shapes,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  square: Square,
  'square-round-corner': SquareRoundCorner,
  star: Star,
  'table-2': Table2,
  triangle: Triangle,
  'triangle-alert': TriangleAlert,
  type: Type,
  'undo-2': Undo2,
  unlock: Unlock,
  x: X,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
};

function mountPaneIcon(button: HTMLElement): void {
  const action = button.dataset.paneAction;
  const value = button.textContent;
  const name = action === 'expand'
    ? button.closest('[aria-expanded]')?.getAttribute('aria-expanded') === 'true' ? 'chevron-down' : 'chevron-right'
    : action === 'visibility'
      ? value === '○' ? 'eye-off' : value === '●' ? 'eye' : button.dataset.paneIcon
      : action === 'lock'
        ? value === '🔒' ? 'lock' : value === '🔓' ? 'unlock' : button.dataset.paneIcon
        : undefined;
  if (!name || (button.firstElementChild?.getAttribute('data-pane-icon') === name
    && button.childElementCount === 1)) return;
  button.dataset.paneIcon = name;
  const icon = button.ownerDocument.createElement('i');
  icon.dataset.lucide = name;
  icon.dataset.paneIcon = name;
  button.replaceChildren(icon);
}

/** 逐个渲染已声明的图标，既保留 Lucide 视觉规范，也不引入全量动态挂载器。 */
export function mountEditorIcons(root: Element | Document | DocumentFragment = document): void {
  if (root instanceof HTMLElement && root.matches('[data-pane-action]')) mountPaneIcon(root);
  root.querySelectorAll<HTMLElement>('[data-pane-action]').forEach(mountPaneIcon);
  root.querySelectorAll<HTMLElement>('[data-lucide]').forEach(placeholder => {
    if (placeholder instanceof SVGElement) return;
    const name = placeholder.dataset.lucide;
    const icon = name ? editorIcons[name] : undefined;
    if (!name || !icon) return;
    const attrs: Record<string, string> = {
      width: '18', height: '18', 'stroke-width': '1.8',
      'aria-hidden': 'true',
      ...Object.fromEntries(Array.from(placeholder.attributes, attribute => [attribute.name, attribute.value])),
    };
    attrs.class = ['lucide', `lucide-${name}`, attrs.class].filter(Boolean).join(' ');
    placeholder.replaceWith(createElement(icon, attrs));
  });
}

export function activateEditorIcons(signal: AbortSignal): void {
  if (signal.aborted) return;
  mountEditorIcons();
  const observer = new MutationObserver(records => {
    for (const record of records) mountEditorIcons(record.target as Element);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}
