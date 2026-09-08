import { PasswordRequiredError, WrongPasswordError } from '@web-ppt/core';
import { setAttributeText, setText } from './i18n/runtime';

export { PasswordRequiredError, WrongPasswordError } from '@web-ppt/core';

type PasswordAttempt<T> = (password?: string) => Promise<T>;

function needsPassword(error: unknown): error is PasswordRequiredError | WrongPasswordError {
  return error instanceof PasswordRequiredError || error instanceof WrongPasswordError;
}

function buildDialog(name: string): {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  feedback: HTMLElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
} {
  const dialog = document.createElement('dialog');
  dialog.id = 'viewerPasswordDialog';
  dialog.className = 'password-dialog';
  dialog.setAttribute('aria-labelledby', 'viewerPasswordTitle');
  dialog.setAttribute('aria-describedby', 'viewerPasswordDescription viewerPasswordFeedback');
  dialog.innerHTML = `<form id="viewerPasswordForm" method="dialog">
    <h2 id="viewerPasswordTitle"></h2>
    <p id="viewerPasswordDescription"></p>
    <label for="viewerPassword"></label>
    <input id="viewerPassword" name="password" type="password" autocomplete="current-password">
    <p id="viewerPasswordFeedback" role="status" aria-live="polite"></p>
    <footer>
      <button id="viewerPasswordCancel" type="button"></button>
      <button id="viewerPasswordSubmit" type="submit" class="primary"></button>
    </footer>
  </form>`;

  setAttributeText(dialog, 'aria-label', '输入打开密码');
  setText(dialog.querySelector('h2')!, '输入打开密码');
  setText(dialog.querySelector('#viewerPasswordDescription')!, '“{name}” 已加密。密码只在本机用于解密，不会上传。', { name });
  setText(dialog.querySelector('label')!, '密码');
  setAttributeText(dialog.querySelector('input')!, 'placeholder', '请输入密码');
  setText(dialog.querySelector('#viewerPasswordCancel')!, '取消');
  setText(dialog.querySelector('#viewerPasswordSubmit')!, '打开文稿');

  return {
    dialog,
    form: dialog.querySelector('form')!,
    input: dialog.querySelector('input')!,
    feedback: dialog.querySelector('#viewerPasswordFeedback')!,
    submit: dialog.querySelector('#viewerPasswordSubmit')!,
    cancel: dialog.querySelector('#viewerPasswordCancel')!,
  };
}

/**
 * 首次解析只负责发现加密；需要口令时才创建 UI，并始终用同一个输入闭包重试。
 * 口令提交后立即从 DOM 清空，成功、取消或异常时整个对话框都会移除。
 */
export async function openWithPresentationPassword<T>(
  name: string,
  attempt: PasswordAttempt<T>,
): Promise<T | null> {
  try {
    return await attempt();
  } catch (error) {
    if (!needsPassword(error)) throw error;
  }

  return new Promise<T | null>((resolve, reject) => {
    const { dialog, form, input, feedback, submit, cancel } = buildDialog(name);
    let settled = false;

    const cleanup = (): void => {
      input.value = '';
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const showWrongPassword = (): void => {
      feedback.setAttribute('role', 'alert');
      setText(feedback, '密码错误，请重试');
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (settled || submit.disabled) return;
      const password = input.value;
      input.value = '';
      input.disabled = true;
      submit.disabled = true;
      feedback.setAttribute('role', 'status');
      setText(feedback, '正在验证密码…');
      void attempt(password).then(finish, (error) => {
        if (needsPassword(error)) showWrongPassword();
        else fail(error);
      });
    });
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
