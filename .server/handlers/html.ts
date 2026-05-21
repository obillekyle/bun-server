import { assembleHtml } from '../utils/html-utils';

export async function handleHTML(
  file: any,
  isDevWorker: boolean,
): Promise<Response> {
  let html = await file.text();
  html = assembleHtml(html, isDevWorker);
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
