export async function handleStatic(file: any): Promise<Response> {
  return new Response(file);
}
