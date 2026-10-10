import {createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

type Toast = (text: string) => void;
const ToastContext = createContext<Toast>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({children}: {children: ReactNode}) {
  const element = document.getElementById('toast')!;
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback<Toast>(value => {
    setText(value);
    element.classList.replace('hidden', 'block');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => element.classList.replace('block', 'hidden'), 3200);
  }, [element]);
  return <ToastContext.Provider value={toast}>{children}{createPortal(text, element)}</ToastContext.Provider>;
}

interface ModalApi {
  open(title: string, body: ReactNode): void;
  close(): void;
}

const ModalContext = createContext<ModalApi>({open() {}, close() {}});
export const useModal = () => useContext(ModalContext);

export function ModalProvider({children}: {children: ReactNode}) {
  const dialog = document.getElementById('modal') as HTMLDialogElement;
  const [modal, setModal] = useState<{title: string; body: ReactNode; key: number} | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const onClose = () => setModal(null);
    dialog.addEventListener('close', onClose);
    return () => {
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
    };
  }, [dialog]);

  useEffect(() => {
    if (modal && !dialog.open) dialog.showModal();
    if (!modal && dialog.open) dialog.close();
  }, [dialog, modal]);

  const value = useMemo<ModalApi>(() => ({
    open: (title, body) => setModal({title, body, key: ++counter.current}),
    close: () => setModal(null),
  }), []);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {modal && createPortal(
        <Fragment key={modal.key}>
          <div className="flex items-center justify-between border-b border-line px-24 pt-23 pb-17">
            <h2>{modal.title}</h2>
            <button className="px-8 py-5" onClick={value.close} aria-label="Закрыть">×</button>
          </div>
          <div className="modal-body px-24 py-23">{modal.body}</div>
        </Fragment>,
        dialog,
      )}
    </ModalContext.Provider>
  );
}
