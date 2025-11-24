#!/bin/sh

TASKS_BEFORE=$(grep "\- \[ \]" ./tmp/HOUSEKEEPING.md | wc -l)

if [ "$TASKS_BEFORE" -eq 0 ]; then
    echo "no tasks remaining in document, exiting..."
    exit 0
fi

PROMPT=$(cat ./tmp/housekeeping.prompt)
RESPONSE=$(claude --dangerously-skip-permissions -p "$PROMPT")
echo "$RESPONSE"
TASKS_AFTER=$(grep "\- \[ \]" ./tmp/HOUSEKEEPING.md | wc -l)
echo "Tasks before $TASKS_BEFORE and after $TASKS_AFTER"
