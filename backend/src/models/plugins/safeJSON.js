'use strict';
/**
 * Mongoose plugin: consistent JSON output.
 * - exposes `id`, removes `__v`
 * - strips any field listed in `hidden` (e.g. passwordHash, encryption material)
 */
module.exports = function safeJSON(schema, { hidden = [] } = {}) {
  const transform = (doc, ret) => {
    delete ret.__v;
    for (const field of hidden) delete ret[field];
    return ret;
  };
  schema.set('toJSON', { virtuals: true, versionKey: false, transform });
  schema.set('toObject', { virtuals: true, versionKey: false, transform });
};
