export async function processBody(req: Request): Promise<Record<string, any>> {
  const MAX_BODY_SIZE = 20 * 1024 * 1024; // 20MB

  switch (req.method) {
    case 'GET':
    case 'HEAD': {
      const url = new URL(req.url);
      return Object.fromEntries(url.searchParams.entries());
    }
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE': {
      const contentLength = req.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        throw new Error('Payload Too Large');
      }

      if (!req.body) return {};

      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalBytes += value.length;

          if (totalBytes > MAX_BODY_SIZE) {
            await reader.cancel();
            throw new Error('Payload Too Large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const bodyBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bodyBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const tempReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: bodyBuffer,
      });

      const type = req.headers.get('content-type') || '';

      switch (true) {
        case type.includes('application/json'):
          return (await tempReq.json()) as any;

        case type.includes('application/x-www-form-urlencoded'):
        case type.includes('multipart/form-data'):
          const formData = await tempReq.formData();
          return Object.fromEntries(formData.entries());

        // if blob or image, return as is
        case type.includes('application/'):
        case type.includes('audio/'):
        case type.includes('video/'):
        case type.includes('model/'):
        case type.includes('image/'):
          return {
            file: await tempReq.blob(),
          };

        default:
          return {
            data: await tempReq.text(),
          };
      }
    }
    default:
      return {};
  }
}
