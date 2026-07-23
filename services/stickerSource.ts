export const imageSourceToBlob = async (source: string): Promise<Blob> => {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not preserve the paid source image (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('The paid source image was empty.');
  return blob.type === 'image/png' ? blob : new Blob([await blob.arrayBuffer()], { type: blob.type || 'image/png' });
};
