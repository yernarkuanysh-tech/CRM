import {useState} from 'react';
import {GoogleConnectButton, GoogleLoadButton, GoogleResultView, type GoogleResult} from '../components/Google';
import {Shell} from '../components/Shell';
import {card, cx, Heading} from '../components/ui';

const description = 'min-h-62 text-[13px] leading-[1.6] text-muted';

export function IntegrationsPage() {
  const [result, setResult] = useState<GoogleResult | null>(null);
  return (
    <Shell active="integrations">
      <Heading title="Интеграции" text="Документы и переписка в карточках клиентов." />
      <div className="grid grid-cols-[repeat(3,1fr)] gap-18 max-md:grid-cols-[1fr]">
        <article className={cx('p-23', card)}>
          <h2 className="mb-10">Google Drive и Docs</h2>
          <p className={description}>Ссылки на папки и документы работают сразу. Для просмотра содержимого папок подключите ваш Google-аккаунт.</p>
          <GoogleConnectButton kind="drive">Подключить Google Drive</GoogleConnectButton>
        </article>
        <article className={cx('p-23', card)}>
          <h2 className="mb-10">Gmail</h2>
          <p className={description}>Подключение отдельно в карточке клиента. Чтение последних писем; отправка от имени клиента не включена.</p>
          <a href="#clients">Выбрать клиента</a>
        </article>
        <article className={cx('p-23', card)}>
          <h2 className="mb-10">WhatsApp</h2>
          <p className={description}>Переход в чат по номеру клиента. Отчёт PDF можно прикрепить в WhatsApp вручную.</p>
          <a href="#clients">Открыть клиентов</a>
        </article>
      </div>
      <GoogleLoadButton action="status" className="mt-24" onResult={setResult}>Проверить подключения</GoogleLoadButton>
      <GoogleResultView result={result} />
    </Shell>
  );
}
