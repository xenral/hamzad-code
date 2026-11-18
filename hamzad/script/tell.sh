#!/usr/bin/env bash
# After a failed step on a runner: leaves the end of each log a step kept (hamzad-*.log in the
# runner's temporary directory) as an annotation, which shows on the run's page without opening
# the log itself.
cd "${RUNNER_TEMP:-/tmp}" || exit 0
for log in hamzad-*.log; do
  [ -f "$log" ] || continue
  text=$(tail -n 30 "$log" | perl -pe 's/\e\[[0-9;?]*[A-Za-z]//g; s/\r//g' | cut -c1-300)
  text=${text//'%'/'%25'}
  text=${text//$'\n'/'%0A'}
  echo "::error title=${log%.log}::$text"
done
