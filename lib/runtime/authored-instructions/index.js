// @ts-check
'use strict';

const {
  createTransposeSuccess,
  createTransposeFailure,
  createValidationSuccess,
  createValidationFailure,
} = require('./contracts');
const {
  DOCUMENTED_CONTEXT_SYMBOLS,
  resolveContextSymbol,
  resolveScopedReference,
  currentAreaRef,
  expandRoomRef,
  resolveRoomReference,
} = require('./reference-resolution');
const { transposeAuthoredInstructions } = require('./transposer');
const { validateAuthoredInstructions } = require('./validator');

module.exports = {
  createTransposeSuccess,
  createTransposeFailure,
  createValidationSuccess,
  createValidationFailure,
  DOCUMENTED_CONTEXT_SYMBOLS,
  resolveContextSymbol,
  resolveScopedReference,
  currentAreaRef,
  expandRoomRef,
  resolveRoomReference,
  transposeAuthoredInstructions,
  validateAuthoredInstructions,
};
