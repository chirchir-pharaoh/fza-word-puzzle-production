const { handleRequest } = require('../server/http');

// Single Vercel Function for every /api/* route.
// vercel.json rewrites /api/:path* to this file while preserving the path in
// the query string. One function keeps the Hobby/free-function count low.
module.exports = async function handler(req, res){
  await handleRequest(req, res);
};
