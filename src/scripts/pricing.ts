/** Monthly / yearly switch on the pricing table. Prices are already in the markup. */
export function initPricingToggle(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-pricing]')) {
    const buttons = root.querySelectorAll<HTMLButtonElement>('button[data-period]');
    const apply = (period: 'monthly' | 'yearly') => {
      for (const button of buttons) {
        const on = button.dataset['period'] === period;
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('bg-accent', on);
        button.classList.toggle('text-accent-ink', on);
        button.classList.toggle('text-muted', !on);
      }
      for (const price of root.querySelectorAll<HTMLElement>('[data-monthly]')) {
        price.textContent = price.dataset[period] ?? price.textContent;
      }
      for (const note of root.querySelectorAll<HTMLElement>('[data-period-note]')) {
        note.hidden = note.dataset['periodNote'] !== period;
      }
    };
    for (const button of buttons) {
      button.addEventListener('click', () => apply(button.dataset['period'] === 'yearly' ? 'yearly' : 'monthly'));
    }
    apply('monthly');
  }
}
