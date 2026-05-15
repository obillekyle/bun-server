import { jsonResponse } from '@server/utils';

export default respond(async (req) => {
  return jsonResponse(200, 'pong');
});
