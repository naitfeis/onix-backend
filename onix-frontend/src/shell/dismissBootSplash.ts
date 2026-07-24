/** Hide the HTML boot splash once React has mounted the shell. */
export function dismissBootSplash(): void {
  const el = document.getElementById('onix-boot');
  if (!el) return;
  el.classList.add('is-done');
  window.setTimeout(() => {
    el.remove();
  }, 320);
}
