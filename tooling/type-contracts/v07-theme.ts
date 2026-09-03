import type { PresentationTheme } from '@web-ppt/core';
import type { SetThemeCommand, ThemeState } from '@web-ppt/edit-core';
import { listThemes, openEditor, queryTheme } from '@web-ppt/editor';
import type { SetThemeCommand as ReactThemeCommand, ThemeState as ReactThemeState } from '@web-ppt/react';
import type { SetThemeCommand as VueThemeCommand, ThemeState as VueThemeState } from '@web-ppt/vue';

async function themeJourney(input: Uint8Array): Promise<void> {
  const session = await openEditor(input, { idPrefix: 'type-v07-' });
  const theme = listThemes(session.editor.doc)[0];
  const state: ThemeState = queryTheme(session.editor.doc, theme.id);
  const command: SetThemeCommand = {
    type: 'SetTheme', id: state.id,
    clrScheme: { accent1: '#112233' },
    fontScheme: { minor: { latin: 'Theme Latin' } },
  };
  session.editor.exec(command);
  void (command satisfies ReactThemeCommand);
  void (command satisfies VueThemeCommand);
  void (state satisfies ReactThemeState);
  void (state satisfies VueThemeState);
  void (state satisfies Pick<PresentationTheme, 'id' | 'name' | 'colors' | 'fonts'>);
  session.dispose();
}

void themeJourney;
