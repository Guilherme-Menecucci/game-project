import { describe, it } from 'vitest'

describe('CI gate verification', () => {
  // Un-skip this test to verify CI goes red.
  // Steps:
  //   1. Remove `.skip` from the test below
  //   2. Push to any branch
  //   3. Confirm the CI "test" job fails (red)
  //   4. Restore `.skip` and push again — CI must go green
  //   5. This satisfies Phase 1 Success Criterion 3
  it.skip('INTENTIONAL FAILURE — used to verify CI goes red', () => {
    throw new Error('This test is intentionally failing. Restore .skip after CI verification.')
  })
})
