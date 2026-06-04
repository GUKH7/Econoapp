const Module = require('node:module');
const path = require('node:path');

const originalResolveFilename = Module._resolveFilename;
const distSrc = path.join(__dirname, 'dist', 'src');

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(
      this,
      path.join(distSrc, request.slice(2)),
      parent,
      isMain,
      options,
    );
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
