import type {
  BuiltinTemplateId, BuiltinTemplatePreviewToken,
} from '@web-ppt/edit-core/templates';
import { createBlankPptx } from '@web-ppt/edit-core/generate';
import { createPptxFromTemplate, listBuiltinTemplates } from '@web-ppt/edit-core/templates';

export type NewDocumentChoice =
  | { readonly kind: 'blank'; readonly name: '空白' }
  | { readonly kind: 'template'; readonly id: BuiltinTemplateId; readonly name: string };

export interface NewDocumentResult {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly loadingMessage: string;
  readonly noticeMessage: string;
}

const pickerCss = `
.template-dialog{width:min(840px,calc(100vw - 32px));padding:0;border:0;border-radius:16px;color:var(--ink);background:#fff;box-shadow:0 24px 80px #11182738}
.template-dialog::backdrop{background:#11182770;backdrop-filter:blur(2px)}
.template-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 14px;border-bottom:1px solid var(--soft-line)}
.template-dialog-head strong,.template-dialog-head small{display:block}.template-dialog-head strong{font-size:18px}.template-dialog-head small{margin-top:4px;color:var(--muted)}
.template-dialog-head button{border:0;background:transparent;color:var(--muted);font-size:24px;line-height:1;cursor:pointer}
.template-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:20px 22px 24px}
.template-card{min-width:0;padding:0 0 12px;overflow:hidden;text-align:left;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s}
.template-card:hover,.template-card:focus-visible{border-color:var(--template-accent);box-shadow:0 8px 24px #11182718;transform:translateY(-2px);outline:none}
.template-card>strong,.template-card>small{display:block;margin-inline:12px}.template-card>strong{margin-top:10px;font-size:14px}.template-card>small{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.35}
.template-preview{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;background:var(--template-surface);color:var(--template-foreground)}
.template-preview::before,.template-preview::after{content:'';position:absolute;left:12%;border-radius:2px;background:currentColor}.template-preview::before{top:33%;width:48%;height:8%;opacity:.9}.template-preview::after{top:48%;width:32%;height:4%;opacity:.35}
.template-preview i,.template-preview b{position:absolute;display:block}.motif-orb i{right:-12%;top:-28%;width:58%;aspect-ratio:1;border-radius:50%;background:var(--template-accent);opacity:.23}.motif-orb b{left:-8%;bottom:-30%;width:40%;aspect-ratio:1;border-radius:50%;background:var(--template-secondary);opacity:.28}
.motif-rule i{inset:0 auto 0 0;width:5%;background:var(--template-accent)}.motif-rule b{left:12%;right:10%;bottom:10%;height:2px;background:var(--template-secondary)}
.motif-beam i,.motif-beam b{top:-36%;height:130%;transform:rotate(27deg);background:var(--template-accent);opacity:.2}.motif-beam i{right:13%;width:13%}.motif-beam b{right:1%;width:8%;background:var(--template-secondary)}
@media(max-width:680px){.template-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

function pickerElements(): {
  dialog: HTMLDialogElement; grid: HTMLElement; close: HTMLButtonElement;
} {
  const existing = document.querySelector<HTMLDialogElement>('#templateDialog');
  if (existing) return {
    dialog: existing,
    grid: existing.querySelector<HTMLElement>('#templateGrid')!,
    close: existing.querySelector<HTMLButtonElement>('#closeTemplateDialog')!,
  };
  const style = document.createElement('style');
  style.dataset.templatePicker = '';
  style.textContent = pickerCss;
  const dialog = document.createElement('dialog');
  dialog.id = 'templateDialog';
  dialog.className = 'template-dialog';
  dialog.setAttribute('aria-labelledby', 'templateDialogTitle');
  const head = document.createElement('div');
  head.className = 'template-dialog-head';
  const heading = document.createElement('div');
  const title = document.createElement('strong');
  title.id = 'templateDialogTitle';
  title.textContent = '新建演示文稿';
  const subtitle = document.createElement('small');
  subtitle.textContent = '选择一个可继续编辑的设计起点';
  heading.append(title, subtitle);
  const close = document.createElement('button');
  close.id = 'closeTemplateDialog';
  close.type = 'button';
  close.ariaLabel = '关闭模板选择';
  close.textContent = '×';
  const grid = document.createElement('div');
  grid.id = 'templateGrid';
  grid.className = 'template-grid';
  head.append(heading, close);
  dialog.append(head, grid);
  document.head.append(style);
  document.body.append(dialog);
  return { dialog, grid, close };
}

const blankPreview: BuiltinTemplatePreviewToken = {
  surface: '#FFFFFF', foreground: '#1F3864', accent: '#4472C4', secondary: '#70AD47', motif: 'rule',
};

function card(
  choice: NewDocumentChoice,
  description: string,
  preview: BuiltinTemplatePreviewToken,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'template-card';
  button.dataset.templateId = choice.kind === 'blank' ? 'blank' : choice.id;
  button.style.setProperty('--template-surface', preview.surface);
  button.style.setProperty('--template-foreground', preview.foreground);
  button.style.setProperty('--template-accent', preview.accent);
  button.style.setProperty('--template-secondary', preview.secondary);
  const canvas = document.createElement('span');
  canvas.className = `template-preview motif-${preview.motif}`;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.append(document.createElement('i'), document.createElement('b'));
  const title = document.createElement('strong');
  title.textContent = choice.name;
  const detail = document.createElement('small');
  detail.textContent = description;
  button.append(canvas, title, detail);
  return button;
}

/** 目录与配方只在用户打开选择器后加载；取消不会改变当前文稿。 */
export async function chooseNewDocument(): Promise<NewDocumentResult | null> {
  const { dialog, grid, close } = pickerElements();
  const choices = [
    {
      choice: { kind: 'blank', name: '空白' } as const,
      description: '兼容原有最小文稿', preview: blankPreview,
    },
    ...listBuiltinTemplates().map((template) => ({
      choice: { kind: 'template', id: template.id, name: template.name } as const,
      description: template.description, preview: template.preview,
    })),
  ];
  grid.replaceChildren(...choices.map(({ choice, description, preview }) =>
    card(choice, description, preview)));
  const selected = await new Promise<NewDocumentChoice | null>((resolve) => {
    let selected: NewDocumentChoice | null = null;
    const select = (event: Event): void => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-template-id]');
      if (!button) return;
      selected = choices.find(({ choice }) =>
        (choice.kind === 'blank' ? 'blank' : choice.id) === button.dataset.templateId)?.choice ?? null;
      dialog.close();
    };
    grid.addEventListener('click', select);
    dialog.addEventListener('close', () => {
      grid.removeEventListener('click', select);
      resolve(selected);
    }, { once: true });
    close.onclick = () => dialog.close();
    dialog.showModal();
    grid.querySelector<HTMLButtonElement>('button')?.focus();
  });
  if (!selected) return null;
  return {
    bytes: selected.kind === 'blank' ? createBlankPptx() : createPptxFromTemplate(selected.id),
    fileName: selected.kind === 'blank' ? '未命名演示文稿.pptx' : `${selected.name}演示文稿.pptx`,
    loadingMessage: `正在新建${selected.name}演示文稿`,
    noticeMessage: `正在准备${selected.name}演示文稿…`,
  };
}
