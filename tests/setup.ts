/**
 * Test setup - runs before all tests
 *
 * Suppresses console output during tests to reduce noise.
 * Set VERBOSE_TESTS=1 to see logs during debugging.
 */

if (!process.env["VERBOSE_TESTS"]) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.error = noop;
  console.warn = noop;
}
