#!/usr/bin/env bash
#
# Titan CLI test runner with structured console output and JSON log capture.
#
#   ./scripts/test-titan.sh [--run PATTERN] [--sequential] [--verbose-output]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVAGO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${TITAN_TEST_LOG_DIR:-$AVAGO_DIR/test-results}"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/titan-${TIMESTAMP}.log"
LATEST_LINK="$LOG_DIR/latest.log"

RUN_FILTER=""
SEQUENTIAL=false
VERBOSE_OUTPUT=false
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      RUN_FILTER="$2"
      shift 2
      ;;
    --sequential|-s)
      SEQUENTIAL=true
      shift
      ;;
    --verbose-output|-vv)
      VERBOSE_OUTPUT=true
      shift
      ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -t 1 ]]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  DIM='\033[0;2m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' RED='' YELLOW='' CYAN='' DIM='' BOLD='' RESET=''
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for colored test output — install: sudo apt-get install -y jq" >&2
  exit 1
fi

export PATH="${HOME}/.local/go/bin:/usr/local/go/bin:${PATH}"

TEST_ARGS=(
  -count=1
  -json
  ./cmd/titan/...
)
if [[ -n "$RUN_FILTER" ]]; then
  TEST_ARGS+=(-run "$RUN_FILTER")
fi
if $SEQUENTIAL; then
  TEST_ARGS+=(-p 1 -parallel 1)
fi
if ((${#EXTRA_ARGS[@]} > 0)); then
  TEST_ARGS+=("${EXTRA_ARGS[@]}")
fi

PASS=0
FAIL=0
SKIP=0
declare -a FAILED_TESTS=()
declare -A TEST_OUTPUT=()

echo -e "${BOLD}Titan CLI tests${RESET}  ${DIM}(logging to $LOG_FILE)${RESET}"
echo ""

handle_line() {
  local line="$1"
  printf '%s\n' "$line" >>"$LOG_FILE"

  local action test output elapsed package
  action="$(printf '%s' "$line" | jq -r '.Action // empty')"
  test="$(printf '%s' "$line" | jq -r '.Test // empty')"
  output="$(printf '%s' "$line" | jq -r '.Output // empty')"
  elapsed="$(printf '%s' "$line" | jq -r '.Elapsed // 0')"
  package="$(printf '%s' "$line" | jq -r '.Package // empty')"

  case "$action" in
    run)
      if [[ -n "$test" ]]; then
        TEST_OUTPUT["$test"]=""
        echo -e "${CYAN}▶ RUN${RESET}   ${BOLD}$test${RESET}"
      elif [[ -n "$package" ]]; then
        echo -e "${DIM}── package $package ──${RESET}"
      fi
      ;;
    pause|cont)
      if $VERBOSE_OUTPUT && [[ -n "$test" ]]; then
        echo -e "${DIM}  … $test ($action)${RESET}"
      fi
      ;;
    output)
      if [[ -n "$test" && -n "$output" ]]; then
        TEST_OUTPUT["$test"]+="$output"
        if $VERBOSE_OUTPUT; then
          printf '%s' "$output" | while IFS= read -r oline || [[ -n "$oline" ]]; do
            echo -e "${DIM}  │ ${oline}${RESET}"
          done
        fi
      fi
      ;;
    pass)
      if [[ -n "$test" ]]; then
        PASS=$((PASS + 1))
        echo -e "${GREEN}✓ PASS${RESET}  $test ${DIM}(${elapsed}s)${RESET}"
        unset 'TEST_OUTPUT[$test]'
      fi
      ;;
    fail)
      if [[ -n "$test" ]]; then
        FAIL=$((FAIL + 1))
        FAILED_TESTS+=("$test")
        echo -e "${RED}✗ FAIL${RESET}  $test ${DIM}(${elapsed}s)${RESET}"
        if ! $VERBOSE_OUTPUT && [[ -n "${TEST_OUTPUT[$test]:-}" ]]; then
          printf '%s' "${TEST_OUTPUT[$test]}" | while IFS= read -r oline || [[ -n "$oline" ]]; do
            echo -e "    ${RED}${oline}${RESET}"
          done
        fi
      fi
      ;;
    skip)
      if [[ -n "$test" ]]; then
        SKIP=$((SKIP + 1))
        echo -e "${YELLOW}○ SKIP${RESET}  $test"
      fi
      ;;
  esac
}

cd "$AVAGO_DIR"

set +e
while IFS= read -r line; do
  handle_line "$line"
done < <(go test "${TEST_ARGS[@]}" 2>&1)
GO_EXIT=$?
set -e

ln -sf "$(basename "$LOG_FILE")" "$LATEST_LINK"

echo ""
echo -e "${BOLD}────────────────────────────────────────${RESET}"
TOTAL=$((PASS + FAIL + SKIP))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}PASS${RESET}  ${PASS}/${TOTAL} tests passed"
else
  echo -e "${RED}${BOLD}FAIL${RESET}  ${FAIL} failed, ${PASS} passed, ${SKIP} skipped"
  if ((${#FAILED_TESTS[@]} > 0)); then
    echo ""
    echo -e "${RED}${BOLD}Failed tests:${RESET}"
    for name in "${FAILED_TESTS[@]}"; do
      echo -e "  ${RED}• $name${RESET}"
    done
  fi
fi
echo -e "${DIM}Log: $LOG_FILE${RESET}"
echo -e "${DIM}Latest: $LATEST_LINK  (tail -f while re-running)${RESET}"

exit "$GO_EXIT"