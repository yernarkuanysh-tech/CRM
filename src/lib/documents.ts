import {check, errorMessage, supabase} from './api';
import type {ClientDocument} from '../types';

const bucket = 'client-documents';

// Must match the bucket settings in supabase/migrations/20261010120000_client_documents.sql.
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx,.txt,.zip';

const path = (doc: Pick<ClientDocument, 'clientId' | 'id'>) => `${doc.clientId}/${doc.id}`;

export function validateDocument(file: {name: string; size: number}) {
  if (!file.size) throw Error(`Файл «${file.name}» пустой.`);
  if (file.size > MAX_DOCUMENT_SIZE) throw Error(`Файл «${file.name}» больше 20 МБ.`);
  if (file.name.length > 255) throw Error('Слишком длинное имя файла.');
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

export async function listDocuments(clientId: string): Promise<ClientDocument[]> {
  const {data} = check(await supabase.from('client_documents').select('id, client_id, name, size, mime_type, created_at')
    .eq('client_id', clientId).order('created_at', {ascending: false}));
  return data!.map(row => ({id: row.id, clientId: row.client_id, name: row.name, size: row.size, mimeType: row.mime_type, createdAt: row.created_at}));
}

/** Uploads the file first, then records it; a failed record removes the orphaned file. */
export async function uploadDocument(clientId: string, file: File): Promise<void> {
  validateDocument(file);
  const doc = {id: crypto.randomUUID(), clientId};
  const upload = await supabase.storage.from(bucket).upload(path(doc), file, {contentType: file.type || undefined});
  if (upload.error) throw Error(/mime|type/i.test(upload.error.message) ? `Тип файла «${file.name}» не поддерживается.` : errorMessage(upload.error));
  const {error} = await supabase.from('client_documents').insert({id: doc.id, client_id: clientId, name: file.name, size: file.size, mime_type: file.type});
  if (error) {
    await supabase.storage.from(bucket).remove([path(doc)]);
    throw Error(errorMessage(error));
  }
}

export async function downloadDocument(doc: ClientDocument) {
  const {data, error} = await supabase.storage.from(bucket).createSignedUrl(path(doc), 60, {download: doc.name});
  if (error) throw Error(errorMessage(error));
  Object.assign(document.createElement('a'), {href: data.signedUrl}).click();
}

/** Deletes the record first: a leftover file is invisible, a record without a file is not. */
export async function deleteDocument(doc: ClientDocument) {
  check(await supabase.from('client_documents').delete().eq('id', doc.id));
  await supabase.storage.from(bucket).remove([path(doc)]);
}

/** Removes the stored files of deleted clients (their records go with the client row). Best-effort. */
export async function removeClientFiles(clientIds: string[]) {
  for (const clientId of clientIds) {
    const {data, error} = await supabase.storage.from(bucket).list(clientId, {limit: 1000});
    if (error) throw Error(errorMessage(error));
    if (data?.length) check(await supabase.storage.from(bucket).remove(data.map(file => `${clientId}/${file.name}`)));
  }
}
