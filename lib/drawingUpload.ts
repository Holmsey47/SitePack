/**
 * Upload the PDF, then insert the drawing row.
 * A refused insert deletes the object that was just uploaded.
 * The previous current drawing is left alone because the insert never committed.
 */
export async function commitDrawingFile<TUploaded extends { storagePath: string }, T>(deps: {
  upload: () => Promise<TUploaded>;
  insert: (uploaded: TUploaded) => Promise<T>;
  remove: (storagePath: string) => Promise<void>;
}): Promise<T> {
  const uploaded = await deps.upload();
  try {
    return await deps.insert(uploaded);
  } catch (insertError) {
    try {
      await deps.remove(uploaded.storagePath);
    } catch (removeError) {
      const insertMessage = insertError instanceof Error ? insertError.message : 'insert_failed';
      const removeMessage = removeError instanceof Error ? removeError.message : 'delete_failed';
      throw new Error(`${insertMessage} (the file was not removed: ${removeMessage})`);
    }
    throw insertError;
  }
}
