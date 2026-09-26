#!/bin/bash
export RUN_LIFECYCLE_TESTS=1
for i in {1..20}; do
  echo "Run $i"
  npx jest --runInBand src/infrastructure/lifecycle/lifecycle.integration.test.ts -t "both finite local batch exits after browser cleanup" || { echo "Failed on run $i"; exit 1; }
done
echo "All runs passed"
