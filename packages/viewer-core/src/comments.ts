import type { Slide } from '@web-ppt/core';

export interface CommentsPanel {
  setSlide(slide: Pick<Slide, 'comments'> | null): void;
  dispose(): void;
}

/** 只读目录独立加载；内容只进入文本节点，不能被当成宿主 HTML 或翻译词条。 */
export function createCommentsPanel(container: HTMLElement, emptyLabel = 'No comments on this slide'): CommentsPanel {
  const document = container.ownerDocument;
  const root = document.createElement('section'), list = document.createElement('ol'), empty = document.createElement('p');
  root.dataset.commentsPanel = '';
  empty.dataset.commentsEmpty = ''; empty.textContent = emptyLabel;
  list.style.paddingInlineStart = '28px';
  root.append(list, empty); container.append(root);
  let disposed = false;
  return {
    setSlide(slide) {
      if (disposed) return;
      list.replaceChildren();
      const comments = slide?.comments ?? [];
      empty.hidden = !!comments.length; list.hidden = !comments.length;
      comments.forEach((comment, index) => {
        const item = document.createElement('li'), author = document.createElement('strong'), text = document.createElement('p');
        item.value = comment.idx ?? index + 1;
        item.style.marginBlock = '16px';
        author.textContent = comment.author;
        text.textContent = comment.text;
        text.style.whiteSpace = 'pre-wrap'; text.style.overflowWrap = 'anywhere';
        item.append(author);
        if (comment.date) {
          const time = document.createElement('time'); time.textContent = ` · ${comment.date}`; item.append(time);
        }
        item.append(text); list.append(item);
      });
    },
    dispose() { disposed = true; root.remove(); },
  };
}
