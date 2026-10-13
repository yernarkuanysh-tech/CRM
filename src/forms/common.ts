import {useRef, useState, type FormEvent} from 'react';
import {errorMessage} from '../lib/api';

export const trimmedValues = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()])) as Record<string, string>;

export const rawValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string, string>;

/** Form submit handler with an inline error message; errors thrown by `action` are shown in the form. */
export function useFormAction(action: (form: HTMLFormElement) => Promise<void> | void) {
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const form = event.currentTarget;
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])'));
    const disabled = buttons.map(button => button.disabled);
    buttons.forEach(button => { button.disabled = true; });
    setError('');
    try {
      await action(form);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      pending.current = false;
      buttons.forEach((button, index) => { button.disabled = disabled[index]; });
    }
  }
  return {error, onSubmit};
}
