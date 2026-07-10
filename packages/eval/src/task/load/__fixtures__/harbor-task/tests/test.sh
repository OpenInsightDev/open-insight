#!/bin/bash
set -euo pipefail

test "$(cat /app/result.txt)" = "$EXPECTED"
echo 1 > /logs/verifier/reward.txt
