import {useState, type FormEvent} from 'react';
import {errorMessage} from '../lib/api';

export const trimmedValues = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()])) as Record<string, string>;

export const rawValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string, string>;

/** Form submit handler with an inline error message; errors thrown by `action` are shown in the form. */
export function useFormAction(action: (form: HTMLFormElement) => Promise<void> | void) {
  const [error, setError] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await action(event.currentTarget);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return {error, onSubmit};
}
