export function bindMobileNav(): void {
  const menu = document.querySelector<HTMLDetailsElement>('.mobile-nav-more');
  if (!menu) return;

  menu.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) menu.open = false;
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menu.open = false;
    menu.querySelector('summary')?.focus();
  });
  document.addEventListener('click', (event) => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
}
