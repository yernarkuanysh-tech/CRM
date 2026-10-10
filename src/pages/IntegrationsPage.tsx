import {Shell} from '../components/Shell';
import {card, cx, Heading} from '../components/ui';

export function IntegrationsPage() {
  return (
    <Shell active="integrations">
      <Heading title="Интеграции" text="Переписка с клиентами." />
      <div className="grid grid-cols-[repeat(3,1fr)] gap-18 max-md:grid-cols-[1fr]">
        <article className={cx('p-23', card)}>
          <h2 className="mb-10">WhatsApp</h2>
          <p className="min-h-62 text-[13px] leading-[1.6] text-muted">Переход в чат по номеру клиента. Отчёт PDF можно прикрепить в WhatsApp вручную.</p>
          <a href="#clients">Открыть клиентов</a>
        </article>
      </div>
    </Shell>
  );
}
