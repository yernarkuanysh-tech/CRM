import type {ReactNode} from 'react';
import type {AppStatus} from '../types';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

export const subtle = 'text-[12px] tracking-[.015em] text-muted';
export const card = 'rounded-[8px] border border-line bg-white shadow-card';
export const localNote = 'mt-19 text-[11px] leading-[1.6] tracking-[.015em] text-muted max-md:max-w-[70ch]';
export const quietLink = 'mt-18 inline-block text-[12px] text-link';
export const errorText = 'text-[12px] text-danger';

const iconPaths = {
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',
  check: 'm5 12 4 4L19 6',
  mail: 'M3 5h18v14H3z m0 0 9 7 9-7',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  file: 'M14 2H4v20h16V8z M14 2v6h6 M8 13h8 M8 17h6',
  arrow: 'm14 6-6 6 6 6',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  hat: 'm2 9 10-5 10 5-10 5z M6 11v6q6 5 12 0v-6 M22 9v7',
};

export type IconName = keyof typeof iconPaths;

export function Icon({name, className}: {name: IconName; className?: string}) {
  return (
    <svg className={cx('size-18 shrink-0 align-middle', className)} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function BrandLogo({organization, compact = false, large = false}: {organization: string; compact?: boolean; large?: boolean}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-11">
      <span className={cx('grid flex-none place-items-center overflow-hidden rounded-[6px] border border-line bg-white shadow-mark', large ? 'size-46 p-5' : 'size-38 p-4 max-md:size-34')} aria-hidden="true">
        <img className="brand-logo-image block size-full object-contain" src="/granted-logo-mark.jpg" width="132" height="161" alt="" />
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-[1.05]">
          <strong className="truncate text-[17px] font-semibold tracking-[-.025em] text-ink">{organization || 'GrantEd'}</strong>
          <small className="mt-5 font-mono text-[9px] font-semibold tracking-[.04em] text-faint uppercase max-md:hidden">Admissions CRM</small>
        </span>
      )}
    </span>
  );
}

const avatarTones = ['bg-tint text-ink', 'bg-[#e9f2ee] text-[#38705b]', 'bg-[#f7eee4] text-[#8a6241]', 'bg-[#edeaf4] text-[#6b5688]'];

export function Avatar({children, tone = 0, className = 'size-35 text-[12px]'}: {children: ReactNode; tone?: number; className?: string}) {
  return <span className={cx('grid shrink-0 place-items-center rounded-full font-semibold', avatarTones[tone % 4], className)}>{children}</span>;
}

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-line bg-tint text-ink-soft',
  blue: 'border-[#d3e5ff] bg-[#e6f1ff] text-[#0761d1]',
  green: 'border-[#d3e5ff] bg-[#e6f1ff] text-[#0761d1]',
  amber: 'border-[#f8dfa9] bg-warning-bg text-warning',
  red: 'border-[#efb8bb] bg-[#f7d4d6] text-[#c50000]',
};

export function Badge({tone = 'neutral', children}: {tone?: BadgeTone; children: ReactNode}) {
  return <span className={cx('inline-block rounded-full border px-7 py-5 text-[11px] tracking-[.01em]', badgeTones[tone])}>{children}</span>;
}

const statusTone = (s: AppStatus): BadgeTone => s === 'Оффер' ? 'green' : s === 'Подана' ? 'blue' : s === 'Интервью' || s === 'Документы' ? 'amber' : s === 'Отказ' ? 'red' : 'neutral';

export const StatusBadge = ({status}: {status: AppStatus}) => <Badge tone={statusTone(status)}>{status}</Badge>;

export function Empty({children}: {children: ReactNode}) {
  return <div className="rounded-[8px] border border-dashed border-control bg-canvas px-22 py-42 text-center leading-[1.7] text-muted">{children}</div>;
}

export const EmptyTitle = ({children}: {children: ReactNode}) => <h3 className="text-ink">{children}</h3>;

export function Notice({children, className}: {children: ReactNode; className?: string}) {
  return <div className={cx('mb-20 rounded-[7px] bg-canvas px-16 py-13 text-[12px] leading-[1.6] text-ink-soft', className)}>{children}</div>;
}

export function SectionTop({children, margin = 'mb-17'}: {children: ReactNode; margin?: string}) {
  return <div className={cx('flex items-center justify-between gap-12', margin)}>{children}</div>;
}

export function BtnRow({children}: {children: ReactNode}) {
  return <div className="flex flex-wrap items-center gap-9 [&_button]:flex [&_button]:items-center [&_button]:gap-7">{children}</div>;
}

export function TableWrap({children, className}: {children: ReactNode; className?: string}) {
  return <div className={cx('overflow-auto', card, className)}><table>{children}</table></div>;
}

export function Heading({title, text, avatar, children}: {title: ReactNode; text?: ReactNode; avatar?: ReactNode; children?: ReactNode}) {
  const copy = (
    <div>
      <h1 className="m-0 mb-7 text-[32px] leading-[40px] font-semibold tracking-[-.04em] text-ink max-md:text-[28px] max-md:leading-[34px]">{title}</h1>
      {text !== undefined && <p className="m-0 leading-[1.5] text-ink-soft max-md:text-[12px]">{text}</p>}
    </div>
  );
  return (
    <div className="mb-32 flex items-center justify-between gap-15 max-md:items-start max-sm:flex-wrap">
      {avatar ? <div className="flex items-center gap-15">{avatar}{copy}</div> : copy}
      {children}
    </div>
  );
}

export function Person({avatar, children}: {avatar: ReactNode; children: ReactNode}) {
  return <div className="flex items-center gap-10">{avatar}<div>{children}</div></div>;
}

export const PersonSmall = ({children, className = 'mt-4 text-[11px] tracking-[.01em]'}: {children: ReactNode; className?: string}) =>
  <small className={cx('block text-muted', className)}>{children}</small>;

export function Options({items, labels}: {items: readonly string[]; labels?: Record<string, string>}) {
  return <>{items.map(s => <option key={s} value={s}>{labels?.[s] ?? s}</option>)}</>;
}

export function FormFooter({label = 'Сохранить', error, onCancel}: {label?: string; error: string; onCancel: () => void}) {
  return (
    <>
      <p className="text-[12px]" id="form-error" role="alert">{error}</p>
      <div className="mt-23 flex justify-end gap-8">
        <button type="button" onClick={onCancel}>Отмена</button>
        <button type="submit" className="primary">{label}</button>
      </div>
    </>
  );
}

export function PasswordField({name, label, className}: {name: 'currentPassword' | 'newPassword' | 'confirmPassword'; label: string; className?: string}) {
  const current = name === 'currentPassword';
  return (
    <label className={className}>
      {label}
      <input type="password" name={name} required minLength={current ? 1 : 12} maxLength={256} autoComplete={current ? 'current-password' : 'new-password'} />
    </label>
  );
}
