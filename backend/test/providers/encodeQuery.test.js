// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework, no mocking library in devDependencies). Exercises phase 3 task
// 3.1's exact acceptance criterion: the Cohere embed call receives inputType:
// 'search_query', and the returned vector is 1024-d.
//
// REQUIRES live Cohere credentials — intercepts the real CohereClient.embed call by
// monkey-patching its prototype for the duration of one call, rather than mocking the
// network layer, so the request shape asserted here is the exact one that reaches Cohere.
import assert from 'assert';
import { CohereClient } from 'cohere-ai';
import { encodeQuery } from '../../src/providers/embeddings.js';

const originalEmbed = CohereClient.prototype.embed;
let capturedRequest = null;

CohereClient.prototype.embed = function patchedEmbed(req) {
  capturedRequest = req;
  return originalEmbed.call(this, req);
};

try {
  const result = await encodeQuery('what is EMEA revenue');

  assert.ok(capturedRequest, 'CohereClient.embed was called');
  assert.strictEqual(
    capturedRequest.inputType, 'search_query',
    `expected inputType "search_query", got "${capturedRequest.inputType}"`,
  );
  console.log('[encodeQuery.test] PASS — Cohere embed call carried inputType: "search_query"');

  assert.strictEqual(result.vector.length, 1024, `expected a 1024-d vector, got ${result.vector.length}`);
  console.log('[encodeQuery.test] PASS — returned vector is 1024-d');
} finally {
  CohereClient.prototype.embed = originalEmbed;
}

console.log('[encodeQuery.test] ALL PASS');
