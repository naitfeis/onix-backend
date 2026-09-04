type Props = {
  onSupport: () => void;
  onTickets: () => void;
};

const MAIL = 'onixtg.shop@gmail.com';

export default function SiteFooter({ onSupport, onTickets }: Props) {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <strong>ONIX</strong>
        <p>© {year} ONIX, биржа игровых товаров с эскроу</p>
        <p><a href={`mailto:${MAIL}`}>{MAIL}</a></p>
      </div>
      <div className="site-footer__col">
        <h3>Информация</h3>
        <a href="/rules.html">Правила</a>
        <a href="/developers/index.html">Документация API</a>
        <a href="/terms.html">Пользовательское соглашение</a>
        <a href="/privacy.html">Политика конфиденциальности</a>
        <a href="/cookies.html">Политика cookie</a>
        <a href="/data-policy.html">Правила сбора данных</a>
      </div>
      <div className="site-footer__col">
        <h3>Помощь</h3>
        <button type="button" onClick={onSupport}>Написать в поддержку</button>
        <button type="button" onClick={onTickets}>Мои тикеты</button>
        <a href="/contacts.html">Контакты</a>
      </div>
      <div className="site-footer__social">
        <a className="site-footer__icon" href="https://t.me/Onixshop_bot" target="_blank" rel="noopener noreferrer" aria-label="Telegram">TG</a>
      </div>
    </footer>
  );
}
